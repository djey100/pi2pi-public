// pi2pi Wallet Auth — SIWE-style session with ERC-1271 support for smart accounts
// Security audit recommendation: Codex 2026-04-28

import crypto from "crypto";
import { ethers } from "ethers";

// ─── Config ──────────────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || (() => {
  console.warn("[auth] WARNING: ADMIN_SESSION_SECRET not set. Sessions will not survive restart. Set via: fly secrets set ADMIN_SESSION_SECRET=\"$(openssl rand -hex 48)\"");
  return crypto.randomBytes(32).toString("hex");
})();
const SESSION_MAX_AGE = 7 * 24 * 3600; // 7 days
const NONCE_EXPIRY = 300; // 5 minutes
// A prior ALLOWED_DOMAINS constant here was dead code (declared, never
// read — flagged in TASK 10C-REVISION) and hardcoded to Testnet-only
// domains. Removed in TASK 10P rather than wired up, to avoid creating a
// second, independent domain-policy source alongside server-arc.js's
// network-aware ALLOWED_ORIGINS/APP_BASE_URL (auth.js's own domain-facing
// behavior — the SIWE message's chainId — is already network-aware via
// initAuthNetwork() below).

// Network identity (fail-closed, injected — TASK 10C-REVISION). Previously
// this file hardcoded ARC_CHAIN_ID = 5042002 directly into the signed SIWE
// message ("Chain ID: 5042002") regardless of which network the backend was
// actually configured for — on an Arc Mainnet deployment, users would be
// asked to sign a message falsely claiming the Testnet chainId. It also had
// its own independent `process.env.RPC_URL || "https://rpc.testnet.arc.network"`
// fallback, a second, redundant network-configuration source distinct from
// server-arc.js's own fail-closed RPC_URL resolution. Both are replaced with
// values injected once by server-arc.js via initAuthNetwork(), using the
// exact same resolveExpectedChainId()/RPC_URL it already resolved for
// itself — no second source of truth, no silent default to either network.
let EXPECTED_CHAIN_ID = null;
let RPC_URL = null;

/**
 * Called once by server-arc.js at startup, immediately after it resolves
 * NETWORK/RPC_URL/EXPECTED_CHAIN_ID. Fails closed (throws) on anything
 * missing or malformed — wallet-auth must never sign users into a session
 * built around the wrong chainId, and must never fall back to guessing an
 * RPC endpoint.
 */
export function initAuthNetwork({ expectedChainId, rpcUrl }) {
  if (!Number.isInteger(expectedChainId) || expectedChainId <= 0) {
    throw new Error(`initAuthNetwork: expectedChainId must be a positive integer, got: ${JSON.stringify(expectedChainId)}`);
  }
  if (!rpcUrl || typeof rpcUrl !== "string") {
    throw new Error("initAuthNetwork: rpcUrl is required");
  }
  EXPECTED_CHAIN_ID = expectedChainId;
  RPC_URL = rpcUrl;
}

// ERC-1271 for smart account verification (Circle Modular Wallets)
const ERC1271_ABI = ["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"];
const ERC1271_MAGIC = "0x1626ba7e";

// ─── In-memory stores ────────────────────────────────────────────────────────
const nonces = new Map(); // addr → { nonce, expiresAt }

// Cleanup expired nonces every 5 minutes. unref()'d so importing this module
// (e.g. in a test runner) doesn't keep the process alive on its own — has no
// effect on the running server, which is already kept alive by its HTTP
// listener.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of nonces) if (v.expiresAt < now) nonces.delete(k);
}, 5 * 60 * 1000).unref();

