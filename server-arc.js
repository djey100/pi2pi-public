// pi2pi Arc Testnet server — port 3001
// Sprint 2: state migrated from in-memory arrays/files to Supabase Postgres.
// Same REST API as before — only the storage layer changed.
// Run: node server-arc.js  (env: SUPABASE_URL, SUPABASE_SERVICE_KEY, optional PORT)

import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { createHmac, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { handleAdmin, initAdminNetwork } from "./admin_routes.js";
import { handleAuthRoutes, getAuth, requireAuth, initAuthNetwork } from "./auth.js";
import { isCidAuthorizedForAddr } from "./cid-auth.js";
import { checkFieldLock } from "./contract-form-lock.js";
import { checkText } from "./text-filter.js";
import { checkDisplayName } from "./reserved-names.js";
import { sendTelegramMessage, notifyUser, handleBotUpdate, isConfigured as telegramConfigured, initTelegramAppUrl } from "./telegram-notify.js";
import { writeKeeperHeartbeat } from "./keeper-heartbeat.js";
import { resolveExpectedChainId, assertChainMatch, fetchChainId, resolveContractAddresses, resolveArchiveEscrowAllowlist, pofNetworkFilterClause, assertSupportedNetwork, isPofRowInScope } from "./network-config.js";
import { serveStatic as _serveStatic } from "./static-serve.js";
import { resolveAppBaseUrl, resolveFlyHostnameUrl, resolveAllowedOrigins, resolveWebauthnOrigins, resolveFlyRedirectTarget } from "./domain-config.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = parseInt(process.env.PORT || "3001", 10);
const ARC_DIR = existsSync(join(__dirname, "arc", "dist")) ? join(__dirname, "arc", "dist") : join(__dirname, "arc");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in env");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// B1: Check if messages.params column exists (for i18n event params)
let _hasParamsColumn = false;
(async () => {
  try {
    const { error } = await supabase.from('messages').select('params').limit(1);
    _hasParamsColumn = !error;
    if (error) console.warn('[B1] messages.params column missing. Chat i18n params disabled. To enable, run SQL: ALTER TABLE messages ADD COLUMN IF NOT EXISTS params JSONB DEFAULT NULL;');
    else console.log('[B1] messages.params column OK');
  } catch(e) {}
})();

// Ensure doc_keys table exists for document encryption
(async () => {
  try {
    const { error } = await supabase.from('doc_keys').select('cid').limit(1);
    if (error) {
      console.warn('[doc_keys] Table missing or needs migration.');
      console.warn('[doc_keys] Run: migrations/2026-04-28-doc-keys-acl.sql');
      console.warn('[doc_keys] Schema: cid TEXT PK, key TEXT, owner_addr TEXT, peer_addr TEXT, created_at TIMESTAMPTZ');
    } else {
      console.log('[doc_keys] Table OK');
    }
  } catch(e) {}
})();

// Ensure event_logs table exists for structured event logging
(async () => {
  try {
    const { error } = await supabase.from('event_logs').select('id').limit(1);
    if (error) {
      console.warn('[event_logs] Table missing. Run SQL:');
      console.warn('  CREATE TABLE IF NOT EXISTS event_logs (id BIGSERIAL PRIMARY KEY, time TIMESTAMPTZ NOT NULL, type TEXT NOT NULL, user_addr TEXT, action TEXT, contract_id TEXT, data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());');
      console.warn('  CREATE INDEX idx_event_logs_time ON event_logs(time DESC);');
      console.warn('  CREATE INDEX idx_event_logs_type ON event_logs(type);');
      console.warn('  CREATE INDEX idx_event_logs_user ON event_logs(user_addr);');
    } else {
      console.log('[event_logs] Table OK');
    }
  } catch(e) {}
})();

// ─── Network identity (fail-closed) ──────────────────────────────────────
// NETWORK and RPC_URL are both mandatory — this backend supports Arc Testnet
// and Arc Mainnet, and must never assume which one it's running against or
// hardcode a single RPC endpoint as if it were the only possible one. There
// is no default network and no implicit fallback (see network-config.js).
// The existing Arc Testnet Fly deployment supplies both explicitly via
// fly.toml's [env] block (non-secret — a network name and a public RPC URL
// are not credentials).
const NETWORK = process.env.NETWORK;
const RPC_URL = process.env.RPC_URL;
if (!NETWORK || !RPC_URL) {
  console.error("FATAL: NETWORK and RPC_URL must be set in env (e.g. NETWORK=arc-testnet RPC_URL=https://rpc.testnet.arc.network). No default network is assumed.");
  process.exit(1);
}
let EXPECTED_CHAIN_ID;
try {
  EXPECTED_CHAIN_ID = resolveExpectedChainId(NETWORK);
} catch (e) {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
}

// === Proof of Funds: continuous balance check for active listings ===
const ARC_RPC = RPC_URL; // no hardcoded default — see NETWORK/RPC_URL check above
// Fallback source of truth: config/deployments.json ("active" pair + top-level
// "usdc" field) — but ONLY for networks with a verified entry there (currently
// arc-testnet only). Any other network (e.g. arc-mainnet) has no manifest
// entry and therefore no fallback — RentalEscrow, PropDepEscrow, AND USDC
// must all be set explicitly, or startup fails closed. See
// resolveContractAddresses() in network-config.js.
const DEPLOYMENTS = JSON.parse(readFileSync(join(__dirname, "config", "deployments.json"), "utf8"));
let RENTAL_ESCROW_ADDR, PROPDEP_ESCROW_ADDR, USDC_ADDRESS;
try {
  ({ rentalEscrow: RENTAL_ESCROW_ADDR, propDepEscrow: PROPDEP_ESCROW_ADDR, usdc: USDC_ADDRESS } = resolveContractAddresses(NETWORK, {
    rentalEscrowEnv: process.env.RENTAL_ESCROW_ADDRESS,
    propDepEscrowEnv: process.env.PROPDEP_ESCROW_ADDRESS,
    usdcEnv: process.env.USDC_ADDRESS,
    deployments: DEPLOYMENTS,
    expectedChainId: EXPECTED_CHAIN_ID,
  }));
} catch (e) {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
}
// Arc Testnet alone has had five RentalEscrow deployments over time, all
// sharing chainId 5042002 (active + historicalIntermediate + legacy x3) — so
// chain_id ALONE cannot distinguish the currently-active deployment's
// active_contracts/archived_contracts rows from a retired deployment's rows
// that happen to share the same chain. Every DB query scoped to "this
// runtime's own data" must filter by BOTH chain_id AND escrow_address. See
// migrations/2026-09-17-network-scope-contracts-expand.sql.
const RENTAL_ESCROW_ADDR_LC = RENTAL_ESCROW_ADDR.toLowerCase();

// Archive/history reads (closed, immutable records) are deliberately scoped
// DIFFERENTLY from active-contract reads (TASK 9G): an active contract only
// makes sense against the CURRENT escrow (you can't act on a decommissioned
// one), but a closed historical record is still legitimately part of a
// user's history no matter which now-superseded deployment created it. This
// resolves every known RentalEscrow generation for THIS network's own chain
// only (never another chain's) — see resolveArchiveEscrowAllowlist()'s doc
// comment in network-config.js. Fails closed at startup, same as every
// other resolution above.
let ARCHIVE_ESCROW_ALLOWLIST;
try {
  ARCHIVE_ESCROW_ALLOWLIST = resolveArchiveEscrowAllowlist(NETWORK, {
    deployments: DEPLOYMENTS,
    expectedChainId: EXPECTED_CHAIN_ID,
    currentEscrowAddress: RENTAL_ESCROW_ADDR_LC,
  });
} catch (e) {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
}

// admin_routes.js must never resolve its own RPC/contract addresses — inject
// the same verified values resolved above so admin routes can never diverge
// onto a different network's RPC or contracts (see admin_routes.js's
// initAdminNetwork() doc comment).
try {
  initAdminNetwork({ rpc: ARC_RPC, rentalEscrow: RENTAL_ESCROW_ADDR, propDepEscrow: PROPDEP_ESCROW_ADDR, chainId: EXPECTED_CHAIN_ID, network: NETWORK });
} catch (e) {
  console.error(`FATAL: admin network initialization failed: ${e.message}`);
  process.exit(1);
}

// auth.js must never resolve its own chainId/RPC — inject the same verified
// values so the wallet sign-in message can never claim the wrong network's
// chainId (see auth.js's initAuthNetwork() doc comment).
try {
  initAuthNetwork({ expectedChainId: EXPECTED_CHAIN_ID, rpcUrl: ARC_RPC });
} catch (e) {
  console.error(`FATAL: auth network initialization failed: ${e.message}`);
  process.exit(1);
}

// ─── Branded domain / hostname identity (fail-closed in production) ──────
// TASK 10P: APP_BASE_URL previously defaulted to a hardcoded
// "https://my.pi2pi.io" when unset — harmless only by coincidence, because
// my.pi2pi.io happened to already point at this exact runtime (Testnet).
// Once my.pi2pi.io/testnet.pi2pi.io are split across two different Fly
// apps, that same silent default would make one of them lie about its own
// domain in emails, share links, CORS, and the WebAuthn origins manifest.
// Production (detected via FLY_APP_NAME, which Fly always injects) must
// set APP_BASE_URL explicitly — no default is assumed. Local dev (no
// FLY_APP_NAME) gets a safe, non-branded fallback that can never be
// mistaken for either network's real domain.
const FLY_APP_NAME = process.env.FLY_APP_NAME || null;
let APP_BASE_URL;
try {
  APP_BASE_URL = resolveAppBaseUrl({ envAppBaseUrl: process.env.APP_BASE_URL, flyAppName: FLY_APP_NAME, port: PORT });
} catch (e) {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
}
// This runtime's own raw Fly hostname (e.g. "https://pi2pi-project.fly.dev")
// — derived from Fly's own injected FLY_APP_NAME, never hardcoded to either
// app's name. null in local dev (no FLY_APP_NAME), which is correct: the
// fly.dev-hostname redirect and CORS/webauthn entries that use this are
// production-only concerns.
const FLY_HOSTNAME_URL = resolveFlyHostnameUrl(FLY_APP_NAME);

// telegram-notify.js must never hardcode a branded domain either — inject
// this runtime's own APP_BASE_URL so Telegram messages always link back to
// whichever domain the recipient is actually meant to use.
initTelegramAppUrl(APP_BASE_URL);

// ─── SEO/AEO static pages ────────────────────────────────────────────────
// The app (arc/) uses React Router's HashRouter (arc/src/main.jsx), so every
// in-app view lives after "#" in the URL and is rendered client-side only —
// the server always sees the same "/" and returns the same empty SPA shell.
// Crawlers and non-JS LLM/AI agents never see that content. These pages are
// therefore plain static HTML files (pre-generated by
// scripts/build-seo-pages.mjs into public/seo/*.html), served directly at
// real, extension-less, canonical paths — bypassing the SPA entirely. Regen
// with: node scripts/build-seo-pages.mjs (also picks up config/deployments.json
// changes for the /arc page's address snapshot).
const SEO_PAGES = {
  "/how-it-works": "seo/how-it-works.html",
  "/for-tenants": "seo/for-tenants.html",
  "/for-landlords": "seo/for-landlords.html",
  "/security": "seo/security.html",
  "/deposit-protection": "seo/deposit-protection.html",
  "/arc": "seo/arc.html",
  "/tbilisi": "seo/tbilisi.html",
  "/batumi": "seo/batumi.html",
  "/da-nang": "seo/da-nang.html",
  "/nha-trang": "seo/nha-trang.html",
  "/faq": "seo/faq.html",
};
const BALANCE_OF_SELECTOR = "0x70a08231";
const POF_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function readUsdcBalance(addr) {
  try {
    // ⚠️ ARC TESTNET ONLY: USDC is native — eth_getBalance returns 18 decimals
    // MIGRATION TO ARBITRUM: change back to balanceOf with /1e6 (see deferred-fixes.md)
    const r = await fetch(ARC_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_getBalance", id: 1,
        params: [addr.toLowerCase(), "latest"],
      }),
    });
    const j = await r.json();
    if (!j.result) return 0;
    return Number(BigInt(j.result)) / 1e18;
  } catch (e) {
    return -1; // -1 means RPC error — don't change status
  }
}

// Check PropDep on-chain state for an agreement.
// Returns { state: 0-5, hasData: bool } or null on error.
async function checkPropDepState(agrId) {
  try {
    const pdStateHex = await fetch(ARC_RPC, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: PROPDEP_ESCROW_ADDR, data: "0x44c9af28" + BigInt(agrId).toString(16).padStart(64, "0") }, "latest"] }),
    }).then(r => r.json()).then(j => j.result);
    const state = pdStateHex ? parseInt(pdStateHex, 16) : 0;
    let hasData = false;
    if (state > 0 && state < 5) {
      try {
        const pdDataHex = await fetch(ARC_RPC, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: PROPDEP_ESCROW_ADDR, data: "0xc55ab8e7" + BigInt(agrId).toString(16).padStart(64, "0") }, "latest"] }),
        }).then(r => r.json()).then(j => j.result);
        hasData = pdDataHex && pdDataHex.length > 66 && parseInt(pdDataHex.slice(2 + 3 * 64, 2 + 4 * 64), 16) > 0;
      } catch {}
    }
    return { state, hasData };
  } catch (e) {
    console.warn("[checkPropDepState] error:", e.message);
    return null;
  }
}

// Applies pofNetworkFilterClause()'s decision to a Supabase query builder —
// used on both the SELECT that picks PoF candidates and, as a defense-in-depth
// guard, every UPDATE that acts on one (TASK 10F; see network-config.js's
// isPofRowInScope()/pofNetworkFilterClause() doc comments for why). Also
// reused (TASK 10I) for the public tenant-requests read paths, which need
// the exact same transitional rule: `users.data.intent.network` has NOT
// been backfilled (unlike `listings.network` — see applyStrictNetworkScope
// below), so untagged legacy tenant intents must remain visible on Testnet
// (where every one of them actually originates) while staying invisible on
// Mainnet.
function applyPofNetworkScope(query, column) {
  const clause = pofNetworkFilterClause(column, NETWORK);
  return clause.mode === "eq" ? query.eq(clause.column, clause.value) : query.or(clause.filter);
}

// TASK 10I: strict network-scoping for `listings` table reads/preconditions
// — the public marketplace feed/detail/owner routes, every owner-only
// mutation's ownership+network precondition check, the per-owner PoF-sum
// helpers, the hard-limit-3 count, and the account-reset/auto-pause/auto-
// resume helpers. Unlike checkListingsTablePoF's transitional scoping,
// `listings.network` has already been fully backfilled (TASK 10G — every
// existing row is tagged) and every INSERT stamps it from trusted runtime
// config (TASK 10F) — so a null/missing value can never legitimately exist
// going forward, and treating it as "maybe this network's" would only mask
// a bug instead of protecting against one. Strict equality on both networks.
//
// This closes TASK 10H's finding: the Arc Mainnet runtime was serving real
// Arc Testnet listings (and could, via forged UUIDs, have edited/deleted/
// published/paused them) because these queries carried no network filter
// at all.
function applyStrictNetworkScope(query, column = "network") {
  assertSupportedNetwork(NETWORK);
  return query.eq(column, NETWORK);
}

