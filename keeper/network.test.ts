import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NETWORKS,
  NetworkConfigError,
  NetworkMismatchError,
  ContractAddressError,
  DryRunConfigError,
  resolveExpectedChainId,
  assertChainMatch,
  resolveMemoAddress,
  assertContractAddressesForNetwork,
  isValidNonZeroAddress,
  parseDryRun,
} from "./network.js";

test("arc-testnet config resolves correctly", () => {
  assert.equal(resolveExpectedChainId("arc-testnet"), 5042002);
});

test("arc-mainnet config resolves correctly where the chainId is known", () => {
  assert.equal(resolveExpectedChainId("arc-mainnet"), 5042);
});

test("unsupported network name fails closed", () => {
  assert.throws(() => resolveExpectedChainId("arbitrum-sepolia"), NetworkConfigError);
  assert.throws(() => resolveExpectedChainId("mainnet"), NetworkConfigError);
  assert.throws(() => resolveExpectedChainId(""), NetworkConfigError);
});

test("RPC chainId matching the configured network passes silently", () => {
  assert.doesNotThrow(() => assertChainMatch("arc-testnet", 5042002, 5042002));
  assert.doesNotThrow(() => assertChainMatch("arc-mainnet", 5042, 5042));
});

test("RPC chainId mismatch throws NetworkMismatchError (keeper must not scan or write)", () => {
  // Exact scenario from the task: configured expected=5042 (mainnet), RPC reports 5042002 (testnet).
  assert.throws(() => assertChainMatch("arc-mainnet", 5042, 5042002), NetworkMismatchError);
});

test("testnet contract/network identity cannot silently become the mainnet default", () => {
  // Regression guard: arc-testnet and arc-mainnet must never resolve to the same chainId,
  // and neither may be produced as a "default" for the other.
  assert.notEqual(NETWORKS["arc-testnet"], NETWORKS["arc-mainnet"]);
  assert.throws(() => assertChainMatch("arc-testnet", NETWORKS["arc-testnet"], NETWORKS["arc-mainnet"]), NetworkMismatchError);
});

test("Memo: testnet has a verified address", () => {
  assert.equal(resolveMemoAddress("arc-testnet"), "0x5294E9927c3306DcBaDb03fe70b92e01cCede505");
});

test("Memo: mainnet must NOT silently reuse the testnet address (none verified yet)", () => {
  assert.equal(resolveMemoAddress("arc-mainnet"), null);
});

test("Memo: unknown network also gets no address", () => {
  assert.equal(resolveMemoAddress("bogus"), null);
});

// ─── assertContractAddressesForNetwork ─────────────────────────────────────
// Every generation recorded in config/deployments.json's "5042002" entry, so
// the deny-list test coverage tracks the deny-list content itself (see the
// "must stay in sync" comment on KNOWN_ARC_TESTNET_CONTRACTS in network.ts).
const TESTNET_ESCROW = "0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8"; // active
const TESTNET_PROPDEP = "0xe2190997F3811B771C25525C8401504a0e5330c5"; // active
const TESTNET_ESCROW_HISTORICAL = "0x11184188c24ce546912617156c0693868a98b2a3"; // historicalIntermediate
const TESTNET_PROPDEP_HISTORICAL = "0xfe7b14a5313e93d8e22c7c4edc62431eca0f0880"; // historicalIntermediate
const TESTNET_LEGACY_PAIRS: Array<{ label: string; rentalEscrow: string; propDepEscrow: string }> = [
  { label: "legacy[0] 2026-06-12 pair", rentalEscrow: "0x6cbF4d958dA24b7AdC98Fb7633213Ac26b5a6f3a", propDepEscrow: "0x7428B32B61Ee0678c6e3706cB7d5aa4Ece818082" },
  { label: "legacy[1] pre-audit pair", rentalEscrow: "0xEaC111678149818168dd8499882A234e2019A802", propDepEscrow: "0x9d9047E307FeFc1494e80A81E25A67653F6E96f7" },
  { label: "legacy[2] undocumented deployment (TASK 9F)", rentalEscrow: "0xC7791a029384D03B0CCD4fF03FB283575E7F0D8f", propDepEscrow: "0x0B6d95a9cD6d5F0C298703F2D7fa140d4C329CF5" },
];
// Syntactically valid fixture addresses that are NOT any known testnet
// address — used only to prove the configuration-level check can pass for
// arc-mainnet; this is not a claim that either is a genuine Pi2pi Mainnet
// contract.
const MAINNET_FIXTURE_ESCROW = "0x111111111111111111111111111111111111111a";
const MAINNET_FIXTURE_PROPDEP = "0x222222222222222222222222222222222222222b";

test("valid current active testnet addresses accepted for arc-testnet (existing deployed keeper behavior preserved)", () => {
  assert.doesNotThrow(() => assertContractAddressesForNetwork("arc-testnet", TESTNET_ESCROW, TESTNET_PROPDEP));
});

test("all historical/legacy testnet address generations remain valid syntactic inputs for arc-testnet", () => {
  assert.doesNotThrow(() => assertContractAddressesForNetwork("arc-testnet", TESTNET_ESCROW_HISTORICAL, TESTNET_PROPDEP_HISTORICAL));
  for (const { rentalEscrow, propDepEscrow } of TESTNET_LEGACY_PAIRS) {
    assert.doesNotThrow(() => assertContractAddressesForNetwork("arc-testnet", rentalEscrow, propDepEscrow));
  }
});