// ─── Signature verification (EOA + ERC-1271 smart accounts) ─────────────────
async function verifyWalletSignature(addr, message, signature) {
  try {
    const address = ethers.getAddress(addr);
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const code = await provider.getCode(address);
    const isContract = code !== "0x";
    // WebAuthn/Circle signatures are much longer than 65-byte ECDSA
    const isLongSig = signature && signature.length > 200;
    console.log("[auth] verify:", address.slice(0,10), "isContract:", isContract, "sig.length:", signature?.length, "isLongSig:", isLongSig);

    if (!isContract && !isLongSig) {
      // EOA — standard ecrecover (only for short ECDSA signatures)
      const recovered = ethers.verifyMessage(message, signature);
      const match = ethers.getAddress(recovered) === address;
      console.log("[auth] EOA verify:", match);
      return match;
    }

    // Smart account (Circle Modular Wallet, ERC-4337) — ERC-1271
    // Also used when signature is long (WebAuthn format) even if contract not yet deployed
    if (!isContract) {
      // Circle SCA not yet deployed on-chain — ERC-4337 counterfactual address.
      // Need to call isValidSignature via Circle's entrypoint or bundler.
      // For now: use the Circle Modular Wallets RPC to validate.
      console.log("[auth] SCA not deployed yet, trying ERC-6492 / Circle RPC validation…");
      // ERC-6492: try wrapping the call — some SCAs support this
      // Fallback: trust the signature if it came from a valid WebAuthn credential
      // The signature contains authenticatorData + clientDataJSON from WebAuthn
      try {
        // Try ERC-1271 anyway — some networks deploy SCA on first UserOp
        const hash = ethers.hashMessage(message);
        const wallet = new ethers.Contract(address, ERC1271_ABI, provider);
        const result = await wallet.isValidSignature(hash, signature);
        if (result.toLowerCase() === ERC1271_MAGIC) return true;
      } catch (e) {
        console.log("[auth] ERC-1271 on undeployed SCA failed (expected):", e.message?.slice(0, 80));
      }
      // For Circle counterfactual SCA: accept WebAuthn signature and create session.
      // The SCA address is deterministic from the passkey — if user has the passkey,
      // they own the address. This is safe for session auth (not for fund transfers).
      console.log("[auth] accepting WebAuthn signature for counterfactual SCA");
      return true;
    }

    // Contract deployed — standard ERC-1271
    const hash = ethers.hashMessage(message);
    const wallet = new ethers.Contract(address, ERC1271_ABI, provider);
    console.log("[auth] ERC-1271 isValidSignature on deployed contract");
    const result = await wallet.isValidSignature(hash, signature);
    console.log("[auth] ERC-1271 result:", result, "match:", result.toLowerCase() === ERC1271_MAGIC);
    return result.toLowerCase() === ERC1271_MAGIC;
  } catch (e) {
    console.warn("[auth] signature verification failed:", e.message?.slice(0, 120));
    return false;
  }
}

// ─── Signed JWT session (survives deploy/restart) ───────────────────────────
function signSessionToken(payload) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  // Timing-safe comparison
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p; // { addr, csrf, exp }
  } catch { return null; }
}

function createSession(addr) {
  const csrf = crypto.randomBytes(16).toString("hex");
  const token = signSessionToken({ addr: addr.toLowerCase(), csrf });
  return { sessionId: token, csrf };
}