// Multi-listing PoF for the new `listings` table.
// Per-owner, per-tick: one suspend OR one resume (cascade across ticks).
// Strategy:
//   sum_required = Σ monthly_rent of active listings
//   if balance < sum_required → suspend the LAST published active → email
//   if balance >= sum_required + smallest suspended → resume oldest suspended → email
async function checkListingsTablePoF() {
  try {
    // TASK 10F: only scan rows this network owns — see applyPofNetworkScope()
    // and network-config.js's isPofRowInScope() doc comment (TASK 10D's root
    // cause was this SELECT having no network filter at all).
    const { data: rows, error } = await applyPofNetworkScope(
      supabase.from("listings")
        .select("id,owner_addr,monthly_rent,status,published_at,suspended_at,district,city,property_type,network")
        .in("status", ["active", "suspended"]),
      "network"
    );
    if (error) { console.error("[pof2] listings fetch error:", error.message); return; }
    // Load city settings once
    const { data: ccRow } = await supabase.from("users").select("data").eq("addr", "__city_config__").maybeSingle();
    const citySettings = ccRow?.data?.cities || [];
    // Group by owner_addr
    const byOwner = new Map();
    for (const r of (rows || [])) {
      if (!byOwner.has(r.owner_addr)) byOwner.set(r.owner_addr, []);
      byOwner.get(r.owner_addr).push(r);
    }
    let suspended = 0, resumed = 0;
    for (const [owner, listings] of byOwner.entries()) {
      const balance = await readUsdcBalance(owner);
      if (balance < 0) continue; // RPC error
      const actives = listings.filter(l => l.status === "active");
      const suspendeds = listings.filter(l => l.status === "suspended");
      const sumActive = actives.reduce((s, l) => s + Number(l.monthly_rent), 0);

      // Resolve city minimum for this owner
      const ownerCity = listings[0]?.city || listings[0]?.district || "";
      const cm = citySettings.find(c => ownerCity && (ownerCity.toLowerCase().includes(c.city.toLowerCase()) || c.city.toLowerCase().includes(ownerCity.toLowerCase())));
      const cityMin = cm?.min_balance || 0;

      // Level 1: Listing suspend — balance < sum of active rents OR balance < city minimum
      if ((sumActive > balance || (cityMin > 0 && balance < cityMin)) && actives.length > 0) {
        const sorted = [...actives].sort((a, b) =>
          new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()
        );
        const victim = sorted[0];
        // Network guard repeated on the UPDATE itself (defense-in-depth): even
        // if the SELECT above were ever changed to skip scoping, this can
        // still never write outside NETWORK's own rows.
        await applyPofNetworkScope(
          supabase.from("listings").update({ status: "suspended", suspended_at: new Date().toISOString() }).eq("id", victim.id),
          "network"
        );
        suspended++;
        console.log(`[pof2] listing suspended ${victim.id} (owner ${owner.slice(0,10)}…) — balance ${balance.toFixed(2)} < required ${sumActive}`);
        const title = `${victim.property_type} in ${victim.district}`;
        sendNotification(owner, "listing_paused", { listingTitle: title, balance: balance.toFixed(2), required: sumActive })
          .catch(e => console.warn("[pof2/email] error:", e.message));
        // Don't continue — still check account suspension below
      }

      // Listing resume — balance can cover one more
      if (suspendeds.length > 0) {
        const sortedSusp = [...suspendeds].sort((a, b) =>
          new Date(a.suspended_at || 0).getTime() - new Date(b.suspended_at || 0).getTime()
        );
        const candidate = sortedSusp[0];
        const currentActive = actives.reduce((s, l) => s + Number(l.monthly_rent), 0);
        const wouldRequire = currentActive + Number(candidate.monthly_rent);
        const resumeMin = Math.max(wouldRequire, cityMin);
        if (balance >= resumeMin) {
          await applyPofNetworkScope(
            supabase.from("listings").update({ status: "active", suspended_at: null }).eq("id", candidate.id),
            "network"
          );
          resumed++;
          console.log(`[pof2] listing resumed ${candidate.id} (owner ${owner.slice(0,10)}…) — balance ${balance.toFixed(2)} >= required ${resumeMin}`);
          const title = `${candidate.property_type} in ${candidate.district}`;
          sendNotification(owner, "listing_resumed", { listingTitle: title, balance: balance.toFixed(2) })
            .catch(e => console.warn("[pof2/email] error:", e.message));
        }
      }

      // Level 2: Account suspend — balance < city minimum (contacts/chat block)
      if (cityMin > 0) {
        try {
          const { data: uRow } = await supabase.from("users").select("data").eq("addr", owner).maybeSingle();
          if (!uRow) continue;
          const wasSuspended = !!uRow.data?.account_suspended;
          if (balance < cityMin && !wasSuspended) {
            await supabase.from("users").update({ data: { ...uRow.data, account_suspended: true, account_suspended_at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq("addr", owner);
            await notifyChatPartnersSuspension(owner, true);
            console.log(`[pof2] account blocked ${owner.slice(0,10)}… — balance ${balance.toFixed(2)} < city min ${cityMin}`);
          } else if (balance >= cityMin && wasSuspended) {
            await supabase.from("users").update({ data: { ...uRow.data, account_suspended: false, account_suspended_at: null }, updated_at: new Date().toISOString() }).eq("addr", owner);
            await notifyChatPartnersSuspension(owner, false);
            console.log(`[pof2] account unblocked ${owner.slice(0,10)}… — balance ${balance.toFixed(2)} >= city min ${cityMin}`);
          }
        } catch {}
      }
    }
    if (suspended + resumed > 0) {
      console.log(`[pof2] tick (network=${NETWORK}): ${byOwner.size} owners checked, ${suspended} suspended, ${resumed} resumed`);
    }
  } catch (e) {
    console.error("[pof2] error:", e.message);
  }
}

// === Tenant PoF: check balance for tenants with active intents ===
async function checkTenantIntentPoF() {
  try {
    // TASK 10F: scope by the network tag nested at data.intent.network — see
    // applyPofNetworkScope()/network-config.js's isPofRowInScope(). For
    // arc-mainnet this also shrinks the scan to only users with an
    // explicitly-mainnet-tagged intent, instead of every row in the table.
    const { data: rows, error } = await applyPofNetworkScope(
      supabase.from("users").select("addr, data"),
      "data->intent->>network"
    );
    if (error) { console.error("[pof-tn] fetch error:", error.message); return; }
    // Load city settings once
    const { data: ccRow } = await supabase.from("users").select("data").eq("addr", "__city_config__").maybeSingle();
    const citySettings = ccRow?.data?.cities || [];
    let suspended = 0, resumed = 0;
    for (const u of (rows || [])) {
      if (!u.data || u.data.role !== "tenant" || !u.data.intent) continue;
      const intent = u.data.intent;
      if (intent.paused) continue; // user-paused, skip
      const addr = u.addr;
      const budget = parseFloat(intent.budget) || 0;
      const city = intent.city || "";
      const cm = citySettings.find(c => city && (city.toLowerCase().includes(c.city.toLowerCase()) || c.city.toLowerCase().includes(city.toLowerCase())));
      const cityMin = cm?.min_balance || 0;
      if (budget <= 0 && cityMin <= 0) continue;
      const balance = await readUsdcBalance(addr);
      if (balance < 0) continue; // RPC error

      // Level 1: balance < budget → only hide intent (but user can still browse/chat)
      // Level 2: balance < cityMin → full account block (STOP screen)
      const shouldSuspendIntent = budget > 0 && balance < budget;
      const shouldSuspendAccount = cityMin > 0 && balance < cityMin;
      const intentWasSuspended = !!intent.suspended;
      const accountWasSuspended = !!u.data.account_suspended;

      let changed = false;
      const newIntent = { ...intent };
      const newData = { ...u.data };

      // Intent suspend/resume
      if (shouldSuspendIntent && !intentWasSuspended) {
        newIntent.suspended = true; newIntent.suspended_at = new Date().toISOString();
        changed = true; suspended++;
        console.log(`[pof-tn] intent suspended ${addr.slice(0,10)}… — balance ${balance.toFixed(2)} < budget ${budget}`);
        sendNotification(addr, "intent_suspended", { balance: balance.toFixed(2), required: budget }).catch(()=>{});
      } else if (!shouldSuspendIntent && intentWasSuspended) {
        newIntent.suspended = false; newIntent.suspended_at = null;
        changed = true; resumed++;
        console.log(`[pof-tn] intent resumed ${addr.slice(0,10)}… — balance ${balance.toFixed(2)} >= budget ${budget}`);
        sendNotification(addr, "intent_resumed", { balance: balance.toFixed(2) }).catch(()=>{});
      }

      // Account suspend/resume (full block — only when below city minimum)
      // If account is blocked, intent must also be suspended
      if (shouldSuspendAccount && !intentWasSuspended) {
        newIntent.suspended = true; newIntent.suspended_at = new Date().toISOString();
        changed = true;
      }
      if (shouldSuspendAccount && !accountWasSuspended) {
        newData.account_suspended = true; newData.account_suspended_at = new Date().toISOString();
        changed = true;
        console.log(`[pof-tn] account blocked ${addr.slice(0,10)}… — balance ${balance.toFixed(2)} < city min ${cityMin}`);
        await notifyChatPartnersSuspension(addr, true);
      } else if (!shouldSuspendAccount && accountWasSuspended) {
        newData.account_suspended = false; newData.account_suspended_at = null;
        changed = true;
        console.log(`[pof-tn] account unblocked ${addr.slice(0,10)}… — balance ${balance.toFixed(2)} >= city min ${cityMin}`);
        await notifyChatPartnersSuspension(addr, false);
      }

      if (changed) {
        newData.intent = newIntent;
        // Network guard repeated on the UPDATE itself (defense-in-depth), same
        // rationale as checkListingsTablePoF's UPDATE guard.
        await applyPofNetworkScope(
          supabase.from("users").update({ data: newData, updated_at: new Date().toISOString() }).eq("addr", addr),
          "data->intent->>network"
        );
      }
    }
    if (suspended + resumed > 0) {
      console.log(`[pof-tn] tick (network=${NETWORK}): ${suspended} suspended, ${resumed} resumed`);
    }
  } catch (e) {
    console.error("[pof-tn] error:", e.message);
  }
}

// === Notify all chat partners when a user gets suspended/resumed ===
async function notifyChatPartnersSuspension(addr, isSuspended) {
  try {
    const { data: msgs } = await supabase.from("messages").select("from_addr, to_addr").or(`from_addr.eq.${addr},to_addr.eq.${addr}`);
    const partners = new Set();
    for (const m of (msgs || [])) {
      if (m.from_addr === addr && m.to_addr !== addr) partners.add(m.to_addr);
      if (m.to_addr === addr && m.from_addr !== addr) partners.add(m.from_addr);
    }
    for (const partner of partners) {
      await supabase.from("messages").insert({
        from_addr: "system",
        to_addr: partner,
        text: isSuspended ? `peer_suspended:${addr}` : `peer_resumed:${addr}`,
        type: "system",
        event_type: isSuspended ? "peer_suspended" : "peer_resumed",
        actor_address: addr,
      }).catch(()=>{});
    }
  } catch {}
}

// Run every 5 minutes + once at startup
setInterval(checkListingsTablePoF, POF_INTERVAL_MS);
setInterval(checkTenantIntentPoF, POF_INTERVAL_MS);
setTimeout(checkListingsTablePoF, 10 * 1000);
setTimeout(checkTenantIntentPoF, 15 * 1000);

// TASK 10M: extracted to static-serve.js so its response-ordering fix
// (read the file before sending headers — see that file's doc comment for
// the ERR_HTTP_HEADERS_SENT bug this closes) can be unit tested without
// booting this side-effecting module.
function serveStatic(res, filePath) {
  return _serveStatic(res, filePath, [ARC_DIR, join(__dirname, "arc"), __dirname, join(__dirname, "public")]);
}

// json() uses the CORS origin already set on res by the request handler (no * override)
const json = (res, data, status=200) => { res.writeHead(status, {"Content-Type":"application/json"}); res.end(JSON.stringify(data)); };
const readBody = (req) => new Promise(r => { let b=""; req.on("data",c=>b+=c); req.on("end",()=>{ try{r(JSON.parse(b));}catch{r(null);} }); });
const readBodyLimited = (req, maxBytes = 1048576) => new Promise((resolve, reject) => {
  let b = ""; let size = 0;
  req.on("data", c => { size += c.length; if (size > maxBytes) { reject(new Error("Body too large")); req.destroy(); } else b += c; });
  req.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
});
const cfKey = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join("-");

// ─── Rate limiter (in-memory, per IP+path) ──────────────────────────────────
const _rateLimits = new Map();
setInterval(() => { const now = Date.now(); for (const [k,v] of _rateLimits) if (v.resetAt < now) _rateLimits.delete(k); }, 60000);
function rateLimit(req, res, path, maxPerMinute = 10) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const key = ip + ":" + path;
  const now = Date.now();
  const entry = _rateLimits.get(key) || { count: 0, resetAt: now + 60000 };
  if (entry.resetAt < now) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  _rateLimits.set(key, entry);
  if (entry.count > maxPerMinute) {
    json(res, { error: "Too many requests. Try again later." }, 429);
    return false;
  }
  return true;
}

// isCidAuthorizedForAddr imported from cid-auth.js

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL NOTIFICATIONS — via Resend API
// ═══════════════════════════════════════════════════════════════════════════
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "pi2pi <noreply@pi2pi.io>";
// APP_BASE_URL is resolved once, fail-closed, near the top of this file
// (TASK 10P) — see that definition's doc comment.
const EMAIL_SECRET = process.env.EMAIL_SECRET || process.env.ADMIN_SESSION_SECRET || "dev-secret-rotate-me";

async function sendEmail({ to, subject, html, from }) {
  if (!RESEND_API_KEY) { console.error("[email] RESEND_API_KEY not set"); return { ok: false, error: "api_key_missing" }; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from || EMAIL_FROM, to: Array.isArray(to) ? to : [to], subject, html }),
    });
    const j = await r.json();
    if (!r.ok) { console.error("[email] send failed:", j); return { ok: false, error: j?.message || "send_failed" }; }
    console.log(`[email] sent to ${to} · subject="${subject}" · id=${j.id}`);
    return { ok: true, id: j.id };
  } catch (e) {
    console.error("[email] error:", e.message);
    return { ok: false, error: e.message };
  }
}