test("malformed address rejected", () => {
  assert.throws(() => assertContractAddressesForNetwork("arc-testnet", "not-an-address", TESTNET_PROPDEP), ContractAddressError);
  assert.throws(() => assertContractAddressesForNetwork("arc-testnet", TESTNET_ESCROW, "0x333"), ContractAddressError);
});

test("zero address rejected", () => {
  assert.throws(
    () => assertContractAddressesForNetwork("arc-testnet", "0x0000000000000000000000000000000000000000", TESTNET_PROPDEP),
    ContractAddressError,
  );
});

test("current active Arc Testnet RentalEscrow rejected on arc-mainnet", () => {
  assert.throws(
    () => assertContractAddressesForNetwork("arc-mainnet", TESTNET_ESCROW, MAINNET_FIXTURE_PROPDEP),
    ContractAddressError,
  );
});

test("current active Arc Testnet PropDepEscrow rejected on arc-mainnet", () => {
  assert.throws(
    () => assertContractAddressesForNetwork("arc-mainnet", MAINNET_FIXTURE_ESCROW, TESTNET_PROPDEP),
    ContractAddressError,
  );
});

test("historical/intermediate Arc Testnet RentalEscrow rejected on arc-mainnet", () => {
  assert.throws(
    () => assertContractAddressesForNetwork("arc-mainnet", TESTNET_ESCROW_HISTORICAL, MAINNET_FIXTURE_PROPDEP),
    ContractAddressError,
  );
});

test("historical/intermediate Arc Testnet PropDepEscrow rejected on arc-mainnet", () => {
  assert.throws(
    () => assertContractAddressesForNetwork("arc-mainnet", MAINNET_FIXTURE_ESCROW, TESTNET_PROPDEP_HISTORICAL),
    ContractAddressError,
  );
});

test("every legacy Arc Testnet RentalEscrow/PropDepEscrow address recorded in the manifest is rejected on arc-mainnet", () => {
  for (const { label, rentalEscrow, propDepEscrow } of TESTNET_LEGACY_PAIRS) {
    assert.throws(
      () => assertContractAddressesForNetwork("arc-mainnet", rentalEscrow, MAINNET_FIXTURE_PROPDEP),
      ContractAddressError,
      `${label}: RentalEscrow should be rejected on arc-mainnet`,
    );
    assert.throws(
      () => assertContractAddressesForNetwork("arc-mainnet", MAINNET_FIXTURE_ESCROW, propDepEscrow),
      ContractAddressError,
      `${label}: PropDepEscrow should be rejected on arc-mainnet`,
    );
  }
});

test("arc-mainnet + two syntactically valid non-testnet fixture addresses passes this configuration-level check", () => {
  // This intentionally does NOT verify these are genuine deployed Pi2pi
  // Mainnet contracts — no mainnet deployment exists yet. It only proves the
  // check isn't an accidental testnet-only allowlist: it rejects known
  // cross-network reuse, not "anything that isn't an exact known testnet address."
  assert.doesNotThrow(() => assertContractAddressesForNetwork("arc-mainnet", MAINNET_FIXTURE_ESCROW, MAINNET_FIXTURE_PROPDEP));
});

test("chain mismatch behavior remains unchanged by this addition", () => {
  assert.throws(() => assertChainMatch("arc-mainnet", 5042, 5042002), NetworkMismatchError);
  assert.doesNotThrow(() => assertChainMatch("arc-testnet", 5042002, 5042002));
});

test("isValidNonZeroAddress sanity checks", () => {
  assert.equal(isValidNonZeroAddress(TESTNET_ESCROW), true);
  assert.equal(isValidNonZeroAddress("0x0000000000000000000000000000000000000000"), false);
  assert.equal(isValidNonZeroAddress("not-an-address"), false);
});

// ─── parseDryRun (TASK 10A) ─────────────────────────────────────────────────
// Regression suite for the exact fail-open bug this task fixes: previously
// `process.env.DRY_RUN === "true"` silently meant "anything except the exact
// string true enables real writes" — including a missing/unset env var. This
// is the guarantee an Arc Mainnet keeper's very first deployment depends on.

test("parseDryRun('true') returns true (dry run, no writes)", () => {
  assert.equal(parseDryRun("true"), true);
});

test("parseDryRun('false') returns false (writes enabled) — requires the explicit, exact opt-out", () => {
  assert.equal(parseDryRun("false"), false);
});

test("parseDryRun fails closed (throws, never defaults to writes-enabled) when DRY_RUN is missing", () => {
  assert.throws(() => parseDryRun(undefined), DryRunConfigError);
});

test("parseDryRun fails closed on every malformed/mistyped value — regression guard for the exact old fail-open bug", () => {
  for (const bad of ["", "TRUE", "True", "1", "yes", "false ", " true", "0", "null"]) {
    assert.throws(
      () => parseDryRun(bad),
      DryRunConfigError,
      `parseDryRun(${JSON.stringify(bad)}) must throw, not silently enable writes`
    );
  }
});

test("a Mainnet keeper's first config (DRY_RUN=true, explicit) never accidentally enables writes", () => {
  // Simulates the exact recommended first-deployment Mainnet keeper env.
  assert.equal(parseDryRun("true"), true);
});
