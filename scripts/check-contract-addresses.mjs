#!/usr/bin/env node
// Consistency check for pi2pi contract addresses across Arc Testnet AND Arc
// Mainnet.
//
// config/deployments.json is the single source of truth for both networks
// ("5042002" = arc-testnet, "5042" = arc-mainnet). Each runtime boundary
// resolves addresses from it differently, so this checker validates each
// boundary against its own actual mechanism instead of assuming one shared
// shape:
//
//   - backend (server-arc.js)  → delegates to network-config.js's
//     resolveContractAddresses(), which keys the manifest by
//     String(expectedChainId). No literal fallback addresses live in
//     server-arc.js itself. server-arc.js then injects those same resolved
//     values into admin_routes.js via initAdminNetwork() — admin_routes.js
//     never reads config/deployments.json or resolves anything itself, so
//     it cannot independently drift onto a different network's RPC/
//     addresses.
//   - frontend (arc/src/helpers.js) → NETWORK_CONFIGS holds one literal,
//     network-scoped config object per network that HAS a verified
//     deployment. A network with no verified deployment (e.g. arc-mainnet,
//     until it is activated for the frontend) is intentionally absent — that
//     is not an error.
//   - keeper (keeper/network.ts) → cannot read config/deployments.json at
//     runtime (isolated Docker build context), so it hand-maintains
//     KNOWN_ARC_TESTNET_CONTRACTS, a deny-list of every Arc Testnet address
//     ever recorded (active + historicalIntermediate + legacy), used only to
//     refuse cross-network reuse. This checker derives the expected deny-list
//     from the manifest and diffs it against the hardcoded list in both
//     directions.
//
// Retired Arc Testnet addresses (historicalIntermediate + legacy) must not
// appear anywhere in runtime code EXCEPT keeper/network.ts and
// keeper/network.test.ts, which intentionally reference all of them as part
// of the cross-network deny-list and its tests.
//
// It deliberately does NOT walk backups/, archive/, .claude/, deck/,
// contracts/broadcast|out|cache, arc/dist, or git history — those are
// historical artifacts, not runtime code, and are expected to contain old
// addresses.
//
// Usage: node scripts/check-contract-addresses.mjs
// Exit code: 0 = consistent, 1 = mismatch found.

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");

const errors = [];
const warnings = [];
const info = [];
function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
function isValidNonZeroAddress(addr) {
  return typeof addr === "string" && ADDRESS_RE.test(addr) && addr.toLowerCase() !== ZERO_ADDRESS;
}