// Sign a short token with HMAC so we can verify it later without DB lookup.
// Used for: email confirmation links, one-click unsubscribe links.
function signToken(payload, ttlSec = 7 * 86400) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = createHmac("sha256", EMAIL_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", EMAIL_SECRET).update(body).digest("base64url");
  if (sig !== expected) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

// Shared email shell (header + content + unsubscribe footer).
// Kept minimal inline HTML — renders well in Gmail, Apple Mail, Outlook.
function emailShell({ preheader, bodyHtml, ctaText, ctaUrl, unsubscribeUrl, preferencesUrl }) {
  const preheaderHtml = preheader ? `<div style="display:none;max-height:0;overflow:hidden">${preheader}</div>` : "";
  const ctaHtml = ctaText && ctaUrl ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td>
      <a href="${ctaUrl}" style="display:inline-block;padding:12px 22px;background:#00a699;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">${ctaText}</a>
    </td></tr></table>` : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a">
${preheaderHtml}
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f5f5f5;padding:30px 0"><tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04)"><tr><td>
    <div style="background:white;padding:22px 26px 14px;border-bottom:3px solid #00a699">
      <span style="font-weight:800;font-size:20px;color:#00a699;letter-spacing:-0.5px">pi2pi.io</span>
      <div style="font-size:10px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-top:2px">Decentralised Rental Protocol</div>
    </div>
    <div style="padding:26px;font-size:15px;line-height:1.6;color:#1a1a1a">
      ${bodyHtml}
      ${ctaHtml}
    </div>
    <div style="padding:16px 26px;background:#fafafa;border-top:1px solid #e8e8e8;font-size:11px;color:#888;line-height:1.5">
      You received this because you set this email on pi2pi.io.<br/>
      ${preferencesUrl ? `<a href="${preferencesUrl}" style="color:#00a699;text-decoration:none">Notification preferences</a> · ` : ""}
      ${unsubscribeUrl ? `<a href="${unsubscribeUrl}" style="color:#00a699;text-decoration:none">Unsubscribe</a>` : ""}
    </div>
  </td></tr></table>
  <div style="font-size:11px;color:#aaa;margin-top:12px">pi2pi.io · programmable rental agreements in USDC</div>
</td></tr></table>
</body></html>`;
}

// Send a notification — checks user's preferences + confirmation before sending.
// type: "confirm" | "viewing_request" | "new_message" | "early_termination" | "contract_proposed" | "damage_claim" | "dispute_freeze"
async function sendNotification(toAddr, type, payload) {
  if (!toAddr) return { ok: false, error: "no_addr" };
  const addr = toAddr.toLowerCase();
  // Look up user + email prefs
  const { data: row } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
  const udata = row?.data || {};
  const email = udata.email;
  const confirmed = !!udata.email_confirmed;
  if (!email) return { ok: false, error: "no_email" };
  // Type 'confirm' is always sent regardless of prefs (it IS the confirmation)
  if (type !== "confirm") {
    if (!confirmed) return { ok: false, error: "not_confirmed" };
    const prefs = udata.email_notifications || { transactional: true, promo: true, support: true };
    if (type === "promo" && prefs.promo === false) return { ok: false, error: "opt_out_promo" };
    if (type !== "promo" && type !== "support" && prefs.transactional === false) return { ok: false, error: "opt_out_transactional" };
  }
  // Build unsubscribe tokens
  const unsubToken = signToken({ a: addr, t: "transactional" });
  const unsubscribeUrl = `${APP_BASE_URL}/api/email/unsubscribe?token=${unsubToken}`;
  const preferencesUrl = `${APP_BASE_URL}/?openSettings=1`;
  // Per-type subject + body + cta
  const tmpl = emailTemplate(type, payload);
  if (!tmpl) return { ok: false, error: "unknown_type" };
  const html = emailShell({
    preheader: tmpl.preheader || tmpl.subject,
    bodyHtml: tmpl.body,
    ctaText: tmpl.ctaText,
    ctaUrl: tmpl.ctaUrl,
    unsubscribeUrl: type === "confirm" ? null : unsubscribeUrl,
    preferencesUrl: type === "confirm" ? null : preferencesUrl,
  });
  return sendEmail({ to: email, subject: tmpl.subject, html });
}

// Per-event templates — returns {subject, body, preheader, ctaText, ctaUrl}
function emailTemplate(type, p) {
  const name = p?.displayName || (p?.peerAddr ? p.peerAddr.slice(0, 6) + "…" + p.peerAddr.slice(-4) : "someone");
  switch (type) {
    case "confirm":
      return {
        subject: "Confirm your pi2pi email",
        preheader: "One click to start receiving pi2pi alerts.",
        body: `<p>Hi,</p><p>Click the button below to confirm this email and start receiving notifications about messages, viewings, and contract updates on pi2pi.io.</p><p style="font-size:12px;color:#888">If you didn't set this email on pi2pi, ignore this message — the link expires in 7 days.</p>`,
        ctaText: "Confirm email",
        ctaUrl: p.confirmUrl,
      };
    case "viewing_request":
      return {
        subject: "👁 New viewing request on pi2pi",
        preheader: `${name} wants to view your listing.`,
        body: `<p><strong>${name}</strong> requested to view your property${p.listingTitle ? ` <em>"${p.listingTitle}"</em>` : ""}.</p>${p.message ? `<p style="background:#f8f8f8;border-left:3px solid #00a699;padding:10px 12px;margin:14px 0;font-style:italic;color:#555">"${p.message}"</p>` : ""}<p>Open pi2pi to confirm a time or decline.</p>`,
        ctaText: "Open pi2pi",
        ctaUrl: `${APP_BASE_URL}/?inbox=1`,
      };
    case "new_message":
      return {
        subject: `💬 New message from ${name}`,
        preheader: p.preview || "Open pi2pi to read and reply.",
        body: `<p><strong>${name}</strong> sent you a message on pi2pi.</p>${p.preview ? `<p style="background:#f8f8f8;border-left:3px solid #00a699;padding:10px 12px;margin:14px 0;color:#333">${p.preview}</p>` : ""}`,
        ctaText: "Read & reply",
        ctaUrl: `${APP_BASE_URL}/?inbox=1`,
      };
    case "contract_proposed":
      return {
        subject: "📋 Contract proposal received",
        preheader: `${name} proposed a rental agreement.`,
        body: `<p><strong>${name}</strong> proposed a rental agreement on pi2pi.io.</p><p>Review the terms, deposits, and sign on-chain — or decline.</p>`,
        ctaText: "Review contract",
        ctaUrl: `${APP_BASE_URL}/?inbox=1`,
      };
    case "contract_cancelled":
      return {
        subject: "Contract proposal cancelled",
        preheader: `${name} cancelled the rental agreement proposal.`,
        body: `<p><strong>${name}</strong> cancelled the rental agreement proposal on pi2pi.io.</p><p>You are free to explore other options.</p>`,
        ctaText: "Open pi2pi",
        ctaUrl: `${APP_BASE_URL}/?inbox=1`,
      };
    case "early_termination":
      return {
        subject: "⚠ Early termination proposed",
        preheader: `${name} proposed to end the lease early.`,
        body: `<p><strong>${name}</strong> proposed to terminate your lease early on pi2pi.</p><p>Type: <strong>${p.termType || "unspecified"}</strong>. Your response is needed — open pi2pi to review and sign.</p>`,
        ctaText: "Review early termination",
        ctaUrl: `${APP_BASE_URL}/?inbox=1`,
      };
    case "listing_paused":
      return {
        subject: "⏸ Your listing was paused — wallet balance dropped",
        preheader: `${p.listingTitle || "A listing"} is no longer visible to tenants.`,
        body: `<p>Your listing <strong>${p.listingTitle || "—"}</strong> was paused automatically.</p><p>Wallet balance: <strong>${p.balance} USDC</strong>. Required for your active listings: <strong>${p.required} USDC</strong>.</p><p>Top up your wallet to bring this listing back online. It will resume automatically once your balance covers the required amount.</p>`,
        ctaText: "Open my listings",
        ctaUrl: `${APP_BASE_URL}/?view=my-listings`,
      };
    case "listing_resumed":
      return {
        subject: "Your listing is live again",
        preheader: `${p.listingTitle || "A listing"} is visible to tenants.`,
        body: `<p>Your listing <strong>${p.listingTitle || "—"}</strong> is live again.</p><p>Your wallet balance (<strong>${p.balance} USDC</strong>) now covers the required amount. Tenants can find and contact you.</p>`,
        ctaText: "Open my listings",
        ctaUrl: `${APP_BASE_URL}/?view=my-listings`,
      };
    case "intent_suspended":
      return {
        subject: "Your search request was paused — low balance",
        preheader: "Your wallet balance dropped below the required minimum.",
        body: `<p>Your search request was paused automatically because your wallet balance dropped below the required minimum.</p><p>Wallet balance: <strong>${p.balance} USDC</strong>. Required: <strong>${p.required} USDC</strong>.</p><p>Top up your wallet to bring your request back online. It will resume automatically once your balance covers the required amount.</p>`,
        ctaText: "Open pi2pi",
        ctaUrl: `${APP_BASE_URL}/#/my-intent`,
      };
    case "intent_resumed":
      return {
        subject: "Your search request is live again",
        preheader: "Landlords can see your request again.",
        body: `<p>Your search request is live again.</p><p>Your wallet balance (<strong>${p.balance} USDC</strong>) now covers the required amount. Landlords can find you and send offers.</p>`,
        ctaText: "Open pi2pi",
        ctaUrl: `${APP_BASE_URL}/#/my-intent`,
      };
    default:
      return null;
  }
}
// ═══════════════════════════════════════════════════════════════════════════

// TASK 10P: allowed origins are always THIS runtime's own branded domain +
// its own Fly hostname + local dev — never the other network's branded
// domain (least privilege; a stray CORS/webauthn grant to the wrong
// network's domain would be a real cross-environment trust leak, the same
// class of mistake this engagement has been closing at the DB layer in
// TASK 10F–10J). Both entries derive from APP_BASE_URL/FLY_HOSTNAME_URL —
// no second, independently-hardcoded domain list.
const ALLOWED_ORIGINS = resolveAllowedOrigins({ appBaseUrl: APP_BASE_URL, flyHostnameUrl: FLY_HOSTNAME_URL });

const server = createServer(async (req, res) => {
  // CORS — support credentials for wallet auth session
  const origin = req.headers.origin || "";
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-CSRF-Token",
      "Access-Control-Allow-Credentials": "true",
    });
    res.end(); return;
  }
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Credentials", "true");

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ============ WebAuthn Related Origins ============
  // Circle's backend returns rpId="<this app's Fly hostname>" even for
  // branded-domain clients (Circle stores rpId at project level, not
  // per-key). To make passkeys work on the branded domain anyway, we serve
  // a related-origins manifest from the rpId domain. Browser fetches it
  // when it sees a cross-origin rpId, and accepts the credential if our
  // origin is listed. MUST be returned BEFORE the redirect, otherwise
  // browser follows 301 and never sees JSON. Origins are ALLOWED_ORIGINS'
  // two real domains only (never localhost, never the other network's
  // domain) — TASK 10P.
  if (url.pathname === "/.well-known/webauthn") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    });
    res.end(JSON.stringify({ origins: resolveWebauthnOrigins({ appBaseUrl: APP_BASE_URL, flyHostnameUrl: FLY_HOSTNAME_URL }) }));
    return;
  }

  // ============ REDIRECT fly.dev → branded domain ============
  // All other paths on this runtime's own raw Fly hostname → bounce to its
  // own APP_BASE_URL, preserving path + query (TASK 10P: previously
  // hardcoded to my.pi2pi.io regardless of which network was running).
  // FLY_HOSTNAME_URL is null in local dev, so this never fires there; in
  // production APP_BASE_URL's host is always different from
  // FLY_HOSTNAME_URL's host by construction, so this can't loop.
  const host = (req.headers.host || "").toLowerCase();
  const flyRedirectTarget = resolveFlyRedirectTarget({ host, flyHostnameUrl: FLY_HOSTNAME_URL, appBaseUrl: APP_BASE_URL, requestUrl: req.url });
  if (flyRedirectTarget) {
    res.writeHead(301, { Location: flyRedirectTarget });
    res.end();
    return;
  }
  const path = url.pathname;

  try {
    // ============ AUTH ROUTES ============
    // Handle /api/auth/* endpoints (nonce, verify, logout, session)
    if (path.startsWith("/api/auth/")) {
      if (await handleAuthRoutes(req, res, path, json, readBody)) return;
    }

    // ============ ADMIN ROUTES ============
    // Handle all /api/admin/* endpoints (login, stats, users, promocodes, etc.)
    if (await handleAdmin(req, res, supabase, path)) return;

    // Serve admin UI at /pi2pi-console (access is enforced by the session/auth
    // check in handleAdmin() above, not by the obscurity of this path)
    if (path === "/pi2pi-console" || path === "/pi2pi-console/") {
      return serveStatic(res, "pi2pi-console.html");
    }
    if (path === "/pi2pi-console.jsx") {
      return serveStatic(res, "pi2pi-console.jsx");
    }

    // ============ WALLET AUTH ============
    const REQUIRE_AUTH = process.env.REQUIRE_WALLET_AUTH === "true";
    const AUTH_EXEMPT = ["/api/log", "/api/auth/", "/api/email/confirm", "/api/listings/compose-description", "/api/keeper/heartbeat", "/api/telegram/webhook"];

    // Attach session to request if available
    if (path.startsWith("/api/")) {
      const session = getAuth(req);
      if (session) req._walletSession = session;
    }

    // Enforce auth on mutating endpoints
    if (path.startsWith("/api/") && (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE")) {
      const isExempt = AUTH_EXEMPT.some(e => path.startsWith(e));
      if (!isExempt && REQUIRE_AUTH && !req._walletSession) {
        return json(res, { error: "Unauthorized — please reconnect wallet" }, 401);
      }
    }

    // Helper: require wallet session, return session addr. Returns null + sends 401 if no session.
    const requireWallet = () => {
      if (req._walletSession) return req._walletSession.addr;
      if (REQUIRE_AUTH) { json(res, { error: "Unauthorized" }, 401); return null; }
      return undefined; // no session, auth not enforced — let through
    };

    // Helper: verify claimed addr matches session. Body addr is NEVER trusted as auth source.
    // If session exists, body addr MUST match. If no session + auth optional, pass through.
    const verifyAddrMatch = (body) => {
      if (!req._walletSession) return true;
      const claimed = (body?.addr || body?.fromAddr || body?.owner_addr || "").toLowerCase();
      if (claimed && req._walletSession.addr !== claimed) {
        json(res, { error: "Address mismatch" }, 403);
        return false;
      }
      return true;
    };

    // Helper: for path-based addr endpoints, verify session owns that addr
    const requireSessionAddr = (pathAddr) => {
      if (!req._walletSession) return !REQUIRE_AUTH; // optional mode
      return req._walletSession.addr === pathAddr.toLowerCase();
    };

    // ============ DEBUG: contract-form-lock read-only diagnostic ============
    if (path === "/api/debug/contract-form-lock" && req.method === "GET") {
      const qs = new URL(req.url, "http://x").searchParams;
      const addr = (qs.get("addr") || "").toLowerCase();
      const peer = (qs.get("peer") || "").toLowerCase();
      const field = qs.get("field") || "";
      if (!addr || !peer || !field) return json(res, { error: "Required: addr, peer, field" }, 400);
      // Build value from query params
      const value = {};
      if (qs.get("type")) value.type = qs.get("type");
      if (qs.get("amount")) value.amount = Number(qs.get("amount"));
      if (qs.get("label")) value.label = qs.get("label");
      if (qs.get("kind")) value[qs.get("kind")] = {};
      const key = [addr, peer].sort().join("-");
      const { data: row } = await supabase.from("contract_forms").select("form").eq("key", key).maybeSingle();
      const cf = row?.form || { steps: {}, deposit: {}, signatures: {} };
      const lock = checkFieldLock(field, Object.keys(value).length ? value : null, cf);
      const stepBools = {};
      for (const [k, v] of Object.entries(cf.steps || {})) { if (typeof v === "boolean") stepBools[k] = v; }
      return json(res, {
        lock,
        field,
        value: Object.keys(value).length ? value : null,
        formSummary: {
          stepBools,
          depositConfirmed: cf.deposit?.confirmed || false,
          depositType: cf.deposit?.type || null,
          depositAmount: cf.deposit?.amount || null,
          signaturesCount: Object.keys(cf.signatures || {}).length,
          documentsCount: (cf.documents || []).length,
        },
        version: { contractVersion: 6, depositLockRule: "deposit.confirmed or signatures only" },
      });
    }

    // ============ VERSION (read-only, no auth) ============
    if (path === "/api/version" && req.method === "GET") {
      return json(res, {
        app: "pi2pi-project",
        contractVersion: 6,
        rentalEscrow: RENTAL_ESCROW_ADDR,
        propDepEscrow: PROPDEP_ESCROW_ADDR,
        depositLockRule: "deposit.confirmed or signatures only",
        buildTime: new Date().toISOString(), // server start time
        node: process.version,
      });
    }

    // ============ EVENT LOG ============
    if (path === "/api/log" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body || !body.type) return json(res, { error: "Missing type" }, 400);
      // Fire-and-forget insert — don't block response on DB errors
      supabase.from("event_logs").insert({
        time: body.time || new Date().toISOString(),
        type: body.type,
        user_addr: (body.user || "").toLowerCase() || null,
        action: body.action || null,
        contract_id: body.contractId || null,
        data: body.data || null,
      }).then(({ error }) => { if (error) console.warn("[event_logs] insert error:", error.message); });
      return json(res, { ok: true });
    }

    // ============ USERS ============
    if (path === "/api/users" && req.method === "GET") {
      const { data, error } = await supabase.from("users").select("addr,data");
      if (error) return json(res, {error: error.message}, 500);
      const out = {};
      (data || []).forEach(row => { out[row.addr] = row.data; });
      return json(res, out);
    }
    if (path === "/api/users" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.addr) return json(res, {error:"Missing addr"}, 400);
      const addr = body.addr.toLowerCase();
      // Legacy PoF on user.data.listing.rent removed in M8 — listings now live
      // in the `listings` table and have their own PoF cron (checkListingsTablePoF).
      // Shield — preserve server-only fields the client never sees.
      // Auto-sync from localStorage does POST /api/users with the cached profile;
      // we must not let that overwrite email/preferences/locks that were set
      // server-side after the cache snapshot. Explicit Reset Account uses DELETE,
      // not POST, so this shield doesn't prevent user-initiated wipes.
      try {
        const { data: prev } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
        const prevData = prev?.data || {};
        const PROTECTED_KEYS = [
          "email", "email_confirmed", "email_confirmed_at", "email_set_at",
          "email_resend_at", "email_notifications",
          "display_name", "display_name_locked",
        ];
        for (const k of PROTECTED_KEYS) {
          if (prevData[k] !== undefined && body[k] === undefined) body[k] = prevData[k];
        }
      } catch {}
      const { error } = await supabase.from("users").upsert({ addr, data: body, updated_at: new Date().toISOString() });
      if (error) return json(res, {error: error.message}, 500);
      return json(res, {ok:true});
    }
    // GET /api/user-status/:addr — suspension status for UI polling
    if (path.match(/^\/api\/user-status\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      const addr = path.split("/").pop().toLowerCase();
      const { data: uRow } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (!uRow) return json(res, { suspended: false });
      const d = uRow.data || {};
      const role = d.role || "tenant";
      const { data: ccRow } = await supabase.from("users").select("data").eq("addr", "__city_config__").maybeSingle();
      const citySettings = ccRow?.data?.cities || [];
      let cityMin = 0, listingRequired = 0;
      if (role === "tenant" && d.intent) {
        const city = d.intent.city || "";
        const cm = citySettings.find(c => city && (city.toLowerCase().includes(c.city.toLowerCase()) || c.city.toLowerCase().includes(city.toLowerCase())));
        cityMin = cm?.min_balance || 0;
        listingRequired = parseFloat(d.intent.budget) || 0;
      } else if (role === "landlord") {
        const { data: lRows } = await applyStrictNetworkScope(
          supabase.from("listings").select("monthly_rent,status,city,district").eq("owner_addr", addr).in("status", ["active","suspended"])
        );
        listingRequired = (lRows || []).reduce((s, l) => s + Number(l.monthly_rent), 0);
        const ownerCity = (lRows || [])[0]?.city || (lRows || [])[0]?.district || "";
        const cm = citySettings.find(c => ownerCity && (ownerCity.toLowerCase().includes(c.city.toLowerCase()) || c.city.toLowerCase().includes(ownerCity.toLowerCase())));
        cityMin = cm?.min_balance || 0;
      }
      let balance = 0;
      try { balance = await readUsdcBalance(addr); } catch {}
      return json(res, {
        suspended: !!d.account_suspended,
        suspended_at: d.account_suspended_at || null,
        intentSuspended: !!(d.intent?.suspended),
        balance: balance >= 0 ? balance : 0,
        cityMin,
        listingRequired,
        required: cityMin, // for STOP banner — city minimum is the threshold
        role,
      });
    }
    if (path.match(/^\/api\/users\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      const addr = path.split("/").pop().toLowerCase();
      const { data, error } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (error) return json(res, {error: error.message}, 500);
      return json(res, data?.data || null);
    }
    // Legacy DELETE /api/users/:addr — redirects to the safe reset endpoint
    if (path.match(/^\/api\/users\/0x[0-9a-fA-F]+$/) && req.method === "DELETE") {
      return json(res, { error: "Use POST /api/users/:addr/reset instead" }, 410);
    }

    // POST /api/users/:addr/reset — dev/test only account reset with active-contract guard
    if (path.match(/^\/api\/users\/0x[0-9a-fA-F]+\/reset$/) && req.method === "POST") {
      if (process.env.ENABLE_ACCOUNT_RESET !== "true") {
        return json(res, { error: "Account reset is disabled in this environment" }, 404);
      }
      const addr = path.split("/")[3].toLowerCase();
      if (!requireSessionAddr(addr)) return json(res, { error: "Forbidden" }, 403);

      // Step 1: Check active contract — fail-closed on DB error
      const { data: acRow, error: acErr } = await supabase.from("active_contracts").select("data").eq("addr", addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC).maybeSingle();
      if (acErr) return json(res, { error: "Cannot verify contract status: " + acErr.message }, 500);
      if (acRow?.data && !acRow.data.archived) {
        return json(res, { ok: false, error: "Active contract exists. Finish or archive contract before reset." }, 409);
      }

      // Step 2: Also check if this addr is referenced as peer in someone else's active contract
      const { data: peerRows, error: peerErr } = await supabase.from("active_contracts").select("addr,data").eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC);
      if (peerErr) return json(res, { error: "Cannot verify peer contract status: " + peerErr.message }, 500);
      const isPeer = (peerRows || []).some(r =>
        r.addr !== addr && !r.data?.archived &&
        (r.data?.peerAddr?.toLowerCase() === addr || r.data?.listing?.contract?.toLowerCase() === addr)
      );
      if (isPeer) {
        return json(res, { ok: false, error: "Active contract exists (as counterparty). Finish or archive contract before reset." }, 409);
      }

      // Step 3: Fetch listings — fail-closed on DB error
      const { data: listings, error: listErr } = await applyStrictNetworkScope(
        supabase.from("listings").select("id,status,photos").eq("owner_addr", addr)
      );
      if (listErr) return json(res, { error: "Cannot read listings: " + listErr.message }, 500);

      let deletedDraftListings = 0;
      let archivedListings = 0;
      let photoWarnings = 0;

      for (const l of (listings || [])) {
        if (l.status === "draft") {
          // Best-effort photo cleanup from storage
          if (l.photos?.length) {
            const paths = l.photos.filter(p => p.path).map(p => p.path);
            if (paths.length) {
              const { error: stErr } = await supabase.storage.from("photos").remove(paths);
              if (stErr) { console.warn("[reset] photo cleanup:", stErr.message); photoWarnings++; }
            }
          }
          const { error: delErr } = await supabase.from("listings").delete().eq("id", l.id);
          if (delErr) return json(res, { error: "Failed to delete draft listing: " + delErr.message }, 500);
          deletedDraftListings++;
        } else if (["active", "paused", "suspended", "published"].includes(l.status)) {
          const { error: archErr } = await supabase.from("listings").update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", l.id);
          if (archErr) return json(res, { error: "Failed to archive listing: " + archErr.message }, 500);
          archivedListings++;
        }
        // archived listings — leave as-is
      }

      // Step 4: User-related data cleanup (no active contract at this point)
      const { error: msgErr } = await supabase.from("messages").delete().or(`from_addr.eq.${addr},to_addr.eq.${addr}`);
      if (msgErr) return json(res, { error: "Failed to delete messages: " + msgErr.message }, 500);

      const { error: vrErr } = await supabase.from("viewing_requests").delete().or(`from_addr.eq.${addr},to_addr.eq.${addr}`);
      if (vrErr) return json(res, { error: "Failed to delete viewing requests: " + vrErr.message }, 500);

      const { error: cpErr } = await supabase.from("contract_proposals").delete().or(`from_addr.eq.${addr},to_addr.eq.${addr}`);
      if (cpErr) return json(res, { error: "Failed to delete contract proposals: " + cpErr.message }, 500);

      const { error: etErr } = await supabase.from("early_terms").delete().or(`from_addr.eq.${addr},to_addr.eq.${addr}`);
      if (etErr) return json(res, { error: "Failed to delete early terms: " + etErr.message }, 500);

      // contract_forms where this address is part of the key
      const { data: cfRows, error: cfSelErr } = await supabase.from("contract_forms").select("key").like("key", `%${addr}%`);
      if (cfSelErr) return json(res, { error: "Cannot read contract forms: " + cfSelErr.message }, 500);
      for (const row of (cfRows || [])) {
        const { error: cfErr } = await supabase.from("contract_forms").delete().eq("key", row.key);
        if (cfErr) return json(res, { error: "Failed to delete contract form: " + cfErr.message }, 500);
      }

      // Delete archived active_contracts row (if any — already confirmed non-active above)
      const { error: acDelErr } = await supabase.from("active_contracts").delete().eq("addr", addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC);
      if (acDelErr) return json(res, { error: "Failed to delete active_contracts: " + acDelErr.message }, 500);

      // Delete user row
      const { error: userErr } = await supabase.from("users").delete().eq("addr", addr);
      if (userErr) return json(res, { error: "Failed to delete user: " + userErr.message }, 500);

      const result = { ok: true, deletedDraftListings, archivedListings, deletedUser: true };
      if (photoWarnings > 0) result.photoWarnings = photoWarnings;
      return json(res, result);
    }
    // PATCH — partial merge of allowlisted fields (wallet/identity tracking).
    // Safer than POST (which does full-row upsert and can wipe listing/signature).
    if (path.match(/^\/api\/users\/0x[0-9a-fA-F]+$/) && req.method === "PATCH") {
      const addr = path.split("/").pop().toLowerCase();
      if (!requireSessionAddr(addr)) return json(res, {error:"Forbidden"}, 403);
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      console.log("[patch/users]", addr, "body:", JSON.stringify(body));
      if (!body || typeof body !== "object") return json(res, {error:"Bad body"}, 400);
      // Allowlist — DO NOT allow role/listing/signature changes through PATCH
      const ALLOWED = ["walletType", "providerName", "circleBiometric", "lastLoginAt", "lastWalletSeenAt", "lastSeenInbox"];
      const patch = {};
      for (const k of ALLOWED) if (k in body) patch[k] = body[k];
      if (Object.keys(patch).length === 0) return json(res, {error:"No allowed fields"}, 400);

      const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (!existing) { console.log("[patch/users] skipped — not registered:", addr); return json(res, {ok:true, skipped:"user not registered yet"}); }
      const merged = { ...existing.data, ...patch, addr };
      const { error } = await supabase.from("users").update({ data: merged, updated_at: new Date().toISOString() }).eq("addr", addr);
      if (error) { console.error("[patch/users] DB error:", error.message); return json(res, {error: error.message}, 500); }
      console.log("[patch/users] ✓ updated:", addr, "fields:", Object.keys(patch));
      return json(res, {ok:true, patched: Object.keys(patch)});
    }

    // ============ MESSAGES ============
    if (path === "/api/messages" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.fromAddr || !body?.toAddr) return json(res, {error:"Missing fields"}, 400);
      // Block suspended users from sending messages
      if (body.type !== "system") {
        const fromAddr = body.fromAddr.toLowerCase();
        const { data: senderRow } = await supabase.from("users").select("data").eq("addr", fromAddr).maybeSingle();
        if (senderRow?.data?.account_suspended) return json(res, { error: "account_suspended" }, 403);
      }
      // Block URLs in user messages (anti-spam/phishing)
      if ((!body.type || body.type === "user") && body.text) {
        const filter = checkText(body.text);
        if (filter.blocked) return json(res, { error: "links_not_allowed" }, 400);
      }
      const row = {
        from_addr: body.fromAddr.toLowerCase(),
        to_addr: body.toAddr.toLowerCase(),
        text: body.text || null,
        type: body.type || "user",
        actor_address: (body.actorAddress || body.fromAddr).toLowerCase(),
        actor_role: body.actorRole || null,
        event_type: body.eventType || null,
      };
      if (_hasParamsColumn && body.params) row.params = body.params;
      // Dedup: skip if same event_type + same from/to pair exists within last 60 seconds
      if (row.event_type && row.type !== "user") {
        const since = new Date(Date.now() - 60000).toISOString();
        const { data: dup } = await supabase.from("messages").select("id").eq("from_addr", row.from_addr).eq("to_addr", row.to_addr).eq("event_type", row.event_type).gte("created_at", since).limit(1);
        if (dup && dup.length > 0) return json(res, { id: dup[0].id, deduplicated: true });
      }
      const { data, error } = await supabase.from("messages").insert(row).select().single();
      if (error) return json(res, {error: error.message}, 500);
      // Email notification for user messages (not system events — those create their own notifications).
      // Simple in-memory rate limit: at most 1 email per (from→to) pair per 10 min (prevents chat spam).
      if (row.type === "user") {
        const preview = row.text.length > 120 ? row.text.slice(0, 117) + "…" : row.text;
        // Email — throttled (1 per 10 min per pair)
        const key = row.from_addr + "→" + row.to_addr;
        const now = Date.now();
        if (!global.__msgEmailThrottle) global.__msgEmailThrottle = new Map();
        const lastSent = global.__msgEmailThrottle.get(key) || 0;
        if (now - lastSent >= 10 * 60 * 1000) {
          global.__msgEmailThrottle.set(key, now);
          sendNotification(row.to_addr, "new_message", { peerAddr: row.from_addr, preview }).catch(e => console.warn("[email/msg] error:", e.message));
        }
        // Telegram — every message, no throttle
        supabase.from("users").select("data").eq("addr", row.from_addr).maybeSingle().then(({ data: senderRow }) => {
          const fromName = senderRow?.data?.display_name || "New message";
          notifyUser(supabase, row.to_addr, "message_received", { preview, fromName }).catch(()=>{});
        }).catch(() => {
          notifyUser(supabase, row.to_addr, "message_received", { preview, fromName: "New message" }).catch(()=>{});
        });
      }
      // Telegram for system messages (contract signed, early term, rent paid, etc.)
      if (row.type === "system" && row.event_type && row.from_addr !== row.to_addr) {
        const evtMap = {
          "contract_signed": "contract_signed",
          "early_exit_requested": "early_term_proposed",
          "early_exit_executed": "early_term_accepted",
          "rent_paid": "rent_paid",
          "damage_claimed": "damage_claim",
          "damage_accepted": "deposit_returned",
          "lease_ended": "contract_signed",
          "lease_terminated": "early_term_accepted",
          "tenant_deposited": "contract_signed",
          "landlord_deposited": "contract_signed",
        };
        const tgType = evtMap[row.event_type];
        if (tgType) {
          const preview = row.text ? (row.text.length > 100 ? row.text.slice(0, 97) + "…" : row.text) : row.event_type;
          supabase.from("users").select("data").eq("addr", row.from_addr).maybeSingle().then(({ data: senderRow }) => {
            const fromName = senderRow?.data?.display_name || "";
            notifyUser(supabase, row.to_addr, tgType, { fromName, preview, amount: "" }).catch(()=>{});
          }).catch(() => {
            notifyUser(supabase, row.to_addr, tgType, { fromName: "", preview: row.text || row.event_type }).catch(()=>{});
          });
        }
      }
      return json(res, msgRowToApi(data));
    }
    if (path.match(/^\/api\/messages\/0x[0-9a-fA-F]+\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      if (!req._walletSession) return json(res, { error: "Unauthorized" }, 401);
      const parts = path.split("/");
      const a = parts[3].toLowerCase(), b = parts[4].toLowerCase();
      const sessionAddr = req._walletSession.addr.toLowerCase();
      if (sessionAddr !== a && sessionAddr !== b) return json(res, { error: "Forbidden" }, 403);
      const { data, error } = await supabase.from("messages").select("*")
        .or(`and(from_addr.eq.${a},to_addr.eq.${b}),and(from_addr.eq.${b},to_addr.eq.${a})`)
        .order("id", { ascending: true });
      if (error) return json(res, {error: error.message}, 500);
      return json(res, (data || []).map(msgRowToApi));
    }

    // ============ VIEWING REQUESTS ============
    if (path === "/api/viewing-request" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.fromAddr || !body?.toAddr) return json(res, {error:"Missing fields"}, 400);
      const from = body.fromAddr.toLowerCase(), to = body.toAddr.toLowerCase();
      // Tenant must have active server-side intent
      const { data: fromUser } = await supabase.from("users").select("data").eq("addr", from).maybeSingle();
      const fromIntent = fromUser?.data?.intent || null;
      if (!fromIntent || fromIntent.paused || fromIntent.suspended || fromUser?.data?.account_suspended) {
        return json(res, { error: "no_active_intent" }, 403);
      }
      const { data: existingArr } = await supabase.from("viewing_requests").select("*")
        .or(`and(from_addr.eq.${from},to_addr.eq.${to}),and(from_addr.eq.${to},to_addr.eq.${from})`);
      if (existingArr && existingArr.length > 0) {
        const existing = existingArr[0];
        if (existing.status === "declined") {
          // Reset to pending with new initiator
          const { data: updated, error: updErr } = await supabase.from("viewing_requests").update({
            from_addr: from, to_addr: to, status: "pending", signature: null, signed_by: null, updated_at: new Date().toISOString(),
          }).eq("id", existing.id).select().single();
          if (updErr) return json(res, {error: updErr.message}, 500);
          await supabase.from("messages").insert({
            from_addr: from, to_addr: to, text: "👁 Viewing requested again", type: "system", actor_address: from, event_type: "viewing_requested",
          });
          sendNotification(to, "viewing_request", { peerAddr: from }).catch(e => console.warn("[email/viewing] error:", e.message));
          return json(res, vrRowToApi(updated));
        }
        return json(res, vrRowToApi(existing));
      }
      const { data: vrData, error } = await supabase.from("viewing_requests").insert({
        from_addr: from, to_addr: to,
        listing_id: body.listingId || null,
        listing_title: body.listingTitle || "",
        message: body.message || "",
        status: "pending",
      }).select().single();
      if (error) return json(res, {error: error.message}, 500);
      // Add system message
      await supabase.from("messages").insert({
        from_addr: from, to_addr: to,
        text: "👁 Viewing requested",
        type: "system",
        actor_address: from,
        event_type: "viewing_requested",
      });
      // Email notification (fire-and-forget)
      sendNotification(to, "viewing_request", { peerAddr: from, listingTitle: body.listingTitle, message: body.message }).catch(e => console.warn("[email/viewing] error:", e.message));
      supabase.from("users").select("data").eq("addr", from).maybeSingle().then(({ data: senderRow }) => {
        const fromName = senderRow?.data?.display_name || "New viewing request";
        notifyUser(supabase, to, "viewing_request", { fromName, listingTitle: body.listingTitle }).catch(()=>{});
      }).catch(() => {
        notifyUser(supabase, to, "viewing_request", { fromName: "New viewing request", listingTitle: body.listingTitle }).catch(()=>{});
      });
      return json(res, vrRowToApi(vrData));
    }
    if (path.match(/^\/api\/viewing-request\/\d+$/) && req.method === "PATCH") {
      const id = parseInt(path.split("/").pop());
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      const update = { updated_at: new Date().toISOString() };
      if (body?.status) update.status = body.status;
      if (body?.signature) update.signature = body.signature;
      if (body?.signedBy) update.signed_by = body.signedBy;
      const { data: vrData, error } = await supabase.from("viewing_requests").update(update).eq("id", id).select().single();
      if (error || !vrData) return json(res, {error: error?.message || "Not found"}, 404);
      if (body?.status === "confirmed") {
        const actor = (body.signedBy || vrData.to_addr).toLowerCase();
        const peer = actor === vrData.from_addr ? vrData.to_addr : vrData.from_addr;
        await supabase.from("messages").insert({
          from_addr: actor, to_addr: peer,
          text: "✅ Viewing confirmed",
          type: "system",
          actor_address: actor,
          event_type: "viewing_confirmed",
        });
        supabase.from("users").select("data").eq("addr", actor).maybeSingle().then(({data:s})=>{
          notifyUser(supabase, peer, "viewing_confirmed", { fromName: s?.data?.display_name || "Viewing confirmed" }).catch(()=>{});
        }).catch(()=>{});
      }
      if (body?.status === "declined") {
        const actor = (body.signedBy || vrData.to_addr).toLowerCase();
        const peer = actor === vrData.from_addr ? vrData.to_addr : vrData.from_addr;
        await supabase.from("messages").insert({
          from_addr: actor, to_addr: peer,
          text: "Viewing declined",
          type: "system",
          actor_address: actor,
          event_type: "viewing_declined",
        });
        supabase.from("users").select("data").eq("addr", actor).maybeSingle().then(({data:s})=>{
          notifyUser(supabase, peer, "viewing_declined", { fromName: s?.data?.display_name || "Viewing declined" }).catch(()=>{});
        }).catch(()=>{});
      }
      return json(res, vrRowToApi(vrData));
    }

    // ============ CONTRACT PROPOSALS ============
    if (path === "/api/contract-proposal" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.fromAddr || !body?.toAddr) return json(res, {error:"Missing fields"}, 400);
      const from = body.fromAddr.toLowerCase(), to = body.toAddr.toLowerCase();
      // Block if either party already has an active (non-cancelled/rejected) proposal
      const { data: existingFrom } = await supabase.from("contract_proposals")
        .select("id,from_addr,to_addr,status")
        .or(`from_addr.eq.${from},to_addr.eq.${from}`)
        .not("status", "in", '("cancelled","rejected")')
        .limit(1);
      if (existingFrom && existingFrom.length > 0) {
        return json(res, { error: "active_proposal_exists", party: "proposer" }, 409);
      }
      const { data: existingTo } = await supabase.from("contract_proposals")
        .select("id,from_addr,to_addr,status")
        .or(`from_addr.eq.${to},to_addr.eq.${to}`)
        .not("status", "in", '("cancelled","rejected")')
        .limit(1);
      if (existingTo && existingTo.length > 0) {
        return json(res, { error: "peer_has_active_proposal" }, 409);
      }
      const signatures = {};
      let status = "proposed";
      if (body.signature) { signatures[from] = body.signature; status = "signed-by-proposer"; }
      // Clear old contract form data for this pair (fresh start)
      const cfKeyNew = [from, to].sort().join("-");
      try { await supabase.from("contract_forms").delete().eq("key", cfKeyNew); } catch(e) {}
      const { data: cpData, error } = await supabase.from("contract_proposals").insert({
        from_addr: from, to_addr: to, status, signatures,
      }).select().single();
      if (error) return json(res, {error: error.message}, 500);
      await supabase.from("messages").insert({
        from_addr: from, to_addr: to,
        text: "📋 Rental agreement proposed",
        type: "system",
        actor_address: from,
        event_type: "contract_proposed",
      });
      sendNotification(to, "contract_proposed", { peerAddr: from }).catch(e => console.warn("[email/contract] error:", e.message));
      supabase.from("users").select("data").eq("addr", from).maybeSingle().then(({data:s})=>{
        notifyUser(supabase, to, "contract_proposal", { fromName: s?.data?.display_name || "New proposal" }).catch(()=>{});
      }).catch(()=>{});
      return json(res, cpRowToApi(cpData));
    }
    // Cancel contract proposal
    if (path.startsWith("/api/contract-proposal/") && path.endsWith("/cancel") && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      const cpId = path.split("/")[3];
      if (!body?.addr) return json(res, {error:"Missing addr"}, 400);
      const addr = body.addr.toLowerCase();
      const { data: cp, error: getErr } = await supabase.from("contract_proposals").select("*").eq("id", cpId).maybeSingle();
      if (getErr || !cp) return json(res, {error:"Not found"}, 404);
      // Only parties can cancel
      if (cp.from_addr !== addr && cp.to_addr !== addr) return json(res, {error:"Unauthorized"}, 403);
      if (cp.status === "cancelled") return json(res, {error:"Already cancelled"}, 400);
      // Block cancel if on-chain activation has started
      if (cp.status === "activating" || cp.status === "onchain") return json(res, {error:"Cannot cancel — on-chain transaction in progress"}, 400);
      // Check if either party already has an on-chain agreement
      const fromAc = await supabase.from("active_contracts").select("data").eq("addr", cp.from_addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC).maybeSingle();
      const toAc = await supabase.from("active_contracts").select("data").eq("addr", cp.to_addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC).maybeSingle();
      if (fromAc?.data?.data?.agreementId || toAc?.data?.data?.agreementId) {
        return json(res, {error:"Cannot cancel — agreement already created on-chain"}, 400);
      }
      const { error: updErr } = await supabase.from("contract_proposals").update({
        status: "cancelled", updated_at: new Date().toISOString(),
      }).eq("id", cpId);
      if (updErr) return json(res, {error: updErr.message}, 500);
      const peer = addr === cp.from_addr ? cp.to_addr : cp.from_addr;
      await supabase.from("messages").insert({
        from_addr: addr, to_addr: peer,
        text: "Contract proposal cancelled",
        type: "system",
        actor_address: addr,
        event_type: "contract_cancelled",
      });
      sendNotification(peer, "contract_cancelled", { peerAddr: addr }).catch(e => console.warn("[email/contract-cancel] error:", e.message));
      // Clean up contract form data + soft-delete active_contracts
      const key = [cp.from_addr, cp.to_addr].sort().join("-");
      const { error: cfDelErr } = await supabase.from("contract_forms").delete().eq("key", key);
      if (cfDelErr) console.warn("[cancel-proposal] contract_forms delete error:", cfDelErr.message);
      // Soft-delete: mark as archived/cancelled instead of hard delete
      for (const a of [cp.from_addr, cp.to_addr]) {
        const { data: ac } = await supabase.from("active_contracts").select("data").eq("addr", a).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC).maybeSingle();
        if (ac?.data && !ac.data.agreementId) {
          await supabase.from("active_contracts").update({
            data: { ...ac.data, archived: true, archivedAt: Date.now(), closedReason: "cancelled_proposal" },
            updated_at: new Date().toISOString()
          }).eq("addr", a).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC).catch(()=>{});
        }
      }
      return json(res, { ok: true });
    }
    if (path === "/api/contract-sign" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.contractId || !body?.addr || !body?.signature) return json(res, {error:"Missing fields"}, 400);
      const { data: cp, error: getErr } = await supabase.from("contract_proposals").select("*").eq("id", body.contractId).maybeSingle();
      if (getErr || !cp) return json(res, {error: "Not found"}, 404);
      const signer = body.addr.toLowerCase();
      const signatures = { ...(cp.signatures || {}), [signer]: body.signature };
      const bothSigned = [cp.from_addr, cp.to_addr].every(a => signatures[a]);
      const newStatus = bothSigned ? "signed-by-both" : cp.status;
      const { data: updated, error: updErr } = await supabase.from("contract_proposals").update({
        signatures, status: newStatus, updated_at: new Date().toISOString(),
      }).eq("id", body.contractId).select().single();
      if (updErr) return json(res, {error: updErr.message}, 500);
      const peer = signer === cp.from_addr ? cp.to_addr : cp.from_addr;
      await supabase.from("messages").insert({
        from_addr: signer, to_addr: peer,
        text: "✅ Rental agreement accepted",
        type: "system",
        actor_address: signer,
        event_type: "contract_accepted",
      });
      return json(res, cpRowToApi(updated));
    }

    // ============ CONTRACT FORMS ============
    if (path === "/api/contract-form" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.addr || !body?.peerAddr) return json(res, {error:"Missing fields"}, 400);
      const key = cfKey(body.addr, body.peerAddr);
      const addr = body.addr.toLowerCase();
      const { data: existing } = await supabase.from("contract_forms").select("form").eq("key", key).maybeSingle();
      const cf = existing?.form || { steps:{}, deposit:{}, signatures:{}, createdAt: Date.now() };

      // ── Field locking (shared logic in contract-form-lock.js) ──
      const lock = checkFieldLock(body.field, body.value, cf);
      if (lock.locked) {
        const valueKeys = body.value && typeof body.value === "object" ? Object.keys(body.value) : [body.field];
        const peerShort = (body.peerAddr || "").toLowerCase().slice(0, 10);
        console.warn(`[contract-form-lock] BLOCKED field=${body.field} keys=${valueKeys.join(",")} reason="${lock.reason}" addr=${addr.slice(0,10)} peer=${peerShort}`);
        return json(res, { error: lock.reason || "Field locked — already confirmed. Reset contract form to renegotiate." }, 409);
      }

      if (body.field === "deposit") cf.deposit = {...cf.deposit, ...body.value, setBy: addr, updatedAt: Date.now()};
      if (body.field === "depositConfirm") { cf.deposit.confirmedBy = addr; cf.deposit.confirmed = true; cf.deposit.updatedAt = Date.now(); }
      if (body.field === "signature") {
        cf.signatures[addr] = { sig: body.value, signedAt: Date.now() };
        const parties = key.split("-");
        if (parties.every(p => cf.signatures[p])) cf.bothSigned = true;
      }
      if (body.field === "deployed") cf.deployed = {...body.value, deployedBy: addr, deployedAt: Date.now()};
      if (body.field === "reset") {
        // Wipe form for fresh contract negotiation (keep key)
        const { error: resetErr } = await supabase.from("contract_forms").upsert({ key, form: { steps:{}, deposit:{}, signatures:{}, photos:[], documents:[], createdAt: Date.now() }, updated_at: new Date().toISOString() });
        if (resetErr) return json(res, {error: resetErr.message}, 500);
        return json(res, {ok:true, reset:true});
      }
      if (body.field === "photo") { cf.photos = cf.photos || []; cf.photos.push({...body.value, uploadedBy: addr, uploadedAt: Date.now()}); }
      if (body.field === "document") {
        cf.documents = cf.documents || [];
        cf.documents.push({...body.value, uploadedBy: addr, uploadedAt: Date.now()});
        // Update doc_keys ACL with both parties
        if (body.value?.cid) {
          const peerAddr = body.peerAddr?.toLowerCase() || "";
          const { error: aclErr } = await supabase.from("doc_keys").update({ owner_addr: addr, peer_addr: peerAddr }).eq("cid", body.value.cid);
          if (aclErr) console.error("[doc-acl] peer update failed for CID", body.value.cid, ":", aclErr.message);
        }
      }
      if (body.field === "removePhoto") { cf.photos = (cf.photos||[]).filter((_,i) => i !== body.value.index); }
      if (body.field === "steps") cf.steps = {...(cf.steps||{}), ...body.value, updatedBy: addr, updatedAt: Date.now()};
      const { error } = await supabase.from("contract_forms").upsert({ key, form: cf, updated_at: new Date().toISOString() });
      if (error) return json(res, {error: error.message}, 500);
      return json(res, cf);
    }
    if (path.match(/^\/api\/contract-form\/0x[0-9a-fA-F]+\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      const parts = path.split("/");
      const key = cfKey(parts[3], parts[4]);
      const { data } = await supabase.from("contract_forms").select("form").eq("key", key).maybeSingle();
      return json(res, data?.form || null);
    }

    // ============ ACTIVE CONTRACTS ============
    if (path === "/api/active-contract" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.addr) return json(res, {error:"Missing addr"}, 400);
      const addr = body.addr.toLowerCase();
      // Explicit select-then-branch instead of .upsert(): a bare .upsert()
      // has no reliable conflict target against the new partial unique
      // index on (chain_id, escrow_address, addr) — and this code must work
      // correctly whether or not active_contracts.addr is still the table's
      // PRIMARY KEY, since the two migrations that manage that constraint
      // are deliberately applied at different times (see migrations/
      // 2026-09-17-network-scope-contracts-expand.sql, which adds the new
      // scoping columns/indexes while leaving the old addr PK in place, and
      // *-contract.sql, applied later, which finally drops it once no old-
      // backend instance depends on it anymore). This selects the current
      // network+deployment's own row (if any) and updates it, or inserts a
      // new one — never touching any OTHER network/deployment's row for
      // this addr.
      const { data: existingRow } = await supabase.from("active_contracts")
        .select("addr").eq("addr", addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC).maybeSingle();
      const { error } = existingRow
        ? await supabase.from("active_contracts").update({
            addr, data: body, updated_at: new Date().toISOString(),
            chain_id: EXPECTED_CHAIN_ID, escrow_address: RENTAL_ESCROW_ADDR_LC,
          }).eq("addr", addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC)
        : await supabase.from("active_contracts").insert({
            addr, data: body, updated_at: new Date().toISOString(),
            chain_id: EXPECTED_CHAIN_ID, escrow_address: RENTAL_ESCROW_ADDR_LC,
          });
      if (error) return json(res, {error: error.message}, 500);
      // Auto-pause all active listings for this address (server-side guarantee)
      const { data: activeListings } = await applyStrictNetworkScope(
        supabase.from("listings").select("id").eq("owner_addr", addr).eq("status", "active")
      );
      if (activeListings?.length) {
        for (const l of activeListings) {
          await supabase.from("listings").update({
            status: "paused", suspended_at: new Date().toISOString()
          }).eq("id", l.id).catch(()=>{});
        }
        console.log(`[auto-pause] paused ${activeListings.length} listing(s) for ${addr.slice(0,8)}`);
      }
      return json(res, {ok:true});
    }
    if (path.match(/^\/api\/active-contract\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      const addr = path.split("/").pop().toLowerCase();
      const { data } = await supabase.from("active_contracts").select("data").eq("addr", addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC).maybeSingle();
      if (!data?.data) return json(res, null);
      // If DB says archived, verify on-chain PropDep is truly resolved before hiding
      const _hasAgrId = data.data.agreementId !== undefined && data.data.agreementId !== null && data.data.agreementId !== "";
      if (data.data.archived && _hasAgrId) {
        const pd = await checkPropDepState(data.data.agreementId);
        if (pd && pd.state > 0 && pd.state < 5 && pd.hasData) {
          // PropDep still active on-chain — return as active/settling despite DB archived flag
          return json(res, { ...data.data, archived: false, _propDepUnresolved: true });
        }
      }
      if (data.data.archived) return json(res, null);
      return json(res, data.data);
    }
    // List all addresses with active contracts (used to hide their listings from feed)
    if (path === "/api/active-contracts" && req.method === "GET") {
      const { data } = await supabase.from("active_contracts").select("addr,data").eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC);
      // Return only non-archived addresses (archived users are free to make new contracts)
      const result = (data||[]).filter(row => !row.data?.archived).map(row => ({
        addr: row.addr,
        peerAddr: row.data?.peerAddr || row.data?.listing?.contract || null,
        agreementId: row.data?.agreementId || null,
      }));
      return json(res, result);
    }
    if (path.match(/^\/api\/active-contract\/0x[0-9a-fA-F]+\/archive$/) && req.method === "POST") {
      const addr = path.split("/")[3].toLowerCase();
      console.log("[archive] request:", { addr: addr.slice(0,10), sessionAddr: req._walletSession?.addr?.slice(0,10) });
      if (!requireSessionAddr(addr)) { console.warn("[archive] FORBIDDEN: session mismatch"); return json(res, {error:"Forbidden"}, 403); }
      const { data: row } = await supabase.from("active_contracts").select("data").eq("addr", addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC).maybeSingle();
      if (!row) { console.warn("[archive] NOT FOUND: no active_contracts row for", addr.slice(0,10)); return json(res, {error:"Not found"}, 404); }
      const agrId = row.data?.agreementId;
      const hasAgrId = agrId !== undefined && agrId !== null && agrId !== "";
      console.log("[archive] found row:", { agrId: hasAgrId ? String(agrId).slice(0,16) : "none", peerAddr: row.data?.peerAddr?.slice(0,10), archived: row.data?.archived });
      // Block archiving if PropDep dispute is active (uses shared helper)
      if (hasAgrId) {
        const pd = await checkPropDepState(agrId);
        if (pd && pd.state > 0 && pd.state < 5 && pd.hasData) {
          return json(res, {error:"Cannot archive — property deposit dispute is still active"}, 400);
        }
      }
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      const closedReason = body?.closedReason || row.data?.closedReason || "completed";

      // Build immutable snapshot: contract form data + on-chain state
      let snapshot = {};
      try {
        const peerAddr = row.data?.peerAddr || row.data?.listing?.contract || "";
        // Snapshot contract form (names, terms, photos, docs, inventory, signatures)
        if (peerAddr) {
          const cfk = cfKey(addr, peerAddr);
          const { data: cfRow } = await supabase.from("contract_forms").select("form").eq("key", cfk).maybeSingle();
          if (cfRow?.form) snapshot.contractForm = cfRow.form;
        }
        // Snapshot on-chain agreement state if available
        if (hasAgrId) {
          try {
            const agrHex = await fetch(ARC_RPC, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({jsonrpc:"2.0",method:"eth_call",id:1,params:[{to:RENTAL_ESCROW_ADDR,data:"0xbd14de96"+BigInt(agrId).toString(16).padStart(64,"0")},"latest"]}) }).then(r=>r.json()).then(j=>j.result);
            if (agrHex && agrHex.length > 66) {
              const w = (i) => parseInt(agrHex.slice(2+i*64, 2+(i+1)*64), 16);
              const a = (i) => "0x" + agrHex.slice(2+i*64+24, 2+(i+1)*64);
              snapshot.onChain = {
                tenant: a(0), landlord: a(1), monthlyRent: w(2)/1e6,
                commitmentDeposit: w(3)/1e6, hostingDeposit: w(4)/1e6, propSecurityDeposit: w(5)/1e6,
                duration: w(6), createdAt: w(7), activatedAt: w(8), leaseEndTime: w(9),
                state: w(10), rentPaymentsMade: w(15), firstRentPaid: w(13) !== 0,
              };
            }
          } catch (e) { console.warn("[archive] on-chain snapshot error:", e.message); }
          // PropDep state snapshot
          try {
            const pdCheck = await checkPropDepState(agrId);
            if (pdCheck) snapshot.propDepState = pdCheck;
          } catch {}
        }
        // Listing info snapshot
        if (row.data?.listing) snapshot.listing = row.data.listing;
      } catch (e) { console.warn("[archive] snapshot error:", e.message); }

      // Insert into archived_contracts table (supports multiple per user)
      const agrIdStr = hasAgrId ? (typeof agrId === "string" ? agrId : String(agrId)) : null;
      const peerAddr = (row.data?.peerAddr || row.data?.listing?.contract || "").toLowerCase();

      // Prevent duplicate archive (double-click / retry): check if already archived
      if (agrIdStr) {
        const { data: dup } = await supabase.from("archived_contracts")
          .select("id").eq("addr", addr).eq("agreement_id", agrIdStr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC).maybeSingle();
        if (dup) {
          console.log("[archive] duplicate detected for", addr.slice(0,10), "agrId:", agrIdStr?.slice(0,16));
          // Already archived — ensure BOTH active_contracts rows are cleaned up
          await supabase.from("active_contracts").delete().eq("addr", addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC);
          if (peerAddr) await supabase.from("active_contracts").delete().eq("addr", peerAddr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC);
          return json(res, { ok: true, alreadyArchived: true, agreementId: agrIdStr, deletedActiveRows: 2 });
        }
      }
      const { error: insErr } = await supabase.from("archived_contracts").insert({
        addr,
        agreement_id: agrIdStr,
        peer_addr: peerAddr || null,
        data: { ...row.data, archived: true, archivedAt: Date.now(), closedReason },
        snapshot,
        closed_reason: closedReason,
        chain_id: EXPECTED_CHAIN_ID,
        escrow_address: RENTAL_ESCROW_ADDR_LC,
      });
      if (insErr) { console.error("[archive] INSERT FAILED:", insErr.message); return json(res, {error:"Failed to archive: " + insErr.message}, 500); }
      console.log("[archive] inserted into archived_contracts for", addr.slice(0,10));

      // Delete BOTH active_contracts rows (caller + peer)
      let deletedRows = 0;
      const { error: delErr } = await supabase.from("active_contracts").delete().eq("addr", addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC);
      if (delErr) {
        console.error("[archive] CRITICAL: delete caller row failed:", delErr.message);
        return json(res, {error:"Archive saved but cleanup failed: " + delErr.message}, 500);
      }
      deletedRows++;
      if (peerAddr) {
        const { error: peerDelErr } = await supabase.from("active_contracts").delete().eq("addr", peerAddr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC);
        if (peerDelErr) console.warn("[archive] peer active_contracts delete error:", peerDelErr.message);
        else deletedRows++;
      }
      console.log("[archive] deleted", deletedRows, "active_contracts row(s)");

      // Cancel related contract proposals
      const addrLc = addr.toLowerCase();
      const { error: cpErr } = await supabase.from("contract_proposals")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .or(`from_addr.eq.${addrLc},to_addr.eq.${addrLc}`)
        .not("status", "in", '("cancelled","rejected")');
      if (cpErr) console.warn("[archive] cancel proposals error:", cpErr.message);
      // Auto-resume paused listings if contract ended normally
      const normalEnd = !closedReason || closedReason === "completed" || closedReason === "lease_ended" || closedReason === "mutual_exit";
      if (normalEnd) {
        const { data: pausedListings } = await applyStrictNetworkScope(
          supabase.from("listings").select("id").eq("owner_addr", addrLc).eq("status", "paused")
        );
        if (pausedListings?.length) {
          const { data: otherActive } = await supabase.from("active_contracts").select("addr").eq("addr", addrLc).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC);
          if (!otherActive?.length) {
            for (const l of pausedListings) {
              await supabase.from("listings").update({ status: "active", suspended_at: null }).eq("id", l.id).catch(()=>{});
            }
            console.log(`[auto-resume] resumed ${pausedListings.length} listing(s) for ${addrLc.slice(0,8)}`);
          }
        }
      }
      return json(res, { ok: true, agreementId: agrIdStr, deletedActiveRows: deletedRows });
    }
    if (path.match(/^\/api\/active-contract\/0x[0-9a-fA-F]+$/) && req.method === "DELETE") {
      const addr = path.split("/").pop().toLowerCase();
      if (!requireSessionAddr(addr)) return json(res, {error:"Forbidden"}, 403);
      await supabase.from("active_contracts").delete().eq("addr", addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC);
      return json(res, {ok:true});
    }
    // Get archived contracts for user — both as owner (addr) and as peer (peer_addr)
    if (path.match(/^\/api\/archived-contracts\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      const addr = path.split("/").pop().toLowerCase();
      // Read from new table: addr OR peer_addr matches. Archive reads accept
      // ANY known RentalEscrow deployment for this chain (TASK 9G) — not
      // just the current one — so a user's history survives a redeploy.
      const { data: rows } = await supabase.from("archived_contracts")
        .select("*").or(`addr.eq.${addr},peer_addr.eq.${addr}`).eq("chain_id", EXPECTED_CHAIN_ID).in("escrow_address", ARCHIVE_ESCROW_ALLOWLIST).order("archived_at", { ascending: false });
      if (rows?.length) {
        return json(res, rows.map(r => ({
          ...r.data,
          snapshot: r.snapshot || {},
          archivedAt: r.archived_at,
          _archiveId: r.id,
        })));
      }
      // Fallback: check old active_contracts table for legacy archived rows
      const { data: legacy } = await supabase.from("active_contracts").select("data").eq("addr", addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC);
      const legacyArchived = (legacy||[]).filter(r => r.data?.archived).map(r => r.data);
      return json(res, legacyArchived);
    }

    // ============ EARLY TERMINATIONS ============
    if (path === "/api/early-term" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.fromAddr || !body?.toAddr || !body?.termType) return json(res, {error:"Missing fields"}, 400);
      const etReason = String(body.reason || "").trim();
      if (etReason.length < 30) return json(res, {error:"reason_min_length"}, 400);
      const from = body.fromAddr.toLowerCase(), to = body.toAddr.toLowerCase();
      const { data: existingArr } = await supabase.from("early_terms").select("*")
        .or(`from_addr.eq.${from},from_addr.eq.${to}`)
        .neq("status", "settled");
      if (existingArr && existingArr.length > 0) return json(res, etRowToApi(existingArr[0]));
      const { data: etData, error } = await supabase.from("early_terms").insert({
        from_addr: from, to_addr: to,
        term_type: body.termType,
        reason: etReason,
        status: "proposed",
      }).select().single();
      if (error) return json(res, {error: error.message}, 500);
      sendNotification(to, "early_termination", { peerAddr: from, termType: body.termType }).catch(e => console.warn("[email/et] error:", e.message));
      supabase.from("users").select("data").eq("addr", from).maybeSingle().then(({data:s})=>{
        notifyUser(supabase, to, "early_term_proposed", { fromName: s?.data?.display_name || "Your counterparty", reason: body.reason }).catch(()=>{});
      }).catch(()=>{});
      return json(res, etRowToApi(etData));
    }
    if (path.match(/^\/api\/early-term\/\d+$/) && req.method === "PATCH") {
      const id = parseInt(path.split("/").pop());
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      const update = { updated_at: new Date().toISOString() };
      if (body?.response !== undefined) update.response = body.response;
      if (body?.status) update.status = body.status;
      const { data: etData, error } = await supabase.from("early_terms").update(update).eq("id", id).select().single();
      if (error || !etData) return json(res, {error: error?.message || "Not found"}, 404);
      return json(res, etRowToApi(etData));
    }
    if (path.match(/^\/api\/early-term\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      const addr = path.split("/").pop().toLowerCase();
      const { data: arr } = await supabase.from("early_terms").select("*")
        .or(`from_addr.eq.${addr},to_addr.eq.${addr}`)
        .neq("status", "settled");
      return json(res, arr && arr.length > 0 ? etRowToApi(arr[0]) : null);
    }

    // ============ CONTRACT BUSY CHECK ============
    if (path.match(/^\/api\/contract-busy\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      const addr = path.split("/").pop().toLowerCase();
      const { data } = await supabase.from("contract_proposals")
        .select("id,from_addr,to_addr,status")
        .or(`from_addr.eq.${addr},to_addr.eq.${addr}`)
        .not("status", "in", '("cancelled","rejected")')
        .limit(1);
      return json(res, { busy: !!(data && data.length > 0) });
    }

    // ============ TELEGRAM ============
    // Generate connect token — user clicks "Connect Telegram" in app
    if (path === "/api/telegram/connect" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      const addr = body.addr?.toLowerCase();
      if (!addr) return json(res, { error: "Missing addr" }, 400);
      // Generate one-time token
      const token = randomBytes(16).toString("hex");
      const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (!existing) return json(res, { error: "User not found" }, 404);
      const merged = { ...existing.data, telegram_connect_token: token, telegram_connect_at: Date.now() };
      await supabase.from("users").update({ data: merged, updated_at: new Date().toISOString() }).eq("addr", addr);
      // Deep link: user opens bot with this token
      const botUsername = "pi2pi_notify_bot";
      return json(res, { ok: true, link: `https://t.me/${botUsername}?start=${token}` });
    }

    // Telegram webhook — bot sends updates here
    if (path === "/api/telegram/webhook" && req.method === "POST") {
      const update = await readBody(req);
      const result = await handleBotUpdate(update);
      if (result && result.type === "connect" && result.token) {
        // Find user by token
        const { data: users } = await supabase.from("users").select("addr, data").not("data", "is", null);
        const match = (users || []).find(u => u.data?.telegram_connect_token === result.token && (Date.now() - (u.data.telegram_connect_at || 0)) < 600000); // 10 min expiry
        if (match) {
          const merged = { ...match.data, telegram_chat_id: result.chatId, telegram_username: result.username, telegram_connect_token: null };
          await supabase.from("users").update({ data: merged, updated_at: new Date().toISOString() }).eq("addr", match.addr);
          await sendTelegramMessage(result.chatId, "✅ *Connected!*\n\nYou'll now receive notifications about messages, viewings, and contracts on pi2pi.io.\n\nTo disconnect, go to Account → Settings in the app.");
        } else {
          await sendTelegramMessage(result.chatId, `❌ Link expired or invalid. Go to ${new URL(APP_BASE_URL).host} → Account → Connect Telegram to get a new link.`);
        }
      }
      return json(res, { ok: true });
    }

    // Disconnect Telegram
    if (path === "/api/telegram/disconnect" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      const addr = body.addr?.toLowerCase();
      const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (existing) {
        const merged = { ...existing.data, telegram_chat_id: null, telegram_username: null };
        await supabase.from("users").update({ data: merged, updated_at: new Date().toISOString() }).eq("addr", addr);
      }
      return json(res, { ok: true });
    }

    // Check Telegram connection status
    if (path.match(/^\/api\/telegram\/status\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      const addr = path.split("/").pop().toLowerCase();
      const { data: user } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      return json(res, { connected: !!user?.data?.telegram_chat_id, username: user?.data?.telegram_username || null });
    }

    // ============ INBOX ============
    // Mark inbox as seen
    if (path.match(/^\/api\/inbox\/0x[0-9a-fA-F]+\/seen$/) && req.method === "POST") {
      const addr = path.split("/")[3].toLowerCase();
      if (!requireSessionAddr(addr)) return json(res, {error:"Forbidden"}, 403);
      const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (existing) {
        const merged = { ...existing.data, lastSeenInbox: Date.now() };
        await supabase.from("users").update({ data: merged, updated_at: new Date().toISOString() }).eq("addr", addr);
      }
      return json(res, { ok: true });
    }
    if (path.match(/^\/api\/inbox\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      if (!req._walletSession) return json(res, { error: "Unauthorized" }, 401);
      const addr = path.split("/").pop().toLowerCase();
      if (req._walletSession.addr.toLowerCase() !== addr) return json(res, { error: "Forbidden" }, 403);
      const items = [];
      const [vrs, msgs, cps, ets] = await Promise.all([
        supabase.from("viewing_requests").select("*").or(`from_addr.eq.${addr},to_addr.eq.${addr}`),
        supabase.from("messages").select("*").or(`from_addr.eq.${addr},to_addr.eq.${addr}`),
        supabase.from("contract_proposals").select("*").or(`from_addr.eq.${addr},to_addr.eq.${addr}`),
        supabase.from("early_terms").select("*").or(`from_addr.eq.${addr},to_addr.eq.${addr}`),
      ]);
      (vrs.data || []).forEach(v => {
        const api = vrRowToApi(v);
        items.push({...api, type: api.toAddr === addr ? "viewing_request_received" : "viewing_request_sent", vrId: api.id});
      });
      // Group messages by peer: count messages, find latest
      const msgsByPeer = {};
      (msgs.data || []).forEach(m => {
        const api = msgRowToApi(m);
        if (api.type === "system" && (api.eventType === "peer_suspended" || api.eventType === "peer_resumed")) return; // skip system suspension msgs from inbox count
        const peer = api.fromAddr === addr ? api.toAddr : api.fromAddr;
        if (!peer) return;
        if (!msgsByPeer[peer]) msgsByPeer[peer] = { count: 0, latest: null, fromPeer: 0 };
        msgsByPeer[peer].count++;
        if (api.fromAddr !== addr) msgsByPeer[peer].fromPeer++;
        if (!msgsByPeer[peer].latest || (api.createdAt > msgsByPeer[peer].latest.createdAt)) msgsByPeer[peer].latest = api;
      });
      Object.entries(msgsByPeer).forEach(([peer, info]) => {
        if (info.latest) {
          items.push({
            ...info.latest,
            type: info.fromPeer > 0 ? "message_received" : "message_sent",
            messageCount: info.count,
            fromAddr: info.latest.fromAddr,
            toAddr: info.latest.toAddr,
          });
        }
      });
      (cps.data || []).forEach(c => {
        const api = cpRowToApi(c);
        items.push({...api, type: api.toAddr === addr ? "contract_received" : "contract_sent", contractId: api.id});
      });
      (ets.data || []).forEach(e => {
        const api = etRowToApi(e);
        items.push({...api, type: api.toAddr === addr ? "early_term_received" : "early_term_sent"});
      });
      // Include lastSeenInbox for unread calculation
      const { data: userRow } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      const lastSeen = userRow?.data?.lastSeenInbox || 0;
      return json(res, { items, lastSeenInbox: lastSeen });
    }

    // ============ Listing Photos (Supabase Storage) ============
    if (path === "/api/upload/listing-photo" && req.method === "POST") {
      if (!rateLimit(req, res, "/api/upload", 20)) return; // 20 uploads per minute
      try {
        // Size limit: 5MB for images
        const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
        const contentLength = parseInt(req.headers["content-length"] || "0");
        if (contentLength > MAX_UPLOAD_SIZE) return json(res, {error:"File too large (max 5MB)"}, 413);
        const chunks = [];
        let totalSize = 0;
        for await (const chunk of req) {
          totalSize += chunk.length;
          if (totalSize > MAX_UPLOAD_SIZE) return json(res, {error:"File too large (max 5MB)"}, 413);
          chunks.push(chunk);
        }
        const rawBody = Buffer.concat(chunks);
        // Parse multipart — extract file
        const contentType = req.headers["content-type"] || "";
        const boundary = contentType.split("boundary=")[1];
        if (!boundary) return json(res, {error:"No multipart boundary"}, 400);
        // Simple multipart parse: find file data between boundaries
        const bodyStr = rawBody.toString("latin1");
        const parts = bodyStr.split("--" + boundary).filter(p => p.includes("filename="));
        if (parts.length === 0) return json(res, {error:"No file in upload"}, 400);
        const part = parts[0];
        const headerEnd = part.indexOf("\r\n\r\n");
        const fileData = Buffer.from(part.slice(headerEnd + 4).replace(/\r\n$/, ""), "latin1");
        // Extract filename and content type
        const fnMatch = part.match(/filename="([^"]+)"/);
        const ctMatch = part.match(/Content-Type:\s*(.+)\r/);
        const origName = fnMatch ? fnMatch[1] : "photo.jpg";
        const fileCt = ctMatch ? ctMatch[1].trim() : "image/jpeg";
        // File type check
        const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
        if (!ALLOWED_TYPES.includes(fileCt)) return json(res, {error:"File type not allowed (jpeg/png/webp only)"}, 400);
        // Generate unique path
        const ext = origName.split(".").pop() || "jpg";
        const fileName = `listing-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
        const storagePath = `listings/${fileName}`;
        // Upload to Supabase Storage
        const { data, error } = await supabase.storage.from("photos").upload(storagePath, fileData, { contentType: fileCt, upsert: false });
        if (error) return json(res, {error: "Storage upload failed: " + error.message}, 500);
        // Get public URL
        const { data: urlData } = supabase.storage.from("photos").getPublicUrl(storagePath);
        return json(res, { url: urlData.publicUrl, path: storagePath, name: fileName });
      } catch (e) {
        return json(res, {error: e.message}, 500);
      }
    }

    // ============ IPFS (Pinata) ============
    // Upload file (photo/document) to IPFS via Pinata
    if (path === "/api/ipfs/upload-file" && req.method === "POST") {
      if (!rateLimit(req, res, "/api/upload", 20)) return;
      const PINATA_JWT = process.env.PINATA_JWT;
      if (!PINATA_JWT) return json(res, {error:"PINATA_JWT not configured"}, 500);
      const shouldEncrypt = url.searchParams.get("encrypt") === "1";
      try {
        // Size limit: 10MB for documents, 5MB for images
        const MAX_IPFS_SIZE = 10 * 1024 * 1024;
        const contentLength = parseInt(req.headers["content-length"] || "0");
        if (contentLength > MAX_IPFS_SIZE) return json(res, {error:"File too large (max 10MB)"}, 413);
        const chunks = [];
        let totalSize = 0;
        for await (const chunk of req) {
          totalSize += chunk.length;
          if (totalSize > MAX_IPFS_SIZE) return json(res, {error:"File too large (max 10MB)"}, 413);
          chunks.push(chunk);
        }
        const rawBody = Buffer.concat(chunks);
        const contentType = req.headers["content-type"] || "";

        if (shouldEncrypt) {
          // ─── Encrypted upload (documents only) ───
          const boundary = contentType.split("boundary=")[1];
          let fileData = rawBody;
          let fileName = "document";
          if (boundary) {
            const bodyStr = rawBody.toString("latin1");
            const parts = bodyStr.split("--" + boundary).filter(p => p.includes("filename="));
            if (parts.length > 0) {
              const part = parts[0];
              const fnMatch = part.match(/filename="([^"]+)"/);
              if (fnMatch) fileName = fnMatch[1];
              const headerEnd = part.indexOf("\r\n\r\n");
              fileData = Buffer.from(part.slice(headerEnd + 4).replace(/\r\n$/, ""), "latin1");
            }
          }
          const key = randomBytes(32);
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key, iv);
          const encrypted = Buffer.concat([cipher.update(fileData), cipher.final()]);
          const authTag = cipher.getAuthTag();
          const packed = Buffer.concat([iv, authTag, encrypted]);
          const blob = { encrypted: true, data: packed.toString("base64"), fileName };
          const r = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + PINATA_JWT },
            body: JSON.stringify({ pinataContent: blob, pinataMetadata: { name: "pi2pi-enc-" + Date.now() } }),
          });
          const data = await r.json();
          if (!r.ok) return json(res, {error: "Pinata error", details: data}, 500);
          const cid = data.IpfsHash;
          // Store key + ACL (who can decrypt)
          const uploaderAddr = req._walletSession?.addr || null;
          const { error: keyErr } = await supabase.from("doc_keys").upsert({
            cid, key: key.toString("hex"),
            owner_addr: uploaderAddr,
            peer_addr: null, // filled when contract form links peer
            created_at: new Date().toISOString(),
          });
          if (keyErr) { console.error("[enc-upload] ACL store failed — aborting:", keyErr.message); return json(res, {error:"Failed to store encryption key"}, 500); }
          console.log(`[enc-upload] ${fileName} → ${cid}`);
          return json(res, { cid, size: packed.length, name: fileName, encrypted: true });
        } else {
          // ─── Plain upload (photos) ───
          const r = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
            method: "POST",
            headers: { "Content-Type": contentType, "Authorization": "Bearer " + PINATA_JWT },
            body: rawBody,
          });
          const data = await r.json();
          if (!r.ok) return json(res, {error: "Pinata error", details: data}, 500);
          return json(res, { cid: data.IpfsHash, size: data.PinSize, name: data.Metadata?.name });
        }
      } catch (e) {
        return json(res, {error: e.message}, 500);
      }
    }

    // Decrypt and serve an encrypted document
    if (path.match(/^\/api\/ipfs\/decrypt\/[a-zA-Z0-9]+$/) && req.method === "GET") {
      try {
        const cid = path.split("/").pop();
        // Security: require wallet session
        if (!req._walletSession && REQUIRE_AUTH) return json(res, {error:"Unauthorized"}, 401);
        const callerAddr = req._walletSession?.addr;
        if (!callerAddr && REQUIRE_AUTH) return json(res, {error:"Wallet session required"}, 401);
        // Verify CID ACL — strict check against doc_keys.owner_addr/peer_addr
        // No fallback to mutable JSON search (contract_forms can be user-modified)
        if (callerAddr) {
          const { data: keyMeta, error: metaErr } = await supabase.from("doc_keys").select("owner_addr,peer_addr").eq("cid", cid).maybeSingle();
          if (metaErr) return json(res, {error:"ACL check failed"}, 500);
          if (!keyMeta) return json(res, {error:"Document not found"}, 404);
          const caller = callerAddr.toLowerCase();
          const owner = (keyMeta.owner_addr || "").toLowerCase();
          const peer = (keyMeta.peer_addr || "").toLowerCase();
          if (!owner) return json(res, {error:"Document has no owner — access denied"}, 403);
          const allowed = caller === owner || (peer && caller === peer);
          if (!allowed) return json(res, {error:"Not authorized to decrypt this document"}, 403);
        }
        // Get key from Supabase
        const { data: keyRow } = await supabase.from("doc_keys").select("key").eq("cid", cid).maybeSingle();
        if (!keyRow) return json(res, {error:"No decryption key found"}, 404);
        const key = Buffer.from(keyRow.key, "hex");

        // Fetch encrypted blob from Pinata
        const PINATA_JWT = process.env.PINATA_JWT;
        const gwUrl = "https://gateway.pinata.cloud/ipfs/" + cid;
        const r = await fetch(gwUrl, PINATA_JWT ? { headers: { "Authorization": "Bearer " + PINATA_JWT } } : {});
        if (!r.ok) return json(res, {error:"IPFS fetch failed"}, 404);
        const blob = await r.json();
        if (!blob.encrypted || !blob.data) return json(res, {error:"Not an encrypted document"}, 400);

        // Decrypt
        const packed = Buffer.from(blob.data, "base64");
        const iv = packed.subarray(0, 12);
        const authTag = packed.subarray(12, 28);
        const encrypted = packed.subarray(28);
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

        // Detect content type
        const ext = (blob.fileName || "").split(".").pop().toLowerCase();
        const mimeMap = { jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", pdf:"application/pdf", webp:"image/webp" };
        const mime = mimeMap[ext] || "application/octet-stream";

        res.writeHead(200, { "Content-Type": mime, "Content-Length": decrypted.length, "Cache-Control": "private, max-age=300" });
        res.end(decrypted);
      } catch (e) {
        return json(res, {error: "Decrypt failed: " + e.message}, 500);
      }
      return;
    }
    // Upload JSON to IPFS via Pinata
    if (path === "/api/ipfs/upload" && req.method === "POST") {
      if (!rateLimit(req, res, "/api/upload", 20)) return;
      const PINATA_JWT = process.env.PINATA_JWT;
      if (!PINATA_JWT) return json(res, {error:"PINATA_JWT not configured"}, 500);
      let body;
      try { body = await readBodyLimited(req, 2 * 1024 * 1024); } catch { return json(res, {error:"Body too large (max 2MB)"}, 413); }
      if (!verifyAddrMatch(body)) return;
      if (!body) return json(res, {error:"Missing JSON body"}, 400);
      try {
        const r = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + PINATA_JWT,
          },
          body: JSON.stringify({
            pinataContent: body.content || body,
            pinataMetadata: { name: body.name || "pi2pi-contract-" + Date.now() },
          }),
        });
        const data = await r.json();
        if (!r.ok) return json(res, {error: "Pinata error", details: data}, 500);
        return json(res, { cid: data.IpfsHash, size: data.PinSize });
      } catch (e) {
        return json(res, {error: e.message}, 500);
      }
    }
    // Proxy raw IPFS file (images, PDFs) — avoids CORS and slow public gateway
    if (path.match(/^\/api\/ipfs\/file\/[a-zA-Z0-9]+$/) && req.method === "GET") {
      const cid = path.split("/").pop();
      try {
        const PINATA_JWT = process.env.PINATA_JWT;
        // Use dedicated gateway if available, fallback to public
        const gwUrl = "https://gateway.pinata.cloud/ipfs/" + cid;
        const r = await fetch(gwUrl, PINATA_JWT ? { headers: { "Authorization": "Bearer " + PINATA_JWT } } : {});
        if (!r.ok) { res.writeHead(404); res.end("Not found"); return; }
        const contentType = r.headers.get("content-type") || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable", // IPFS content is immutable
        });
        const buffer = Buffer.from(await r.arrayBuffer());
        res.end(buffer);
      } catch (e) {
        res.writeHead(500); res.end("Error: " + e.message);
      }
      return;
    }
    // Proxy IPFS JSON content
    if (path.match(/^\/api\/ipfs\/[a-zA-Z0-9]+$/) && req.method === "GET") {
      const cid = path.split("/").pop();
      try {
        const r = await fetch("https://gateway.pinata.cloud/ipfs/" + cid);
        if (!r.ok) return json(res, {error:"IPFS fetch failed"}, 404);
        const data = await r.json().catch(async () => ({ raw: await r.text() }));
        return json(res, data);
      } catch (e) {
        return json(res, {error: e.message}, 500);
      }
    }

    // ============ WORLD ID OIDC EXCHANGE ============
    // Backend exchanges OIDC code+verifier for token, decodes JWT, saves nullifier
    if (path === "/api/verify/worldid-oidc" && req.method === "POST") {
      const WORLDCOIN_APP_ID = process.env.WORLDCOIN_APP_ID;
      if (!WORLDCOIN_APP_ID) return json(res, {error:"WORLDCOIN_APP_ID not configured"}, 500);
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.code || !body?.code_verifier || !body?.addr || !body?.redirect_uri) {
        return json(res, {error:"Missing fields: code, code_verifier, addr, redirect_uri"}, 400);
      }
      try {
        // Exchange code for token via Worldcoin OIDC token endpoint
        const tokenRes = await fetch("https://id.worldcoin.org/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: body.code,
            redirect_uri: body.redirect_uri,
            client_id: WORLDCOIN_APP_ID,
            code_verifier: body.code_verifier,
          }).toString(),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.id_token) {
          return json(res, {error:"Token exchange failed", details: tokenData}, 400);
        }
        // Decode id_token JWT (header.payload.signature) — payload only, no signature verification (TODO)
        const parts = tokenData.id_token.split(".");
        if (parts.length !== 3) return json(res, {error:"Invalid id_token format"}, 400);
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
        // payload.sub = nullifier hash (unique per user per app)
        // payload['https://id.worldcoin.org/v1']?.verification_level = 'orb' or 'device'
        const nullifier = payload.sub;
        const verLevel = payload["https://id.worldcoin.org/v1"]?.verification_level || "device";
        if (!nullifier) return json(res, {error:"No nullifier in id_token"}, 400);
        // Save to user record
        const addr = body.addr.toLowerCase();
        const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
        const userData = existing?.data || { addr };
        userData.verifications = userData.verifications || {};
        userData.verifications.worldid = {
          verified: true,
          nullifier_hash: nullifier,
          verification_level: verLevel,
          verifiedAt: Date.now(),
          method: "oidc",
        };
        await supabase.from("users").upsert({ addr, data: userData, updated_at: new Date().toISOString() });
        return json(res, { ok: true, verification_level: verLevel, nullifier });
      } catch (e) {
        return json(res, {error: e.message}, 500);
      }
    }

    // ============ WORLD ID VERIFICATION (action proof) ============
    // Verify World ID proof and store verification on user record
    if (path === "/api/verify/worldid" && req.method === "POST") {
      const WORLDCOIN_APP_ID = process.env.WORLDCOIN_APP_ID;
      const WORLDCOIN_RP_ID = process.env.WORLDCOIN_RP_ID;
      if (!WORLDCOIN_APP_ID) return json(res, {error:"WORLDCOIN_APP_ID not configured"}, 500);
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.proof || !body?.merkle_root || !body?.nullifier_hash || !body?.verification_level || !body?.addr) {
        return json(res, {error:"Missing required fields: proof, merkle_root, nullifier_hash, verification_level, addr"}, 400);
      }
      try {
        // Call Worldcoin verification API
        // World ID 4.0 uses v4 endpoint with rp_id
        // Legacy World ID 3.0 used v2 endpoint with app_id
        const verifyPayload = {
          nullifier_hash: body.nullifier_hash,
          merkle_root: body.merkle_root,
          proof: body.proof,
          verification_level: body.verification_level,
          action: "pi2pi-personhood",
          // Default = hashToField("") which is what IDKit uses when no signal is provided
signal_hash: body.signal_hash || "0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4",
        };
        console.log("[worldid/verify] payload:", JSON.stringify(verifyPayload).slice(0, 500));

        let r = null;
        let data = null;

        // 1. Try v4 with rp_id (World ID 4.0) — wraps v3 proof in proper v4 format
        if (WORLDCOIN_RP_ID) {
          console.log("[worldid/verify] trying v4 with rp_id:", WORLDCOIN_RP_ID);
          // Generate nonce (random 16 bytes hex)
          const nonceBytes = new Uint8Array(16);
          for (let i = 0; i < 16; i++) nonceBytes[i] = Math.floor(Math.random() * 256);
          const nonce = "0x" + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, "0")).join("");
          // V4 expects v3 proofs wrapped with protocol_version and responses array
          // Each response has `identifier` (= verification level) and `nullifier` (not nullifier_hash)
          const v4Payload = {
            protocol_version: "3.0",
            nonce,
            action: "pi2pi-personhood",
            environment: "production",
            responses: [{
              identifier: body.verification_level, // "orb" or "device"
              proof: body.proof,
              merkle_root: body.merkle_root,
              nullifier: body.nullifier_hash,
              // Default = hashToField("") which is what IDKit uses when no signal is provided
signal_hash: body.signal_hash || "0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4",
            }],
          };
          console.log("[worldid/verify] v4 payload:", JSON.stringify(v4Payload).slice(0, 500));
          r = await fetch("https://developer.world.org/api/v4/verify/" + WORLDCOIN_RP_ID, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(v4Payload),
          });
          data = await r.json();
          console.log("[worldid/verify] v4 response:", r.status, JSON.stringify(data).slice(0, 500));
        }

        // 2. Try v2 with app_id if v4 failed or rp_id not set
        if (!r || !r.ok) {
          console.log("[worldid/verify] trying v2 with app_id:", WORLDCOIN_APP_ID);
          r = await fetch("https://developer.world.org/api/v2/verify/" + WORLDCOIN_APP_ID, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(verifyPayload),
          });
          data = await r.json();
          console.log("[worldid/verify] v2 response:", r.status, JSON.stringify(data).slice(0, 500));
        }

        // 3. Try v1 with app_id as last resort
        if (!r.ok && data?.code === "invalid_action") {
          console.log("[worldid/verify] trying v1 with app_id");
          r = await fetch("https://developer.world.org/api/v1/verify/" + WORLDCOIN_APP_ID, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(verifyPayload),
          });
          data = await r.json();
          console.log("[worldid/verify] v1 response:", r.status, JSON.stringify(data).slice(0, 500));
        }

        if (!r.ok || data.code) {
          return json(res, {error: "Worldcoin verification failed", details: data, status: r.status}, 400);
        }
        // Save verification to user record
        const addr = body.addr.toLowerCase();
        const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
        const userData = existing?.data || { addr };
        userData.verifications = userData.verifications || {};
        userData.verifications.worldid = {
          verified: true,
          nullifier_hash: body.nullifier_hash,
          verification_level: body.verification_level,
          verifiedAt: Date.now(),
        };
        await supabase.from("users").upsert({ addr, data: userData, updated_at: new Date().toISOString() });
        return json(res, { ok: true, verification_level: body.verification_level });
      } catch (e) {
        return json(res, {error: e.message}, 500);
      }
    }

    // ============ STATS ============
    if (path.match(/^\/api\/stats\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      const addr = path.split("/").pop().toLowerCase();
      const [vrs, cps, acs, arcs] = await Promise.all([
        supabase.from("viewing_requests").select("id").or(`from_addr.eq.${addr},to_addr.eq.${addr}`).eq("status", "confirmed"),
        supabase.from("contract_proposals").select("id").or(`from_addr.eq.${addr},to_addr.eq.${addr}`).eq("status", "signed-by-both"),
        supabase.from("active_contracts").select("data").eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC),
        supabase.from("archived_contracts").select("id,agreement_id").or(`addr.eq.${addr},peer_addr.eq.${addr}`).eq("chain_id", EXPECTED_CHAIN_ID).in("escrow_address", ARCHIVE_ESCROW_ALLOWLIST),
      ]);
      const viewings = (vrs.data || []).length;
      // Dedupe contracts by agreement_id across proposals, active, and archived
      const seen = new Set();
      (cps.data || []).forEach(row => { seen.add("cp_" + row.id); });
      (acs.data || []).forEach(row => {
        const d = row.data || {};
        if ((d.addr || "").toLowerCase() === addr || (d.peerAddr || "").toLowerCase() === addr) {
          if (d.agreementId) seen.add(d.agreementId); else seen.add("ac_" + ((d.addr || row.addr || d.peerAddr || "").toLowerCase()));
        }
      });
      (arcs.data || []).forEach(row => { if (row.agreement_id) seen.add(row.agreement_id); else seen.add("ar_" + row.id); });
      return json(res, { viewings, rentals: seen.size });
    }

    // ============ EMAIL ============
    // POST /api/email/set — user sets their email; we save it (unconfirmed) and send confirmation link
    if (path === "/api/email/set" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.addr || !body?.email) return json(res, { error: "Missing addr or email" }, 400);
      const addr = body.addr.toLowerCase();
      const email = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, { error: "Invalid email" }, 400);

      const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (!existing) return json(res, { error: "User not registered" }, 404);

      // Email uniqueness — check no other user has this email
      const { data: emailUsers } = await supabase.from("users").select("addr, data").neq("addr", addr);
      const emailTaken = (emailUsers || []).some(u => u.data?.email?.toLowerCase() === email);
      if (emailTaken) return json(res, { error: "This email is already linked to another account" }, 409);

      // Store email, mark unconfirmed, set default preferences
      const newData = {
        ...existing.data,
        email,
        email_confirmed: false,
        email_set_at: Date.now(),
        email_notifications: existing.data?.email_notifications || { transactional: true, promo: true, support: true },
      };
      await supabase.from("users").update({ data: newData, updated_at: new Date().toISOString() }).eq("addr", addr);

      // Generate token valid 7 days; send confirmation email
      const token = signToken({ a: addr, e: email, p: "email_confirm" });
      const confirmUrl = `${APP_BASE_URL}/api/email/confirm?token=${token}`;
      const sendRes = await sendNotification(addr, "confirm", { confirmUrl });
      if (!sendRes.ok) return json(res, { error: "Failed to send confirmation: " + sendRes.error }, 500);
      return json(res, { ok: true, sent: true, emailId: sendRes.id });
    }

    // GET /api/email/confirm?token=X — user clicks link in email, we mark confirmed
    if (path === "/api/email/confirm" && req.method === "GET") {
      const token = url.searchParams.get("token");
      const p = verifyToken(token);
      if (!p || p.p !== "email_confirm") {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><title>pi2pi — Link expired</title><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:60px auto;padding:20px;text-align:center"><h2 style="color:#dc2626">Link expired or invalid</h2><p>This confirmation link is no longer valid. Please request a new one from pi2pi Settings.</p><p><a href="${APP_BASE_URL}" style="color:#00a699">← Back to pi2pi</a></p></body>`);
        return;
      }
      const { data: existing } = await supabase.from("users").select("data").eq("addr", p.a).maybeSingle();
      if (!existing) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:60px auto;padding:20px;text-align:center"><h2>User not found</h2></body>`);
        return;
      }
      if (existing.data?.email !== p.e) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:60px auto;padding:20px;text-align:center"><h2>Email changed</h2><p>This link was for a different email that's no longer on the account.</p></body>`);
        return;
      }
      const newData = { ...existing.data, email_confirmed: true, email_confirmed_at: Date.now() };
      await supabase.from("users").update({ data: newData, updated_at: new Date().toISOString() }).eq("addr", p.a);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>pi2pi — Email confirmed</title><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:60px auto;padding:20px;text-align:center;color:#1a1a1a"><div style="font-size:48px;margin-bottom:16px">✅</div><h2 style="color:#00a699;margin-top:0">Email confirmed!</h2><p style="color:#555;line-height:1.6">You'll now receive pi2pi alerts at <strong>${p.e}</strong>.<br/>You can change preferences anytime in Settings.</p><p style="margin-top:30px"><a href="${APP_BASE_URL}" style="display:inline-block;padding:10px 22px;background:#00a699;color:white;text-decoration:none;border-radius:8px;font-weight:700">Open pi2pi</a></p></body>`);
      return;
    }

    // POST /api/email/resend-confirm — user pressed "Resend email"; rate-limited 1/min
    if (path === "/api/email/resend-confirm" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.addr) return json(res, { error: "Missing addr" }, 400);
      const addr = body.addr.toLowerCase();
      const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (!existing?.data?.email) return json(res, { error: "No email set" }, 400);
      if (existing.data.email_confirmed) return json(res, { error: "Already confirmed" }, 400);
      // Rate limit: can resend at most once per minute
      const lastSent = existing.data.email_resend_at || existing.data.email_set_at || 0;
      if (Date.now() - lastSent < 60 * 1000) return json(res, { error: "Please wait a moment before resending" }, 429);
      const token = signToken({ a: addr, e: existing.data.email, p: "email_confirm" });
      const confirmUrl = `${APP_BASE_URL}/api/email/confirm?token=${token}`;
      const sendRes = await sendNotification(addr, "confirm", { confirmUrl });
      if (!sendRes.ok) return json(res, { error: "Failed: " + sendRes.error }, 500);
      const newData = { ...existing.data, email_resend_at: Date.now() };
      await supabase.from("users").update({ data: newData, updated_at: new Date().toISOString() }).eq("addr", addr);
      return json(res, { ok: true, sent: true });
    }

    // DELETE /api/email/:addr — user removes their email from account
    if (path.match(/^\/api\/email\/0x[0-9a-fA-F]+$/) && req.method === "DELETE") {
      const addr = path.split("/").pop().toLowerCase();
      if (!requireSessionAddr(addr)) return json(res, {error:"Forbidden"}, 403);
      const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (!existing) return json(res, { error: "User not found" }, 404);
      const newData = { ...existing.data };
      delete newData.email;
      delete newData.email_confirmed;
      delete newData.email_confirmed_at;
      delete newData.email_set_at;
      delete newData.email_resend_at;
      delete newData.email_notifications;
      await supabase.from("users").update({ data: newData, updated_at: new Date().toISOString() }).eq("addr", addr);
      return json(res, { ok: true });
    }

    // PATCH /api/email/preferences — granular notification toggles
    if (path === "/api/email/preferences" && req.method === "PATCH") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.addr) return json(res, { error: "Missing addr" }, 400);
      const addr = body.addr.toLowerCase();
      const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (!existing) return json(res, { error: "User not found" }, 404);
      const prefs = existing.data?.email_notifications || { transactional: true, promo: true, support: true };
      const update = {
        transactional: typeof body.transactional === "boolean" ? body.transactional : prefs.transactional,
        promo:         typeof body.promo === "boolean" ? body.promo : prefs.promo,
        support: true, // always on (can't fully disable support while email is set)
      };
      const newData = { ...existing.data, email_notifications: update };
      await supabase.from("users").update({ data: newData, updated_at: new Date().toISOString() }).eq("addr", addr);
      return json(res, { ok: true, preferences: update });
    }

    // GET /api/email/unsubscribe?token=X — one-click unsubscribe from email link
    if (path === "/api/email/unsubscribe" && req.method === "GET") {
      const token = url.searchParams.get("token");
      const p = verifyToken(token);
      if (!p || p.t !== "transactional") {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,sans-serif;max-width:480px;margin:60px auto;padding:20px;text-align:center"><h2>Invalid link</h2></body>`);
        return;
      }
      const addr = p.a;
      const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (existing) {
        const prefs = existing.data?.email_notifications || {};
        prefs.transactional = false;
        prefs.promo = false;
        await supabase.from("users").update({ data: { ...existing.data, email_notifications: prefs }, updated_at: new Date().toISOString() }).eq("addr", addr);
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>pi2pi — Unsubscribed</title><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:60px auto;padding:20px;text-align:center;color:#1a1a1a"><div style="font-size:48px;margin-bottom:16px">👋</div><h2>You're unsubscribed</h2><p style="color:#555;line-height:1.6">You won't receive notification emails from pi2pi anymore.<br/>You can re-enable them in Settings at any time.</p><p style="margin-top:30px"><a href="${APP_BASE_URL}" style="display:inline-block;padding:10px 22px;background:#00a699;color:white;text-decoration:none;border-radius:8px;font-weight:700">Back to pi2pi</a></p></body>`);
      return;
    }

    // POST /api/displayname — set display name (Latin only, unique, one-time lock)
    if (path === "/api/displayname" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.addr || !body?.name) return json(res, { error: "Missing addr or name" }, 400);
      const addr = body.addr.toLowerCase();
      const name = String(body.name).trim();
      if (name.length < 2 || name.length > 40) return json(res, { error: "Name must be 2-40 characters" }, 400);
      if (!/^[a-zA-Z][a-zA-Z0-9 ._-]*$/.test(name)) return json(res, { error: "Latin letters only (a-z, 0-9, spaces, dots, hyphens)" }, 400);
      const nameCheck = checkDisplayName(name);
      if (nameCheck.blocked) return json(res, { error: "This name is reserved and cannot be used" }, 400);
      const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (!existing) return json(res, { error: "User not registered" }, 404);
      if (existing.data?.display_name_locked) return json(res, { error: "Display name is locked and cannot be changed" }, 403);
      // Uniqueness check
      const { data: allUsers } = await supabase.from("users").select("addr, data").neq("addr", addr);
      const nameTaken = (allUsers || []).some(u => u.data?.display_name?.toLowerCase() === name.toLowerCase());
      if (nameTaken) return json(res, { error: "This name is already taken by another user" }, 409);
      const newData = { ...existing.data, display_name: name, display_name_locked: true };
      await supabase.from("users").update({ data: newData, updated_at: new Date().toISOString() }).eq("addr", addr);
      return json(res, { ok: true, name });
    }

    // GET /api/displayname/check?name=X — check availability without setting
    if (path === "/api/displayname/check" && req.method === "GET") {
      const name = (url.searchParams.get("name") || "").trim();
      if (!name || name.length < 2) return json(res, { available: false, error: "Too short" });
      if (!/^[a-zA-Z][a-zA-Z0-9 ._-]*$/.test(name)) return json(res, { available: false, error: "Latin letters only" });
      const nameReserved = checkDisplayName(name);
      if (nameReserved.blocked) return json(res, { available: false, error: "This name is reserved" });
      const { data: allUsers } = await supabase.from("users").select("data");
      const taken = (allUsers || []).some(u => u.data?.display_name?.toLowerCase() === name.toLowerCase());
      return json(res, { available: !taken });
    }

    // ============ OFFER VIEWING (landlord → tenant, one-way) ============
    if (path === "/api/offer-viewing" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.fromAddr || !body?.toAddr) return json(res, {error:"Missing addrs"}, 400);
      const from = body.fromAddr.toLowerCase();
      const to = body.toAddr.toLowerCase();
      // Check landlord has at least one active published listing
      const { data: activeLst } = await applyStrictNetworkScope(
        supabase.from("listings").select("id").eq("owner_addr", from).eq("status", "active").limit(1)
      );
      if (!activeLst || activeLst.length === 0) return json(res, { error: "no_active_listing" }, 403);
      // Check if already offered
      const { data: existing } = await supabase.from("messages").select("id")
        .eq("from_addr", from).eq("to_addr", to).eq("event_type", "viewing_offered").limit(1);
      if (existing && existing.length > 0) return json(res, { ok: true, alreadyOffered: true });
      // Create system message + viewing request so tenant can accept
      await supabase.from("messages").insert({
        from_addr: from, to_addr: to,
        text: "Viewing offered",
        type: "system", actor_address: from, actor_role: "landlord",
        event_type: "viewing_offered",
      });
      // Also create a viewing_request so it shows in tenant's inbox with Accept/Decline
      const { data: existingVr } = await supabase.from("viewing_requests").select("id")
        .eq("from_addr", from).eq("to_addr", to).in("status", ["pending","confirmed"]).limit(1);
      if (!existingVr?.length) {
        await supabase.from("viewing_requests").insert({
          from_addr: from, to_addr: to,
          listing_id: null, listing_title: "",
          message: "Landlord offered a viewing",
          status: "pending",
        });
      }
      return json(res, { ok: true });
    }

    // Check if landlord already offered viewing to tenant
    if (path === "/api/offer-viewing/check" && req.method === "GET") {
      const from = (url.searchParams.get("from") || "").toLowerCase();
      const to = (url.searchParams.get("to") || "").toLowerCase();
      if (!from || !to) return json(res, { offered: false });
      const { data } = await supabase.from("messages").select("id")
        .eq("from_addr", from).eq("to_addr", to).eq("event_type", "viewing_offered").limit(1);
      return json(res, { offered: !!(data && data.length > 0) });
    }

    // ============ CITY SETTINGS (public, read-only) ============
    if (path === "/api/city-settings" && req.method === "GET") {
      const { data } = await supabase.from("users").select("data").eq("addr", "__city_config__").maybeSingle();
      return json(res, data?.data?.cities || []);
    }

    // ============ TENANT SEARCH REQUESTS ============
    // GET /api/tenant-requests — all tenants with intent (for landlord feed)
    if (path === "/api/tenant-requests" && req.method === "GET") {
      // TASK 10I: same transitional scoping as checkTenantIntentPoF —
      // data.intent.network hasn't been backfilled, so untagged legacy
      // intents stay visible on Testnet (where they all originate) and
      // hidden on Mainnet. See applyPofNetworkScope's doc comment.
      const { data, error } = await applyPofNetworkScope(
        supabase.from("users").select("addr, data"),
        "data->intent->>network"
      );
      if (error) return json(res, { error: error.message }, 500);
      const tenants = (data || [])
        .filter(u => u.data?.role === "tenant" && u.data?.intent && !u.data.intent.paused && !u.data.intent.suspended && !u.data.account_suspended)
        .map(u => ({
          addr: u.addr,
          name: u.data.display_name || u.addr.slice(0,6) + "…" + u.addr.slice(-4),
          city: u.data.intent.city || null,
          propertyType: u.data.intent.propType || null,
          budget: u.data.intent.budget || null,
          duration: u.data.intent.duration || null,
          verified: !!u.data.display_name_locked,
        }));
      return json(res, tenants);
    }

    // POST /api/tenant-requests — save tenant intent to user profile
    if (path === "/api/tenant-requests" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.addr) return json(res, { error: "Missing addr" }, 400);
      const addr = body.addr.toLowerCase();
      const { data: existing } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (!existing) return json(res, { error: "User not found" }, 404);
      // network is stamped from this runtime's own trusted config (TASK 10F),
      // never trusted from the client — even if body.intent already contains
      // a "network" key, the explicit key below always wins over the spread.
      const newData = { ...existing.data, intent: body.intent ? { ...body.intent, network: NETWORK } : null };
      await supabase.from("users").update({ data: newData, updated_at: new Date().toISOString() }).eq("addr", addr);
      return json(res, { ok: true });
    }

    // ============ LISTINGS ============

    // GET /api/listings — feed (filters: district, min_rent, max_rent, status default=active)
    if (path === "/api/listings" && req.method === "GET") {
      let q = applyStrictNetworkScope(supabase.from("listings").select("*"));
      const status = url.searchParams.get("status") || "active";
      q = q.eq("status", status);
      const district = url.searchParams.get("district");
      if (district) q = q.eq("district", district);
      const minRent = url.searchParams.get("min_rent");
      if (minRent) q = q.gte("monthly_rent", Number(minRent));
      const maxRent = url.searchParams.get("max_rent");
      if (maxRent) q = q.lte("monthly_rent", Number(maxRent));
      q = q.order("published_at", { ascending: false, nullsFirst: false });
      const { data, error } = await q;
      if (error) return json(res, {error: error.message}, 500);
      // Enrich with owner display names
      const ownerAddrs = [...new Set((data||[]).map(l=>l.owner_addr).filter(Boolean))];
      let nameMap = {};
      if (ownerAddrs.length) {
        const { data: users } = await supabase.from("users").select("addr, data").in("addr", ownerAddrs);
        (users||[]).forEach(u => { if (u.data?.display_name) nameMap[u.addr] = u.data.display_name; });
      }
      return json(res, (data || []).map(r => ({ ...listingRowToApi(r), ownerName: nameMap[r.owner_addr] || null })));
    }

    // GET /api/tenant/:addr — public tenant profile (intent + display name)
    if (path.match(/^\/api\/tenant\/0x[0-9a-fA-F]+$/) && req.method === "GET") {
      const addr = path.split("/").pop().toLowerCase();
      const { data: user } = await supabase.from("users").select("data").eq("addr", addr).maybeSingle();
      if (!user) return json(res, { error: "Not found" }, 404);
      const intent = user.data?.intent || user.data?.listing || null;
      // TASK 10I: a cross-network intent (or none at all) gets the exact
      // same "Not available" response — never a distinct message that would
      // let a caller infer a Testnet row exists behind a Mainnet lookup.
      if (!intent || intent.paused || intent.suspended || user.data?.account_suspended || !isPofRowInScope(intent.network, NETWORK)) {
        return json(res, { error: "Not available" }, 404);
      }
      return json(res, {
        addr,
        displayName: user.data?.display_name || null,
        city: intent.city || null,
        propType: intent.propType || intent.propertyType || null,
        budget: intent.budget || intent.rent || null,
        duration: intent.duration || null,
      });
    }

    // GET /api/listings/:id — single listing by UUID
    if (path.match(/^\/api\/listings\/[0-9a-f-]{36}$/) && req.method === "GET") {
      const id = path.split("/").pop();
      // TASK 10H/10I: a listing on another network must return the exact
      // same "Not found" as a nonexistent id — never a distinct response
      // that would let a caller infer a cross-network row exists.
      const { data, error } = await applyStrictNetworkScope(
        supabase.from("listings").select("*").eq("id", id).maybeSingle()
      );
      if (error || !data) return json(res, { error: "Not found" }, 404);
      return json(res, listingRowToApi(data));
    }

    // GET /api/listings/owner/:addr — все листинги владельца
    if (path.startsWith("/api/listings/owner/") && req.method === "GET") {
      const addr = path.slice("/api/listings/owner/".length).toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr)) return json(res, {error:"Invalid address"}, 400);
      const { data, error } = await applyStrictNetworkScope(
        supabase.from("listings").select("*")
          .eq("owner_addr", addr)
          .neq("status", "archived")
          .order("created_at", { ascending: false })
      );
      if (error) return json(res, {error: error.message}, 500);
      return json(res, (data || []).map(listingRowToApi));
    }

    // POST /api/listings/compose-description — server-side template (no AI)
    if (path === "/api/listings/compose-description" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body) return json(res, {error:"Missing body"}, 400);
      const text = composeDescription(body);
      return json(res, { text });
    }

    // POST /api/listings — create draft
    if (path === "/api/listings" && req.method === "POST") {
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.owner_addr) return json(res, {error:"Missing owner_addr"}, 400);
      // Auth: if session exists, enforce addr match
      if (req._walletSession && req._walletSession.addr !== body.owner_addr.toLowerCase()) {
        return json(res, {error:"Address mismatch"}, 403);
      }
      const owner_addr = body.owner_addr.toLowerCase();
      // Hard limit: 3 non-archived listings per owner, per network — Testnet
      // and Mainnet are separate marketplaces (TASK 10I).
      const { count } = await applyStrictNetworkScope(
        supabase.from("listings").select("id", { count: "exact", head: true })
          .eq("owner_addr", owner_addr).neq("status", "archived")
      );
      if ((count || 0) >= 3) return json(res, {error:"Hard limit: 3 listings per landlord"}, 400);
      const insert = {
        owner_addr,
        status: "draft",
        // Stamped from this runtime's own trusted config (TASK 10F), never
        // from the client — see checkListingsTablePoF's network scoping.
        network: NETWORK,
        city: body.city || null,
        district: body.district || "Other",
        address: body.address || "",
        zone_lat: body.zone_lat || null,
        zone_lng: body.zone_lng || null,
        property_type: body.property_type || "Studio",
        floor: body.floor ?? null,
        monthly_rent: Number(body.monthly_rent) || 0,
        min_stay_months: Number(body.min_stay_months) || 6,
        amenities: body.amenities || [],
        photos: body.photos || [],
        description: body.description || "",
        description_mode: body.description_mode || "auto",
        description_prompts: body.description_prompts || null,
        draft_data: body.draft_data || null,
      };
      const { data, error } = await supabase.from("listings").insert(insert).select().single();
      if (error) return json(res, {error: error.message}, 500);
      return json(res, listingRowToApi(data));
    }

    // GET /api/listings/:id (redundant with the UUID-regex route above for
    // any request this actually reaches, but scoped identically — TASK 10I)
    if (path.startsWith("/api/listings/") && req.method === "GET" && !path.includes("/owner/")) {
      const id = path.slice("/api/listings/".length).split("/")[0];
      if (!/^[0-9a-f-]{36}$/.test(id)) return json(res, {error:"Invalid id"}, 400);
      const { data, error } = await applyStrictNetworkScope(
        supabase.from("listings").select("*").eq("id", id).maybeSingle()
      );
      if (error) return json(res, {error: error.message}, 500);
      if (!data) return json(res, {error:"Not found"}, 404);
      return json(res, listingRowToApi(data));
    }

    // PATCH /api/listings/:id — update fields (owner only — owner_addr must match body.owner_addr)
    if (path.startsWith("/api/listings/") && req.method === "PATCH") {
      const id = path.slice("/api/listings/".length).split("/")[0];
      if (!/^[0-9a-f-]{36}$/.test(id)) return json(res, {error:"Invalid id"}, 400);
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      if (!body?.owner_addr) return json(res, {error:"Missing owner_addr (auth)"}, 400);
      const owner_addr = body.owner_addr.toLowerCase();
      // TASK 10I: a cross-network id must fail the exact same "Not found" as
      // a nonexistent one — this also closes the write-side half of TASK
      // 10H (a forged/reused id could otherwise have edited another
      // network's listing).
      const { data: existing } = await applyStrictNetworkScope(
        supabase.from("listings").select("owner_addr,status").eq("id", id).maybeSingle()
      );
      if (!existing) return json(res, {error:"Not found"}, 404);
      if (existing.owner_addr !== owner_addr) return json(res, {error:"Not your listing"}, 403);
      // Whitelist updatable fields
      const allowed = ["city","district","address","zone_lat","zone_lng","property_type","floor","monthly_rent","min_stay_months","amenities","photos","description","description_mode","description_prompts","draft_data"];
      const update = {};
      for (const k of allowed) if (body[k] !== undefined) update[k] = body[k];
      if (Object.keys(update).length === 0) return json(res, {error:"No fields to update"}, 400);
      const { data, error } = await supabase.from("listings").update(update).eq("id", id).select().single();
      if (error) return json(res, {error: error.message}, 500);
      return json(res, listingRowToApi(data));
    }

    // DELETE /api/listings/:id — delete (only drafts; published cannot be deleted, only archived)
    if (path.startsWith("/api/listings/") && req.method === "DELETE") {
      const id = path.slice("/api/listings/".length).split("/")[0];
      if (!/^[0-9a-f-]{36}$/.test(id)) return json(res, {error:"Invalid id"}, 400);
      const { data: existing } = await applyStrictNetworkScope(
        supabase.from("listings").select("owner_addr,status").eq("id", id).maybeSingle()
      );
      if (!existing) return json(res, {error:"Not found"}, 404);
      // Auth: verify session addr owns this listing (not query param)
      const sessionAddr = req._walletSession?.addr;
      if (sessionAddr && existing.owner_addr !== sessionAddr) return json(res, {error:"Not your listing"}, 403);
      if (!sessionAddr && REQUIRE_AUTH) return json(res, {error:"Unauthorized"}, 401);
      const force = url.searchParams.get("force") === "1";
      if (!force && existing.status !== "draft") return json(res, {error:"Only drafts can be deleted; use archive for published"}, 400);
      // Delete listing photos from Supabase Storage
      try {
        const { data: listing } = await supabase.from("listings").select("photos").eq("id", id).maybeSingle();
        if (listing?.photos?.length) {
          const paths = listing.photos.filter(p => p.path).map(p => p.path);
          if (paths.length) await supabase.storage.from("photos").remove(paths);
        }
      } catch(e) { console.warn("[delete] photo cleanup error:", e.message); }
      const { error } = await supabase.from("listings").delete().eq("id", id);
      if (error) return json(res, {error: error.message}, 500);
      return json(res, {ok:true});
    }

    // POST /api/listings/:id/publish — draft → active (validates + checks PoF)
    if (path.match(/^\/api\/listings\/[^/]+\/publish$/) && req.method === "POST") {
      const id = path.split("/")[3];
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      const owner_addr = (body?.owner_addr || "").toLowerCase();
      const { data: l } = await applyStrictNetworkScope(
        supabase.from("listings").select("*").eq("id", id).maybeSingle()
      );
      if (!l) return json(res, {error:"Not found"}, 404);
      if (l.owner_addr !== owner_addr) return json(res, {error:"Not your listing"}, 403);
      if (l.status !== "draft" && l.status !== "paused") return json(res, {error:"Listing already active or archived"}, 400);
      // Block publish if owner has an active (non-archived) contract
      const { data: ac } = await supabase.from("active_contracts").select("data").eq("addr", owner_addr).eq("chain_id", EXPECTED_CHAIN_ID).eq("escrow_address", RENTAL_ESCROW_ADDR_LC).maybeSingle();
      if (ac?.data && !ac.data.archived) return json(res, {error:"Cannot publish while you have an active contract"}, 400);
      const errors = validateListing(l);
      if (errors.length) return json(res, {error:"Validation failed", errors}, 400);
      // City minimum balance check
      const listingCity = l.city || l.district || "";
      const { data: cityConfigRow } = await supabase.from("users").select("data").eq("addr", "__city_config__").maybeSingle();
      const citySettings = cityConfigRow?.data?.cities || [];
      const cityMin = citySettings.find(c => listingCity.toLowerCase().includes(c.city.toLowerCase()) || c.city.toLowerCase().includes(listingCity.toLowerCase()));
      const cityMinBalance = cityMin?.min_balance || 0;

      // Multi-listing PoF check
      const { data: others } = await applyStrictNetworkScope(
        supabase.from("listings").select("monthly_rent")
          .eq("owner_addr", owner_addr).in("status", ["active","suspended"]).neq("id", id)
      );
      const listingRequired = (others || []).reduce((s, r) => s + Number(r.monthly_rent), 0) + Number(l.monthly_rent);
      const required = Math.max(listingRequired, cityMinBalance);
      let balance = 0;
      try { balance = await readUsdcBalance(owner_addr); } catch {}
      if (balance < required) {
        return json(res, {error: `Insufficient wallet balance: need ${required} USDC (city minimum: ${cityMinBalance} USDC), have ${balance.toFixed(2)} USDC`, required, cityMinBalance, balance}, 400);
      }
      const { data: updated, error } = await supabase.from("listings")
        .update({ status: "active", published_at: new Date().toISOString(), suspended_at: null })
        .eq("id", id).select().single();
      if (error) return json(res, {error: error.message}, 500);
      return json(res, listingRowToApi(updated));
    }

    // POST /api/listings/:id/pause — active → paused (manual)
    if (path.match(/^\/api\/listings\/[^/]+\/pause$/) && req.method === "POST") {
      const id = path.split("/")[3];
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      const owner_addr = (body?.owner_addr || "").toLowerCase();
      const { data: l } = await applyStrictNetworkScope(
        supabase.from("listings").select("owner_addr,status").eq("id", id).maybeSingle()
      );
      if (!l) return json(res, {error:"Not found"}, 404);
      if (l.owner_addr !== owner_addr) return json(res, {error:"Not your listing"}, 403);
      if (l.status !== "active") return json(res, {error:"Only active listings can be paused"}, 400);
      const { data, error } = await supabase.from("listings")
        .update({ status: "paused", suspended_at: null }).eq("id", id).select().single();
      if (error) return json(res, {error: error.message}, 500);
      return json(res, listingRowToApi(data));
    }

    // POST /api/listings/:id/resume — paused → active (re-checks PoF)
    if (path.match(/^\/api\/listings\/[^/]+\/resume$/) && req.method === "POST") {
      const id = path.split("/")[3];
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      const owner_addr = (body?.owner_addr || "").toLowerCase();
      const { data: l } = await applyStrictNetworkScope(
        supabase.from("listings").select("*").eq("id", id).maybeSingle()
      );
      if (!l) return json(res, {error:"Not found"}, 404);
      if (l.owner_addr !== owner_addr) return json(res, {error:"Not your listing"}, 403);
      if (l.status !== "paused") return json(res, {error:"Only paused listings can be resumed"}, 400);
      const { data: others } = await applyStrictNetworkScope(
        supabase.from("listings").select("monthly_rent")
          .eq("owner_addr", owner_addr).in("status", ["active","suspended"]).neq("id", id)
      );
      const required = (others || []).reduce((s, r) => s + Number(r.monthly_rent), 0) + Number(l.monthly_rent);
      let balance = 0;
      try { balance = await readUsdcBalance(owner_addr); } catch {}
      if (balance < required) {
        return json(res, {error: `Insufficient wallet balance: need ${required} USDC, have ${balance.toFixed(2)} USDC`, required, balance}, 400);
      }
      const { data, error } = await supabase.from("listings")
        .update({ status: "active", suspended_at: null }).eq("id", id).select().single();
      if (error) return json(res, {error: error.message}, 500);
      return json(res, listingRowToApi(data));
    }

    // POST /api/listings/:id/archive — terminal state, irreversible
    if (path.match(/^\/api\/listings\/[^/]+\/archive$/) && req.method === "POST") {
      const id = path.split("/")[3];
      const body = await readBody(req);
      if (!verifyAddrMatch(body)) return;
      const owner_addr = (body?.owner_addr || "").toLowerCase();
      const { data: l } = await applyStrictNetworkScope(
        supabase.from("listings").select("owner_addr").eq("id", id).maybeSingle()
      );
      if (!l) return json(res, {error:"Not found"}, 404);
      if (l.owner_addr !== owner_addr) return json(res, {error:"Not your listing"}, 403);
      const { data, error } = await supabase.from("listings")
        .update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", id).select().single();
      if (error) return json(res, {error: error.message}, 500);
      return json(res, listingRowToApi(data));
    }

    // ============ KEEPER HEARTBEAT ============
    // POST /api/keeper/heartbeat — keeper sends health data on each scan
    if (path === "/api/keeper/heartbeat" && req.method === "POST") {
      const secret = req.headers["x-keeper-secret"];
      const expected = process.env.KEEPER_HEARTBEAT_SECRET;
      if (!expected || secret !== expected) return json(res, { error: "Unauthorized" }, 401);
      const body = await readBody(req);
      if (!body || typeof body !== "object") return json(res, { error: "Bad body" }, 400);
      const result = await writeKeeperHeartbeat(supabase, body);
      return json(res, result.body, result.status);
    }

    // GET /api/admin/keeper/status — handled by admin_routes.js (handleAdmin)

    // ============ RESET ============
    // DISABLED: reset-all is a destructive endpoint that deletes all production data.
    // Must never be available without owner-admin auth. Removed per security audit 2026-04-28.
    if (path === "/api/reset-all" && req.method === "POST") {
      return json(res, {error:"This endpoint is disabled in production"}, 403);
    }

    // ============ ONE-TIME MIGRATION ============
    if (path === "/api/migrate-b1" && req.method === "POST") {
      // Add params JSONB column to messages (idempotent)
      const { error: testErr } = await supabase.from("messages").select("params").limit(1);
      if (testErr && testErr.message?.includes("does not exist")) {
        // Column missing — need to add it via Supabase Dashboard SQL Editor:
        // ALTER TABLE messages ADD COLUMN IF NOT EXISTS params JSONB DEFAULT NULL;
        return json(res, { error: "Column 'params' missing. Run SQL: ALTER TABLE messages ADD COLUMN IF NOT EXISTS params JSONB DEFAULT NULL;" }, 400);
      }
      return json(res, { ok: true, message: "params column exists" });
    }

    // ============ SEO/AEO: project-info.json (read-only, no auth) ============
    // Machine-readable project metadata for AI agents/tools. project-info.json
    // uses the same resolved runtime contract addresses as /api/version,
    // including configured environment overrides (RENTAL_ESCROW_ADDR /
    // PROPDEP_ESCROW_ADDR below).
    if (path === "/project-info.json" && req.method === "GET") {
      return json(res, {
        name: "pi2pi",
        description: "Peer-to-peer rental agreement protocol with smart-contract deposit escrow, settled in USDC.",
        // Network-aware (TASK 10A) — this runtime's own resolved NETWORK/
        // chainId, never a hardcoded testnet literal. A mainnet-configured
        // instance must report itself as mainnet, not silently claim testnet.
        status: NETWORK.replace(/^arc-/, ""),
        network: NETWORK,
        chainId: EXPECTED_CHAIN_ID,
        contracts: {
          RentalEscrow: RENTAL_ESCROW_ADDR,
          PropDepEscrow: PROPDEP_ESCROW_ADDR,
        },
        links: {
          // "website" is the only pi2pi.io reference here — that domain is a
          // separate GitHub Pages repository, not served by this codebase.
          // Every other link below is a real path this server answers, on
          // whichever domain this specific runtime actually serves —
          // derived from APP_BASE_URL (defaults to https://my.pi2pi.io),
          // never hardcoded, so a Testnet runtime correctly reports
          // testnet.pi2pi.io instead of falsely claiming the Mainnet host.
          website: "https://pi2pi.io",
          app: APP_BASE_URL,
          howItWorks: `${APP_BASE_URL}/how-it-works`,
          security: `${APP_BASE_URL}/security`,
          faq: `${APP_BASE_URL}/faq`,
          llmsTxt: `${APP_BASE_URL}/llms.txt`,
        },
      });
    }

    // ============ STATIC FILES ============
    if (path === "/") { serveStatic(res, "index.html"); return; }
    if (path === "/admin") { serveStatic(res, "pi2pi-console.html"); return; }
    // SEO/AEO static pages — see SEO_PAGES definition above for the architecture note.
    if (Object.prototype.hasOwnProperty.call(SEO_PAGES, path) && req.method === "GET") {
      serveStatic(res, SEO_PAGES[path]);
      return;
    }
    serveStatic(res, path.slice(1));
  } catch (e) {
    console.error("[server] unhandled error:", e);
    if (!res.headersSent) return json(res, {error: e.message || "Internal error"}, 500);
    try { res.end(); } catch {}
  }
});

