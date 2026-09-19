// ─── pi2pi Admin Backend ─────────────────────────────────────────────
// All admin endpoints, auth middleware, and helpers in one module.
// Imported by server-arc.js.
//
// Endpoints:
//   POST /api/admin/login         — email + password → cookie
//   POST /api/admin/logout
//   GET  /api/admin/me            — current admin info (requires auth)
//   GET  /api/admin/stats         — overview metrics
//   GET  /api/admin/users         — paginated user list
//   GET  /api/admin/users/:addr   — user detail
//   GET  /api/admin/contracts     — active + recent contracts
//   GET  /api/admin/promocodes    — list
//   POST /api/admin/promocodes    — generate batch
//   DELETE /api/admin/promocodes/:code — revoke
//   GET  /api/admin/admins        — list admins (Owner only)
//   POST /api/admin/admins        — create admin (Owner only)
//   PATCH /api/admin/admins/:id   — update admin (Owner only)
//   GET  /api/admin/audit         — audit log
//   GET  /api/admin/system-health — on-chain diagnostics & wiring check
//   GET  /api/admin/wallet/:addr/diagnostics — full wallet diagnostic report

import bcrypt from "bcryptjs";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { ethers } from "ethers";
import { deriveKeeperStatus } from "./keeper-heartbeat.js";
import { assertSupportedNetwork, pofNetworkFilterClause, isPofRowInScope } from "./network-config.js";

// ── On-chain config for dispute tracking (network-aware, fail-closed) ──
// admin_routes.js must never resolve its own RPC/contract addresses
// independently — it previously read a second, unrelated ARC_RPC env var
// that was never actually set in production, so it silently fell back to a
// hardcoded Arc Testnet RPC URL and Arc Testnet's manifest entry regardless
// of NETWORK. server-arc.js already resolves the verified RPC URL and
// contract addresses once at startup via network-config.js's
// resolveContractAddresses() (same manifest, same NETWORK env var, same
// fail-closed rules) — initAdminNetwork() injects those exact values here
// instead of re-deriving a second, divergent copy.
let ARC_RPC = null;
let RENTAL_ESCROW = null;
let PROPDEP_ESCROW = null;
// The runtime's expected chainId — used together with RENTAL_ESCROW to scope
// every active_contracts / archived_contracts query (see migrations/2026-
// 09-17-network-scope-contracts.sql). chain_id ALONE is not enough: Arc
// Testnet alone has had four RentalEscrow deployments sharing chainId
// 5042002 (active + historicalIntermediate + legacy x2), so every scoped
// query below filters by BOTH chain_id and escrow_address, mirroring the
// RPC/contract-address injection above.
let ADMIN_CHAIN_ID = null;
// The runtime's network name ("arc-testnet"/"arc-mainnet") — TASK 10I.
// Needed separately from ADMIN_CHAIN_ID because `listings.network` stores
// this string, not the chainId, so admin routes reading the `listings`
// table (e.g. the landlord→listingId lookup in GET /api/admin/users, and
// the per-user listing history in the wallet diagnostics route) can stay
// scoped to their own runtime instead of mixing in the other network's rows.
let ADMIN_NETWORK = null;

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
function isValidNonZeroAddress(addr) {
  return typeof addr === "string" && ADDRESS_RE.test(addr) && addr.toLowerCase() !== ZERO_ADDRESS;
}

/**
 * Called once by server-arc.js at startup, immediately after it resolves
 * NETWORK/RPC_URL/RentalEscrow/PropDepEscrow/chainId. Fails closed (throws)
 * on anything missing or malformed — admin routes must never run against an
 * unset, zero, or malformed RPC/address/chainId.
 */
export function initAdminNetwork({ rpc, rentalEscrow, propDepEscrow, chainId, network }) {
  if (!rpc || typeof rpc !== "string") {
    throw new Error("initAdminNetwork: rpc is required");
  }
  if (!isValidNonZeroAddress(rentalEscrow)) {
    throw new Error(`initAdminNetwork: rentalEscrow is not a valid non-zero address: "${rentalEscrow}"`);
  }
  if (!isValidNonZeroAddress(propDepEscrow)) {
    throw new Error(`initAdminNetwork: propDepEscrow is not a valid non-zero address: "${propDepEscrow}"`);
  }
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`initAdminNetwork: chainId must be a positive integer, got: ${JSON.stringify(chainId)}`);
  }
  assertSupportedNetwork(network); // throws NetworkConfigError on anything unrecognized
  ARC_RPC = rpc;
  RENTAL_ESCROW = rentalEscrow.toLowerCase();
  PROPDEP_ESCROW = propDepEscrow.toLowerCase();
  ADMIN_CHAIN_ID = chainId;
  ADMIN_NETWORK = network;
}

// ── `events` table network scoping (TASK 10J) ───────────────────────────
// The `events` table (supabase/admin_schema.sql) has no network/chain_id
// column and, as of this task, no live write path anywhere in this codebase
// (verified: no `.from("events").insert(...)` call in server-arc.js,
// admin_routes.js, or arc/src, and no such call in this repo's git history
// for those files either — and the production table is currently empty).
// Only some of its event types describe marketplace/chain-specific actions
// (a listing view, a contract start) — others describe identity/social
// actions that aren't tied to a specific network any more than a chat
// message is (see server-arc.js's `messages` table, deliberately left
// unscoped for the same reason). Only the marketplace subset needs scoping;
// forcing a network tag onto e.g. "register" would be undue scope creep.
const MARKETPLACE_EVENT_TYPES = new Set(["post_listing", "view_listing", "request_viewing", "start_contract", "sign_contract"]);

// Mirrors server-arc.js's applyPofNetworkScope(): Mainnet only ever sees
// events explicitly tagged `network='arc-mainnet'`; Testnet transitionally
// also sees untagged rows (there is currently no write path stamping
// `network` at all, so every future row would otherwise be invisible on
// Testnet too, which is the one network real traffic has ever come from).
function applyEventsNetworkScope(query, column = "network") {
  const clause = pofNetworkFilterClause(column, ADMIN_NETWORK);
  return clause.mode === "eq" ? query.eq(clause.column, clause.value) : query.or(clause.filter);
}

// Pre-computed selectors (verified via `cast sig`).
const SEL_GET_STATE     = "0x44c9af28";  // getState(uint256) — same on both contracts
const SEL_IS_FREEZE_EXP = "0xb79adecc";  // isFreezeExpired(uint256)
const SEL_AGREEMENTS    = "0xbd14de96";  // agreements(uint256) — RentalEscrow mapping
const SEL_PROPDEPS      = "0xc31c2c55";  // propDeps(uint256)    — PropDepEscrow mapping

// Rental state enum → label (matches contracts/src/RentalEscrow.sol State enum)
const RENTAL_STATES = [
  "Created", "AwaitingLandlordDep", "AwaitingTenantDep", "Active",
  "EarlyTermProposed", "CheckoutProposed", "DamageClaimed", "DisputeOpen",
  "Settled", "LeaseEnded",
];
// Rental states that represent an open dispute or pending-resolution state
const RENTAL_DISPUTE_STATES = new Set([4, 5, 7]);

// PropDep state enum (contracts/src/PropDepEscrow.sol)
const PROPDEP_STATES = ["None", "Active", "Claimed", "Disputed", "Frozen", "Settled"];
const PROPDEP_DISPUTE_STATES = new Set([2, 3, 4]);

// TermType enum (RentalEscrow.sol)
const TERM_TYPES = ["None", "Mutual", "InitiatorAccepts", "Disputed"];

// Agreement struct word layout — public mapping auto-getter returns flat tuple of 40 static fields.
const AGR_W = {
  tenant: 0, landlord: 1, monthlyRent: 2,
  commitmentDeposit: 3, hostingDeposit: 4, propSecurityDeposit: 5,
  leaseDurationMonths: 6, createdAt: 7, activatedAt: 8, leaseEndTime: 9,
  state: 10, tenantDeposited: 11, landlordDeposited: 12, firstRentPaid: 13,
  lastRentTimestamp: 14, rentPaymentsMade: 15,
  landlordWantsRenew: 16, tenantWantsRenew: 17, landlordVoted: 18, tenantVoted: 19,
  damageClaim: 20, damageClaimDeadline: 21,
  tenantAcceptedClaim: 22, tenantDisputedClaim: 23,
  disputeBond: 24, disputeBondPoster: 25, freezeStart: 26, freezeDuration: 27,
  earlyTermType: 28, earlyTermInitiator: 29, earlyTermProposedAt: 30,
  checkoutStartedAt: 31,
  mutualSettlementProposer: 32, mutualSettlementToLandlord: 33, mutualSettlementToTenant: 34,
  earlySettlementMode: 35, contentHash: 36,
  hasPropDep: 37, rentGraceExtension: 38, vacateDeadline: 39,
};

// PropDep struct word layout
const PD_W = {
  leaseId: 0, tenant: 1, landlord: 2, amount: 3, state: 4,
  leaseEndTime: 5, windowStart: 6, windowEnd: 7,
  claimAmount: 8, claimDeadline: 9, tenantAccepted: 10, tenantDisputed: 11,
  disputeBond: 12, bondPoster: 13, freezeStart: 14,
  settlementProposer: 15, settlementToLandlord: 16, settlementToTenant: 17,
};

async function arcEthCall(to, data) {
  try {
    const r = await fetch(ARC_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to, data }, "latest"] }),
    });
    const j = await r.json();
    return typeof j?.result === "string" ? j.result : null;
  } catch { return null; }
}

function encUint256(n) {
  return BigInt(n).toString(16).padStart(64, "0");
}

/// Send a transaction from the deployer/owner wallet to a contract.
async function sendOwnerTx(to, data, privateKey) {
  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  const tx = await wallet.sendTransaction({ to, data, type: 0 }); // legacy tx for Arc Testnet
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error("Transaction reverted");
  return { hash: tx.hash };
}

// Decode ABI-encoded uint8 or bool from a 32-byte eth_call return
function decodeU8(hex) {
  if (!hex || hex === "0x") return null;
  return parseInt(hex.slice(-2) || "0", 16);
}

// ── Event topic hashes (from `cast keccak "EventName(args)"`) ─────────
const TOPIC_AGREEMENT_SETTLED  = "0x1970c22e337565408654f9069320d0ef9054de15c76717d62a6667579cfedba4";
const TOPIC_PROPDEP_SETTLED    = "0x9ecd6f6a38ebbc0c63f4fd200fe28cc40b86b66dc302a786f6f9da97035be761";
// Block scan window: last 2M blocks (~2-4 days on Arc, covers current contract deployment history)
const HISTORY_SCAN_WINDOW      = 2_000_000;
const GETLOGS_CHUNK            = 10_000;

