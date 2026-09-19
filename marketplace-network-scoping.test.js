// marketplace-network-scoping.test.js — structural verification that every
// public marketplace read/precondition route on `listings`/`users.data.intent`
// (server-arc.js) and the equivalent admin_routes.js views are network-scoped
// (TASK 10I), closing TASK 10H's finding.
//
// TASK 10H: the newly-deployed Arc Mainnet runtime's public
// GET /api/listings (and /api/listings/:id, /api/listings/owner/:addr,
// GET /api/tenant-requests) served real Arc Testnet marketplace rows,
// because these routes carried no network filter at all — a data-exposure
// bug distinct from (and undetected by) TASK 10F's fix, which only scoped
// the two *background* PoF jobs.
//
// The underlying pure scoping decisions (isPofRowInScope/
// pofNetworkFilterClause/assertSupportedNetwork) are unit-tested
// behaviorally in network-config.test.js, including direct TASK 10D/10H
// incident-reproduction assertions (e.g. "a Mainnet runtime must NEVER treat
// an untagged legacy row as its own"). server-arc.js/admin_routes.js are
// side-effecting scripts (mandatory env vars, process.exit on
// misconfiguration, live Supabase client construction, server.listen()) —
// they cannot be imported directly in a unit test, so this file verifies
// every route actually wires those pure decisions in, the same
// source-pattern style already used by network-scoped-db.test.js and
// pof-network-scoping.test.js for the analogous active_contracts/PoF-job
// scoping.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
function readSrc(relPath) {
  return readFileSync(join(__dirname, relPath), "utf8");
}

const SERVER_SRC = readSrc("server-arc.js");
const ADMIN_SRC = readSrc("admin_routes.js");

// Grabs the text from the first occurrence of `marker` forward to a bounded
// window — enough to see the route's query chain without risking swallowing
// an unrelated later route.
function windowAfter(src, marker, size = 900) {
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, `expected to find ${JSON.stringify(marker)} in source`);
  return src.slice(idx, idx + size);
}

test("applyStrictNetworkScope is defined and backed by the unit-tested assertSupportedNetwork", () => {
  assert.match(SERVER_SRC, /import\s*\{[^}]*assertSupportedNetwork[^}]*\}\s*from\s*"\.\/network-config\.js"/);
  assert.match(SERVER_SRC, /function applyStrictNetworkScope\(query, column = "network"\)/);
  const body = windowAfter(SERVER_SRC, "function applyStrictNetworkScope(query, column", 300);
  assert.match(body, /assertSupportedNetwork\(NETWORK\)/);
  assert.match(body, /query\.eq\(column, NETWORK\)/);
});

test("GET /api/listings (feed) is strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, 'if (path === "/api/listings" && req.method === "GET")');
  assert.match(w, /applyStrictNetworkScope\(supabase\.from\("listings"\)\.select\("\*"\)\)/);
});

test("GET /api/listings/:id (UUID-regex route) is strictly network-scoped and returns the same 404 shape whether nonexistent or cross-network", () => {
  const w = windowAfter(SERVER_SRC, "// GET /api/listings/:id — single listing by UUID");
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("\*"\)\.eq\("id", id\)\.maybeSingle\(\)/);
  // Single unconditional not-found branch — no second branch that could leak
  // "this id exists but belongs to another network".
  const notFoundBranches = [...w.matchAll(/return json\(res, \{ ?error: ?"Not found" ?\}, 404\)/g)];
  assert.equal(notFoundBranches.length, 1, "expected exactly one undifferentiated 404 branch");
});

test("GET /api/listings/:id (startsWith fallback route) is strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, "// GET /api/listings/:id (redundant with the UUID-regex route above");
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("\*"\)\.eq\("id", id\)\.maybeSingle\(\)/);
});

test("GET /api/listings/owner/:addr is strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, "// GET /api/listings/owner/:addr");
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("\*"\)/);
});

test("POST /api/listings hard-limit-3 count is per-network (Testnet and Mainnet are separate marketplaces)", () => {
  const w = windowAfter(SERVER_SRC, "// Hard limit: 3 non-archived listings per owner");
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("id", \{ count: "exact", head: true \}\)/);
});

test("PATCH /api/listings/:id ownership precondition is strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, "// PATCH /api/listings/:id", 1300);
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("owner_addr,status"\)\.eq\("id", id\)\.maybeSingle\(\)/);
});

test("DELETE /api/listings/:id ownership precondition is strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, "// DELETE /api/listings/:id");
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("owner_addr,status"\)\.eq\("id", id\)\.maybeSingle\(\)/);
});

test("POST /api/listings/:id/publish precondition and PoF-sum are both strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, "// POST /api/listings/:id/publish", 2600);
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("\*"\)\.eq\("id", id\)\.maybeSingle\(\)/);
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("monthly_rent"\)/);
});