// Prevent whole-process crash on unhandled errors inside async handlers
process.on("uncaughtException", (e) => console.error("[uncaught]", e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));

// === Row → API converters (snake_case → camelCase, preserve original API shape) ===
function msgRowToApi(r) {
  if (!r) return null;
  return {
    id: r.id,
    fromAddr: r.from_addr,
    toAddr: r.to_addr,
    text: r.text,
    type: r.type,
    actorAddress: r.actor_address,
    actorRole: r.actor_role,
    eventType: r.event_type,
    params: r.params || null,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),

  };
}
function vrRowToApi(r) {
  if (!r) return null;
  return {
    id: r.id,
    fromAddr: r.from_addr,
    toAddr: r.to_addr,
    listingId: r.listing_id,
    listingTitle: r.listing_title,
    message: r.message,
    status: r.status,
    signature: r.signature,
    signedBy: r.signed_by,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null,
  };
}
function cpRowToApi(r) {
  if (!r) return null;
  return {
    id: r.id,
    fromAddr: r.from_addr,
    toAddr: r.to_addr,
    status: r.status,
    signatures: r.signatures || {},
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null,
  };
}
function etRowToApi(r) {
  if (!r) return null;
  return {
    id: r.id,
    fromAddr: r.from_addr,
    toAddr: r.to_addr,
    termType: r.term_type,
    reason: r.reason,
    status: r.status,
    response: r.response,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null,
  };
}

