import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import {
  EXPECTED_CHAIN_IDS,
  NetworkConfigError,
  NetworkMismatchError,
  ContractAddressError,
  resolveExpectedChainId,
  assertChainMatch,
  fetchChainId,
  resolveContractAddresses,
  resolveArchiveEscrowAllowlist,
  isValidNonZeroAddress,
  isPofRowInScope,
  pofNetworkFilterClause,
  assertSupportedNetwork,
} from "./network-config.js";

test("arc-testnet config resolves correctly", () => {
  assert.equal(resolveExpectedChainId("arc-testnet"), 5042002);
});

test("arc-mainnet config resolves correctly where the chainId is known", () => {
  assert.equal(resolveExpectedChainId("arc-mainnet"), 5042);
});

test("backend: missing NETWORK fails", () => {
  // Mirrors server-arc.js's own check: an unset NETWORK is never coerced into
  // a real network name before reaching resolveExpectedChainId.
  assert.throws(() => resolveExpectedChainId(undefined), NetworkConfigError);
});

test("backend: unsupported NETWORK fails", () => {
  assert.throws(() => resolveExpectedChainId("arbitrum-sepolia"), NetworkConfigError);
  assert.throws(() => resolveExpectedChainId("mainnet"), NetworkConfigError);
  assert.throws(() => resolveExpectedChainId(""), NetworkConfigError);
});

test("testnet chainId cannot silently become the mainnet default (or vice versa)", () => {
  assert.notEqual(EXPECTED_CHAIN_IDS["arc-testnet"], EXPECTED_CHAIN_IDS["arc-mainnet"]);
});

test("backend: testnet + chainId 5042002 passes", async () => {
  const fakeFetch = async () => ({ json: async () => ({ result: "0x4cef52" }) }); // 5042002
  const actual = await fetchChainId("https://fake-testnet-rpc", fakeFetch);
  const expected = resolveExpectedChainId("arc-testnet");
  assert.doesNotThrow(() => assertChainMatch("arc-testnet", expected, actual));
});

test("backend: mainnet + chainId 5042 passes with a supplied RPC/config fixture", async () => {
  const fakeFetch = async () => ({ json: async () => ({ result: "0x13b2" }) }); // 5042
  const actual = await fetchChainId("https://fake-mainnet-rpc", fakeFetch);
  const expected = resolveExpectedChainId("arc-mainnet");
  assert.doesNotThrow(() => assertChainMatch("arc-mainnet", expected, actual));
});

test("backend: NETWORK/RPC mismatch fails (e.g. NETWORK=arc-mainnet but RPC is actually testnet)", async () => {
  const fakeFetch = async () => ({ json: async () => ({ result: "0x4cef52" }) }); // 5042002 — testnet
  const actual = await fetchChainId("https://fake-rpc", fakeFetch);
  const expected = resolveExpectedChainId("arc-mainnet"); // configured for mainnet
  assert.throws(() => assertChainMatch("arc-mainnet", expected, actual), NetworkMismatchError);
});

test("fetchChainId parses eth_chainId hex results correctly", async () => {
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.method, "eth_chainId");
    return { json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x1" }) };
  };
  assert.equal(await fetchChainId("https://fake", fakeFetch), 1);
});

// ─── resolveContractAddresses ──────────────────────────────────────────────
// Fixture mirrors the real config/deployments.json structure: a verified
// entry (RentalEscrow/PropDepEscrow under `.active`, USDC at the top level)
// under the testnet chainId key, and — deliberately, matching the real file —
// no "5042" (arc-mainnet) entry at all.
const TESTNET_RENTAL = "0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8";
const TESTNET_PROPDEP = "0xe2190997F3811B771C25525C8401504a0e5330c5";
const TESTNET_USDC = "0x3600000000000000000000000000000000000000";
const FIXTURE_DEPLOYMENTS = {
  "5042002": {
    usdc: TESTNET_USDC,
    active: {
      RentalEscrow: { address: TESTNET_RENTAL },
      PropDepEscrow: { address: TESTNET_PROPDEP },
    },
  },
};

const MAINNET_RENTAL = "0x111111111111111111111111111111111111111a";
const MAINNET_PROPDEP = "0x222222222222222222222222222222222222222b";
const MAINNET_USDC = "0x555555555555555555555555555555555555555e";