test("POST /api/listings/:id/pause precondition is strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, "// POST /api/listings/:id/pause");
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("owner_addr,status"\)\.eq\("id", id\)\.maybeSingle\(\)/);
});

test("POST /api/listings/:id/resume precondition and PoF-sum are both strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, "// POST /api/listings/:id/resume", 1200);
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("\*"\)\.eq\("id", id\)\.maybeSingle\(\)/);
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("monthly_rent"\)/);
});

test("POST /api/listings/:id/archive precondition is strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, "// POST /api/listings/:id/archive");
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("owner_addr"\)\.eq\("id", id\)\.maybeSingle\(\)/);
});

test("GET /api/tenant-requests is scoped by data.intent.network (transitional, same rule as checkTenantIntentPoF)", () => {
  const w = windowAfter(SERVER_SRC, 'if (path === "/api/tenant-requests" && req.method === "GET")');
  assert.match(w, /applyPofNetworkScope\(\s*\n?\s*supabase\.from\("users"\)\.select\("addr, data"\)/);
  assert.match(w, /"data->intent->>network"/);
});

test("GET /api/tenant/:addr excludes a cross-network intent via isPofRowInScope, with a single undifferentiated 404 branch", () => {
  const w = windowAfter(SERVER_SRC, "// GET /api/tenant/:addr — public tenant profile");
  assert.match(w, /isPofRowInScope\(intent\.network, NETWORK\)/);
  const notAvailableBranches = [...w.matchAll(/error: ?"Not available" ?\}, 404\)/g)];
  assert.equal(notAvailableBranches.length, 1, "expected exactly one undifferentiated 404 branch");
});

test("account-reset (dev/test) listings fetch is strictly network-scoped — a Mainnet reset must never delete/archive a Testnet listing", () => {
  const w = windowAfter(SERVER_SRC, "// Step 3: Fetch listings");
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("id,status,photos"\)\.eq\("owner_addr", addr\)/);
});

test("auto-pause (on active-contract write) is strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, "// Auto-pause all active listings for this address");
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("id"\)\.eq\("owner_addr", addr\)\.eq\("status", "active"\)/);
});

test("auto-resume (on active-contract archive) is strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, "// Auto-resume paused listings if contract ended normally", 500);
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("id"\)\.eq\("owner_addr", addrLc\)\.eq\("status", "paused"\)/);
});

test("offer-viewing active-listing gate is strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, "// Check landlord has at least one active published listing");
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("id"\)\.eq\("owner_addr", from\)\.eq\("status", "active"\)\.limit\(1\)/);
});

test("landlord PoF-status listing sum (/api/users/:addr/status) is strictly network-scoped", () => {
  const w = windowAfter(SERVER_SRC, 'role === "landlord"');
  assert.match(w, /applyStrictNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)\.select\("monthly_rent,status,city,district"\)/);
});

// ─── admin_routes.js ─────────────────────────────────────────────────────

test("admin_routes.js: initAdminNetwork accepts and requires a network string, injected from server-arc.js's own NETWORK", () => {
  assert.match(ADMIN_SRC, /import\s*\{[^}]*assertSupportedNetwork[^}]*\}\s*from\s*"\.\/network-config\.js"/);
  assert.match(ADMIN_SRC, /export function initAdminNetwork\(\{ rpc, rentalEscrow, propDepEscrow, chainId, network \}\)/);
  assert.match(ADMIN_SRC, /assertSupportedNetwork\(network\)/);
  assert.match(ADMIN_SRC, /ADMIN_NETWORK = network/);
  assert.match(SERVER_SRC, /initAdminNetwork\(\{[^}]*network: NETWORK[^}]*\}\)/);
});

test("admin_routes.js's fail-closed guard also requires ADMIN_NETWORK to have been set", () => {
  const w = windowAfter(ADMIN_SRC, "export async function handleAdmin", 400);
  assert.match(w, /!ADMIN_NETWORK/);
});

test("GET /api/admin/users landlord→listingId lookup is scoped to ADMIN_NETWORK", () => {
  const w = windowAfter(ADMIN_SRC, "// Also fetch listings for landlords");
  assert.match(w, /supabase\.from\("listings"\)\.select\("id,owner_addr,status"\)\.in\("owner_addr", landlordAddrs\)\.eq\("status", "active"\)\.eq\("network", ADMIN_NETWORK\)/);
});

test("GET /api/admin/wallet/:addr/diagnostics listings history is scoped to ADMIN_NETWORK", () => {
  const w = windowAfter(ADMIN_SRC, "// Parallel queries", 500);
  assert.match(w, /supabase\.from\("listings"\)\.select\("id,status,city,district,monthly_rent,created_at,updated_at"\)\.eq\("owner_addr", addr\)\.eq\("network", ADMIN_NETWORK\)/);
});