function listingRowToApi(r) {
  if (!r) return null;
  return {
    id: r.id,
    ownerAddr: r.owner_addr,
    status: r.status,
    city: r.city || null,
    district: r.district,
    address: r.address,
    zoneLat: r.zone_lat,
    zoneLng: r.zone_lng,
    propertyType: r.property_type,
    floor: r.floor,
    monthlyRent: Number(r.monthly_rent),
    minStayMonths: r.min_stay_months,
    amenities: r.amenities || [],
    photos: r.photos || [],
    description: r.description,
    descriptionMode: r.description_mode,
    descriptionPrompts: r.description_prompts,
    draftData: r.draft_data,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null,
    publishedAt: r.published_at ? new Date(r.published_at).getTime() : null,
    archivedAt: r.archived_at ? new Date(r.archived_at).getTime() : null,
    suspendedAt: r.suspended_at ? new Date(r.suspended_at).getTime() : null,
  };
}

function validateListing(l) {
  const errors = [];
  if (!l.district) errors.push({field:"district", message:"District required"});
  if (!l.address || l.address.length < 5) errors.push({field:"address", message:"Address too short"});
  if (!l.property_type) errors.push({field:"property_type", message:"Property type required"});
  if (!l.monthly_rent || Number(l.monthly_rent) <= 0) errors.push({field:"monthly_rent", message:"Rent must be > 0"});
  if (![6,12,18,24].includes(Number(l.min_stay_months))) errors.push({field:"min_stay_months", message:"Min stay must be 6/12/18/24"});
  const amenities = Array.isArray(l.amenities) ? l.amenities : [];
  if (amenities.length < 3) errors.push({field:"amenities", message:"Pick at least 3 features"});
  const photos = Array.isArray(l.photos) ? l.photos : [];
  if (photos.length < 5) errors.push({field:"photos", message:"At least 5 photos required"});
  if (photos.length > 10) errors.push({field:"photos", message:"Maximum 10 photos"});
  const desc = (l.description || "").trim();
  if (desc.length < 80) errors.push({field:"description", message:"Description too short (min 80 chars)"});
  if (desc.length > 500) errors.push({field:"description", message:"Description too long (max 500 chars)"});
  // Smart-prompt: if "Full kitchen" amenity present, require a Kitchen-captioned photo
  if (amenities.includes("Full kitchen") && !photos.some(p => (p.caption || "").toLowerCase() === "kitchen")) {
    errors.push({field:"photos", message:"You marked Full kitchen — add a kitchen photo"});
  }
  return errors;
}

