// pof-network-scoping.test.js — structural verification that
// checkListingsTablePoF/checkTenantIntentPoF (server-arc.js) and their write
// paths actually use the network scoping added in TASK 10F, and that the
// EXPAND migration for it is additive-only.
//
// The pure decision logic (isPofRowInScope/pofNetworkFilterClause) is
// covered behaviorally in network-config.test.js — including direct
// TASK 10D incident-reproduction assertions. server-arc.js itself is a
// side-effecting script (mandatory env vars, process.exit on
// misconfiguration, live Supabase client construction, server.listen()) — it
// cannot be imported directly in a unit test, so this file verifies the
// wiring structurally (source-pattern assertions), the same style already
// used by network-scoped-db.test.js for the analogous active_contracts/
// archived_contracts scoping.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const MIGRATION_PATH = "migrations/2026-09-17-network-scope-listings-expand.sql";

function readSrc(relPath) {
  return readFileSync(join(__dirname, relPath), "utf8");
}

function fnBody(src, fnName) {
  const start = src.indexOf(`async function ${fnName}(`);
  assert.ok(start >= 0, `expected to find "async function ${fnName}(" in server-arc.js`);
  // Bounded window: both PoF functions are well under 100 lines; this is
  // generous enough to capture the whole body without risking swallowing an
  // unrelated later function.
  return src.slice(start, start + 6000);
}

const SRC = readSrc("server-arc.js");

test("applyPofNetworkScope is imported from network-config.js's pure, unit-tested pofNetworkFilterClause", () => {
  assert.match(SRC, /import\s*\{[^}]*pofNetworkFilterClause[^}]*\}\s*from\s*"\.\/network-config\.js"/);
  assert.match(SRC, /function applyPofNetworkScope\(query, column\)/);
});

test("checkListingsTablePoF's SELECT is network-scoped via applyPofNetworkScope(..., \"network\")", () => {
  const body = fnBody(SRC, "checkListingsTablePoF");
  const selectSection = body.slice(0, body.indexOf("byOwner.entries()"));
  assert.match(selectSection, /applyPofNetworkScope\(\s*\n?\s*supabase\.from\("listings"\)/);
  assert.match(selectSection, /"network"\s*\)\s*;/);
});

test("checkListingsTablePoF's suspend AND resume UPDATE calls both carry the network guard (defense-in-depth)", () => {
  const body = fnBody(SRC, "checkListingsTablePoF");
  const updateCalls = [...body.matchAll(/supabase\.from\("listings"\)\.update\(/g)];
  assert.equal(updateCalls.length, 2, `expected exactly 2 listings UPDATE calls (suspend + resume), found ${updateCalls.length}`);
  for (const m of updateCalls) {
    const windowText = body.slice(Math.max(0, m.index - 200), m.index + 300);
    assert.match(
      windowText, /applyPofNetworkScope\(/,
      `listings UPDATE at offset ${m.index} is not wrapped in applyPofNetworkScope(...)`
    );
  }
});

test("checkTenantIntentPoF's SELECT is network-scoped via applyPofNetworkScope(..., \"data->intent->>network\")", () => {
  const body = fnBody(SRC, "checkTenantIntentPoF");
  const selectSection = body.slice(0, body.indexOf("for (const u of"));
  assert.match(selectSection, /applyPofNetworkScope\(\s*\n?\s*supabase\.from\("users"\)\.select\("addr, data"\)/);
  assert.match(selectSection, /"data->intent->>network"/);
});

test("checkTenantIntentPoF's write-back UPDATE carries the network guard (defense-in-depth)", () => {
  const body = fnBody(SRC, "checkTenantIntentPoF");
  const updateCalls = [...body.matchAll(/supabase\.from\("users"\)\.update\(/g)];
  assert.equal(updateCalls.length, 1, `expected exactly 1 users UPDATE call in checkTenantIntentPoF, found ${updateCalls.length}`);
  const m = updateCalls[0];
  const windowText = body.slice(Math.max(0, m.index - 200), m.index + 300);
  assert.match(windowText, /applyPofNetworkScope\(/);
  assert.match(windowText, /"data->intent->>network"/);
});

test("both PoF ticks log the network identity they ran under", () => {
  assert.match(SRC, /\[pof2\] tick \(network=\$\{NETWORK\}\)/);
  assert.match(SRC, /\[pof-tn\] tick \(network=\$\{NETWORK\}\)/);
});

test("POST /api/listings stamps network from the trusted server-side NETWORK const, never from the client body", () => {
  const idx = SRC.indexOf('"/api/listings" && req.method === "POST"');
  assert.ok(idx >= 0, "expected to find the POST /api/listings route");
  const routeSection = SRC.slice(idx, idx + 1500);
  const insertIdx = routeSection.indexOf("const insert = {");
  assert.ok(insertIdx >= 0);
  const insertObjectText = routeSection.slice(insertIdx, routeSection.indexOf("};", insertIdx));
  assert.match(insertObjectText, /network:\s*NETWORK,/, "listings insert object must stamp network: NETWORK");
  assert.doesNotMatch(insertObjectText, /network:\s*body\./, "listings insert must never take network from client body");
});

test("POST /api/tenant-requests stamps intent.network from the trusted server-side NETWORK const, overriding any client-supplied value", () => {
  const idx = SRC.indexOf('"/api/tenant-requests" && req.method === "POST"');
  assert.ok(idx >= 0, "expected to find the POST /api/tenant-requests route");
  const routeSection = SRC.slice(idx, idx + 800);
  assert.match(
    routeSection,
    /intent:\s*body\.intent\s*\?\s*\{\s*\.\.\.body\.intent,\s*network:\s*NETWORK\s*\}\s*:\s*null/,
    "tenant-requests write must spread body.intent then override network with the trusted NETWORK const (object literal key order guarantees the override wins)"
  );
});

// ─── Migration structural checks (mirrors network-scoped-db.test.js's style) ─

function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, "");
}

test("listings network-scoping migration is additive and data-preserving: no DELETE/TRUNCATE/DROP TABLE/DROP COLUMN", () => {
  const sql = stripSqlComments(readSrc(MIGRATION_PATH));
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+COLUMN\b/i);
});

test("listings network-scoping migration adds a nullable `network` column and an idempotent NULL-only backfill", () => {
  const sql = stripSqlComments(readSrc(MIGRATION_PATH));
  assert.match(sql, /ADD COLUMN IF NOT EXISTS network text/i);
  assert.match(sql, /UPDATE public\.listings\s+SET network = 'arc-testnet'\s+WHERE network IS NULL/i);
  // The backfill must never be able to overwrite a row some later, real
  // Mainnet-tagged write already stamped — WHERE network IS NULL guarantees
  // this structurally (re-running the migration is a no-op for any tagged row).
});