test("arc-testnet with no explicit contract env vars resolves the existing verified testnet deployment", () => {
  const { rentalEscrow, propDepEscrow, usdc } = resolveContractAddresses("arc-testnet", {
    rentalEscrowEnv: undefined,
    propDepEscrowEnv: undefined,
    usdcEnv: undefined,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042002,
  });
  assert.equal(rentalEscrow, TESTNET_RENTAL);
  assert.equal(propDepEscrow, TESTNET_PROPDEP);
  assert.equal(usdc, TESTNET_USDC);
});

test("arc-testnet may use explicit valid contract env vars to override the manifest (existing architecture allows this)", () => {
  const { rentalEscrow, propDepEscrow, usdc } = resolveContractAddresses("arc-testnet", {
    rentalEscrowEnv: MAINNET_RENTAL, // reusing as a generic "override" fixture, not a real mainnet claim
    propDepEscrowEnv: MAINNET_PROPDEP,
    usdcEnv: MAINNET_USDC,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042002,
  });
  assert.equal(rentalEscrow, MAINNET_RENTAL);
  assert.equal(propDepEscrow, MAINNET_PROPDEP);
  assert.equal(usdc, MAINNET_USDC);
});

test("arc-mainnet with all three explicit valid addresses resolves successfully", () => {
  const { rentalEscrow, propDepEscrow, usdc } = resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: MAINNET_RENTAL,
    propDepEscrowEnv: MAINNET_PROPDEP,
    usdcEnv: MAINNET_USDC,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  });
  assert.equal(rentalEscrow, MAINNET_RENTAL);
  assert.equal(propDepEscrow, MAINNET_PROPDEP);
  assert.equal(usdc, MAINNET_USDC);
});

test("arc-mainnet missing RENTAL_ESCROW_ADDRESS fails", () => {
  assert.throws(() => resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: undefined,
    propDepEscrowEnv: MAINNET_PROPDEP,
    usdcEnv: MAINNET_USDC,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  }), ContractAddressError);
});

test("arc-mainnet missing PROPDEP_ESCROW_ADDRESS fails", () => {
  assert.throws(() => resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: MAINNET_RENTAL,
    propDepEscrowEnv: undefined,
    usdcEnv: MAINNET_USDC,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  }), ContractAddressError);
});

test("arc-mainnet missing both escrow addresses fails", () => {
  assert.throws(() => resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: undefined,
    propDepEscrowEnv: undefined,
    usdcEnv: MAINNET_USDC,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  }), ContractAddressError);
});

test("arc-mainnet without USDC_ADDRESS fails", () => {
  assert.throws(() => resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: MAINNET_RENTAL,
    propDepEscrowEnv: MAINNET_PROPDEP,
    usdcEnv: undefined,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  }), ContractAddressError);
});

test("arc-mainnet with explicit valid USDC_ADDRESS resolves", () => {
  const { usdc } = resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: MAINNET_RENTAL,
    propDepEscrowEnv: MAINNET_PROPDEP,
    usdcEnv: MAINNET_USDC,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  });
  assert.equal(usdc, MAINNET_USDC);
});

test('arc-mainnet never resolves ANY address (RentalEscrow/PropDepEscrow/USDC) from DEPLOYMENTS["5042002"] — regression guard for the reported bug', () => {
  // FIXTURE_DEPLOYMENTS has a perfectly valid testnet entry, including USDC;
  // requesting mainnet with no env vars must still fail, and must never
  // silently surface any testnet address anywhere (including the message).
  let caught = null;
  try {
    resolveContractAddresses("arc-mainnet", {
      rentalEscrowEnv: undefined,
      propDepEscrowEnv: undefined,
      usdcEnv: undefined,
      deployments: FIXTURE_DEPLOYMENTS,
      expectedChainId: 5042,
    });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof ContractAddressError, "expected a ContractAddressError, got none");
  assert.doesNotMatch(caught.message, new RegExp(TESTNET_RENTAL));
  assert.doesNotMatch(caught.message, new RegExp(TESTNET_PROPDEP));
  assert.doesNotMatch(caught.message, new RegExp(TESTNET_USDC));
  // Also prove it never falls back even when only USDC is missing (escrow addrs supplied).
  assert.throws(() => resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: MAINNET_RENTAL,
    propDepEscrowEnv: MAINNET_PROPDEP,
    usdcEnv: undefined,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  }), (e) => e instanceof ContractAddressError && !e.message.includes(TESTNET_USDC));
});

