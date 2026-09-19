// domain-config.test.js — behavioral tests for TASK 10P's network-aware
// hostname resolution (APP_BASE_URL, CORS origins, WebAuthn related-origins,
// fly.dev → branded-domain redirect).
//
// Root cause (TASK 10O audit): server-arc.js used to hardcode
// "https://my.pi2pi.io" / "pi2pi-project.fly.dev" directly, correct only by
// coincidence because my.pi2pi.io happened to already point at that exact
// app. These tests directly reproduce both the Testnet and Mainnet
// scenarios against the real functions server-arc.js now calls.

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAppBaseUrl,
  resolveFlyHostnameUrl,
  resolveAllowedOrigins,
  resolveWebauthnOrigins,
  resolveFlyRedirectTarget,
} from "./domain-config.js";

// ─── resolveAppBaseUrl ──────────────────────────────────────────────────────

test("Testnet: explicit APP_BASE_URL is used as-is", () => {
  const url = resolveAppBaseUrl({ envAppBaseUrl: "https://testnet.pi2pi.io", flyAppName: "pi2pi-project", port: 3001 });
  assert.equal(url, "https://testnet.pi2pi.io");
});

test("Mainnet: explicit APP_BASE_URL is used as-is", () => {
  const url = resolveAppBaseUrl({ envAppBaseUrl: "https://my.pi2pi.io", flyAppName: "pi2pi-mainnet", port: 3001 });
  assert.equal(url, "https://my.pi2pi.io");
});

test("(TASK 10P repro) fails closed under Fly with no APP_BASE_URL set — never silently defaults to either network's domain", () => {
  assert.throws(
    () => resolveAppBaseUrl({ envAppBaseUrl: undefined, flyAppName: "pi2pi-project", port: 3001 }),
    /APP_BASE_URL must be set explicitly/
  );
  assert.throws(
    () => resolveAppBaseUrl({ envAppBaseUrl: "", flyAppName: "pi2pi-mainnet", port: 3001 }),
    /APP_BASE_URL must be set explicitly/
  );
});

test("local dev (no FLY_APP_NAME): falls back to a safe, non-branded localhost URL, never throws", () => {
  const url = resolveAppBaseUrl({ envAppBaseUrl: undefined, flyAppName: null, port: 3001 });
  assert.equal(url, "http://localhost:3001");
  assert.doesNotMatch(url, /pi2pi\.io/);
});

// ─── resolveFlyHostnameUrl ──────────────────────────────────────────────────

test("Testnet: Fly hostname derives from FLY_APP_NAME, never hardcoded", () => {
  assert.equal(resolveFlyHostnameUrl("pi2pi-project"), "https://pi2pi-project.fly.dev");
});

test("Mainnet: Fly hostname derives from FLY_APP_NAME, never hardcoded", () => {
  assert.equal(resolveFlyHostnameUrl("pi2pi-mainnet"), "https://pi2pi-mainnet.fly.dev");
});

test("local dev: null when FLY_APP_NAME is absent", () => {
  assert.equal(resolveFlyHostnameUrl(null), null);
});

// ─── resolveAllowedOrigins (CORS) ───────────────────────────────────────────

test("(TASK 10P repro) Testnet allowed origins contain testnet.pi2pi.io + pi2pi-project.fly.dev + local dev, and NEVER my.pi2pi.io/pi2pi-mainnet.fly.dev", () => {
  const origins = resolveAllowedOrigins({ appBaseUrl: "https://testnet.pi2pi.io", flyHostnameUrl: "https://pi2pi-project.fly.dev" });
  assert.deepEqual(origins, ["https://testnet.pi2pi.io", "https://pi2pi-project.fly.dev", "http://localhost:5173", "http://localhost:3001"]);
  assert.ok(!origins.includes("https://my.pi2pi.io"), "Testnet must never accept the Mainnet branded origin");
  assert.ok(!origins.includes("https://pi2pi-mainnet.fly.dev"), "Testnet must never accept the Mainnet fly.dev origin");
});

test("(TASK 10P repro) Mainnet allowed origins contain my.pi2pi.io + pi2pi-mainnet.fly.dev + local dev, and NEVER testnet.pi2pi.io/pi2pi-project.fly.dev", () => {
  const origins = resolveAllowedOrigins({ appBaseUrl: "https://my.pi2pi.io", flyHostnameUrl: "https://pi2pi-mainnet.fly.dev" });
  assert.deepEqual(origins, ["https://my.pi2pi.io", "https://pi2pi-mainnet.fly.dev", "http://localhost:5173", "http://localhost:3001"]);
  assert.ok(!origins.includes("https://testnet.pi2pi.io"), "Mainnet must never accept the Testnet branded origin");
  assert.ok(!origins.includes("https://pi2pi-project.fly.dev"), "Mainnet must never accept the Testnet fly.dev origin");
});

test("local dev: flyHostnameUrl null is dropped, not included as a literal null entry", () => {
  const origins = resolveAllowedOrigins({ appBaseUrl: "http://localhost:3001", flyHostnameUrl: null });
  assert.deepEqual(origins, ["http://localhost:3001", "http://localhost:5173", "http://localhost:3001"]);
  assert.ok(!origins.includes(null));
});

