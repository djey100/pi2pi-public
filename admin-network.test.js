// admin-network.test.js — verifies admin_routes.js's network-aware,
// fail-closed initialization (TASK 8B).
//
// admin_routes.js no longer resolves its own RPC/contract addresses — it is
// initialized once by server-arc.js via initAdminNetwork(), using the exact
// values resolveContractAddresses() already produced (same manifest, same
// NETWORK env var, same fail-closed rules — see network-config.test.js for
// exhaustive coverage of that resolver itself). These tests focus on what's
// new here: initAdminNetwork's own validation, the fail-closed guard in
// handleAdmin() before initialization, and the end-to-end wiring for both
// real networks — not re-testing resolveContractAddresses' internal logic.
//
// Order matters within this file: admin_routes.js holds its resolved
// RPC/address values in module-level state, set once by initAdminNetwork().
// The "not yet initialized" tests MUST run before any successful
// initAdminNetwork() call in this process.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { resolveExpectedChainId, resolveContractAddresses, NetworkConfigError, ContractAddressError } from "./network-config.js";

// admin_routes.js reads ADMIN_SESSION_SECRET at module-evaluation time (it's
// unrelated to network config, just a prerequisite for handleAdmin() to get
// past its own "server misconfigured" check and reach the guard/auth logic
// these tests exercise). Static ESM imports are hoisted ahead of any of this
// file's own statements, so the env var must be set before a dynamic import
// triggers evaluation — a plain top-level `import` would run too late.
process.env.ADMIN_SESSION_SECRET ||= "test-only-admin-session-secret-never-used-in-production";
const { handleAdmin, initAdminNetwork } = await import("./admin_routes.js");

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DEPLOYMENTS = JSON.parse(readFileSync(join(__dirname, "config", "deployments.json"), "utf8"));

function fakeRes() {
  const res = { statusCode: null, headers: null, body: null };
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; };
  res.end = (body) => { res.body = body; };
  return res;
}
function fakeReq(overrides = {}) {
  return { headers: {}, method: "GET", url: "/api/admin/me", socket: { remoteAddress: "127.0.0.1" }, ...overrides };
}

test("handleAdmin fails closed with 500 before initAdminNetwork has ever been called", async () => {
  const res = fakeRes();
  // handleAdmin returns undefined on every early-error `return json(...)` path
  // (pre-existing convention — see the ADMIN_SESSION_SECRET check just below
  // this guard for the same pattern), so this only asserts on the response.
  await handleAdmin(fakeReq(), res, {}, "/api/admin/me");
  assert.equal(res.statusCode, 500);
  assert.match(JSON.parse(res.body).error, /admin network not initialized/);
});

test("initAdminNetwork throws when rpc is missing", () => {
  assert.throws(
    () => initAdminNetwork({ rentalEscrow: "0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8", propDepEscrow: "0xe2190997F3811B771C25525C8401504a0e5330c5" }),
    /rpc is required/
  );
});

test("initAdminNetwork throws when rentalEscrow is malformed", () => {
  assert.throws(
    () => initAdminNetwork({ rpc: "https://rpc.testnet.arc.network", rentalEscrow: "not-an-address", propDepEscrow: "0xe2190997F3811B771C25525C8401504a0e5330c5" }),
    /rentalEscrow is not a valid/
  );
});

test("initAdminNetwork throws when propDepEscrow is the zero address", () => {
  assert.throws(
    () => initAdminNetwork({ rpc: "https://rpc.testnet.arc.network", rentalEscrow: "0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8", propDepEscrow: "0x0000000000000000000000000000000000000000" }),
    /propDepEscrow is not a valid/
  );
});

test("initAdminNetwork throws when chainId is missing", () => {
  assert.throws(
    () => initAdminNetwork({ rpc: "https://rpc.testnet.arc.network", rentalEscrow: "0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8", propDepEscrow: "0xe2190997F3811B771C25525C8401504a0e5330c5" }),
    /chainId must be a positive integer/
  );
});

test("initAdminNetwork throws when chainId is not a positive integer", () => {
  for (const bad of [0, -5042002, 5042002.5, "5042002", null]) {
    assert.throws(
      () => initAdminNetwork({ rpc: "https://rpc.testnet.arc.network", rentalEscrow: "0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8", propDepEscrow: "0xe2190997F3811B771C25525C8401504a0e5330c5", chainId: bad }),
      /chainId must be a positive integer/,
      `expected throw for chainId=${JSON.stringify(bad)}`
    );
  }
});