test("zero address fails (escrow)", () => {
  assert.throws(() => resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: "0x0000000000000000000000000000000000000000",
    propDepEscrowEnv: MAINNET_PROPDEP,
    usdcEnv: MAINNET_USDC,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  }), ContractAddressError);
});

test("zero address fails (USDC)", () => {
  assert.throws(() => resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: MAINNET_RENTAL,
    propDepEscrowEnv: MAINNET_PROPDEP,
    usdcEnv: "0x0000000000000000000000000000000000000000",
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  }), ContractAddressError);
});

test("malformed address fails (escrow)", () => {
  assert.throws(() => resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: "not-an-address",
    propDepEscrowEnv: MAINNET_PROPDEP,
    usdcEnv: MAINNET_USDC,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  }), ContractAddressError);
  assert.throws(() => resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: "0x333", // too short
    propDepEscrowEnv: MAINNET_PROPDEP,
    usdcEnv: MAINNET_USDC,
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  }), ContractAddressError);
});

test("malformed address fails (USDC)", () => {
  assert.throws(() => resolveContractAddresses("arc-mainnet", {
    rentalEscrowEnv: MAINNET_RENTAL,
    propDepEscrowEnv: MAINNET_PROPDEP,
    usdcEnv: "not-an-address",
    deployments: FIXTURE_DEPLOYMENTS,
    expectedChainId: 5042,
  }), ContractAddressError);
});

test("isValidNonZeroAddress sanity checks", () => {
  assert.equal(isValidNonZeroAddress(TESTNET_RENTAL), true);
  assert.equal(isValidNonZeroAddress("0x0000000000000000000000000000000000000000"), false);
  assert.equal(isValidNonZeroAddress("not-an-address"), false);
  assert.equal(isValidNonZeroAddress(undefined), false);
});

// ─── resolveArchiveEscrowAllowlist (TASK 9G) ───────────────────────────────
// Archive/history reads accept ANY known RentalEscrow deployment for a
// network's OWN chain — never another network's addresses (per-network, not
// global) — unlike active-contract reads, which stay scoped to the single
// current deployment.
const TESTNET_HISTORICAL = "0x11184188c24ce546912617156c0693868a98b2a3";
const TESTNET_LEGACY_0 = "0x6cbF4d958dA24b7AdC98Fb7633213Ac26b5a6f3a";
const TESTNET_LEGACY_1 = "0xEaC111678149818168dd8499882A234e2019A802";
const FIXTURE_DEPLOYMENTS_WITH_HISTORY = {
  "5042002": {
    usdc: TESTNET_USDC,
    active: { RentalEscrow: { address: TESTNET_RENTAL } },
    historicalIntermediate: { RentalEscrow: { address: TESTNET_HISTORICAL } },
    legacy: [
      { RentalEscrow: { address: TESTNET_LEGACY_0 } },
      { RentalEscrow: { address: TESTNET_LEGACY_1 } },
    ],
  },
  "5042": {
    usdc: MAINNET_USDC,
    active: { RentalEscrow: { address: MAINNET_RENTAL } },
  },
};

test("testnet archive allowlist includes every known historical + current deployment on chain 5042002", () => {
  const allowlist = resolveArchiveEscrowAllowlist("arc-testnet", {
    deployments: FIXTURE_DEPLOYMENTS_WITH_HISTORY,
    expectedChainId: 5042002,
    currentEscrowAddress: TESTNET_RENTAL,
  });
  const set = new Set(allowlist);
  assert.equal(set.size, 4, `expected 4 distinct testnet addresses, got ${allowlist.length}: ${allowlist}`);
  for (const addr of [TESTNET_RENTAL, TESTNET_HISTORICAL, TESTNET_LEGACY_0, TESTNET_LEGACY_1]) {
    assert.ok(set.has(addr.toLowerCase()), `expected ${addr} in the testnet archive allowlist`);
  }
});

test("testnet archive allowlist never includes a mainnet address (per-network, not global)", () => {
  const allowlist = resolveArchiveEscrowAllowlist("arc-testnet", {
    deployments: FIXTURE_DEPLOYMENTS_WITH_HISTORY,
    expectedChainId: 5042002,
    currentEscrowAddress: TESTNET_RENTAL,
  });
  assert.ok(!allowlist.includes(MAINNET_RENTAL.toLowerCase()), "testnet allowlist leaked a mainnet address");
});

