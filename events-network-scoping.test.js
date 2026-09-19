// events-network-scoping.test.js — verifies admin_routes.js's `events`
// table reads are network-scoped for marketplace event types, closing the
// blocker TASK 10I flagged (TASK 10J).
//
// The `events` table (supabase/admin_schema.sql) has no network/chain_id
// column and, as of this task, no live write path anywhere in this
// codebase, and is verified empty in production — see the migration file's
// own doc comment for the full provenance check. Only marketplace event
// types (post_listing, view_listing, request_viewing, start_contract,
// sign_contract) are network-scoped; identity/social types (register,
// open_chat, send_message, ...) are left global, matching the `messages`
// table's existing treatment.
//
// admin_routes.js is a side-effecting script (mandatory env vars, live
// Supabase client, process.exit on misconfiguration) — it cannot be
// imported directly in a unit test, so route wiring is verified
// structurally (source-pattern assertions), the same style already used by
// pof-network-scoping.test.js and marketplace-network-scoping.test.js. The
// underlying scoping DECISION (isPofRowInScope/pofNetworkFilterClause) is
// unit-tested behaviorally in network-config.test.js; this file additionally
// reproduces the exact "mixed marketplace + global events, per-user
// history" scenario behaviorally against the real imported function, since
// that mixing logic is specific to this task.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { isPofRowInScope } from "./network-config.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
function readSrc(relPath) {
  return readFileSync(join(__dirname, relPath), "utf8");
}
function windowAfter(src, marker, size = 900) {
  const idx = src.indexOf(marker);
  assert.ok(idx >= 0, `expected to find ${JSON.stringify(marker)} in source`);
  return src.slice(idx, idx + size);
}

const ADMIN_SRC = readSrc("admin_routes.js");
const MIGRATION_PATH = "migrations/2026-09-17-network-scope-events-expand.sql";

// ─── Structural: route wiring ───────────────────────────────────────────

test("applyEventsNetworkScope is defined and backed by the unit-tested pofNetworkFilterClause", () => {
  assert.match(ADMIN_SRC, /import\s*\{[^}]*pofNetworkFilterClause[^}]*isPofRowInScope[^}]*\}\s*from\s*"\.\/network-config\.js"/);
  const w = windowAfter(ADMIN_SRC, "function applyEventsNetworkScope(query, column", 300);
  assert.match(w, /pofNetworkFilterClause\(column, ADMIN_NETWORK\)/);
});

test("MARKETPLACE_EVENT_TYPES contains only chain/listing-specific event types, not identity/social ones", () => {
  const w = windowAfter(ADMIN_SRC, "const MARKETPLACE_EVENT_TYPES", 300);
  for (const t of ["post_listing", "view_listing", "request_viewing", "start_contract", "sign_contract"]) {
    assert.match(w, new RegExp(`"${t}"`));
  }
  assert.doesNotMatch(w, /"register"/);
  assert.doesNotMatch(w, /"open_chat"/);
  assert.doesNotMatch(w, /"send_message"/);
});

test("/api/admin/stats view_listing count is network-scoped", () => {
  const idx = ADMIN_SRC.indexOf('.eq("event", "view_listing")');
  assert.ok(idx >= 0);
  const before = ADMIN_SRC.slice(Math.max(0, idx - 200), idx + 40);
  assert.match(before, /applyEventsNetworkScope\(supabase\.from\("events"\)/);
});

test("GET /api/admin/users/:addr filters marketplace events by network while leaving global events untouched", () => {
  const w = windowAfter(ADMIN_SRC, "const scopedEvents = (events.data || []).filter(", 200);
  assert.match(w, /!MARKETPLACE_EVENT_TYPES\.has\(e\.event\) \|\| isPofRowInScope\(e\.network, ADMIN_NETWORK\)/);
  // The response must use the filtered set, not the raw fetch.
  const w2 = windowAfter(ADMIN_SRC, "return json(res, {\n      addr,", 400);
  assert.match(w2, /events: scopedEvents,/);
});

// ─── Behavioral: reproduces the mixed marketplace+global scenario ────────

const FIXTURE_EVENTS = [
  { event: "register", network: null },                    // global — always visible
  { event: "open_chat", network: null },                    // global — always visible
  { event: "view_listing", network: "arc-testnet" },        // marketplace, testnet-tagged
  { event: "view_listing", network: "arc-mainnet" },        // marketplace, mainnet-tagged
  { event: "post_listing", network: null },                 // marketplace, legacy untagged
  { event: "start_contract", network: "arc-testnet" },      // marketplace, testnet-tagged
];

function scopeEvents(events, network) {
  return events.filter(e => !new Set(["post_listing", "view_listing", "request_viewing", "start_contract", "sign_contract"]).has(e.event) || isPofRowInScope(e.network, network));
}

test("(TASK 10J repro) Mainnet excludes Testnet-tagged and untagged marketplace events, keeps global events and its own mainnet-tagged event", () => {
  const visible = scopeEvents(FIXTURE_EVENTS, "arc-mainnet");
  const visibleKeys = visible.map(e => `${e.event}:${e.network}`);
  assert.deepEqual(visibleKeys.sort(), [
    "open_chat:null",
    "register:null",
    "view_listing:arc-mainnet",
  ].sort());
});

test("(TASK 10J repro) Testnet includes its own tagged + untagged legacy marketplace events, keeps global events, excludes the mainnet-tagged event", () => {
  const visible = scopeEvents(FIXTURE_EVENTS, "arc-testnet");
  const visibleKeys = visible.map(e => `${e.event}:${e.network}`);
  assert.deepEqual(visibleKeys.sort(), [
    "open_chat:null",
    "post_listing:null",
    "register:null",
    "start_contract:arc-testnet",
    "view_listing:arc-testnet",
  ].sort());
  assert.ok(!visibleKeys.includes("view_listing:arc-mainnet"), "Testnet must never see the mainnet-tagged event");
});

test("scopeEvents fails closed on an unsupported/missing runtime network", () => {
  assert.throws(() => scopeEvents(FIXTURE_EVENTS, "bogus"));
  assert.throws(() => scopeEvents(FIXTURE_EVENTS, undefined));
});

// ─── Migration structural checks ─────────────────────────────────────────

function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, "");
}

test("events network-scoping migration is additive and data-preserving: no DELETE/TRUNCATE/DROP TABLE/DROP COLUMN/UPDATE", () => {
  const sql = stripSqlComments(readSrc(MIGRATION_PATH));
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+COLUMN\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.events\b/i);
});

test("events network-scoping migration adds a nullable network column and an index, with no backfill statement", () => {
  const sql = stripSqlComments(readSrc(MIGRATION_PATH));
  assert.match(sql, /ADD COLUMN IF NOT EXISTS network text/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS events_network_event_idx ON public\.events\(network, event\)/i);
});
