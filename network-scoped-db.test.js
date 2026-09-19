// network-scoped-db.test.js — verifies active_contracts / archived_contracts
// access is scoped by BOTH chain_id AND escrow_address (TASK 9B-REVISION),
// closing two related DB blockers:
//
//   1. (TASK 9A) these tables were keyed only by wallet `addr` or
//      (addr, agreement_id) — chain-agnostic keys that collide across
//      networks, since Arc Testnet and Arc Mainnet each independently start
//      nextAgreementId() at 0.
//   2. (TASK 9B-REVISION) chain_id ALONE is not enough scoping: Arc Testnet
//      alone has had five RentalEscrow deployments sharing chainId 5042002
//      (active + historicalIntermediate + legacy x3) — a chain_id-only
//      filter would still mix a retired deployment's rows into the current
//      deployment's data.
//
//   3. (TASK 9G) archive/history reads and active-contract reads have
//      different correctness requirements: an active contract only makes
//      sense against the CURRENT deployment, but a closed historical record
//      is still legitimately part of a user's history no matter which
//      now-superseded deployment created it. archived_contracts reads are
//      therefore scoped by chain_id + an ALLOWLIST of every known
//      deployment on that chain (resolveArchiveEscrowAllowlist() in
//      network-config.js); active_contracts stays scoped to the single
//      current deployment, unchanged.
//
// server-arc.js and admin_routes.js are side-effecting scripts (mandatory
// env vars, process.exit on misconfiguration, live Supabase client
// construction, server-arc.js additionally calls server.listen()) — they
// cannot be imported directly in a unit test without a live Supabase
// connection and a fully configured runtime environment. These tests
// instead verify the actual safety properties structurally (source-pattern
// assertions), the same style scripts/check-contract-addresses.mjs already
// uses for other architectural invariants that can't be exercised as pure
// functions, plus structural review of the migration SQL itself (which
// cannot be executed here — no live Postgres/Supabase in this environment).
//
// initAdminNetwork's chainId/rentalEscrow validation and handleAdmin()'s
// fail-closed guard are covered by admin-network.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// Split into two migrations (TASK 9D) specifically because the currently-
// deployed production backend predates TASK 9B: it writes active_contracts
// via a bare .upsert({ addr, ... }) with no explicit onConflict target, so
// PostgREST infers ON CONFLICT from the table's PRIMARY KEY — that old
// backend's every write is silently dependent on active_contracts_pkey
// continuing to exist. EXPAND is safe to run while that old backend is
// still live; CONTRACT (which finally drops the old PK) may only run after
// it's fully retired — see that file's own boxed warning comment.
const EXPAND_MIGRATION_PATH = "migrations/2026-09-17-network-scope-contracts-expand.sql";
const CONTRACT_MIGRATION_PATH = "migrations/2026-09-17-network-scope-contracts-contract.sql";

function readSrc(relPath) {
  return readFileSync(join(__dirname, relPath), "utf8");
}

