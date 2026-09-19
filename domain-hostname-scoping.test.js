// domain-hostname-scoping.test.js — structural verification that
// server-arc.js, telegram-notify.js, auth.js, both Fly configs, and the
// Dockerfile actually wire in TASK 10P's network-aware hostname behavior.
//
// The pure decision logic (resolveAppBaseUrl/resolveFlyHostnameUrl/
// resolveAllowedOrigins/resolveWebauthnOrigins/resolveFlyRedirectTarget) is
// covered behaviorally in domain-config.test.js. server-arc.js is a
// side-effecting script (mandatory env vars, process.exit on
// misconfiguration, live Supabase client construction, server.listen()) —
// it cannot be imported directly in a unit test, so this file verifies the
// wiring structurally (source-pattern assertions), the same style already
// used by pof-network-scoping.test.js / marketplace-network-scoping.test.js
// / events-network-scoping.test.js for the analogous network-scoping work.

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
const TELEGRAM_SRC = readSrc("telegram-notify.js");
const AUTH_SRC = readSrc("auth.js");
const DOCKERFILE = readSrc("Dockerfile");
const FLY_TOML = readSrc("fly.toml");
const FLY_MAINNET_TOML = readSrc("fly.mainnet.toml");

// ─── server-arc.js wiring ────────────────────────────────────────────────

test("server-arc.js imports all five domain-config.js resolvers", () => {
  assert.match(
    SERVER_SRC,
    /import\s*\{\s*resolveAppBaseUrl,\s*resolveFlyHostnameUrl,\s*resolveAllowedOrigins,\s*resolveWebauthnOrigins,\s*resolveFlyRedirectTarget\s*\}\s*from\s*"\.\/domain-config\.js"/
  );
});

test("APP_BASE_URL is resolved via resolveAppBaseUrl, fail-closed (process.exit) on throw — no hardcoded fallback remains", () => {
  const idx = SERVER_SRC.indexOf("resolveAppBaseUrl({");
  assert.ok(idx >= 0);
  const w = SERVER_SRC.slice(Math.max(0, idx - 200), idx + 300);
  assert.match(w, /catch \(e\) \{/);
  assert.match(w, /process\.exit\(1\)/);
  // Regression guard for the exact bug TASK 10P fixes: no literal fallback
  // to either branded domain anywhere near this resolution.
  assert.doesNotMatch(w, /"https:\/\/my\.pi2pi\.io"/);
});

test("FLY_HOSTNAME_URL is derived via resolveFlyHostnameUrl(FLY_APP_NAME), never a hardcoded app name", () => {
  assert.match(SERVER_SRC, /const FLY_HOSTNAME_URL = resolveFlyHostnameUrl\(FLY_APP_NAME\)/);
});

test("ALLOWED_ORIGINS / webauthn manifest / fly.dev redirect all call the resolveX() functions, not a hardcoded array/string", () => {
  assert.match(SERVER_SRC, /const ALLOWED_ORIGINS = resolveAllowedOrigins\(\{ appBaseUrl: APP_BASE_URL, flyHostnameUrl: FLY_HOSTNAME_URL \}\)/);
  assert.match(SERVER_SRC, /resolveWebauthnOrigins\(\{ appBaseUrl: APP_BASE_URL, flyHostnameUrl: FLY_HOSTNAME_URL \}\)/);
  assert.match(SERVER_SRC, /resolveFlyRedirectTarget\(\{ host, flyHostnameUrl: FLY_HOSTNAME_URL, appBaseUrl: APP_BASE_URL, requestUrl: req\.url \}\)/);
  // No literal branded domains or the old hardcoded fly.dev hostname remain
  // in the server's request-handling logic (module-level comments describing
  // history are fine; this checks the CORS/webauthn/redirect code paths
  // specifically by searching for the old literal patterns process-wide).
  assert.doesNotMatch(SERVER_SRC, /\["https:\/\/my\.pi2pi\.io", "https:\/\/pi2pi-project\.fly\.dev"/);
  assert.doesNotMatch(SERVER_SRC, /host === "pi2pi-project\.fly\.dev"/);
});

test("telegram-notify.js is initialized once with this runtime's own APP_BASE_URL", () => {
  assert.match(SERVER_SRC, /import\s*\{[^}]*initTelegramAppUrl[^}]*\}\s*from\s*"\.\/telegram-notify\.js"/);
  assert.match(SERVER_SRC, /initTelegramAppUrl\(APP_BASE_URL\)/);
});