function composeDescription(input) {
  const {
    property_type = "Apartment",
    district = "",
    monthly_rent = 0,
    min_stay_months = 6,
    amenities = [],
    description_prompts = {},
  } = input || {};
  const top = (amenities || []).slice(0, 8).join(", ");
  const parts = [];
  parts.push(`${property_type} in ${district}, ${monthly_rent} USDC/mo, minimum ${min_stay_months} months.`);
  if (top) parts.push(`Includes: ${top}.`);
  if (description_prompts?.special) parts.push(description_prompts.special.trim().replace(/\.$/, "") + ".");
  if (description_prompts?.neighborhood) parts.push(description_prompts.neighborhood.trim().replace(/\.$/, "") + ".");
  // Derived audience
  const fits = [];
  const has = (k) => (amenities || []).map(a => String(a).toLowerCase()).includes(String(k).toLowerCase());
  const isFamily = has("Kids OK") && /2BR|3BR|House/i.test(property_type);
  const isCouples = has("Couples OK") && /Studio|1BR/i.test(property_type);
  const isRemote = has("WiFi") && has("AC");
  if (isCouples) fits.push("couples");
  if (isFamily) fits.push("families");
  if (isRemote) fits.push("remote workers");
  if (fits.length) parts.push(`Good fit for: ${fits.join(", ")}.`);
  return parts.join(" ");
}