// ─── resolveWebauthnOrigins ──────────────────────────────────────────────────

test("(TASK 10P repro) Testnet WebAuthn origins are exactly testnet.pi2pi.io + pi2pi-project.fly.dev — no localhost, no Mainnet domain", () => {
  const origins = resolveWebauthnOrigins({ appBaseUrl: "https://testnet.pi2pi.io", flyHostnameUrl: "https://pi2pi-project.fly.dev" });
  assert.deepEqual(origins, ["https://testnet.pi2pi.io", "https://pi2pi-project.fly.dev"]);
});

test("(TASK 10P repro) Mainnet WebAuthn origins are exactly my.pi2pi.io + pi2pi-mainnet.fly.dev — no localhost, no Testnet domain", () => {
  const origins = resolveWebauthnOrigins({ appBaseUrl: "https://my.pi2pi.io", flyHostnameUrl: "https://pi2pi-mainnet.fly.dev" });
  assert.deepEqual(origins, ["https://my.pi2pi.io", "https://pi2pi-mainnet.fly.dev"]);
});

// ─── resolveFlyRedirectTarget ────────────────────────────────────────────────

test("(TASK 10P repro) Testnet: pi2pi-project.fly.dev redirects to testnet.pi2pi.io, not my.pi2pi.io", () => {
  const target = resolveFlyRedirectTarget({
    host: "pi2pi-project.fly.dev",
    flyHostnameUrl: "https://pi2pi-project.fly.dev",
    appBaseUrl: "https://testnet.pi2pi.io",
    requestUrl: "/",
  });
  assert.equal(target, "https://testnet.pi2pi.io/");
});

test("(TASK 10P repro) Mainnet: pi2pi-mainnet.fly.dev redirects to my.pi2pi.io", () => {
  const target = resolveFlyRedirectTarget({
    host: "pi2pi-mainnet.fly.dev",
    flyHostnameUrl: "https://pi2pi-mainnet.fly.dev",
    appBaseUrl: "https://my.pi2pi.io",
    requestUrl: "/",
  });
  assert.equal(target, "https://my.pi2pi.io/");
});

test("path and query string are preserved through the redirect", () => {
  const target = resolveFlyRedirectTarget({
    host: "pi2pi-project.fly.dev",
    flyHostnameUrl: "https://pi2pi-project.fly.dev",
    appBaseUrl: "https://testnet.pi2pi.io",
    requestUrl: "/api/listings?status=active&district=Vake",
  });
  assert.equal(target, "https://testnet.pi2pi.io/api/listings?status=active&district=Vake");
});

test("host header is matched case-insensitively", () => {
  const target = resolveFlyRedirectTarget({
    host: "PI2PI-PROJECT.FLY.DEV",
    flyHostnameUrl: "https://pi2pi-project.fly.dev",
    appBaseUrl: "https://testnet.pi2pi.io",
    requestUrl: "/",
  });
  assert.equal(target, "https://testnet.pi2pi.io/");
});

test("no redirect for a request already on the branded domain", () => {
  const target = resolveFlyRedirectTarget({
    host: "testnet.pi2pi.io",
    flyHostnameUrl: "https://pi2pi-project.fly.dev",
    appBaseUrl: "https://testnet.pi2pi.io",
    requestUrl: "/",
  });
  assert.equal(target, null);
});

test("no redirect for an unrelated host", () => {
  const target = resolveFlyRedirectTarget({
    host: "evil.example.com",
    flyHostnameUrl: "https://pi2pi-project.fly.dev",
    appBaseUrl: "https://testnet.pi2pi.io",
    requestUrl: "/",
  });
  assert.equal(target, null);
});

test("no redirect at all in local dev (flyHostnameUrl null) — never fires there", () => {
  const target = resolveFlyRedirectTarget({
    host: "localhost:3001",
    flyHostnameUrl: null,
    appBaseUrl: "http://localhost:3001",
    requestUrl: "/",
  });
  assert.equal(target, null);
});

test("(no redirect loop) appBaseUrl's host is never equal to flyHostnameUrl's host in any real config, so a redirect can never point back at itself", () => {
  const configs = [
    { appBaseUrl: "https://testnet.pi2pi.io", flyHostnameUrl: "https://pi2pi-project.fly.dev" },
    { appBaseUrl: "https://my.pi2pi.io", flyHostnameUrl: "https://pi2pi-mainnet.fly.dev" },
  ];
  for (const { appBaseUrl, flyHostnameUrl } of configs) {
    assert.notEqual(new URL(appBaseUrl).host, new URL(flyHostnameUrl).host);
    // And even if redirected to, appBaseUrl's own host would never re-trigger the guard:
    const target = resolveFlyRedirectTarget({ host: new URL(appBaseUrl).host, flyHostnameUrl, appBaseUrl, requestUrl: "/" });
    assert.equal(target, null, "a request already on the branded domain must never be redirected again");
  }
});