test("the remaining hardcoded Telegram-link message in server-arc.js now derives from APP_BASE_URL", () => {
  const idx = SERVER_SRC.indexOf("Link expired or invalid");
  assert.ok(idx >= 0);
  const line = SERVER_SRC.slice(idx - 10, idx + 150);
  assert.match(line, /new URL\(APP_BASE_URL\)\.host/);
  assert.doesNotMatch(line, /my\.pi2pi\.io/);
});

// ─── telegram-notify.js wiring ───────────────────────────────────────────

test("telegram-notify.js exports initTelegramAppUrl and no longer hardcodes my.pi2pi.io in actual code (only in an explanatory historical comment)", () => {
  assert.match(TELEGRAM_SRC, /export function initTelegramAppUrl\(appBaseUrl\)/);
  const codeOnly = TELEGRAM_SRC.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(codeOnly, /my\.pi2pi\.io/);
});

test("initTelegramAppUrl fails closed on a missing/invalid appBaseUrl", () => {
  const w = TELEGRAM_SRC.slice(TELEGRAM_SRC.indexOf("export function initTelegramAppUrl"), TELEGRAM_SRC.indexOf("export function initTelegramAppUrl") + 300);
  assert.match(w, /throw new Error/);
});

test("notifyUser's app link and the /start welcome message both use the injected appUrl(), not a literal", () => {
  const notifyUserBody = TELEGRAM_SRC.slice(TELEGRAM_SRC.indexOf("export async function notifyUser"), TELEGRAM_SRC.indexOf("export async function handleBotUpdate"));
  assert.match(notifyUserBody, /appUrl\(\)/);
  const handleBotUpdateBody = TELEGRAM_SRC.slice(TELEGRAM_SRC.indexOf("export async function handleBotUpdate"));
  assert.match(handleBotUpdateBody, /appUrl\(\)/);
});

// ─── auth.js: dead ALLOWED_DOMAINS removed, no second domain-policy source ─

test("auth.js no longer declares the dead ALLOWED_DOMAINS constant", () => {
  assert.doesNotMatch(AUTH_SRC, /const ALLOWED_DOMAINS/);
});

// ─── Fly configs ─────────────────────────────────────────────────────────

test("fly.toml declares the target Testnet branded APP_BASE_URL", () => {
  assert.match(FLY_TOML, /APP_BASE_URL = "https:\/\/testnet\.pi2pi\.io"/);
});

test("fly.mainnet.toml declares the target Mainnet branded APP_BASE_URL", () => {
  assert.match(FLY_MAINNET_TOML, /APP_BASE_URL = "https:\/\/my\.pi2pi\.io"/);
});

// ─── Dockerfile: new modules actually ship in the image ─────────────────
// Direct regression guard for the TASK 10N incident (static-serve.js was
// added to the repo but never added to the Dockerfile's COPY list, causing
// a production crash-loop). domain-config.js is new in this task.

test("Dockerfile COPYs domain-config.js into the image", () => {
  assert.match(DOCKERFILE, /^COPY domain-config\.js \.\/$/m);
});

test("Dockerfile still COPYs every other root-level backend module server-arc.js imports (regression guard, not just the new one)", () => {
  for (const file of ["server-arc.js", "admin_routes.js", "network-config.js", "static-serve.js", "domain-config.js", "keeper-heartbeat.js", "auth.js", "cid-auth.js", "contract-form-lock.js", "text-filter.js", "reserved-names.js", "telegram-notify.js"]) {
    assert.match(DOCKERFILE, new RegExp(`^COPY ${file.replace(".", "\\.")} \\./$`, "m"), `Dockerfile is missing COPY ${file}`);
  }
});