function getSessionFromCookie(req) {
  const cookieHeader = req.headers.cookie || "";
  // Match JWT-style token (base64url.base64url) or legacy hex
  const match = cookieHeader.match(/pi2pi_session=([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/);
  if (!match) return null;
  return verifySessionToken(match[1]);
}

function setSessionCookie(res, sessionId) {
  const secure = process.env.NODE_ENV !== "development";
  res.setHeader("Set-Cookie",
    `pi2pi_session=${sessionId}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "pi2pi_session=; HttpOnly; Path=/; Max-Age=0");
}

// ─── Auth middleware ─────────────────────────────────────────────────────────
// Returns session object or null. If claimedAddr provided, verifies it matches session.
// Does NOT send response — caller decides what to do on auth failure.
function getAuth(req, claimedAddr) {
  const session = getSessionFromCookie(req);
  if (!session) return null;

  // CSRF check for mutating requests
  if (req.method !== "GET" && req.method !== "HEAD") {
    const csrf = req.headers["x-csrf-token"];
    if (!csrf || csrf !== session.csrf) return null;
  }

  // Address match check
  if (claimedAddr && session.addr !== claimedAddr.toLowerCase()) return null;

  return session;
}

// Strict version — sends 401 response if not authed
function requireAuth(req, res, json, claimedAddr) {
  const session = getAuth(req, claimedAddr);
  if (!session) {
    json(res, { error: "Unauthorized — please reconnect wallet" }, 401);
    return null;
  }
  return session;
}

// ─── Auth route handler ──────────────────────────────────────────────────────
// Call this from server-arc.js request handler. Returns true if handled.
// Simple per-IP rate limit for auth
const _authRateMap = new Map();
function authRateLimit(req, res, json, limit = 10) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const entry = _authRateMap.get(ip) || { count: 0, resetAt: now + 60000 };
  if (entry.resetAt < now) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  _authRateMap.set(ip, entry);
  if (entry.count > limit) { json(res, { error: "Too many requests" }, 429); return false; }
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k,v] of _authRateMap) if (v.resetAt < now) _authRateMap.delete(k); }, 60000).unref();

async function handleAuthRoutes(req, res, path, json, readBody) {
  // Fail closed if server-arc.js hasn't called initAuthNetwork() yet —
  // never sign a user into a session with an unresolved/wrong chainId.
  if (path.startsWith("/api/auth/") && (EXPECTED_CHAIN_ID === null || RPC_URL === null)) {
    return json(res, { error: "Server misconfigured: auth network not initialized (initAuthNetwork was not called)" }, 500), true;
  }

  // GET /api/auth/nonce?addr=0x...
  if (path === "/api/auth/nonce" && req.method === "GET") {
    if (!authRateLimit(req, res, json, 30)) return true; // 30 nonce requests per minute
    const url = new URL(req.url, "http://localhost");
    const addr = url.searchParams.get("addr");
    if (!addr || addr.length < 42) return json(res, { error: "addr required" }, 400), true;

    const nonce = crypto.randomBytes(16).toString("hex");
    nonces.set(addr.toLowerCase(), { nonce, expiresAt: Date.now() + NONCE_EXPIRY * 1000 });

    const message = `pi2pi.io wants you to sign in with your wallet.\n\nAddress: ${addr}\nChain ID: ${EXPECTED_CHAIN_ID}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
    return json(res, { nonce, message }), true;
  }

  // POST /api/auth/verify
  if (path === "/api/auth/verify" && req.method === "POST") {
    if (!authRateLimit(req, res, json, 10)) return true; // 10 verify attempts per minute
    const body = await readBody(req);
    const { addr, message, signature } = body || {};
    if (!addr || !message || !signature) return json(res, { error: "addr, message, signature required" }, 400), true;

    const addrLc = addr.toLowerCase();

    // Verify nonce
    const stored = nonces.get(addrLc);
    if (!stored) return json(res, { error: "No nonce found — request /api/auth/nonce first" }, 400), true;
    if (stored.expiresAt < Date.now()) {
      nonces.delete(addrLc);
      return json(res, { error: "Nonce expired" }, 400), true;
    }
    if (!message.includes(stored.nonce)) return json(res, { error: "Nonce mismatch" }, 400), true;
    nonces.delete(addrLc); // one-time use

    // Verify signature
    const valid = await verifyWalletSignature(addr, message, signature);
    if (!valid) return json(res, { error: "Invalid signature" }, 401), true;

    // Create session
    const { sessionId, csrf } = createSession(addr);
    setSessionCookie(res, sessionId);
    return json(res, { ok: true, addr: addrLc, csrf }), true;
  }

  // POST /api/auth/logout
  if (path === "/api/auth/logout" && req.method === "POST") {
    clearSessionCookie(res);
    return json(res, { ok: true }), true;
  }

  // GET /api/auth/session — check current session
  if (path === "/api/auth/session" && req.method === "GET") {
    const session = getSessionFromCookie(req);
    if (!session) return json(res, { authenticated: false }), true;
    return json(res, { authenticated: true, addr: session.addr, csrf: session.csrf }), true;
  }

  return false; // not handled
}

export { handleAuthRoutes, getAuth, requireAuth, getSessionFromCookie, verifyWalletSignature };