// ── Load manifest ────────────────────────────────────────────────────
const manifestPath = join(ROOT, "config", "deployments.json");
let deployments;
try {
  deployments = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (e) {
  console.error(`FATAL: could not read/parse ${relative(ROOT, manifestPath)}: ${e.message}`);
  process.exit(1);
}

const NETWORKS = [
  { key: "5042002", name: "arc-testnet" },
  { key: "5042", name: "arc-mainnet" },
];

// ── Part 1: manifest structural validation (both networks) ─────────────
const manifestEntries = {}; // name -> { key, entry, active: { rentalEscrow, propDepEscrow } }

for (const { key, name } of NETWORKS) {
  const entry = deployments[key];
  if (!entry) {
    fail(`config/deployments.json: missing required "${key}" (${name}) entry`);
    continue;
  }
  if (entry.network !== name) {
    fail(`config/deployments.json["${key}"].network is "${entry.network}", expected "${name}"`);
  }
  if (entry.chainId !== Number(key)) {
    fail(`config/deployments.json["${key}"].chainId is ${entry.chainId}, expected ${key}`);
  }
  if (!isValidNonZeroAddress(entry.usdc)) {
    fail(`config/deployments.json["${key}"].usdc is not a valid non-zero Ethereum address: "${entry.usdc}"`);
  }
  if (!entry.active) {
    fail(`config/deployments.json["${key}"] is missing an "active" deployment`);
    continue;
  }
  const re = entry.active.RentalEscrow?.address;
  const pd = entry.active.PropDepEscrow?.address;
  if (!isValidNonZeroAddress(re)) {
    fail(`config/deployments.json["${key}"].active.RentalEscrow.address is not a valid non-zero Ethereum address: "${re}"`);
  }
  if (!isValidNonZeroAddress(pd)) {
    fail(`config/deployments.json["${key}"].active.PropDepEscrow.address is not a valid non-zero Ethereum address: "${pd}"`);
  }
  manifestEntries[name] = {
    key,
    entry,
    active: { rentalEscrow: re?.toLowerCase(), propDepEscrow: pd?.toLowerCase() },
  };
}

// Cross-network reuse of the SAME active address would mean one of the two
// deployments is misrecorded (CREATE addresses are deployer+nonce derived —
// identical values across distinct chains should never happen by accident).
if (manifestEntries["arc-testnet"] && manifestEntries["arc-mainnet"]) {
  const t = manifestEntries["arc-testnet"].active;
  const m = manifestEntries["arc-mainnet"].active;
  if (t.rentalEscrow === m.rentalEscrow) {
    fail(`config/deployments.json: Arc Testnet and Arc Mainnet active RentalEscrow addresses are identical (${t.rentalEscrow})`);
  }
  if (t.propDepEscrow === m.propDepEscrow) {
    fail(`config/deployments.json: Arc Testnet and Arc Mainnet active PropDepEscrow addresses are identical (${t.propDepEscrow})`);
  }
}

// ── Derive testnet address universes from the manifest ─────────────────
function pairAddrs(pair) {
  return [pair?.RentalEscrow?.address, pair?.PropDepEscrow?.address].filter(Boolean).map((a) => a.toLowerCase());
}

const testnetEntry = deployments["5042002"];
const TESTNET_ACTIVE = new Set(pairAddrs(testnetEntry?.active));
const TESTNET_RETIRED = new Set([
  ...pairAddrs(testnetEntry?.historicalIntermediate),
  ...(testnetEntry?.legacy || []).flatMap(pairAddrs),
]);
const TESTNET_ALL = new Set([...TESTNET_ACTIVE, ...TESTNET_RETIRED]);

const mainnetEntry = deployments["5042"];
const MAINNET_ACTIVE = new Set(pairAddrs(mainnetEntry?.active));

// ── Part 2: scan runtime files for RETIRED Arc Testnet address leakage ─
// Active testnet addresses are expected to appear (frontend config, manifest
// reads) — only retired (historicalIntermediate + legacy) addresses are
// leakage outside the keeper's intentional deny-list context.
const SCAN_TARGETS = [
  "arc/src", // frontend source (recurse), excludes arc/dist (not listed)
  "keeper", // keeper source (recurse), excludes keeper/node_modules (skipped below)
  "server-arc.js",
  "admin_routes.js",
  "public/llms.txt",
];

// The only files allowed to reference retired Arc Testnet addresses — the
// keeper's cross-network deny-list and its own tests.
const ALLOWLISTED_RETIRED_ADDRESS_FILES = new Set(["keeper/network.ts", "keeper/network.test.ts"]);

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".git"]);
const SCAN_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".txt"]);

function walk(absPath, out) {
  const st = statSync(absPath);
  if (st.isDirectory()) {
    const base = absPath.split("/").pop();
    if (SKIP_DIR_NAMES.has(base)) return;
    for (const entry of readdirSync(absPath)) walk(join(absPath, entry), out);
  } else if (st.isFile()) {
    if (SCAN_EXTENSIONS.has(extname(absPath))) out.push(absPath);
  }
}

const filesToScan = [];
for (const target of SCAN_TARGETS) {
  const abs = join(ROOT, target);
  try {
    walk(abs, filesToScan);
  } catch (e) {
    warn(`Could not scan ${target}: ${e.message}`);
  }
}

const ADDR_RE_GLOBAL = /0x[a-fA-F0-9]{40}/g;

for (const absFile of filesToScan) {
  const rel = relative(ROOT, absFile);
  const content = readFileSync(absFile, "utf8");
  const matches = content.match(ADDR_RE_GLOBAL) || [];
  for (const m of matches) {
    const lower = m.toLowerCase();
    if (TESTNET_RETIRED.has(lower) && !ALLOWLISTED_RETIRED_ADDRESS_FILES.has(rel)) {
      fail(
        `${rel}: contains RETIRED Arc Testnet contract address ${m} — replace with the active pair from config/deployments.json (or, if this is an intentional cross-network deny-list, add the file to ALLOWLISTED_RETIRED_ADDRESS_FILES in this checker)`
      );
    }
    if (MAINNET_ACTIVE.has(lower) && rel !== "keeper/network.ts" && rel !== "keeper/network.test.ts" && rel.startsWith("keeper/")) {
      // Mainnet addresses in keeper runtime code outside network.ts are fine
      // only if they come from real runtime config (env), never hardcoded —
      // a hit here just means "double-check this wasn't hand-pasted."
      warn(`${rel}: contains an Arc Mainnet active contract address ${m} hardcoded in source — verify this is not meant to come from runtime config instead`);
    }
  }
}