test("mainnet archive allowlist currently accepts only the current mainnet escrow", () => {
  const allowlist = resolveArchiveEscrowAllowlist("arc-mainnet", {
    deployments: FIXTURE_DEPLOYMENTS_WITH_HISTORY,
    expectedChainId: 5042,
    currentEscrowAddress: MAINNET_RENTAL,
  });
  assert.deepEqual(allowlist, [MAINNET_RENTAL.toLowerCase()]);
});

test("mainnet archive allowlist never includes a testnet address, even one this network resolved elsewhere", () => {
  const allowlist = resolveArchiveEscrowAllowlist("arc-mainnet", {
    deployments: FIXTURE_DEPLOYMENTS_WITH_HISTORY,
    expectedChainId: 5042,
    currentEscrowAddress: MAINNET_RENTAL,
  });
  for (const testnetAddr of [TESTNET_RENTAL, TESTNET_HISTORICAL, TESTNET_LEGACY_0, TESTNET_LEGACY_1]) {
    assert.ok(!allowlist.includes(testnetAddr.toLowerCase()), `mainnet allowlist leaked testnet address ${testnetAddr}`);
  }
});

test("archive allowlist always includes the actually-resolved current escrow, even if it diverges from the manifest (env override)", () => {
  const envOverrideAddress = "0x999999999999999999999999999999999999999f";
  const allowlist = resolveArchiveEscrowAllowlist("arc-testnet", {
    deployments: FIXTURE_DEPLOYMENTS_WITH_HISTORY,
    expectedChainId: 5042002,
    currentEscrowAddress: envOverrideAddress,
  });
  assert.ok(allowlist.includes(envOverrideAddress), "newly-written archives under an env-overridden escrow must remain visible");
});

test("archive allowlist fails closed when nothing is available (no manifest entry, no current address)", () => {
  assert.throws(
    () => resolveArchiveEscrowAllowlist("arc-mainnet", { deployments: {}, expectedChainId: 5042, currentEscrowAddress: undefined }),
    ContractAddressError
  );
});

test("archive allowlist against the REAL config/deployments.json: Arc Testnet has multiple deployments, Arc Mainnet has exactly one", () => {
  const realDeployments = JSON.parse(readFileSync(new URL("./config/deployments.json", import.meta.url), "utf8"));

  const testnetAllowlist = resolveArchiveEscrowAllowlist("arc-testnet", {
    deployments: realDeployments,
    expectedChainId: 5042002,
    currentEscrowAddress: realDeployments["5042002"].active.RentalEscrow.address,
  });
  assert.ok(testnetAllowlist.length >= 5, `expected at least 5 known Arc Testnet RentalEscrow deployments (active + historicalIntermediate + 3 legacy), got ${testnetAllowlist.length}`);

  const mainnetAllowlist = resolveArchiveEscrowAllowlist("arc-mainnet", {
    deployments: realDeployments,
    expectedChainId: 5042,
    currentEscrowAddress: realDeployments["5042"].active.RentalEscrow.address,
  });
  assert.deepEqual(mainnetAllowlist, [realDeployments["5042"].active.RentalEscrow.address.toLowerCase()]);

  // No overlap between the two networks' allowlists.
  const overlap = testnetAllowlist.filter((a) => mainnetAllowlist.includes(a));
  assert.equal(overlap.length, 0, `testnet/mainnet archive allowlists must never overlap, found: ${overlap}`);
});

// ─── isPofRowInScope / pofNetworkFilterClause (TASK 10F) ───────────────────
// Direct reproduction of the TASK 10D incident: checkListingsTablePoF /
// checkTenantIntentPoF read `listings`/`users` rows with no network filter,
// so the Arc Mainnet runtime read pre-existing Arc Testnet rows (tagged
// "arc-testnet" once this fix lands, but at the time of the incident simply
// untagged/null) and mutated them via the Mainnet RPC's balance check.

test("(TASK 10D repro) a Mainnet runtime must NEVER treat an untagged legacy row as its own — this exact gap caused the incident", () => {
  assert.equal(isPofRowInScope(null, "arc-mainnet"), false);
  assert.equal(isPofRowInScope(undefined, "arc-mainnet"), false);
  assert.equal(isPofRowInScope("", "arc-mainnet"), false);
});

test("Mainnet never processes an explicit Testnet row", () => {
  assert.equal(isPofRowInScope("arc-testnet", "arc-mainnet"), false);
});