// Classify settle reason → outcome category. Reasons that aren't disputes at all
// are flagged isDispute=false so the UI can hide them.
function classifyOutcome(reason, source) {
  const r = reason || "";
  const rental = {
    clean_checkout:          { label: "Clean checkout",     color: "#059669", isDispute: false },
    lease_ended:             { label: "Lease ended",        color: "#059669", isDispute: false },
    cancelled_created:       { label: "Cancelled (no deposits)", color: "#6b7280", isDispute: false },
    cancelled_unfunded:      { label: "Cancelled (unfunded)",    color: "#6b7280", isDispute: false },
    rent_missed:             { label: "Rent missed → LL",   color: "#dc2626", isDispute: true },
    exit_with_loss:          { label: "Exit with loss",     color: "#b45309", isDispute: true },
    early_term_mutual:       { label: "Mutual exit",        color: "#059669", isDispute: true },
    early_term_expired:      { label: "ET timeout → return", color: "#6b7280", isDispute: true },
    initiator_conceded:      { label: "Initiator conceded", color: "#dc2626", isDispute: true },
    dispute_exit_accepted:   { label: "Claim accepted",     color: "#059669", isDispute: true },
    dispute_cancelled:       { label: "Dispute cancelled",  color: "#dc2626", isDispute: true },
    freeze_expired:          { label: "Dispute expired",    color: "#6366f1", isDispute: true, detail: "60-day freeze expired. Deposits returned to original owners." },
    early_settlement_all_funds: { label: "Mutual mid-freeze", color: "#059669", isDispute: true },
    emergency_settled_expired: { label: "Emergency (180d)", color: "#b45309", isDispute: true },
  };
  const propdep = {
    window_expired_no_claim: { label: "No claim → tenant",   color: "#059669", isDispute: false, detail: "No damage claimed. Full deposit returned to tenant." },
    released_early_no_claim: { label: "LL released early",   color: "#059669", isDispute: false, detail: "Landlord confirmed no damage. Full deposit returned to tenant." },
    claim_accepted:          { label: "Claim accepted",       color: "#b45309", isDispute: true, detail: "Tenant accepted damage claim. Claim amount paid to landlord, remainder to tenant." },
    claim_auto_executed:     { label: "Tenant silent → LL",  color: "#b45309", isDispute: true, detail: "Tenant did not respond within 3 days. Claim auto-executed, paid to landlord." },
    claim_withdrawn:         { label: "LL withdrew claim",    color: "#6b7280", isDispute: true, detail: "Landlord withdrew damage claim. Full deposit returned to tenant." },
    claim_dropped_no_bond:   { label: "LL didn't bond → return", color: "#6b7280", isDispute: true, detail: "Landlord did not post bond after tenant disputed. Claim dropped, deposit returned to tenant." },
    claim_accepted_after_bond: { label: "Tenant conceded after bond", color: "#dc2626", isDispute: true, detail: "Tenant conceded after landlord posted bond. Claim paid to landlord." },
    dispute_cancelled:       { label: "LL cancelled freeze", color: "#6b7280", isDispute: true, detail: "Landlord cancelled dispute. Bond penalty to tenant. Deposit returned." },
    freeze_expired:          { label: "Dispute expired",     color: "#6366f1", isDispute: true, detail: "Dispute expired unresolved. Property deposit returned to tenant. Landlord bond returned to landlord. No claim paid." },
    mutual_settlement:       { label: "Mutual split",        color: "#059669", isDispute: true, detail: "Both parties agreed on split during freeze." },
  };
  const table = source === "propdep" ? propdep : rental;
  return table[r] || { label: r || "Unknown", color: "#6b7280", isDispute: true };
}

// Decode dynamic string from data hex (ABI layout: offset(32) + length(32) + bytes padded)
function decodeDynamicString(dataHex) {
  if (!dataHex || dataHex.length < 2 + 128) return "";
  const body = dataHex.slice(2);
  // first 32 bytes = offset (always 0x20 for single dynamic param)
  // next 32 bytes = length
  const lenHex = body.slice(64, 128);
  const len = parseInt(lenHex, 16);
  if (!len) return "";
  const bytesHex = body.slice(128, 128 + len * 2);
  try {
    return Buffer.from(bytesHex, "hex").toString("utf8");
  } catch { return ""; }
}

// Parallel eth_getLogs over [from, to] in GETLOGS_CHUNK increments.
// Returns flat array of logs sorted by blockNumber asc.
async function scanLogs(contract, topic, fromBlock, toBlock) {
  const ranges = [];
  for (let b = fromBlock; b <= toBlock; b += GETLOGS_CHUNK) {
    ranges.push([b, Math.min(b + GETLOGS_CHUNK - 1, toBlock)]);
  }
  const batchSize = 20; // max 20 concurrent to the public RPC
  const out = [];
  for (let i = 0; i < ranges.length; i += batchSize) {
    const slice = ranges.slice(i, i + batchSize);
    const results = await Promise.all(slice.map(async ([lo, hi]) => {
      try {
        const r = await fetch(ARC_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getLogs", id: 1, params: [{
            fromBlock: "0x" + lo.toString(16),
            toBlock:   "0x" + hi.toString(16),
            address: contract,
            topics: [topic],
          }] }),
        });
        const j = await r.json();
        return Array.isArray(j?.result) ? j.result : [];
      } catch { return []; }
    }));
    for (const arr of results) out.push(...arr);
  }
  out.sort((a, b) => parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16));
  return out;
}

// In-memory cache for history scan (5 min TTL)
let HISTORY_CACHE = { ts: 0, data: null };
const HISTORY_TTL_MS = 5 * 60 * 1000;

// Slice N-th 32-byte word from a hex response string "0x..."
function sliceWord(hex, idx) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("0x")) return null;
  const start = 2 + idx * 64;
  const s = hex.slice(start, start + 64);
  return s.length === 64 ? "0x" + s : null;
}
function wordToAddress(w) { return w ? ("0x" + w.slice(-40)) : null; }
function wordToNum(w) { try { return w ? Number(BigInt(w)) : 0; } catch { return 0; } }
function wordToBool(w) { try { return w ? BigInt(w) !== 0n : false; } catch { return false; } }

// ── Session token format ────────────────────────────────────────────
// Signed cookie: base64(JSON {id, email, role, exp}).hmac
// Validates in O(1) without DB lookup.
//
// ADMIN_SESSION_SECRET env var required (long random string).
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "";
const SESSION_TTL_SEC = 24 * 60 * 60; // 24 hours

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}