// ── Part 3: keeper deny-list must exactly match the manifest's testnet universe ──
const keeperNetworkPath = join(ROOT, "keeper", "network.ts");
try {
  const keeperNetworkSrc = readFileSync(keeperNetworkPath, "utf8");
  const denyListMatch = keeperNetworkSrc.match(/KNOWN_ARC_TESTNET_CONTRACTS[\s\S]*?=\s*new Set\(\s*\[([\s\S]*?)\]\s*\.map/);
  if (!denyListMatch) {
    fail("keeper/network.ts: could not locate the KNOWN_ARC_TESTNET_CONTRACTS array literal to verify against config/deployments.json");
  } else {
    const denyListAddrs = new Set((denyListMatch[1].match(ADDR_RE_GLOBAL) || []).map((a) => a.toLowerCase()));

    for (const addr of TESTNET_ALL) {
      if (!denyListAddrs.has(addr)) {
        fail(`keeper/network.ts: KNOWN_ARC_TESTNET_CONTRACTS is missing Arc Testnet address ${addr} that is present in config/deployments.json — deny-list is stale`);
      }
    }
    for (const addr of denyListAddrs) {
      if (!TESTNET_ALL.has(addr)) {
        fail(`keeper/network.ts: KNOWN_ARC_TESTNET_CONTRACTS contains ${addr}, which is not present anywhere in config/deployments.json's "5042002" entry — remove it or verify it belongs`);
      }
    }
    for (const addr of MAINNET_ACTIVE) {
      if (denyListAddrs.has(addr)) {
        fail(`keeper/network.ts: KNOWN_ARC_TESTNET_CONTRACTS contains ${addr}, which is Arc Mainnet's active contract address — this would incorrectly block legitimate Arc Mainnet keeper operation`);
      }
    }
  }
} catch (e) {
  fail(`keeper/network.ts: could not read (${e.message})`);
}

// ── Part 4: frontend (arc/src/helpers.js) network-aware config model ───
const helpersPath = join(ROOT, "arc", "src", "helpers.js");
try {
  const helpersSrc = readFileSync(helpersPath, "utf8");

  const chainIdsBlockMatch = helpersSrc.match(/NETWORK_CHAIN_IDS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
  if (!chainIdsBlockMatch) {
    fail("arc/src/helpers.js: could not find NETWORK_CHAIN_IDS mapping");
  } else {
    for (const { key, name } of NETWORKS) {
      const m = chainIdsBlockMatch[1].match(new RegExp(`"${name}"\\s*:\\s*(\\d+)`));
      if (!m) fail(`arc/src/helpers.js: NETWORK_CHAIN_IDS is missing "${name}"`);
      else if (Number(m[1]) !== Number(key)) {
        fail(`arc/src/helpers.js: NETWORK_CHAIN_IDS["${name}"] = ${m[1]}, expected ${key}`);
      }
    }
  }

  // Fail-closed resolution guard: ACTIVE_NETWORK_CONFIG must come straight
  // from resolveNetworkConfig(ACTIVE_NETWORK_NAME) with no fallback operator
  // on the same statement (a "|| NETWORK_CONFIGS['arc-testnet']" style
  // fallback would silently reuse testnet config for an unconfigured
  // network). The full runtime throw-on-unset/unsupported/unconfigured
  // behavior is covered by arc/src/__tests__/network-config.test.js.
  if (!/const ACTIVE_NETWORK_CONFIG\s*=\s*resolveNetworkConfig\(ACTIVE_NETWORK_NAME\)\s*;/.test(helpersSrc)) {
    fail(
      "arc/src/helpers.js: could not confirm ACTIVE_NETWORK_CONFIG is resolved via resolveNetworkConfig(ACTIVE_NETWORK_NAME) with no fallback — required for fail-closed network selection (see arc/src/__tests__/network-config.test.js for the runtime behavior contract)"
    );
  }

  // Per-network NETWORK_CONFIGS entries: only validated when present. A
  // missing entry for a network with no verified frontend deployment yet
  // (currently arc-mainnet) is expected, not an error.
  function extractNetworkConfigBlock(src, name) {
    const startIdx = src.indexOf(`"${name}": {`);
    if (startIdx === -1) return null;
    const rest = src.slice(startIdx);
    const nextKeyRel = rest.slice(1).search(/\n\s*"arc-[a-z-]+"\s*:\s*\{/);
    const endOfObjectRel = rest.indexOf("\n});");
    let end = rest.length;
    if (nextKeyRel !== -1) end = Math.min(end, nextKeyRel + 1);
    if (endOfObjectRel !== -1) end = Math.min(end, endOfObjectRel);
    return rest.slice(0, end);
  }

  for (const { name } of NETWORKS) {
    const block = extractNetworkConfigBlock(helpersSrc, name);
    if (!block) {
      if (name === "arc-mainnet") {
        info.push(`arc/src/helpers.js: NETWORK_CONFIGS has no "${name}" entry yet — frontend not activated for this network (expected/allowed; contracts are deployed and recorded in config/deployments.json, but the frontend build config is a separate, deliberate activation step).`);
      } else {
        fail(`arc/src/helpers.js: NETWORK_CONFIGS is missing required "${name}" entry`);
      }
      continue;
    }
    const escrowM = block.match(/escrowAddress:\s*"(0x[a-fA-F0-9]{40})"/);
    const propdepM = block.match(/propdepAddress:\s*"(0x[a-fA-F0-9]{40})"/);
    const usdcM = block.match(/usdcAddress:\s*"(0x[a-fA-F0-9]{40})"/);
    if (!escrowM || !propdepM || !usdcM) {
      fail(`arc/src/helpers.js: NETWORK_CONFIGS["${name}"] is missing escrowAddress/propdepAddress/usdcAddress`);
      continue;
    }
    const manifestForNetwork = manifestEntries[name];
    if (manifestForNetwork) {
      if (escrowM[1].toLowerCase() !== manifestForNetwork.active.rentalEscrow) {
        fail(`arc/src/helpers.js: NETWORK_CONFIGS["${name}"].escrowAddress (${escrowM[1]}) does not match active RentalEscrow in config/deployments.json["${manifestForNetwork.key}"] (${manifestForNetwork.entry.active.RentalEscrow.address})`);
      }
      if (propdepM[1].toLowerCase() !== manifestForNetwork.active.propDepEscrow) {
        fail(`arc/src/helpers.js: NETWORK_CONFIGS["${name}"].propdepAddress (${propdepM[1]}) does not match active PropDepEscrow in config/deployments.json["${manifestForNetwork.key}"] (${manifestForNetwork.entry.active.PropDepEscrow.address})`);
      }
      if (usdcM[1].toLowerCase() !== manifestForNetwork.entry.usdc.toLowerCase()) {
        fail(`arc/src/helpers.js: NETWORK_CONFIGS["${name}"].usdcAddress (${usdcM[1]}) does not match config/deployments.json["${manifestForNetwork.key}"].usdc (${manifestForNetwork.entry.usdc})`);
      }
    }
  }
} catch (e) {
  fail(`arc/src/helpers.js: could not read (${e.message})`);
}

// ── Part 5: backend (network-config.js) network-aware resolver ─────────
try {
  const networkConfigPath = join(ROOT, "network-config.js");
  const networkConfigSrc = readFileSync(networkConfigPath, "utf8");

  const expectedChainIdsBlock = networkConfigSrc.match(/EXPECTED_CHAIN_IDS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
  if (!expectedChainIdsBlock) {
    fail("network-config.js: could not find EXPECTED_CHAIN_IDS mapping");
  } else {
    for (const { key, name } of NETWORKS) {
      const m = expectedChainIdsBlock[1].match(new RegExp(`"${name}"\\s*:\\s*(\\d+)`));
      if (!m) fail(`network-config.js: EXPECTED_CHAIN_IDS is missing "${name}"`);
      else if (Number(m[1]) !== Number(key)) {
        fail(`network-config.js: EXPECTED_CHAIN_IDS["${name}"] = ${m[1]}, expected ${key}`);
      }
    }
  }

  if (!/const manifestKey\s*=\s*String\(expectedChainId\)\s*;/.test(networkConfigSrc)) {
    fail(
      "network-config.js: resolveContractAddresses does not appear to key the manifest lookup by String(expectedChainId) — mainnet could silently reuse another network's manifest entry"
    );
  }
} catch (e) {
  fail(`network-config.js: could not read (${e.message})`);
}

// server-arc.js must delegate to network-config.js, not hardcode fallbacks
// itself, and must pass its resolved RPC/addresses on to admin_routes.js via
// initAdminNetwork() rather than leaving admin routes to fend for themselves.
try {
  const serverPath = join(ROOT, "server-arc.js");
  const serverSrc = readFileSync(serverPath, "utf8");
  if (!/from\s+["']\.\/network-config\.js["']/.test(serverSrc) || !serverSrc.includes("resolveContractAddresses(")) {
    fail("server-arc.js: does not appear to resolve contract addresses via network-config.js's resolveContractAddresses() — check for a reintroduced hardcoded fallback");
  }

  if (!/import\s*\{[^}]*\binitAdminNetwork\b[^}]*\}\s*from\s*["']\.\/admin_routes\.js["']/.test(serverSrc)) {
    fail("server-arc.js: does not appear to import initAdminNetwork from ./admin_routes.js — admin routes would be left uninitialized (fail-closed) or could regress to resolving their own config");
  }

  const initCallMatch = serverSrc.match(/initAdminNetwork\(\s*\{([^}]*)\}\s*\)/);
  if (!initCallMatch) {
    fail("server-arc.js: does not appear to call initAdminNetwork({ rpc, rentalEscrow, propDepEscrow }) — admin routes would be left uninitialized (fail-closed) or could regress to resolving their own config");
  } else {
    for (const key of ["rpc", "rentalEscrow", "propDepEscrow"]) {
      if (!new RegExp(`\\b${key}\\s*:`).test(initCallMatch[1])) {
        fail(`server-arc.js: initAdminNetwork(...) call does not appear to pass "${key}" — admin routes may not receive the fully resolved network config`);
      }
    }
  }
} catch (e) {
  fail(`server-arc.js: could not read (${e.message})`);
}

// admin_routes.js must never resolve its own RPC/contract addresses — it
// receives verified values from server-arc.js via initAdminNetwork() (see
// admin_routes.js's own doc comment). These are regression guards for the
// exact gaps that pattern replaced: a hardcoded arc-testnet-only manifest
// lookup, and a hardcoded Arc Testnet RPC literal.
try {
  const adminPath = join(ROOT, "admin_routes.js");
  const adminSrc = readFileSync(adminPath, "utf8");

  if (!adminSrc.includes("initAdminNetwork")) {
    fail("admin_routes.js: does not appear to define/export initAdminNetwork — the network-aware initialization entry point server-arc.js depends on is missing");
  }
  if (adminSrc.includes('DEPLOYMENTS["5042002"]') || adminSrc.includes("DEPLOYMENTS['5042002']")) {
    fail(
      'admin_routes.js: contains a hardcoded DEPLOYMENTS["5042002"] manifest lookup — this is the exact Arc-Testnet-only regression initAdminNetwork() was introduced to eliminate. Contract addresses must come from initAdminNetwork(), not be re-derived here.'
    );
  }
  if (adminSrc.includes("rpc.testnet.arc.network")) {
    fail(
      'admin_routes.js: contains the hardcoded Arc Testnet RPC literal "rpc.testnet.arc.network" — the RPC URL must come from initAdminNetwork()\'s injected value, not a fallback literal.'
    );
  }
} catch (e) {
  fail(`admin_routes.js: could not read (${e.message})`);
}

// ── Report ────────────────────────────────────────────────────────────
console.log("Manifest (config/deployments.json):");
for (const { key, name } of NETWORKS) {
  const m = manifestEntries[name];
  if (!m) continue;
  console.log(`  [${name}] chainId=${key}`);
  console.log(`    RentalEscrow:  ${m.entry.active.RentalEscrow.address}`);
  console.log(`    PropDepEscrow: ${m.entry.active.PropDepEscrow.address}`);
}
console.log(`Scanned ${filesToScan.length} files under: ${SCAN_TARGETS.join(", ")}`);
console.log("");

if (info.length) {
  for (const i of info) console.log(`  ℹ ${i}`);
  console.log("");
}

if (warnings.length) {
  console.log("Warnings:");
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  console.log("");
}

if (errors.length) {
  console.log("Errors:");
  for (const e of errors) console.log(`  ✖ ${e}`);
  console.log(`\n${errors.length} address consistency error(s) found.`);
  process.exit(1);
}

console.log("OK: manifest is internally consistent across Arc Testnet + Arc Mainnet, no retired-address leakage found, keeper deny-list matches the manifest, frontend/backend resolvers are network-aware.");
process.exit(0);