test("Mainnet only processes rows explicitly tagged arc-mainnet", () => {
  assert.equal(isPofRowInScope("arc-mainnet", "arc-mainnet"), true);
});

test("Testnet transitionally still processes untagged legacy rows (every pre-TASK-10F row)", () => {
  assert.equal(isPofRowInScope(null, "arc-testnet"), true);
  assert.equal(isPofRowInScope(undefined, "arc-testnet"), true);
  assert.equal(isPofRowInScope("", "arc-testnet"), true);
});

test("Testnet processes its own explicitly-tagged rows", () => {
  assert.equal(isPofRowInScope("arc-testnet", "arc-testnet"), true);
});

test("Testnet never processes an explicit Mainnet row, even transitionally", () => {
  assert.equal(isPofRowInScope("arc-mainnet", "arc-testnet"), false);
});

test("isPofRowInScope fails closed on an unsupported/missing currentNetwork — a PoF job can never silently run unscoped", () => {
  assert.throws(() => isPofRowInScope("arc-testnet", "bogus-network"), NetworkConfigError);
  assert.throws(() => isPofRowInScope("arc-testnet", undefined), NetworkConfigError);
  assert.throws(() => isPofRowInScope("arc-testnet", ""), NetworkConfigError);
});

test("pofNetworkFilterClause: mainnet is a strict equality filter (no OR-null transitional allowance)", () => {
  const clause = pofNetworkFilterClause("network", "arc-mainnet");
  assert.deepEqual(clause, { mode: "eq", column: "network", value: "arc-mainnet" });
});

test("pofNetworkFilterClause: testnet is an OR filter accepting its own tag or a null/missing tag", () => {
  const clause = pofNetworkFilterClause("network", "arc-testnet");
  assert.deepEqual(clause, { mode: "or", filter: "network.eq.arc-testnet,network.is.null" });
});

test("pofNetworkFilterClause supports a JSON-path column reference (users.data.intent.network)", () => {
  const clause = pofNetworkFilterClause("data->intent->>network", "arc-mainnet");
  assert.deepEqual(clause, { mode: "eq", column: "data->intent->>network", value: "arc-mainnet" });
  const testnetClause = pofNetworkFilterClause("data->intent->>network", "arc-testnet");
  assert.deepEqual(testnetClause, { mode: "or", filter: "data->intent->>network.eq.arc-testnet,data->intent->>network.is.null" });
});

test("pofNetworkFilterClause fails closed on an unsupported/missing currentNetwork", () => {
  assert.throws(() => pofNetworkFilterClause("network", "bogus-network"), NetworkConfigError);
  assert.throws(() => pofNetworkFilterClause("network", undefined), NetworkConfigError);
});

// ─── assertSupportedNetwork (TASK 10I) ──────────────────────────────────────
// Backs applyStrictNetworkScope() in server-arc.js — the strict, non-
// transitional scoping used by every public marketplace read/precondition
// route on `listings` (GET /api/listings, /api/listings/:id,
// /api/listings/owner/:addr, and every owner-mutation precondition), closing
// TASK 10H's finding that these queries carried no network filter at all.

test("assertSupportedNetwork passes for both real networks", () => {
  assert.doesNotThrow(() => assertSupportedNetwork("arc-testnet"));
  assert.doesNotThrow(() => assertSupportedNetwork("arc-mainnet"));
});

test("assertSupportedNetwork fails closed on missing/unsupported network", () => {
  assert.throws(() => assertSupportedNetwork(undefined), NetworkConfigError);
  assert.throws(() => assertSupportedNetwork(""), NetworkConfigError);
  assert.throws(() => assertSupportedNetwork(null), NetworkConfigError);
  assert.throws(() => assertSupportedNetwork("arc-invalid"), NetworkConfigError);
});

test("pofNetworkFilterClause's testnet OR-filter string never lets a client forge scope by supplying a literal that resembles the filter DSL — the network value itself is always the fixed EXPECTED_CHAIN_IDS key, never interpolated from request input", () => {
  // This is a documentation-style assertion: pofNetworkFilterClause only
  // ever receives `currentNetwork` from server-arc.js's own NETWORK env
  // const (resolved once at startup, fail-closed) — never from a request
  // body. The two valid values are exactly EXPECTED_CHAIN_IDS's keys.
  for (const network of Object.keys(EXPECTED_CHAIN_IDS)) {
    assert.doesNotThrow(() => pofNetworkFilterClause("network", network));
  }
});
