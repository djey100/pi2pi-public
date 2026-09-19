// auth-network.test.js — verifies auth.js's network-aware, fail-closed
// initialization (TASK 10C-REVISION).
//
// Previously auth.js hardcoded ARC_CHAIN_ID = 5042002 directly into the
// signed SIWE-style sign-in message ("Chain ID: 5042002") regardless of
// which network the backend was actually configured for — on an Arc
// Mainnet deployment, users would be asked to sign a message falsely
// claiming the Testnet chainId. It also had its own independent
// `process.env.RPC_URL || "https://rpc.testnet.arc.network"` fallback, a
// second network-configuration source distinct from server-arc.js's own
// fail-closed RPC_URL resolution. initAuthNetwork() (mirroring TASK 8B's
// initAdminNetwork() pattern) replaces both with values injected once by
// server-arc.js, using the exact same resolveExpectedChainId()/RPC_URL it
// already resolved for itself.

import test from "node:test";
import assert from "node:assert/strict";

// auth.js reads ADMIN_SESSION_SECRET at module-evaluation time (unrelated
// to network config — just avoids the noisy "not set" console.warn during
// tests). Static ESM imports are hoisted ahead of this file's own
// statements, so the env var must be set before a dynamic import triggers
// evaluation.
process.env.ADMIN_SESSION_SECRET ||= "test-only-admin-session-secret-never-used-in-production";
const { handleAuthRoutes, initAuthNetwork } = await import("./auth.js");

function fakeRes() {
  const res = { statusCode: null, headers: null, body: null, setHeaderCalls: [] };
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; };
  res.end = (body) => { res.body = body; };
  // logout/session routes call res.setHeader(...) directly (setSessionCookie /
  // clearSessionCookie), separately from the json() helper's writeHead.
  res.setHeader = (name, value) => { res.setHeaderCalls.push([name, value]); };
  return res;
}
const json = (res, data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
const readBody = async () => null;

function extractChainIdClaim(message) {
  const m = message.match(/Chain ID: (\d+)/);
  return m ? m[1] : null;
}

async function requestNonce(addr = "0x497924669F8aeA089E399639D254cB2c708c267A") {
  const res = fakeRes();
  // auth.js's nonce route reads the query string from req.url (via `new
  // URL(req.url, ...)`), separately from the routing `path` argument, which
  // server-arc.js always passes as the bare pathname (url.pathname) — see
  // server-arc.js:750/756.
  const req = { method: "GET", headers: {}, url: `/api/auth/nonce?addr=${addr}` };
  await handleAuthRoutes(req, res, "/api/auth/nonce", json, readBody);
  return res;
}

test("handleAuthRoutes fails closed with 500 before initAuthNetwork has ever been called", async () => {
  const res = await requestNonce();
  assert.equal(res.statusCode, 500);
  assert.match(JSON.parse(res.body).error, /auth network not initialized/);
});

test("initAuthNetwork throws when expectedChainId is missing", () => {
  assert.throws(
    () => initAuthNetwork({ rpcUrl: "https://rpc.testnet.arc.network" }),
    /expectedChainId must be a positive integer/
  );
});

test("initAuthNetwork throws when expectedChainId is not a positive integer", () => {
  for (const bad of [0, -5042002, 5042002.5, "5042002", null]) {
    assert.throws(
      () => initAuthNetwork({ expectedChainId: bad, rpcUrl: "https://rpc.testnet.arc.network" }),
      /expectedChainId must be a positive integer/,
      `expected throw for expectedChainId=${JSON.stringify(bad)}`
    );
  }
});

test("initAuthNetwork throws when rpcUrl is missing", () => {
  assert.throws(
    () => initAuthNetwork({ expectedChainId: 5042002 }),
    /rpcUrl is required/
  );
});

test("failed initAuthNetwork calls above must not have mutated state — guard still active", async () => {
  const res = await requestNonce();
  assert.equal(res.statusCode, 500, "a throw during validation must not partially initialize EXPECTED_CHAIN_ID/RPC_URL");
});

test("Testnet: nonce message's Chain ID claim is exactly 5042002, never 5042", async () => {
  initAuthNetwork({ expectedChainId: 5042002, rpcUrl: "https://rpc.testnet.arc.network" });
  const res = await requestNonce();
  assert.equal(res.statusCode, 200);
  const { message } = JSON.parse(res.body);
  const claim = extractChainIdClaim(message);
  assert.equal(claim, "5042002");
  assert.notEqual(claim, "5042");
});

test("Mainnet: nonce message's Chain ID claim is exactly 5042, never 5042002", async () => {
  initAuthNetwork({ expectedChainId: 5042, rpcUrl: "https://rpc.mainnet.arc.io" });
  const res = await requestNonce();
  assert.equal(res.statusCode, 200);
  const { message } = JSON.parse(res.body);
  const claim = extractChainIdClaim(message);
  assert.equal(claim, "5042");
  assert.notEqual(claim, "5042002");
});

test("existing nonce/message shape is otherwise unchanged: includes Address, Nonce, Issued At, and the returned nonce matches", async () => {
  initAuthNetwork({ expectedChainId: 5042002, rpcUrl: "https://rpc.testnet.arc.network" });
  const addr = "0x497924669F8aeA089E399639D254cB2c708c267A";
  const res = await requestNonce(addr);
  assert.equal(res.statusCode, 200);
  const { message, nonce } = JSON.parse(res.body);
  assert.match(message, /^pi2pi\.io wants you to sign in with your wallet\.\n\n/);
  assert.match(message, new RegExp(`Address: ${addr}`));
  assert.match(message, /Nonce: [0-9a-f]{32}/);
  assert.match(message, /Issued At: /);
  assert.ok(message.includes(nonce), "the returned nonce must appear in the message (verified server-side on /api/auth/verify)");
});

test("logout/session routes are unaffected by network initialization (no auth-network guard on non-/api/auth/ paths, and these routes don't need chainId at all)", async () => {
  initAuthNetwork({ expectedChainId: 5042002, rpcUrl: "https://rpc.testnet.arc.network" });
  const sessionRes = fakeRes();
  await handleAuthRoutes({ method: "GET", headers: {} }, sessionRes, "/api/auth/session", json, readBody);
  assert.equal(sessionRes.statusCode, 200);
  assert.deepEqual(JSON.parse(sessionRes.body), { authenticated: false });

  const logoutRes = fakeRes();
  await handleAuthRoutes({ method: "POST", headers: {} }, logoutRes, "/api/auth/logout", json, readBody);
  assert.equal(logoutRes.statusCode, 200);
});

test("unrelated paths are still reported as unhandled (false), unaffected by the new guard", async () => {
  initAuthNetwork({ expectedChainId: 5042002, rpcUrl: "https://rpc.testnet.arc.network" });
  const res = fakeRes();
  const handled = await handleAuthRoutes({ method: "GET", headers: {} }, res, "/api/not-auth-at-all", json, readBody);
  assert.equal(handled, false);
});