// Finds every `.from("<table>")` call and returns the text from that call
// forward to the next statement-ending `;` (or a bounded window, whichever
// comes first) — enough to see every `.eq()`/insert-payload on the same
// query chain without risking swallowing an unrelated later statement.
function findTableCalls(src, table) {
  const re = new RegExp(`\\.from\\(["']${table}["']\\)`, "g");
  const calls = [];
  let m;
  while ((m = re.exec(src))) {
    const windowEnd = Math.min(src.length, m.index + 700);
    let text = src.slice(m.index, windowEnd);
    const semi = text.indexOf(";");
    if (semi !== -1) text = text.slice(0, semi + 1);
    // Also stop at the next sibling .from(...) call (e.g. two calls inside
    // the same Promise.all([...]) array share one trailing `;`) — without
    // this, a call's "window" can bleed into an unrelated neighboring
    // call's text and produce false positives/negatives.
    const nextFrom = text.slice(1).search(/\.from\(["'][a-z_]+["']\)/);
    if (nextFrom !== -1) text = text.slice(0, nextFrom + 1);
    calls.push({ index: m.index, text });
  }
  return calls;
}

function isChainScoped(callText) {
  return callText.includes('.eq("chain_id"') || /\bchain_id:/.test(callText);
}
function isEscrowScoped(callText) {
  // TASK 9G: archive/history reads scope escrow_address via .in(...) against
  // the multi-deployment allowlist instead of .eq() against the single
  // current deployment — both are valid escrow scoping, just for different
  // purposes (see the dedicated allowlist-vs-current tests below).
  return callText.includes('.eq("escrow_address"') || callText.includes('.in("escrow_address"') || /\bescrow_address:/.test(callText);
}

// The active_contracts write path (server-arc.js's /api/active-contract
// POST) explicitly selects its own (addr, chain_id, escrow_address) row
// before deciding update-vs-insert — that select call IS fully triple-
// scoped (see the (H)/(D) tests below), so nothing needs to be allowlisted
// as "intentionally unscoped" anymore now that the old reject-on-collision
// guard has been replaced with real coexistence.
const INTENTIONALLY_UNSCOPED = [];
function isIntentionallyUnscoped(callText) {
  return INTENTIONALLY_UNSCOPED.some((snippet) => callText.includes(snippet));
}

for (const [label, file, table] of [
  ["server-arc.js active_contracts", "server-arc.js", "active_contracts"],
  ["server-arc.js archived_contracts", "server-arc.js", "archived_contracts"],
  ["admin_routes.js active_contracts", "admin_routes.js", "active_contracts"],
]) {
  test(`(A/B/C/G) every ${label} query is scoped by BOTH chain_id and escrow_address`, () => {
    const src = readSrc(file);
    const calls = findTableCalls(src, table);
    assert.ok(calls.length > 0, `expected to find .from("${table}") calls in ${file} — did the table name or quoting style change?`);
    const relevant = calls.filter((c) => !isIntentionallyUnscoped(c.text));
    const missingChain = relevant.filter((c) => !isChainScoped(c.text));
    const missingEscrow = relevant.filter((c) => !isEscrowScoped(c.text));
    assert.equal(
      missingChain.length,
      0,
      `${file}: ${missingChain.length} .from("${table}") call(s) missing chain_id scoping at offset(s): ${missingChain.map((c) => c.index).join(", ")}`
    );
    assert.equal(
      missingEscrow.length,
      0,
      `${file}: ${missingEscrow.length} .from("${table}") call(s) missing escrow_address scoping — chain_id alone cannot distinguish Arc Testnet's multiple historical RentalEscrow deployments (all share chainId 5042002), at offset(s): ${missingEscrow.map((c) => c.index).join(", ")}`
    );
  });
}

test("(E/F) archived_contracts duplicate-archive check is scoped by chain_id AND escrow_address, so the same agreement_id can coexist across networks and across deployments on the same chain", () => {
  const src = readSrc("server-arc.js");
  const m = src.match(/\.eq\("agreement_id", agrIdStr\)[^;]*\.maybeSingle\(\)/);
  assert.ok(m, 'expected to find the archived_contracts duplicate-archive check (.eq("agreement_id", agrIdStr)...maybeSingle())');
  assert.match(m[0], /\.eq\("chain_id",\s*EXPECTED_CHAIN_ID\)/, "the duplicate-archive check must scope by chain_id");
  assert.match(m[0], /\.eq\("escrow_address",\s*RENTAL_ESCROW_ADDR_LC\)/, "the duplicate-archive check must ALSO scope by escrow_address, or a different testnet deployment's agreement_id=1 would be treated as a duplicate");
});

// ─── TASK 9G: archive/history reads accept ANY known deployment, active_contracts stays current-only ──

test("(9G) archived-contracts user history read (GET /api/archived-contracts/:addr) uses the multi-deployment allowlist, not the single current escrow", () => {
  const src = readSrc("server-arc.js");
  const m = src.match(/Get archived contracts for user[\s\S]{0,900}/);
  assert.ok(m, "expected to find the GET /api/archived-contracts/:addr route");
  assert.match(m[0], /\.eq\("chain_id",\s*EXPECTED_CHAIN_ID\)/, "must still scope by chain_id");
  assert.match(m[0], /\.in\("escrow_address",\s*ARCHIVE_ESCROW_ALLOWLIST\)/, "user-facing archive history must accept any known deployment on this chain, not just the current one");
  assert.doesNotMatch(m[0], /\.eq\("escrow_address",\s*RENTAL_ESCROW_ADDR_LC\)/, "must not ALSO narrow to the current-only filter — that would defeat the allowlist");
});

test("(9G) stats route's archived_contracts count uses the multi-deployment allowlist", () => {
  const src = readSrc("server-arc.js");
  const m = src.match(/archived_contracts"\)\.select\("id,agreement_id"\)[^;]*;/);
  assert.ok(m, "expected to find the /api/stats archived_contracts query");
  assert.match(m[0], /\.eq\("chain_id",\s*EXPECTED_CHAIN_ID\)/);
  assert.match(m[0], /\.in\("escrow_address",\s*ARCHIVE_ESCROW_ALLOWLIST\)/, "stats must count a user's full history across deployments, not just the current one");
});

test("(9G) the archive-write idempotency check and the archive INSERT itself stay scoped to the CURRENT deployment only (unchanged — a new archive event happens on the current escrow, it is not historical data)", () => {
  const src = readSrc("server-arc.js");
  const dupCheck = src.match(/Prevent duplicate archive[\s\S]{0,400}/);
  assert.ok(dupCheck, "expected the duplicate-archive check comment/query");
  assert.match(dupCheck[0], /\.eq\("escrow_address",\s*RENTAL_ESCROW_ADDR_LC\)/, "the duplicate-archive check must stay scoped to the CURRENT deployment, not the allowlist — it's asking 'did I already archive this on the deployment I'm running against', not a history read");
  assert.doesNotMatch(dupCheck[0], /\.in\("escrow_address"/, "duplicate-archive check must not use the allowlist");

  const insertMatch = src.match(/archived_contracts"\)\.insert\(\{[\s\S]{0,400}?\}\);/);
  assert.ok(insertMatch, "expected the archived_contracts INSERT call");
  assert.match(insertMatch[0], /escrow_address:\s*RENTAL_ESCROW_ADDR_LC/, "new archive rows must be tagged with the CURRENT escrow_address, not a historical one — they are being created right now");
});

test("(9G) active_contracts NEVER uses the allowlist (.in) anywhere — it stays current-deployment-only, unchanged from TASK 9B-REVISION", () => {
  const src = readSrc("server-arc.js");
  const calls = findTableCalls(src, "active_contracts");
  const usesAllowlist = calls.filter((c) => c.text.includes(".in(\"escrow_address\"") || c.text.includes("ARCHIVE_ESCROW_ALLOWLIST"));
  assert.equal(usesAllowlist.length, 0, `active_contracts must remain current-deployment-only per TASK 9G's explicit scope (not loosened) — found ${usesAllowlist.length} call(s) using the archive allowlist`);
});

test("(9G) server-arc.js imports and resolves ARCHIVE_ESCROW_ALLOWLIST via resolveArchiveEscrowAllowlist, fail-closed", () => {
  const src = readSrc("server-arc.js");
  assert.match(src, /import\s*\{[^}]*\bresolveArchiveEscrowAllowlist\b[^}]*\}\s*from\s*["']\.\/network-config\.js["']/, "expected server-arc.js to import resolveArchiveEscrowAllowlist from network-config.js");
  const m = src.match(/ARCHIVE_ESCROW_ALLOWLIST\s*=\s*resolveArchiveEscrowAllowlist\(\s*NETWORK,\s*\{([^}]*)\}\s*\);/);
  assert.ok(m, "expected ARCHIVE_ESCROW_ALLOWLIST = resolveArchiveEscrowAllowlist(NETWORK, {...}) at module scope");
  assert.match(m[1], /\bdeployments\s*:/);
  assert.match(m[1], /\bexpectedChainId\s*:\s*EXPECTED_CHAIN_ID\b/);
  assert.match(m[1], /\bcurrentEscrowAddress\s*:\s*RENTAL_ESCROW_ADDR_LC\b/);

  // The resolution must be wrapped in the same fail-closed try/catch +
  // process.exit(1) pattern as every other startup resolution in this file.
  const idx = src.indexOf("let ARCHIVE_ESCROW_ALLOWLIST;");
  assert.ok(idx !== -1, "expected `let ARCHIVE_ESCROW_ALLOWLIST;` declared before the try/catch resolution");
  const block = src.slice(idx, idx + 400);
  assert.match(block, /try\s*\{/, "resolution must be inside a try block");
  assert.match(block, /catch \(e\) \{[\s\S]*?console\.error\(`FATAL: \$\{e\.message\}`\)[\s\S]*?process\.exit\(1\)/, "must fail closed with process.exit(1) on any resolution error, same as every other startup check");
});

test("(D) active_contracts write path no longer rejects cross-network coexistence — it selects/updates/inserts scoped by (addr, chain_id, escrow_address) instead of upserting on addr alone", () => {
  const src = readSrc("server-arc.js");
  assert.doesNotMatch(src, /already has an active contract on a different network/, "the old reject-on-collision guard should no longer exist — TASK 9B-REVISION replaces rejection with real coexistence");
  assert.doesNotMatch(src, /\.from\("active_contracts"\)\.upsert\(/, "active_contracts should no longer be written via .upsert() — it has no reliable conflict target against the new partial unique index");
  assert.match(
    src,
    /existingRow[\s\S]{0,60}\?[\s\S]{0,400}\.from\("active_contracts"\)\.update\(\{[\s\S]{0,300}\}\)\.eq\("addr", addr\)\.eq\("chain_id", EXPECTED_CHAIN_ID\)\.eq\("escrow_address", RENTAL_ESCROW_ADDR_LC\)[\s\S]{0,20}:[\s\S]{0,300}\.from\("active_contracts"\)\.insert\(/,
    "expected an explicit existingRow-driven update-vs-insert, both scoped by (addr, chain_id, escrow_address)"
  );
});

test("(H) every active_contracts / archived_contracts write sets chain_id and escrow_address from trusted runtime config, never from client-supplied body", () => {
  const src = readSrc("server-arc.js");
  // Every literal `chain_id: X` in a write payload must use the trusted
  // module-level constant, never a value read out of `body`.
  const chainIdAssignments = [...src.matchAll(/chain_id:\s*([A-Za-z0-9_.]+)/g)].map((m) => m[1]);
  assert.ok(chainIdAssignments.length > 0, "expected to find chain_id: ... write assignments in server-arc.js");
  for (const value of chainIdAssignments) {
    assert.equal(value, "EXPECTED_CHAIN_ID", `chain_id write assignment uses "${value}" instead of the trusted EXPECTED_CHAIN_ID constant`);
  }
  const escrowAssignments = [...src.matchAll(/escrow_address:\s*([A-Za-z0-9_.()]+)/g)].map((m) => m[1]);
  assert.ok(escrowAssignments.length > 0, "expected to find escrow_address: ... write assignments in server-arc.js");
  for (const value of escrowAssignments) {
    assert.equal(value, "RENTAL_ESCROW_ADDR_LC", `escrow_address write assignment uses "${value}" instead of the trusted RENTAL_ESCROW_ADDR_LC constant`);
  }
});

test("(E) ContractFlow.jsx no longer writes a hardcoded 'arc-testnet' chain literal", () => {
  const src = readSrc("arc/src/components/ContractFlow.jsx");
  assert.doesNotMatch(src, /chain:\s*["']arc-testnet["']/, "ContractFlow.jsx still hardcodes chain: \"arc-testnet\" — this would mislabel every mainnet-created row");
  assert.match(src, /chain:\s*ACTIVE_NETWORK_NAME/, "ContractFlow.jsx should tag new contract rows with the resolved ACTIVE_NETWORK_NAME, not a literal");
});

test("(10A) /project-info.json exposes this runtime's own resolved network identity, never a hardcoded testnet literal", () => {
  const src = readSrc("server-arc.js");
  const m = src.match(/path === "\/project-info\.json"[\s\S]*?\n    \}\n/);
  assert.ok(m, 'expected to find the "/project-info.json" route');
  assert.doesNotMatch(m[0], /status:\s*["']testnet["']/, "status must not be hardcoded to \"testnet\" — a mainnet runtime must report itself correctly");
  assert.doesNotMatch(m[0], /network:\s*["']arc-testnet["']/, "network must not be hardcoded to \"arc-testnet\"");
  assert.doesNotMatch(m[0], /chainId:\s*5042002/, "chainId must not be hardcoded to the testnet value");
  assert.match(m[0], /network:\s*NETWORK\b/, "network must reflect this runtime's own resolved NETWORK constant");
  assert.match(m[0], /chainId:\s*EXPECTED_CHAIN_ID\b/, "chainId must reflect this runtime's own resolved EXPECTED_CHAIN_ID constant");
  assert.doesNotMatch(m[0], /app:\s*["']https:\/\/my\.pi2pi\.io["']/, "app link must not be hardcoded to the Mainnet hostname — a Testnet runtime must report its own host");
  assert.match(m[0], /app:\s*APP_BASE_URL\b/, "app link must be derived from APP_BASE_URL, which differs per runtime");
});

// ── Migration structural review (cannot be executed — no live Postgres here) ──

function stripSqlComments(sql) {
  // Strip `-- comment` lines first — the migrations' own doc comments
  // legitimately discuss (and rule out) DROP/DELETE/TRUNCATE in prose.
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

for (const path of [EXPAND_MIGRATION_PATH, CONTRACT_MIGRATION_PATH]) {
  test(`(C) ${path} is additive and data-preserving: no DELETE/TRUNCATE/DROP TABLE`, () => {
    const code = stripSqlComments(readSrc(path));
    assert.doesNotMatch(code, /\bDELETE\s+FROM\b/i, "migration must never delete rows");
    assert.doesNotMatch(code, /\bTRUNCATE\b/i, "migration must never truncate a table");
    assert.doesNotMatch(code, /\bDROP\s+TABLE\b/i, "migration must never drop a table");
  });
}

test("(A/D) EXPAND migration does NOT drop active_contracts_pkey and remains compatible with the old addr-PK-dependent backend", () => {
  const code = stripSqlComments(readSrc(EXPAND_MIGRATION_PATH));
  assert.doesNotMatch(
    code,
    /DROP CONSTRAINT[\s\S]{0,40}active_contracts_pkey/,
    "EXPAND must never drop active_contracts_pkey — the currently-deployed OLD backend's bare .upsert({ addr, ... }) relies on it for implicit ON CONFLICT inference; dropping it while that backend is still live would break every old-backend write"
  );
  // The new partial unique index must still be present in EXPAND (it can
  // safely coexist with the untouched old PK — PostgreSQL allows multiple
  // indexes covering different/overlapping columns on the same table).
  const idxMatch = readSrc(EXPAND_MIGRATION_PATH).match(/CREATE UNIQUE INDEX IF NOT EXISTS active_contracts_network_scoped_addr[\s\S]*?;/);
  assert.ok(idxMatch, "expected the network-scoped partial unique index to be created in EXPAND, alongside the still-present old PK");
  assert.match(idxMatch[0], /\(chain_id, escrow_address, addr\)/);
  assert.match(idxMatch[0], /WHERE chain_id IS NOT NULL AND escrow_address IS NOT NULL/);
});

test("(B/E) CONTRACT migration drops active_contracts_pkey and adds/retains the addr lookup index + scoped unique index", () => {
  const sql = readSrc(CONTRACT_MIGRATION_PATH);
  assert.match(sql, /ALTER TABLE public\.active_contracts DROP CONSTRAINT IF EXISTS active_contracts_pkey/, "expected the old addr-only PK to be dropped (a constraint, not data)");
  assert.match(sql, /CREATE INDEX IF NOT EXISTS active_contracts_addr_idx ON public\.active_contracts \(addr\)/, "expected an explicit plain addr lookup index to replace the PK's implicit one");
  const idxMatch = sql.match(/CREATE UNIQUE INDEX IF NOT EXISTS active_contracts_network_scoped_addr[\s\S]*?;/);
  assert.ok(idxMatch, "expected the network-scoped partial unique index to be present (idempotently) in CONTRACT too");
  assert.match(idxMatch[0], /\(chain_id, escrow_address, addr\)/);
  assert.match(idxMatch[0], /WHERE chain_id IS NOT NULL AND escrow_address IS NOT NULL/);
});

test("(F) CONTRACT migration explicitly documents it must only be applied after the new backend rollout is complete", () => {
  const sql = readSrc(CONTRACT_MIGRATION_PATH);
  assert.match(sql, /DO NOT APPLY THIS MIGRATION UNTIL/i, "CONTRACT migration must carry an explicit, prominent apply-order warning");
  assert.match(sql, /no old Fly machine\/release is still serving traffic/i, "CONTRACT migration must explicitly call out that no old backend instance may still be running");
});

test("(migration/I) EXPAND backfill UPDATEs are provenance-scoped, not blanket — ambiguous rows are never guessed", () => {
  const sql = readSrc(EXPAND_MIGRATION_PATH);
  const updates = [...sql.matchAll(/UPDATE public\.\w+\s+SET chain_id[\s\S]*?;/gi)];
  assert.ok(updates.length >= 2, "expected a backfill UPDATE for both active_contracts and archived_contracts");
  for (const u of updates) {
    assert.match(u[0], /WHERE chain_id IS NULL\s+AND lower\(data->>'escrowAddress'\) IN \(/, "backfill UPDATE must be scoped to chain_id IS NULL AND a specific, known escrowAddress allowlist — never an unconditional UPDATE");
  }
});

test("(5/F) EXPAND migration adds a partial unique index on archived_contracts covering (chain_id, escrow_address, agreement_id, addr)", () => {
  const sql = readSrc(EXPAND_MIGRATION_PATH);
  const idxMatch = sql.match(/CREATE UNIQUE INDEX IF NOT EXISTS archived_contracts_network_scoped_agreement[\s\S]*?;/);
  assert.ok(idxMatch, "expected a partial unique index on archived_contracts for network+deployment-scoped agreement uniqueness");
  assert.match(idxMatch[0], /\(chain_id, escrow_address, agreement_id, addr\)/, "index must cover (chain_id, escrow_address, agreement_id, addr) — chain_id alone is not enough given Arc Testnet's multiple historical deployments");
  assert.match(idxMatch[0], /WHERE chain_id IS NOT NULL AND escrow_address IS NOT NULL AND agreement_id IS NOT NULL/, "index must be partial, excluding ambiguous NULL rows");
});