function verifySession(token) {
  if (!token || typeof token !== "string" || !SESSION_SECRET) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  // Timing-safe comparison to prevent timing attacks
  try {
    const sigBuf = Buffer.from(sig, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || "";
  header.split(";").forEach(p => {
    const [k, ...v] = p.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  });
  return out;
}

// ── Get current admin from request (returns null if not authenticated) ──
function getAdminFromReq(req) {
  const cookies = parseCookies(req);
  return verifySession(cookies["pi2pi_admin"]);
}

// ── Audit log helper ────────────────────────────────────────────────
async function audit(supabase, admin, action, target, metadata) {
  try {
    await supabase.from("admin_audit").insert({
      admin_id: admin.id,
      admin_email: admin.email,
      action,
      target: target || null,
      metadata: metadata || null,
    });
  } catch (e) { console.error("[admin/audit]", e.message); }
}

// ── Promocode generator ─────────────────────────────────────────────
function generatePromocode(prefix = "PI2PI") {
  // Format: PREFIX-XXXX-XXXX (alphanumeric, no confusing chars like 0/O 1/I)
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars (5 bits each)
  const buf = randomBytes(8);
  let s1 = "", s2 = "";
  for (let i = 0; i < 4; i++) s1 += ALPHA[buf[i] % 32];
  for (let i = 4; i < 8; i++) s2 += ALPHA[buf[i] % 32];
  return `${prefix}-${s1}-${s2}`;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLER — call from server-arc.js as: await handleAdmin(req, res, supabase, path)
// Returns true if handled, false if path doesn't match /api/admin/*
// ═══════════════════════════════════════════════════════════════════
const json = (res, data, status = 200) => {
  // No wildcard CORS — admin endpoints inherit server-level CORS from server-arc.js
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};
const readBody = (req) => new Promise(r => { let b = ""; req.on("data", c => b += c); req.on("end", () => { try { r(JSON.parse(b)); } catch { r(null); } }); });

export async function handleAdmin(req, res, supabase, path) {
  if (!path.startsWith("/api/admin/")) return false;

  if (!ARC_RPC || !RENTAL_ESCROW || !PROPDEP_ESCROW || !ADMIN_CHAIN_ID || !ADMIN_NETWORK) {
    return json(res, { error: "Server misconfigured: admin network not initialized (initAdminNetwork was not called)" }, 500);
  }

  if (!SESSION_SECRET) {
    return json(res, { error: "Server misconfigured: ADMIN_SESSION_SECRET not set" }, 500);
  }

  // ── Login rate limiting (per IP, 5 attempts per 60s) ──────────────
  const LOGIN_WINDOW_MS = 60_000;
  const LOGIN_MAX = 5;
  if (!handleAdmin._loginAttempts) handleAdmin._loginAttempts = new Map();
  const loginLimiter = handleAdmin._loginAttempts;
  // Cleanup old entries every call (cheap for small map)
  const now = Date.now();
  for (const [k, v] of loginLimiter) { if (now - v.firstAt > LOGIN_WINDOW_MS) loginLimiter.delete(k); }

  // ── Public: login ─────────────────────────────────────────────────
  if (path === "/api/admin/login" && req.method === "POST") {
    const body = await readBody(req);
    const email = (body?.email || "").toLowerCase().trim();
    const password = body?.password || "";
    if (!email || !password) return json(res, { error: "Invalid credentials" }, 400);

    // Rate limit by IP
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
    const limiterKey = ip;
    const entry = loginLimiter.get(limiterKey) || { count: 0, firstAt: now };
    entry.count++;
    loginLimiter.set(limiterKey, entry);
    if (entry.count > LOGIN_MAX) return json(res, { error: "Too many login attempts. Try again later." }, 429);

    const { data: user, error } = await supabase
      .from("admin_users")
      .select("id,email,password_hash,role,display_name,active")
      .eq("email", email)
      .eq("active", true)
      .maybeSingle();

    if (error || !user) return json(res, { error: "Invalid email or password" }, 401);

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return json(res, { error: "Invalid email or password" }, 401);

    // Update last_login
    await supabase.from("admin_users").update({ last_login: new Date().toISOString() }).eq("id", user.id);

    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
    const token = signSession({ id: user.id, email: user.email, role: user.role, exp });

    // Generate admin CSRF token for double-submit protection
    const adminCsrf = randomBytes(24).toString("base64url");
    // Multiple Set-Cookie headers must be passed as array (not comma-joined)
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": [
        `pi2pi_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SEC}`,
        `pi2pi_admin_csrf=${adminCsrf}; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SEC}`,
      ],
    });
    res.end(JSON.stringify({ ok: true, csrf: adminCsrf, admin: { id: user.id, email: user.email, role: user.role, displayName: user.display_name } }));
    await audit(supabase, user, "login", user.email, null);
    return true;
  }

  // ── Public: logout ────────────────────────────────────────────────
  if (path === "/api/admin/logout" && req.method === "POST") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": "pi2pi_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
    });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Authenticated routes from here on ────────────────────────────
  const admin = getAdminFromReq(req);
  if (!admin) return json(res, { error: "Unauthorized" }, 401);

  // CSRF check for mutating endpoints (POST/PATCH/DELETE, except login/logout)
  if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
    const csrfHeader = req.headers["x-admin-csrf-token"];
    const csrfCookie = parseCookies(req)["pi2pi_admin_csrf"];
    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
      console.warn("[admin-csrf] REJECTED:", req.method, path, "header:", csrfHeader ? "present" : "MISSING", "cookie:", csrfCookie ? "present" : "MISSING");
      return json(res, { error: "CSRF token missing or invalid" }, 403);
    }
  }

  // Helpers for role gating
  const requireOwner = () => admin.role === "owner";
  const requireWrite = () => admin.role === "owner" || admin.role === "manager";

  // ── /api/admin/me — current admin info ────────────────────────────
  if (path === "/api/admin/me" && req.method === "GET") {
    return json(res, { id: admin.id, email: admin.email, role: admin.role });
  }

  // ── /api/admin/stats — overview metrics ──────────────────────────
  if (path === "/api/admin/stats" && req.method === "GET") {
    const [users, contracts, listings, promosUsed, promosUnused, msgs, viewings, proposals, earlyTerms, views] = await Promise.all([
      supabase.from("users").select("addr,data"),
      supabase.from("active_contracts").select("addr,data").eq("chain_id", ADMIN_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW),
      supabase.from("users").select("addr,data").not("data->listing", "is", null),
      supabase.from("promocodes").select("code", { count: "exact", head: true }).not("used_by_addr", "is", null),
      supabase.from("promocodes").select("code", { count: "exact", head: true }).is("used_by_addr", null),
      supabase.from("messages").select("from_addr,to_addr"),
      supabase.from("viewing_requests").select("id", { count: "exact", head: true }),
      supabase.from("contract_proposals").select("id", { count: "exact", head: true }),
      supabase.from("early_terms").select("*"),
      // TASK 10J: view_listing is a marketplace event — scoped so a Mainnet
      // admin dashboard never counts Testnet listing views (or vice versa).
      applyEventsNetworkScope(supabase.from("events").select("id", { count: "exact", head: true }).eq("event", "view_listing")),
    ]);

    const allUsers = users.data || [];
    const landlords = allUsers.filter(u => u.data?.role === "landlord").length;
    const tenants = allUsers.filter(u => u.data?.role === "tenant").length;
    const insufficientFunds = allUsers.filter(u => u.data?.fundsCheckFailed).length;

    // Identity verifications
    const worldIdVerified = allUsers.filter(u => u.data?.verifications?.worldid?.verified === true).length;
    const circleBiometric = allUsers.filter(u => u.data?.circleBiometric === true || u.data?.walletType === "circle").length;

    // Wallet type breakdown — normalize legacy "metamask" to "injected"
    const wallets = { circle: 0, injected: 0, walletconnect: 0, unknown: 0 };
    allUsers.forEach(u => {
      const t = u.data?.walletType;
      if (t === "circle") wallets.circle++;
      else if (t === "injected" || t === "metamask") wallets.injected++;
      else if (t === "walletconnect") wallets.walletconnect++;
      else wallets.unknown++;
    });

    // Cities histogram
    const cities = {};
    allUsers.forEach(u => {
      const city = u.data?.listing?.city;
      if (city) cities[city] = (cities[city] || 0) + 1;
    });

    // Chats — count unique conversation pairs (a,b == b,a)
    const conversationKeys = new Set();
    (msgs.data || []).forEach(m => {
      if (m.from_addr && m.to_addr) {
        conversationKeys.add([m.from_addr.toLowerCase(), m.to_addr.toLowerCase()].sort().join("-"));
      }
    });

    // TVL estimate from active_contracts — Equal Stakes Protocol:
    // per contract = commitment (1x rent) + hosting (1x rent) + optional propDep
    // active_contracts stores 2 rows per contract (landlord + tenant), so dedupe by pair first.
    // propDep is stored only on tenant row → take max across pair.
    const activeContracts = contracts.data || [];
    const contractByPair = new Map();
    activeContracts.forEach(c => {
      const a = (c.data?.addr || "").toLowerCase();
      const b = (c.data?.peerAddr || "").toLowerCase();
      if (!a || !b) return;
      const key = [a, b].sort().join("-");
      const existing = contractByPair.get(key) || { rent: 0, propDep: 0 };
      existing.rent    = Math.max(existing.rent,    Number(c.data?.listing?.price || 0));
      existing.propDep = Math.max(existing.propDep, Number(c.data?.propDepAmount || 0));
      contractByPair.set(key, existing);
    });

    let tvlEstimate = 0;
    let propDepTotal = 0;
    contractByPair.forEach(c => {
      tvlEstimate += c.rent * 2 + c.propDep; // commitment + hosting + property security deposit
      propDepTotal += c.propDep;
    });
    const uniqueContracts = contractByPair;

    // Disputes — count early_terms rows with "disputed" intent or active dispute state
    const disputes = (earlyTerms.data || []).filter(r => {
      const s = (r.status || r.state || "").toString().toLowerCase();
      return s.includes("disput") || s.includes("frozen") || s === "open";
    }).length;

    return json(res, {
      users: {
        total: allUsers.length,
        landlords,
        tenants,
        insufficientFunds,
      },
      listings: {
        total: (listings.data || []).length,
        views: views.count || 0, // 0 until /api/events tracking is wired into main app
      },
      contracts: {
        active: uniqueContracts.size,
        rowsRaw: activeContracts.length,
      },
      chats: {
        conversations: conversationKeys.size,
        messages: (msgs.data || []).length,
      },
      engagement: {
        viewingRequests: viewings.count || 0,
        contractProposals: proposals.count || 0,
      },
      disputes: {
        total: disputes,
        earlyTermRequests: (earlyTerms.data || []).length,
      },
      economics: {
        tvlEstimate,                // USDC locked (approx, DB-based)
        propDepTotal,               // Property security deposits share of TVL
        lendingActive: false,       // true once Sprint 3b Aave integration ships
        lendingApy: null,           // set to current Aave v3 USDC supply APY once live
        platformProfitTotal: 0,     // 30% of realized yield — 0 until lending live
      },
      promocodes: {
        used: promosUsed.count || 0,
        unused: promosUnused.count || 0,
      },
      identity: {
        worldIdVerified,
        circleBiometric,
        coinbaseVerified: null, // not tracked server-side yet (EAS client-side only)
      },
      wallets,
      cities,
    });
  }

  // ── /api/admin/users — paginated list ────────────────────────────
  if (path === "/api/admin/users" && req.method === "GET") {
    const limit = parseInt(url("/api/admin/users", req).get("limit") || "100", 10);
    const offset = parseInt(url("/api/admin/users", req).get("offset") || "0", 10);
    const role = url("/api/admin/users", req).get("role");

    let q = supabase.from("users").select("addr,data,updated_at", { count: "exact" }).order("updated_at", { ascending: false }).range(offset, offset + limit - 1);
    if (role) q = q.eq("data->>role", role);
    const { data, count, error } = await q;
    if (error) return json(res, { error: error.message }, 500);

    // Also fetch listings for landlords to get listingId
    const landlordAddrs = (data || []).filter(u => u.data?.role === "landlord").map(u => u.addr);
    let listingMap = {};
    if (landlordAddrs.length > 0) {
      // TASK 10I: `listings.network` is fully backfilled and always stamped
      // at write time — strict equality, no NULL-inclusive fallback needed.
      const { data: listings } = await supabase.from("listings").select("id,owner_addr,status").in("owner_addr", landlordAddrs).eq("status", "active").eq("network", ADMIN_NETWORK);
      (listings || []).forEach(l => { if (!listingMap[l.owner_addr]) listingMap[l.owner_addr] = l.id; });
    }
    const items = (data || []).map(u => ({
      addr: u.addr,
      name: u.data?.display_name || null,
      role: u.data?.role,
      city: u.data?.listing?.city || u.data?.intent?.city,
      propType: u.data?.listing?.propType || u.data?.intent?.propType,
      propertyType: u.data?.listing?.propertyType,
      rent: u.data?.listing?.rent || u.data?.listing?.budget || u.data?.intent?.budget,
      listingId: listingMap[u.addr] || null,
      lastBalance: u.data?.lastBalance,
      lastBalanceCheck: u.data?.lastBalanceCheck,
      fundsCheckFailed: !!u.data?.fundsCheckFailed,
      walletType: u.data?.walletType || null,
      circleBiometric: !!(u.data?.circleBiometric || u.data?.walletType === "circle"),
      worldIdVerified: !!u.data?.verifications?.worldid?.verified,
      updatedAt: u.updated_at,
    }));
    return json(res, { items, total: count || 0, limit, offset });
  }

  // ── /api/admin/users/:addr — detail ──────────────────────────────
  const userMatch = path.match(/^\/api\/admin\/users\/(0x[0-9a-fA-F]+)$/);
  if (userMatch && req.method === "GET") {
    const addr = userMatch[1].toLowerCase();
    const [user, contract, viewings, msgs, events] = await Promise.all([
      supabase.from("users").select("data,updated_at").eq("addr", addr).maybeSingle(),
      supabase.from("active_contracts").select("data").eq("addr", addr).eq("chain_id", ADMIN_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW).maybeSingle(),
      supabase.from("viewing_requests").select("*").or(`from_addr.eq.${addr},to_addr.eq.${addr}`).order("created_at", { ascending: false }).limit(50),
      supabase.from("messages").select("from_addr,to_addr,created_at,event_type").or(`from_addr.eq.${addr},to_addr.eq.${addr}`).order("created_at", { ascending: false }).limit(20),
      // TASK 10J: fetched unscoped (this is already a small, bounded,
      // per-address query — not a global scan), then filtered below so a
      // Mainnet admin never sees this user's Testnet marketplace events.
      // Global/identity event types (not in MARKETPLACE_EVENT_TYPES) pass
      // through unfiltered, same as the messages/viewings above.
      supabase.from("events").select("*").eq("addr", addr).order("created_at", { ascending: false }).limit(50),
    ]);

    const scopedEvents = (events.data || []).filter(
      e => !MARKETPLACE_EVENT_TYPES.has(e.event) || isPofRowInScope(e.network, ADMIN_NETWORK)
    );

    return json(res, {
      addr,
      profile: user.data?.data || null,
      profileUpdated: user.data?.updated_at,
      activeContract: contract.data?.data || null,
      viewings: viewings.data || [],
      recentMessages: msgs.data || [],
      events: scopedEvents,
    });
  }

  // ── /api/admin/promocodes — list ──────────────────────────────────
  if (path === "/api/admin/promocodes" && req.method === "GET") {
    const { data, error } = await supabase.from("promocodes").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) return json(res, { error: error.message }, 500);
    const used = data.filter(p => p.used_by_addr).length;
    const unused = data.length - used;
    return json(res, { items: data, used, unused, total: data.length });
  }

  // ── /api/admin/promocodes — generate batch ──────────────────────
  if (path === "/api/admin/promocodes" && req.method === "POST") {
    if (!requireWrite()) return json(res, { error: "Forbidden" }, 403);
    const body = await readBody(req);
    const count = Math.min(Math.max(parseInt(body?.count || "1", 10), 1), 100);
    const prefix = (body?.prefix || "PI2PI").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 12) || "PI2PI";
    const expiresInDays = parseInt(body?.expiresInDays || "30", 10);
    const perks = body?.perks || { bypass_funds_check: true };
    const notes = body?.notes || null;

    const expiresAt = new Date(Date.now() + expiresInDays * 86400 * 1000).toISOString();
    const codes = [];
    for (let i = 0; i < count; i++) codes.push(generatePromocode(prefix));

    const rows = codes.map(code => ({ code, created_by: admin.id, expires_at: expiresAt, perks, notes }));
    const { error } = await supabase.from("promocodes").insert(rows);
    if (error) return json(res, { error: error.message }, 500);

    await audit(supabase, admin, "issue_promo_batch", null, { count, prefix, expiresInDays });
    return json(res, { ok: true, codes });
  }

  // ── /api/admin/promocodes/:code — revoke ─────────────────────────
  const promoMatch = path.match(/^\/api\/admin\/promocodes\/([A-Z0-9-]+)$/);
  if (promoMatch && req.method === "DELETE") {
    if (!requireWrite()) return json(res, { error: "Forbidden" }, 403);
    const code = promoMatch[1];
    const { error } = await supabase.from("promocodes").delete().eq("code", code).is("used_by_addr", null);
    if (error) return json(res, { error: error.message }, 500);
    await audit(supabase, admin, "revoke_promo", code, null);
    return json(res, { ok: true });
  }

  // ── /api/admin/admins — list (Owner only) ────────────────────────
  if (path === "/api/admin/admins" && req.method === "GET") {
    if (!requireOwner()) return json(res, { error: "Forbidden — Owner only" }, 403);
    const { data, error } = await supabase.from("admin_users").select("id,email,role,display_name,created_at,last_login,active").order("created_at", { ascending: false });
    if (error) return json(res, { error: error.message }, 500);
    return json(res, { items: data || [] });
  }

  // ── /api/admin/admins — create (Owner only) ──────────────────────
  if (path === "/api/admin/admins" && req.method === "POST") {
    if (!requireOwner()) return json(res, { error: "Forbidden — Owner only" }, 403);
    const body = await readBody(req);
    const email = (body?.email || "").toLowerCase().trim();
    const password = body?.password || "";
    const role = body?.role;
    const displayName = body?.displayName;

    if (!email || !password || !role) return json(res, { error: "email, password, role required" }, 400);
    if (!["manager", "support"].includes(role)) return json(res, { error: "role must be manager or support" }, 400);
    if (password.length < 8) return json(res, { error: "Password too short (min 8)" }, 400);

    const hash = await bcrypt.hash(password, 12);
    const { data, error } = await supabase.from("admin_users").insert({
      email, password_hash: hash, role, display_name: displayName, created_by: admin.id, active: true,
    }).select().single();
    if (error) return json(res, { error: error.message }, 500);

    await audit(supabase, admin, "create_admin", email, { role });
    return json(res, { ok: true, admin: { id: data.id, email: data.email, role: data.role } });
  }

  // ── /api/admin/admins/:id — update (Owner only) ──────────────────
  const adminUpdMatch = path.match(/^\/api\/admin\/admins\/(\d+)$/);
  if (adminUpdMatch && req.method === "PATCH") {
    if (!requireOwner()) return json(res, { error: "Forbidden — Owner only" }, 403);
    const id = parseInt(adminUpdMatch[1], 10);
    const body = await readBody(req);
    const update = {};
    if (typeof body?.active === "boolean") update.active = body.active;
    if (body?.role && ["manager", "support"].includes(body.role)) update.role = body.role;
    if (body?.displayName) update.display_name = body.displayName;
    if (body?.password && body.password.length >= 8) update.password_hash = await bcrypt.hash(body.password, 12);

    if (Object.keys(update).length === 0) return json(res, { error: "Nothing to update" }, 400);
    const { error } = await supabase.from("admin_users").update(update).eq("id", id);
    if (error) return json(res, { error: error.message }, 500);

    await audit(supabase, admin, "update_admin", String(id), update);
    return json(res, { ok: true });
  }

  // ── /api/admin/audit — audit log ──────────────────────────────────
  if (path === "/api/admin/audit" && req.method === "GET") {
    if (!requireOwner()) return json(res, { error: "Forbidden — Owner only" }, 403);
    const { data, error } = await supabase.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) return json(res, { error: error.message }, 500);
    return json(res, { items: data || [] });
  }

  // ── /api/admin/contracts — active contracts ──────────────────────
  if (path === "/api/admin/contracts" && req.method === "GET") {
    const { data, error } = await supabase.from("active_contracts").select("addr,data,updated_at").eq("chain_id", ADMIN_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW).order("updated_at", { ascending: false }).limit(500);
    if (error) return json(res, { error: error.message }, 500);
    return json(res, { items: data || [] });
  }

  // ── /api/admin/disputes — active disputes view ─────────────────
  // Reads unique contract pairs from active_contracts, calls on-chain
  // `getState(id)` on both RentalEscrow and PropDepEscrow via Arc RPC,
  // filters to dispute / pending-resolution states, returns enriched list.
  // Sources:
  //   RentalEscrow.State enum (0..9) — dispute-relevant: 4 EarlyTermProposed,
  //                                    5 CheckoutProposed, 7 DisputeOpen
  //   PropDepEscrow.PropDepState enum (0..5) — dispute-relevant: 2 Claimed,
  //                                    3 Disputed, 4 Frozen
  // For state=7 and state=4 (60-day freezes) it also calls isFreezeExpired.
  if (path === "/api/admin/disputes" && req.method === "GET") {
    const { data: rows, error } = await supabase
      .from("active_contracts")
      .select("addr,data,updated_at")
      .eq("chain_id", ADMIN_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW);
    if (error) return json(res, { error: error.message }, 500);

    // Dedupe by sorted-pair key; keep first row but merge missing fields from pair mate
    const byPair = new Map();
    (rows || []).forEach(row => {
      const d = row.data || {};
      const aid = d.agreementId ?? null;
      const a = (d.addr || row.addr || "").toLowerCase();
      const b = (d.peerAddr || "").toLowerCase();
      if (aid === null || aid === undefined || !a || !b) return;
      const key = [a, b].sort().join("-");
      const prev = byPair.get(key) || {};
      // If the first row was landlord, tenant fields might live on the other row — take max/longest
      const merged = {
        agreementId: aid,
        tenant: d.role === "tenant" ? a : (prev.tenant || (d.role === "landlord" ? b : null)),
        landlord: d.role === "landlord" ? a : (prev.landlord || (d.role === "tenant" ? b : null)),
        listing: d.listing || prev.listing || null,
        propDepAmount: Math.max(Number(d.propDepAmount || 0), Number(prev.propDepAmount || 0)) || 0,
        contractStartedAt: row.updated_at || prev.contractStartedAt,
      };
      byPair.set(key, merged);
    });

    // Query on-chain state for each pair in parallel (small N, single round trip each)
    const enriched = await Promise.all([...byPair.values()].map(async (p) => {
      const idHex = encUint256(p.agreementId);
      const [reHex, pdHex] = await Promise.all([
        arcEthCall(RENTAL_ESCROW, SEL_GET_STATE + idHex),
        arcEthCall(PROPDEP_ESCROW, SEL_GET_STATE + idHex),
      ]);
      const rentalState = decodeU8(reHex);
      let propdepState = decodeU8(pdHex);
      // If PropDep getState returns active but struct is empty → treat as settled
      if (propdepState > 0 && propdepState < 5) {
        try {
          const pdStructCheck = await arcEthCall(PROPDEP_ESCROW, SEL_PROPDEPS + idHex);
          const pdAmount = pdStructCheck && pdStructCheck.length > 2 + 4*64 ? Number(BigInt("0x" + pdStructCheck.slice(2 + 3*64, 2 + 4*64))) : 0;
          if (pdAmount === 0) propdepState = 5; // Settled
        } catch {}
      }
      const rentalInDispute = RENTAL_DISPUTE_STATES.has(rentalState);
      const propdepInDispute = PROPDEP_DISPUTE_STATES.has(propdepState);
      if (!rentalInDispute && !propdepInDispute) return null;

      // Second parallel round: full struct reads (for initiator / countdowns) + freeze checks
      const wantAgr = rentalInDispute;            // need Agreement struct for rental disputes
      const wantPd  = propdepInDispute;           // need PropDep struct for propdep disputes
      const wantReFreeze = rentalState === 7;     // rental 60-day freeze
      const wantPdFreeze = propdepState === 4;    // propdep 60-day freeze
      const [agrHex, pdStructHex, reFreezeHex, pdFreezeHex] = await Promise.all([
        wantAgr      ? arcEthCall(RENTAL_ESCROW,  SEL_AGREEMENTS    + idHex) : null,
        wantPd       ? arcEthCall(PROPDEP_ESCROW, SEL_PROPDEPS      + idHex) : null,
        wantReFreeze ? arcEthCall(RENTAL_ESCROW,  SEL_IS_FREEZE_EXP + idHex) : null,
        wantPdFreeze ? arcEthCall(PROPDEP_ESCROW, SEL_IS_FREEZE_EXP + idHex) : null,
      ]);

      // Rental struct extraction
      let rentalDetail = null;
      if (agrHex) {
        const earlyTermInitiator = wordToAddress(sliceWord(agrHex, AGR_W.earlyTermInitiator));
        const earlyTermType       = wordToNum(sliceWord(agrHex, AGR_W.earlyTermType));
        const disputeBondPoster   = wordToAddress(sliceWord(agrHex, AGR_W.disputeBondPoster));
        const freezeStart         = wordToNum(sliceWord(agrHex, AGR_W.freezeStart));
        const freezeDuration      = wordToNum(sliceWord(agrHex, AGR_W.freezeDuration));
        const earlyTermProposedAt = wordToNum(sliceWord(agrHex, AGR_W.earlyTermProposedAt));
        const checkoutStartedAt   = wordToNum(sliceWord(agrHex, AGR_W.checkoutStartedAt));
        const vacateDeadline      = wordToNum(sliceWord(agrHex, AGR_W.vacateDeadline));
        const initiatorIsTenant   = !!(earlyTermInitiator && p.tenant && earlyTermInitiator.toLowerCase() === p.tenant.toLowerCase());
        rentalDetail = {
          earlyTermInitiator,
          initiatorRole: earlyTermInitiator === "0x0000000000000000000000000000000000000000"
            ? null : (initiatorIsTenant ? "tenant" : "landlord"),
          earlyTermType,
          earlyTermTypeLabel: TERM_TYPES[earlyTermType] || `Unknown(${earlyTermType})`,
          disputeBondPoster,
          freezeStart, freezeDuration,
          freezeEndTs: freezeStart ? freezeStart + freezeDuration : 0,
          earlyTermProposedAt,
          responseDeadlineTs: earlyTermProposedAt ? earlyTermProposedAt + 7 * 86400 : 0, // 7d for state 4
          checkoutStartedAt,
          checkoutDeadlineTs: checkoutStartedAt ? checkoutStartedAt + 14 * 86400 : 0,    // 14d for state 5
          vacateDeadline,
        };
      }

      // PropDep struct extraction
      let propdepDetail = null;
      if (pdStructHex) {
        const claimAmountRaw     = wordToNum(sliceWord(pdStructHex, PD_W.claimAmount));
        const claimDeadline      = wordToNum(sliceWord(pdStructHex, PD_W.claimDeadline));
        const disputeBond        = wordToNum(sliceWord(pdStructHex, PD_W.disputeBond));
        const bondPoster         = wordToAddress(sliceWord(pdStructHex, PD_W.bondPoster));
        const pdFreezeStart      = wordToNum(sliceWord(pdStructHex, PD_W.freezeStart));
        propdepDetail = {
          claimAmountMicro: claimAmountRaw,
          claimAmountUsdc: claimAmountRaw / 1e6,
          claimDeadline,
          disputeBondMicro: disputeBond,
          bondPoster,
          freezeStart: pdFreezeStart,
          freezeEndTs: pdFreezeStart ? pdFreezeStart + 60 * 86400 : 0,  // default 60d
          // Response deadlines: tenant has 3d after claimDeadline-CLAIM_RESPONSE_PERIOD? No —
          // claimDeadline IS the tenant response deadline (set when claim filed).
          // Landlord must post bond within 3d AFTER claimDeadline.
          tenantResponseDeadlineTs: claimDeadline || 0,
          landlordBondDeadlineTs: claimDeadline ? claimDeadline + 3 * 86400 : 0,
        };
      }

      return {
        agreementId: String(BigInt(p.agreementId)),  // decimal string
        tenant: p.tenant,
        landlord: p.landlord,
        city: p.listing?.city || null,
        rent: p.listing?.rent || null,
        propDepAmount: p.propDepAmount || 0,
        contractStartedAt: p.contractStartedAt,
        rental: {
          state: rentalState,
          label: RENTAL_STATES[rentalState] ?? `Unknown(${rentalState})`,
          inDispute: rentalInDispute,
          freezeExpired: reFreezeHex ? decodeU8(reFreezeHex) === 1 : null,
          detail: rentalDetail,
        },
        propdep: {
          state: propdepState,
          label: PROPDEP_STATES[propdepState] ?? `Unknown(${propdepState})`,
          inDispute: propdepInDispute,
          freezeExpired: pdFreezeHex ? decodeU8(pdFreezeHex) === 1 : null,
          detail: propdepDetail,
        },
      };
    }));

    const items = enriched.filter(Boolean);
    // Bucket summary — what kind of attention each dispute needs
    const buckets = {
      needsResolutionRental: items.filter(i => i.rental.state === 7 && !i.rental.freezeExpired).length,
      keeperCanReleaseRental: items.filter(i => i.rental.state === 7 && i.rental.freezeExpired).length,
      needsResolutionPropdep: items.filter(i => i.propdep.state === 4 && !i.propdep.freezeExpired).length,
      keeperCanReleasePropdep: items.filter(i => i.propdep.state === 4 && i.propdep.freezeExpired).length,
      landlordClaimPendingTenant: items.filter(i => i.propdep.state === 2).length,
      awaitingBond: items.filter(i => i.propdep.state === 3).length,
      earlyTermProposed: items.filter(i => i.rental.state === 4).length,
      checkoutProposed: items.filter(i => i.rental.state === 5).length,
    };

    return json(res, {
      items,
      total: items.length,
      buckets,
      contractAddresses: {
        rentalEscrow: RENTAL_ESCROW,
        propDepEscrow: PROPDEP_ESCROW,
        rpc: ARC_RPC,
      },
    });
  }

  // ── /api/admin/disputes/history — resolved disputes with outcome ───
  // Scans AgreementSettled + PropDepSettled event logs on-chain (last 2M blocks)
  // and returns a list sorted by most recent. Classifies outcome via reason
  // string, hides non-dispute terminations (clean_checkout, lease_ended).
  // Cached 5 min in memory — force refresh via ?nocache=1.
  if (path === "/api/admin/disputes/history" && req.method === "GET") {
    const qs = new URL(req.url, "http://x").searchParams;
    const noCache = qs.get("nocache") === "1";
    const now = Date.now();
    if (!noCache && HISTORY_CACHE.data && (now - HISTORY_CACHE.ts) < HISTORY_TTL_MS) {
      return json(res, { ...HISTORY_CACHE.data, cached: true, cachedAgeSec: Math.floor((now - HISTORY_CACHE.ts) / 1000) });
    }

    // 1) Latest block
    let latest = 0;
    try {
      const r = await fetch(ARC_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 }),
      });
      const j = await r.json();
      latest = parseInt(j?.result || "0x0", 16);
    } catch (e) {
      return json(res, { error: "Failed to get latest block: " + e.message }, 500);
    }
    const fromBlock = Math.max(0, latest - HISTORY_SCAN_WINDOW);

    // 2) Scan both contracts in parallel
    const [rentalLogs, propdepLogs] = await Promise.all([
      scanLogs(RENTAL_ESCROW, TOPIC_AGREEMENT_SETTLED, fromBlock, latest),
      scanLogs(PROPDEP_ESCROW, TOPIC_PROPDEP_SETTLED, fromBlock, latest),
    ]);

    // 3) Decode each settled log → { id, reason, source, blockNumber, txHash }
    function decodeSettled(log, source) {
      const idTopic = log.topics?.[1];
      if (!idTopic) return null;
      return {
        agreementId: String(BigInt(idTopic)),
        reason: decodeDynamicString(log.data || "0x"),
        source,
        blockNumber: parseInt(log.blockNumber, 16),
        txHash: log.transactionHash,
        logIndex: parseInt(log.logIndex, 16),
      };
    }
    const decoded = [
      ...rentalLogs.map(l => decodeSettled(l, "rental")),
      ...propdepLogs.map(l => decodeSettled(l, "propdep")),
    ].filter(Boolean);

    // 4) Enrich each with parties from on-chain struct + classify outcome
    const enriched = await Promise.all(decoded.map(async (e) => {
      const idHex = encUint256(e.agreementId);
      const sel = e.source === "propdep" ? SEL_PROPDEPS : SEL_AGREEMENTS;
      const addr = e.source === "propdep" ? PROPDEP_ESCROW : RENTAL_ESCROW;
      const hex = await arcEthCall(addr, sel + idHex);
      const tenantWord = e.source === "propdep" ? sliceWord(hex, PD_W.tenant) : sliceWord(hex, AGR_W.tenant);
      const landlordWord = e.source === "propdep" ? sliceWord(hex, PD_W.landlord) : sliceWord(hex, AGR_W.landlord);
      const outcome = classifyOutcome(e.reason, e.source);

      // Block timestamp — use a single eth_getBlockByNumber per unique block
      // (caller-side batching not implemented here — small N, parallel is fine)
      let blockTimestamp = 0;
      try {
        const r = await fetch(ARC_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBlockByNumber", id: 1, params: ["0x" + e.blockNumber.toString(16), false] }),
        });
        const j = await r.json();
        blockTimestamp = parseInt(j?.result?.timestamp || "0x0", 16);
      } catch {}

      return {
        agreementId: e.agreementId,
        source: e.source,         // "rental" | "propdep"
        reason: e.reason,
        outcome,
        tenant: wordToAddress(tenantWord),
        landlord: wordToAddress(landlordWord),
        blockNumber: e.blockNumber,
        settledAt: blockTimestamp,
        txHash: e.txHash,
      };
    }));

    // 5) Filter to dispute-type only (hide clean_checkout / lease_ended)
    const disputes = enriched.filter(i => i.outcome.isDispute);

    // 6) Sort by blockNumber desc (most recent first)
    disputes.sort((a, b) => b.blockNumber - a.blockNumber);

    const result = {
      items: disputes,
      total: disputes.length,
      scanWindow: { fromBlock, toBlock: latest, blocks: latest - fromBlock },
      contractAddresses: { rentalEscrow: RENTAL_ESCROW, propDepEscrow: PROPDEP_ESCROW },
    };
    HISTORY_CACHE = { ts: now, data: result };
    return json(res, { ...result, cached: false, cachedAgeSec: 0 });
  }

  // ── /api/admin/disputes/history/:pair — chat timeline for a party pair
  // Returns all Supabase `messages` between the two addresses (any direction),
  // sorted chronologically. Used by the History detail modal as a human-readable
  // timeline of what happened in a finished dispute.
  const histPairMatch = path.match(/^\/api\/admin\/disputes\/history\/(0x[0-9a-fA-F]{40})\/(0x[0-9a-fA-F]{40})$/);
  if (histPairMatch && req.method === "GET") {
    const a = histPairMatch[1].toLowerCase();
    const b = histPairMatch[2].toLowerCase();
    const { data, error } = await supabase.from("messages").select("*")
      .or(`and(from_addr.eq.${a},to_addr.eq.${b}),and(from_addr.eq.${b},to_addr.eq.${a})`)
      .order("created_at", { ascending: true });
    if (error) return json(res, { error: error.message }, 500);
    return json(res, { items: data || [], total: (data || []).length });
  }

  // ══════════════════ CITY SETTINGS (min balance per city) ═════════════════
  const CITY_CONFIG_KEY = "__city_config__";

  // GET /api/admin/city-settings — list all city minimums
  if (path === "/api/admin/city-settings" && req.method === "GET") {
    const { data } = await supabase.from("users").select("data").eq("addr", CITY_CONFIG_KEY).maybeSingle();
    return json(res, data?.data?.cities || []);
  }

  // POST /api/admin/city-settings — save city minimums (full replace)
  if (path === "/api/admin/city-settings" && req.method === "POST") {
    if (admin.role === "support") return json(res, { error: "Insufficient permissions" }, 403);
    const body = await readBody(req);
    if (!Array.isArray(body?.cities)) return json(res, { error: "Expected { cities: [...] }" }, 400);
    // Validate each entry
    for (const c of body.cities) {
      c.min_balance = Number(c.min_balance) || 0;
      if (!c.city || c.min_balance < 0) {
        return json(res, { error: `Invalid entry: ${JSON.stringify(c)}` }, 400);
      }
    }
    await supabase.from("users").upsert({
      addr: CITY_CONFIG_KEY,
      data: { cities: body.cities },
      updated_at: new Date().toISOString()
    });
    try { await supabase.from("admin_audit").insert({ admin_id: admin.id, action: "city_settings_updated", metadata: { count: body.cities.length } }); } catch(e){}
    return json(res, { ok: true, count: body.cities.length });
  }

  // ── /api/admin/time-travel — warp contract time (testnet/dev only) ──
  if (path === "/api/admin/time-travel" && req.method === "POST") {
    if (admin.role !== "owner") return json(res, { error: "Only owner can time-travel" }, 403);
    if (process.env.ALLOW_ADMIN_TIME_TRAVEL !== "true") return json(res, { error: "Time travel is disabled in this environment" }, 403);
    // Chain safety: only allow on Arc Testnet (5042002)
    try {
      const chainHex = await fetch(ARC_RPC, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({jsonrpc:"2.0",method:"eth_chainId",id:1,params:[]}) }).then(r=>r.json()).then(j=>j.result);
      if (parseInt(chainHex, 16) !== 5042002) return json(res, { error: "Time travel blocked: not on Arc Testnet (chain " + parseInt(chainHex, 16) + ")" }, 403);
    } catch {}
    const body = await readBody(req);
    const { contract, delta, reset } = body || {};
    console.log("[time-travel] request by", admin.email, ":", JSON.stringify({ contract, delta, reset }));
    if (!contract) return json(res, { error: "Missing contract" }, 400);
    if (!reset && delta === undefined) return json(res, { error: "Missing delta or reset" }, 400);
    const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!DEPLOYER_KEY) return json(res, { error: "Server configuration error" }, 500); // never reveal key name
    const target = contract === "propdep" ? PROPDEP_ESCROW : RENTAL_ESCROW;
    let txData;
    if (reset) {
      // resetTime() — sets timeOffset to 0 without delta limit
      const resetSel = "0x65a114f1"; // resetTime()
      txData = resetSel;
    } else {
      const warpSel = "0x3ff85cc3"; // warp(int256)
      // Encode int256: positive = as-is, negative = two's complement
      const deltaBI = BigInt(delta);
      const encoded = deltaBI >= 0n
        ? deltaBI.toString(16).padStart(64, "0")
        : ((1n << 256n) + deltaBI).toString(16).padStart(64, "0");
      txData = warpSel + encoded;
    }
    try {
      const result = await sendOwnerTx(target, txData, DEPLOYER_KEY);
      try { await supabase.from("admin_audit").insert({ admin_id: admin.id, action: reset ? "time_reset" : "time_travel", metadata: { contract, delta: reset ? 0 : delta, txHash: result.hash } }); } catch {}
      return json(res, { ok: true, hash: result.hash, delta: reset ? 0 : delta, reset: !!reset });
    } catch (e) {
      return json(res, { error: e.message || "Transaction failed" }, 500);
    }
  }

  // ── /api/admin/time-travel/state — read contract time state ────────
  if (path === "/api/admin/time-travel/state" && req.method === "GET") {
    const qs = url("/api/admin/time-travel/state", req);
    const agrId = qs.get("id") || "0";
    // Read currentTime(), timeOffset, and agreement state from both contracts
    const selCurrentTime = "0xd18e81b3"; // currentTime()
    const [rentalTime, rentalState, propDepTime, propDepState] = await Promise.all([
      arcEthCall(RENTAL_ESCROW, selCurrentTime),
      arcEthCall(RENTAL_ESCROW, SEL_GET_STATE + encUint256(agrId)),
      arcEthCall(PROPDEP_ESCROW, selCurrentTime),
      arcEthCall(PROPDEP_ESCROW, SEL_GET_STATE + encUint256(agrId)),
    ]);
    // Read agreement details
    const agrHex = await arcEthCall(RENTAL_ESCROW, SEL_AGREEMENTS + encUint256(agrId));
    const pdHex = await arcEthCall(PROPDEP_ESCROW, SEL_PROPDEPS + encUint256(agrId));
    const w = (hex, idx) => hex && hex.length > 2 + (idx+1)*64 ? BigInt("0x" + hex.slice(2 + idx*64, 2 + (idx+1)*64)).toString() : "0";
    return json(res, {
      rental: {
        currentTime: rentalTime ? BigInt(rentalTime).toString() : null,
        state: rentalState ? parseInt(rentalState, 16) : null,
        stateName: RENTAL_STATES[rentalState ? parseInt(rentalState, 16) : 0] || "?",
        createdAt: w(agrHex, AGR_W.createdAt),
        activatedAt: w(agrHex, AGR_W.activatedAt),
        leaseEndTime: w(agrHex, AGR_W.leaseEndTime),
        lastRentTimestamp: w(agrHex, AGR_W.lastRentTimestamp),
        rentPaymentsMade: w(agrHex, AGR_W.rentPaymentsMade),
        freezeStart: w(agrHex, AGR_W.freezeStart),
        freezeDuration: w(agrHex, AGR_W.freezeDuration),
        checkoutStartedAt: w(agrHex, AGR_W.checkoutStartedAt),
        earlyTermProposedAt: w(agrHex, AGR_W.earlyTermProposedAt),
        tenant: agrHex && agrHex.length > 66 ? "0x" + agrHex.slice(2 + AGR_W.tenant*64 + 24, 2 + (AGR_W.tenant+1)*64) : null,
        landlord: agrHex && agrHex.length > 130 ? "0x" + agrHex.slice(2 + AGR_W.landlord*64 + 24, 2 + (AGR_W.landlord+1)*64) : null,
        monthlyRent: w(agrHex, AGR_W.monthlyRent),
      },
      propDep: {
        currentTime: propDepTime ? BigInt(propDepTime).toString() : null,
        // If struct is empty (amount=0) but getState returns non-zero, treat as settled
        state: (() => {
          const rawState = propDepState ? parseInt(propDepState, 16) : 0;
          const pdAmount = pdHex && pdHex.length > 2 + 4*64 ? Number(BigInt("0x" + pdHex.slice(2 + 3*64, 2 + 4*64))) : 0;
          return (rawState > 0 && rawState < 5 && pdAmount === 0) ? 5 : rawState; // 5 = Settled
        })(),
        stateName: (() => {
          const rawState = propDepState ? parseInt(propDepState, 16) : 0;
          const pdAmount = pdHex && pdHex.length > 2 + 4*64 ? Number(BigInt("0x" + pdHex.slice(2 + 3*64, 2 + 4*64))) : 0;
          const effectiveState = (rawState > 0 && rawState < 5 && pdAmount === 0) ? 5 : rawState;
          return PROPDEP_STATES[effectiveState] || "?";
        })(),
        windowStart: w(pdHex, PD_W.windowStart),
        windowEnd: w(pdHex, PD_W.windowEnd),
        claimDeadline: w(pdHex, PD_W.claimDeadline),
        freezeStart: w(pdHex, PD_W.freezeStart),
        amount: w(pdHex, PD_W.amount),
      },
    });
  }

  // ── /api/admin/contracts-overview — full on-chain contract list ─────
  if (path === "/api/admin/contracts-overview" && req.method === "GET") {
    // Step 1: get nextAgreementId
    const nextIdHex = await arcEthCall(RENTAL_ESCROW, "0xc9b99dab"); // nextAgreementId()
    if (!nextIdHex) return json(res, { error: "Failed to read nextAgreementId from chain" }, 500);
    const nextId = Number(BigInt(nextIdHex));
    if (nextId === 0) return json(res, { items: [], total: 0 });

    // Step 2: read all agreements in parallel (batches of 20 to not overload RPC)
    const ids = Array.from({ length: nextId }, (_, i) => i);
    const batchSize = 20;
    const items = [];

    for (let b = 0; b < ids.length; b += batchSize) {
      const batch = ids.slice(b, b + batchSize);
      const results = await Promise.all(batch.map(async (id) => {
        const idHex = encUint256(id);
        const [agrHex, stateHex, pdStateHex] = await Promise.all([
          arcEthCall(RENTAL_ESCROW, SEL_AGREEMENTS + idHex),
          arcEthCall(RENTAL_ESCROW, SEL_GET_STATE + idHex),
          arcEthCall(PROPDEP_ESCROW, SEL_GET_STATE + idHex),
        ]);
        if (!agrHex || agrHex === "0x") return null;

        const state = stateHex ? parseInt(stateHex, 16) : 0;
        let pdState = pdStateHex ? parseInt(pdStateHex, 16) : 0;
        // If getState returns active but struct has no funds → treat as settled
        if (pdState > 0 && pdState < 5) {
          try {
            const pdCheck = await arcEthCall(PROPDEP_ESCROW, SEL_PROPDEPS + idHex);
            const pdAmt = pdCheck && pdCheck.length > 2 + 4*64 ? Number(BigInt("0x" + pdCheck.slice(2 + 3*64, 2 + 4*64))) : 0;
            if (pdAmt === 0) pdState = 5;
          } catch {}
        }

        return {
          id,
          state,
          stateName: RENTAL_STATES[state] || `Unknown(${state})`,
          tenant: wordToAddress(sliceWord(agrHex, AGR_W.tenant)),
          landlord: wordToAddress(sliceWord(agrHex, AGR_W.landlord)),
          monthlyRent: String(BigInt(sliceWord(agrHex, AGR_W.monthlyRent) || "0x0")),
          commitmentDeposit: String(BigInt(sliceWord(agrHex, AGR_W.commitmentDeposit) || "0x0")),
          hostingDeposit: String(BigInt(sliceWord(agrHex, AGR_W.hostingDeposit) || "0x0")),
          propSecurityDeposit: String(BigInt(sliceWord(agrHex, AGR_W.propSecurityDeposit) || "0x0")),
          createdAt: wordToNum(sliceWord(agrHex, AGR_W.createdAt)),
          activatedAt: wordToNum(sliceWord(agrHex, AGR_W.activatedAt)),
          leaseEndTime: wordToNum(sliceWord(agrHex, AGR_W.leaseEndTime)),
          rentsPaid: wordToNum(sliceWord(agrHex, AGR_W.rentPaymentsMade)),
          lastRentTimestamp: wordToNum(sliceWord(agrHex, AGR_W.lastRentTimestamp)),
          freezeStart: wordToNum(sliceWord(agrHex, AGR_W.freezeStart)),
          freezeDuration: wordToNum(sliceWord(agrHex, AGR_W.freezeDuration)),
          propDepState: pdState,
          propDepStateName: PROPDEP_STATES[pdState] || `Unknown(${pdState})`,
        };
      }));
      for (const r of results) if (r) items.push(r);
    }

    return json(res, { items, total: items.length });
  }

  // ── /api/admin/logs — event logs with filtering ────────────────────
  if (path === "/api/admin/logs" && req.method === "GET") {
    const qs = url("logs", req);
    let query = supabase.from("event_logs").select("*").order("time", { ascending: false });
    const filterType = qs.get("type");
    if (filterType) query = query.eq("type", filterType);
    const filterUser = qs.get("user");
    if (filterUser) query = query.ilike("user_addr", filterUser.toLowerCase());
    const filterContract = qs.get("contract_id");
    if (filterContract) query = query.eq("contract_id", filterContract);
    const from = qs.get("from");
    if (from) query = query.gte("time", from);
    const to = qs.get("to");
    if (to) query = query.lte("time", to);
    const limit = parseInt(qs.get("limit") || "100", 10);
    query = query.limit(Math.min(limit, 1000));
    const { data, error } = await query;
    if (error) return json(res, { error: error.message }, 500);
    return json(res, { logs: data || [] });
  }

  // ── /api/admin/system-health — read-only on-chain diagnostics ──────
  if (path === "/api/admin/system-health" && req.method === "GET") {
    const warnings = [];
    const errors = [];

    // Helper: direct JSON-RPC call (not eth_call — for chain-level queries)
    const rpcCall = async (method, params = []) => {
      try {
        const r = await fetch(ARC_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method, id: 1, params }),
        });
        const j = await r.json();
        return j?.result ?? null;
      } catch { return null; }
    };

    // Selectors
    const SEL_OWNER            = "0x8da5cb5b"; // owner()
    const SEL_CURRENT_TIME     = "0xd18e81b3"; // currentTime()
    const SEL_NEXT_AGR_ID      = "0xc9b99dab"; // nextAgreementId()
    const SEL_PROPDEP_ESCROW   = "0x1164855d"; // propDepEscrow()
    const SEL_MAIN_CONTRACT    = "0xd270e7ab"; // mainContract()

    // Parallel on-chain reads
    const [
      chainIdHex, blockHex,
      rentalCode, propDepCode,
      rentalOwnerHex, propDepOwnerHex,
      propDepLinkHex, mainLinkHex,
      nextAgrIdHex,
      rentalTimeHex, propDepTimeHex,
    ] = await Promise.all([
      rpcCall("eth_chainId"),
      rpcCall("eth_blockNumber"),
      rpcCall("eth_getCode", [RENTAL_ESCROW, "latest"]),
      rpcCall("eth_getCode", [PROPDEP_ESCROW, "latest"]),
      arcEthCall(RENTAL_ESCROW, SEL_OWNER),
      arcEthCall(PROPDEP_ESCROW, SEL_OWNER),
      arcEthCall(RENTAL_ESCROW, SEL_PROPDEP_ESCROW),
      arcEthCall(PROPDEP_ESCROW, SEL_MAIN_CONTRACT),
      arcEthCall(RENTAL_ESCROW, SEL_NEXT_AGR_ID),
      arcEthCall(RENTAL_ESCROW, SEL_CURRENT_TIME),
      arcEthCall(PROPDEP_ESCROW, SEL_CURRENT_TIME),
    ]);

    const chainId = chainIdHex ? parseInt(chainIdHex, 16) : 0;
    const latestBlock = blockHex ? parseInt(blockHex, 16) : 0;
    const rentalBytecodeExists = !!(rentalCode && rentalCode !== "0x" && rentalCode.length > 2);
    const propDepBytecodeExists = !!(propDepCode && propDepCode !== "0x" && propDepCode.length > 2);

    const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
    const rentalEscrowOwner = rentalOwnerHex ? wordToAddress(sliceWord("0x" + rentalOwnerHex.slice(2).padStart(64, "0"), 0)) : null;
    const propDepEscrowOwner = propDepOwnerHex ? wordToAddress(sliceWord("0x" + propDepOwnerHex.slice(2).padStart(64, "0"), 0)) : null;
    const rentalPropDepLink = propDepLinkHex ? wordToAddress(sliceWord("0x" + propDepLinkHex.slice(2).padStart(64, "0"), 0)) : null;
    const propDepMainLink = mainLinkHex ? wordToAddress(sliceWord("0x" + mainLinkHex.slice(2).padStart(64, "0"), 0)) : null;

    const nextAgreementId = nextAgrIdHex ? Number(BigInt(nextAgrIdHex)) : 0;
    const rentalCurrentTime = rentalTimeHex ? Number(BigInt(rentalTimeHex)) : 0;
    const propDepCurrentTime = propDepTimeHex ? Number(BigInt(propDepTimeHex)) : 0;

    const wiringOk = !!(
      rentalPropDepLink && propDepMainLink &&
      rentalPropDepLink.toLowerCase() === PROPDEP_ESCROW &&
      propDepMainLink.toLowerCase() === RENTAL_ESCROW
    );

    // Extract RPC hostname only (no secrets/path)
    let rpcHost = "";
    try { rpcHost = new URL(ARC_RPC).hostname; } catch { rpcHost = "unknown"; }

    // Build warnings / errors
    if (chainId && chainId !== ADMIN_CHAIN_ID) warnings.push(`Unexpected chainId ${chainId} (expected ${ADMIN_CHAIN_ID})`);
    if (!rentalBytecodeExists) errors.push("RentalEscrow has no bytecode deployed");
    if (!propDepBytecodeExists) errors.push("PropDepEscrow has no bytecode deployed");
    if (!wiringOk) errors.push(`Contract wiring mismatch: propDepEscrow()=${rentalPropDepLink}, mainContract()=${propDepMainLink}`);
    if (rentalEscrowOwner === ZERO_ADDR) errors.push("RentalEscrow owner is zero address");
    if (propDepEscrowOwner === ZERO_ADDR) errors.push("PropDepEscrow owner is zero address");

    const ok = errors.length === 0;

    return json(res, {
      chainId,
      latestBlock,
      rpcHost,
      rentalEscrow: RENTAL_ESCROW,
      propDepEscrow: PROPDEP_ESCROW,
      rentalEscrowOwner,
      propDepEscrowOwner,
      rentalPropDepLink,
      propDepMainLink,
      nextAgreementId,
      rentalCurrentTime,
      propDepCurrentTime,
      bytecodeExists: { rental: rentalBytecodeExists, propDep: propDepBytecodeExists },
      wiringOk,
      envFlags: {
        REQUIRE_WALLET_AUTH: process.env.REQUIRE_WALLET_AUTH || null,
        ENABLE_ACCOUNT_RESET: process.env.ENABLE_ACCOUNT_RESET || null,
        NODE_ENV: process.env.NODE_ENV || null,
      },
      ok,
      warnings,
      errors,
    });
  }

  // ── /api/admin/wallet/:addr/diagnostics — full wallet diagnostic ────
  const diagMatch = path.match(/^\/api\/admin\/wallet\/(0x[0-9a-fA-F]+)\/diagnostics$/) && req.method === "GET";
  if (diagMatch) {
    const addr = path.match(/^\/api\/admin\/wallet\/(0x[0-9a-fA-F]+)\/diagnostics$/)[1].toLowerCase();

    // Parallel queries
    const [userRes, listingsRes, acRes, proposalsRes, viewingsRes, earlyTermsRes, msgCountRes] = await Promise.all([
      supabase.from("users").select("addr,data,updated_at").eq("addr", addr).maybeSingle(),
      // TASK 10I: strict network scope (see the /api/admin/users comment above).
      supabase.from("listings").select("id,status,city,district,monthly_rent,created_at,updated_at").eq("owner_addr", addr).eq("network", ADMIN_NETWORK),
      supabase.from("active_contracts").select("addr,data,updated_at").eq("chain_id", ADMIN_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW),
      supabase.from("contract_proposals").select("*").or(`from_addr.eq.${addr},to_addr.eq.${addr}`),
      supabase.from("viewing_requests").select("*").or(`from_addr.eq.${addr},to_addr.eq.${addr}`),
      supabase.from("early_terms").select("*").or(`from_addr.eq.${addr},to_addr.eq.${addr}`),
      supabase.from("messages").select("id", { count: "exact", head: true }).or(`from_addr.eq.${addr},to_addr.eq.${addr}`),
    ]);

    const userRow = userRes.data || null;
    const listings = listingsRes.data || [];
    const acRows = acRes.data || [];
    const proposals = proposalsRes.data || [];
    const viewings = viewingsRes.data || [];
    const earlyTerms = earlyTermsRes.data || [];
    const messageCount = msgCountRes.count || 0;

    // Group listings by status
    const listingGroups = { draft: [], active: [], paused: [], suspended: [], archived: [] };
    for (const l of listings) {
      const s = (l.status || "draft").toLowerCase();
      if (listingGroups[s]) listingGroups[s].push(l);
      else listingGroups[s] = [l];
    }
    const listingsSummary = {};
    for (const k of Object.keys(listingGroups)) listingsSummary[k] = listingGroups[k].length;

    // Active contracts — filter rows where addr matches, or data.peerAddr matches, or data.listing.contract matches
    const asOwner = [];
    const asPeer = [];
    for (const row of acRows) {
      const rowAddr = (row.addr || "").toLowerCase();
      const peerAddr = (row.data?.peerAddr || "").toLowerCase();
      const contractAddr = (row.data?.listing?.contract || "").toLowerCase();
      if (rowAddr === addr) asOwner.push(row);
      else if (peerAddr === addr || contractAddr === addr) asPeer.push(row);
    }

    // Warnings
    const warnings = [];
    if (!userRow) warnings.push("User row not found");
    if (!userRow && listings.length > 0) warnings.push("Orphan listings: user row deleted but listings remain");
    if (userRow && listingGroups.active.length > 0 && !userRow) warnings.push("Active listing but no user row");
    if (!userRow && listingGroups.active.length > 0) warnings.push("Active listing but no user row");

    // Active contract but no active listing (for landlords)
    const role = userRow?.data?.role || null;
    const hasNonArchivedContract = asOwner.some(r => {
      const s = (r.data?.status || "").toLowerCase();
      return s !== "archived" && s !== "settled";
    });
    if (role === "landlord" && hasNonArchivedContract && listingGroups.active.length === 0) {
      warnings.push("Active contract but no active listing");
    }

    // Deduplicate warnings
    const uniqueWarnings = [...new Set(warnings)];

    return json(res, {
      addr,
      userExists: !!userRow,
      role,
      walletType: userRow?.data?.walletType || null,
      displayName: userRow?.data?.display_name || null,
      emailConfirmed: !!userRow?.data?.email_confirmed,
      listings: listingGroups,
      listingsSummary,
      activeContracts: { asOwner, asPeer },
      contractProposals: proposals,
      viewingRequests: viewings,
      earlyTerms,
      messageCount,
      warnings: uniqueWarnings,
    });
  }

  // ── /api/admin/agreements/:id — full on-chain agreement detail ──────
  const agrDetailMatch = path.match(/^\/api\/admin\/agreements\/(\d+)$/) && req.method === "GET";
  if (agrDetailMatch) {
    const agrId = parseInt(path.match(/^\/api\/admin\/agreements\/(\d+)$/)[1], 10);
    const idHex = encUint256(agrId);

    // Selectors for boolean view functions and currentTime
    const SEL_IS_RENT_OVERDUE      = "0x43f684bb"; // isRentOverdue(uint256) — verified via `cast sig`
    const SEL_IS_LEASE_EXPIRED     = "0x3201ad94"; // isLeaseExpired(uint256) — verified via `cast sig`
    const SEL_IS_DEP_DEADLINE_EXP  = "0x699ca645"; // isDepositDeadlineExpired(uint256) — verified via `cast sig`
    const SEL_CURRENT_TIME         = "0xd18e81b3"; // currentTime()

    // Parallel on-chain reads
    const [agrHex, pdHex, rentalStateHex, pdStateHex,
           rentOverdueHex, leaseExpiredHex, depDeadlineHex, freezeExpHex,
           currentTimeHex] = await Promise.all([
      arcEthCall(RENTAL_ESCROW,  SEL_AGREEMENTS    + idHex),
      arcEthCall(PROPDEP_ESCROW, SEL_PROPDEPS      + idHex),
      arcEthCall(RENTAL_ESCROW,  SEL_GET_STATE     + idHex),
      arcEthCall(PROPDEP_ESCROW, SEL_GET_STATE     + idHex),
      arcEthCall(RENTAL_ESCROW,  SEL_IS_RENT_OVERDUE     + idHex),
      arcEthCall(RENTAL_ESCROW,  SEL_IS_LEASE_EXPIRED    + idHex),
      arcEthCall(RENTAL_ESCROW,  SEL_IS_DEP_DEADLINE_EXP + idHex),
      arcEthCall(RENTAL_ESCROW,  SEL_IS_FREEZE_EXP       + idHex),
      arcEthCall(RENTAL_ESCROW,  SEL_CURRENT_TIME),
    ]);

    if (!agrHex || agrHex === "0x") return json(res, { error: "Agreement not found or RPC error" }, 404);

    const rentalState = rentalStateHex ? parseInt(rentalStateHex, 16) : 0;
    let pdState = pdStateHex ? parseInt(pdStateHex, 16) : 0;
    const currentTime = currentTimeHex ? Number(BigInt(currentTimeHex)) : 0;

    const isRentOverdue            = decodeU8(rentOverdueHex) === 1;
    const isLeaseExpired           = decodeU8(leaseExpiredHex) === 1;
    const isDepositDeadlineExpired = decodeU8(depDeadlineHex) === 1;
    const isFreezeExpiredVal       = decodeU8(freezeExpHex) === 1;

    // --- Decode agreement struct via AGR_W ---
    const USDC_FIELDS_AGR = new Set([
      "monthlyRent", "commitmentDeposit", "hostingDeposit", "propSecurityDeposit",
      "damageClaim", "disputeBond", "mutualSettlementToLandlord", "mutualSettlementToTenant",
    ]);
    const ADDR_FIELDS_AGR = new Set([
      "tenant", "landlord", "disputeBondPoster", "earlyTermInitiator", "mutualSettlementProposer",
    ]);
    const BOOL_FIELDS_AGR = new Set([
      "landlordWantsRenew", "tenantWantsRenew", "landlordVoted", "tenantVoted",
      "tenantAcceptedClaim", "tenantDisputedClaim", "hasPropDep", "firstRentPaid",
      "tenantDeposited", "landlordDeposited",
    ]);

    const rental = {};
    for (const [field, idx] of Object.entries(AGR_W)) {
      const w = sliceWord(agrHex, idx);
      if (ADDR_FIELDS_AGR.has(field)) {
        rental[field] = wordToAddress(w);
      } else if (BOOL_FIELDS_AGR.has(field)) {
        rental[field] = wordToBool(w);
      } else if (USDC_FIELDS_AGR.has(field)) {
        rental[field] = wordToNum(w) / 1e6;
      } else {
        rental[field] = wordToNum(w);
      }
    }
    rental.stateNum = rentalState;
    rental.stateLabel = RENTAL_STATES[rentalState] ?? `Unknown(${rentalState})`;
    rental.earlyTermTypeLabel = TERM_TYPES[rental.earlyTermType] || `Unknown(${rental.earlyTermType})`;
    rental.isRentOverdue = isRentOverdue;
    rental.isLeaseExpired = isLeaseExpired;
    rental.isDepositDeadlineExpired = isDepositDeadlineExpired;
    rental.isFreezeExpired = isFreezeExpiredVal;
    rental.currentTime = currentTime;

    // Derived: nextRentDue, graceEnd
    // nextRentDue = activatedAt + (rentPaymentsMade + 1) * 30 days
    // This matches the contract logic — schedule is based on activatedAt, not lastRentTimestamp
    let nextRentDue = null;
    if (rental.activatedAt > 0) {
      nextRentDue = rental.activatedAt + (rental.rentPaymentsMade + 1) * 30 * 86400;
    }
    rental.nextRentDue = nextRentDue;
    // rentGraceExtension is already in seconds (from contract)
    // graceEnd = nextRentDue + 3 days (default grace) + rentGraceExtension (seconds)
    rental.graceEnd = nextRentDue !== null
      ? nextRentDue + 259200 + rental.rentGraceExtension
      : null;
    rental.rentGraceExtensionDays = rental.rentGraceExtension / 86400;

    // Derived: rentalFreezeEnd
    rental.freezeEnd = rental.freezeStart > 0
      ? rental.freezeStart + rental.freezeDuration
      : null;

    // --- Decode propDep struct via PD_W ---
    const USDC_FIELDS_PD = new Set([
      "amount", "claimAmount", "disputeBond", "settlementToLandlord", "settlementToTenant",
    ]);
    const ADDR_FIELDS_PD = new Set(["tenant", "landlord", "bondPoster", "settlementProposer"]);
    const BOOL_FIELDS_PD = new Set(["tenantAccepted", "tenantDisputed"]);

    const propDep = {};
    for (const [field, idx] of Object.entries(PD_W)) {
      const w = sliceWord(pdHex, idx);
      if (ADDR_FIELDS_PD.has(field)) {
        propDep[field] = wordToAddress(w);
      } else if (BOOL_FIELDS_PD.has(field)) {
        propDep[field] = wordToBool(w);
      } else if (USDC_FIELDS_PD.has(field)) {
        propDep[field] = wordToNum(w) / 1e6;
      } else {
        propDep[field] = wordToNum(w);
      }
    }

    // Correct pdState if struct is empty
    if (pdState > 0 && pdState < 5 && propDep.amount === 0) pdState = 5;
    propDep.stateNum = pdState;
    propDep.stateLabel = PROPDEP_STATES[pdState] ?? `Unknown(${pdState})`;

    // PropDep freeze check
    let pdFreezeExpired = false;
    if (pdState === 4) {
      const pdFreezeHex = await arcEthCall(PROPDEP_ESCROW, SEL_IS_FREEZE_EXP + idHex);
      pdFreezeExpired = decodeU8(pdFreezeHex) === 1;
    }
    propDep.isFreezeExpired = pdFreezeExpired;
    propDep.freezeEnd = propDep.freezeStart > 0 ? propDep.freezeStart + 60 * 86400 : null;

    // --- Diagnosis: shouldKeeperCall ---
    let shouldKeeperCall = null;
    let diagReason = null;
    const diagWarnings = [];

    if (rentalState === 3 && isLeaseExpired) {
      shouldKeeperCall = "endLease";
      diagReason = "Lease expired, state still Active";
    } else if (rentalState === 3 && isRentOverdue) {
      shouldKeeperCall = "flagRentMissed";
      diagReason = "Rent overdue, state still Active";
    } else if (rentalState === 7 && isFreezeExpiredVal) {
      shouldKeeperCall = "releaseFrozenFunds";
      diagReason = "Rental freeze expired, state DisputeOpen";
    } else if (rentalState === 4 && rental.earlyTermProposedAt > 0 && rental.earlyTermProposedAt + 7 * 86400 < currentTime) {
      shouldKeeperCall = "expireEarlyTermProposal";
      diagReason = "Early term proposal expired (7d passed)";
    } else if (rentalState === 5 && rental.checkoutStartedAt > 0 && rental.checkoutStartedAt + 14 * 86400 < currentTime) {
      shouldKeeperCall = "expireCheckout";
      diagReason = "Checkout/renewal vote expired (14d passed)";
    } else if (pdState === 4 && pdFreezeExpired) {
      shouldKeeperCall = "releaseFrozenFunds (propDep)";
      diagReason = "PropDep freeze expired, state Frozen";
    } else if (pdState === 2 && propDep.claimDeadline > 0 && propDep.claimDeadline < currentTime) {
      shouldKeeperCall = "executeExpiredClaim or expireDamageClaim";
      diagReason = "PropDep claim deadline passed, state Claimed";
    }

    // --- DB check: active_contracts vs chain state ---
    try {
      const { data: dbRows } = await supabase
        .from("active_contracts")
        .select("addr,data")
        .eq("chain_id", ADMIN_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW);
      const matching = (dbRows || []).filter(r => {
        const d = r.data || {};
        return String(d.agreementId) === String(agrId);
      });
      if (matching.length > 0 && (rentalState === 8 || rentalState === 9)) {
        diagWarnings.push(`Chain state is ${RENTAL_STATES[rentalState]} but DB still has ${matching.length} active_contract row(s) for this agreementId`);
      }
    } catch (e) {
      diagWarnings.push("Failed to check DB active_contracts: " + e.message);
    }

    return json(res, {
      agreementId: agrId,
      rental,
      propDep,
      diagnosis: {
        shouldKeeperCall,
        reason: diagReason,
        warnings: diagWarnings,
      },
    });
  }

  // ── /api/admin/keeper/status — latest keeper heartbeat ────────────────
  // Status values: database_error (table/Supabase unreachable), missing (no
  // heartbeat row yet), stale (row too old), mismatch (fresh but addresses
  // don't match this backend's ACTIVE pair), healthy (fresh + addresses match).
  if (path === "/api/admin/keeper/status" && req.method === "GET") {
    const { data: hb, error: hbError } = await supabase.from("keeper_heartbeats")
      .select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    return json(res, deriveKeeperStatus(hb, hbError, { rentalEscrow: RENTAL_ESCROW, propDepEscrow: PROPDEP_ESCROW }));
  }

  // Fallthrough: unknown admin route
  return json(res, { error: "Admin endpoint not found", path }, 404);
}

// Helper: parse query string from path
function url(prefix, req) {
  const full = new URL(req.url, "http://x");
  return full.searchParams;
}