test("initAdminNetwork throws when network is missing (TASK 10I)", () => {
  assert.throws(
    () => initAdminNetwork({ rpc: "https://rpc.testnet.arc.network", rentalEscrow: "0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8", propDepEscrow: "0xe2190997F3811B771C25525C8401504a0e5330c5", chainId: 5042002 }),
    NetworkConfigError
  );
});

test("initAdminNetwork throws when network is unsupported (TASK 10I)", () => {
  assert.throws(
    () => initAdminNetwork({ rpc: "https://rpc.testnet.arc.network", rentalEscrow: "0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8", propDepEscrow: "0xe2190997F3811B771C25525C8401504a0e5330c5", chainId: 5042002, network: "arc-invalid" }),
    NetworkConfigError
  );
});

test("failed initAdminNetwork calls above must not have mutated state — guard still active", async () => {
  const res = fakeRes();
  await handleAdmin(fakeReq(), res, {}, "/api/admin/me");
  assert.equal(res.statusCode, 500, "a throw during validation must not partially initialize ARC_RPC/RENTAL_ESCROW/PROPDEP_ESCROW");
});

test("arc-testnet: resolves the real 5042002 manifest pair end-to-end and unblocks handleAdmin", async () => {
  const expectedChainId = resolveExpectedChainId("arc-testnet");
  assert.equal(expectedChainId, 5042002);
  const { rentalEscrow, propDepEscrow } = resolveContractAddresses("arc-testnet", {
    deployments: DEPLOYMENTS,
    expectedChainId,
  });
  assert.equal(rentalEscrow.toLowerCase(), DEPLOYMENTS["5042002"].active.RentalEscrow.address.toLowerCase());
  assert.equal(propDepEscrow.toLowerCase(), DEPLOYMENTS["5042002"].active.PropDepEscrow.address.toLowerCase());

  initAdminNetwork({ rpc: "https://rpc.testnet.arc.network", rentalEscrow, propDepEscrow, chainId: expectedChainId, network: "arc-testnet" });

  // Unauthenticated request now reaches the normal auth check (401), not the
  // "not initialized" guard (500) — proves existing route behavior
  // (auth-then-dispatch) is unchanged under testnet config.
  const res = fakeRes();
  await handleAdmin(fakeReq(), res, {}, "/api/admin/me");
  assert.equal(res.statusCode, 401);
});

test("arc-mainnet: resolves the real 5042 manifest pair end-to-end, distinct from the 5042002 pair", async () => {
  const expectedChainId = resolveExpectedChainId("arc-mainnet");
  assert.equal(expectedChainId, 5042);
  const { rentalEscrow, propDepEscrow } = resolveContractAddresses("arc-mainnet", {
    deployments: DEPLOYMENTS,
    expectedChainId,
  });
  assert.equal(rentalEscrow.toLowerCase(), DEPLOYMENTS["5042"].active.RentalEscrow.address.toLowerCase());
  assert.equal(propDepEscrow.toLowerCase(), DEPLOYMENTS["5042"].active.PropDepEscrow.address.toLowerCase());

  // Regression guard for the exact bug TASK 8A found: mainnet must never
  // resolve to the testnet active pair.
  assert.notEqual(rentalEscrow.toLowerCase(), DEPLOYMENTS["5042002"].active.RentalEscrow.address.toLowerCase());
  assert.notEqual(propDepEscrow.toLowerCase(), DEPLOYMENTS["5042002"].active.PropDepEscrow.address.toLowerCase());

  initAdminNetwork({ rpc: "https://rpc.mainnet.arc.io", rentalEscrow, propDepEscrow, chainId: expectedChainId, network: "arc-mainnet" });

  const res = fakeRes();
  await handleAdmin(fakeReq(), res, {}, "/api/admin/me");
  assert.equal(res.statusCode, 401);
});

test("unknown NETWORK fails closed before any resolution is attempted", () => {
  assert.throws(() => resolveExpectedChainId("arc-invalid"), NetworkConfigError);
});

test("missing manifest entry fails closed with no env override", () => {
  const deploymentsWithoutMainnet = { "5042002": DEPLOYMENTS["5042002"] };
  assert.throws(
    () => resolveContractAddresses("arc-mainnet", { deployments: deploymentsWithoutMainnet, expectedChainId: 5042 }),
    ContractAddressError
  );
});