// Startup network validation — fails closed before the server accepts any
// traffic. Confirms the RPC this process will actually use reports the chain
// we're configured to expect; never assumes it. Non-sensitive identity only
// (network name, chainIds, contract addresses) — no secrets are logged.
async function assertNetworkAtStartup() {
  let actualChainId;
  try {
    actualChainId = await fetchChainId(ARC_RPC);
  } catch (e) {
    console.error(`FATAL: could not verify RPC network at startup (${ARC_RPC}): ${e.message}`);
    process.exit(1);
  }
  try {
    assertChainMatch(NETWORK, EXPECTED_CHAIN_ID, actualChainId);
  } catch (e) {
    console.error(`FATAL: ${e.message} Refusing to start.`);
    process.exit(1);
  }
  console.log(`[startup] Network OK: ${NETWORK} chainId=${actualChainId}`);
}

async function startServer() {
  await assertNetworkAtStartup();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  pi2pi server → http://localhost:${PORT}\n`);
    console.log(`  Storage: Supabase (${SUPABASE_URL})`);
    console.log(`  Network: ${NETWORK} (chainId ${EXPECTED_CHAIN_ID})`);
    console.log(`  RPC: ${ARC_RPC}`);
    console.log(`  RentalEscrow: ${RENTAL_ESCROW_ADDR}`);
    console.log(`  PropDepEscrow: ${PROPDEP_ESCROW_ADDR}`);
    console.log(`  USDC: ${USDC_ADDRESS}\n`);
  });
}

startServer();
