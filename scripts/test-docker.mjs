#!/usr/bin/env node
// Local, offline smoke test for the production backend Docker image.
//
// Builds the same Dockerfile used for `flyctl deploy`, verifies the files
// server-arc.js actually imports/reads at startup are present in the image,
// then boots the container with dummy, clearly-fake credentials to catch
// import-time failures (ERR_MODULE_NOT_FOUND) before they reach production.
// This exists because that exact failure mode took pi2pi-project down in
// production earlier — the Dockerfile's per-file COPY list silently drifted
// from the actual import graph.
//
// Safety, by construction:
// - SUPABASE_URL points at an unroutable local port; SUPABASE_SERVICE_KEY is
//   an obviously-fake string. No real Supabase credentials ever touch this
//   script, so no real database is reachable and nothing here can send an
//   on-chain transaction (only HTTP route handlers do that, and this test
//   never sends the container any HTTP requests).
// - The container is never published to a host port and is always removed
//   at the end (success, failure, or crash).
// - Nothing here touches Fly, `flyctl`, or any deployed environment.
//
// Usage: node scripts/test-docker.mjs   (or: npm run test:docker)
// Exit code: 0 = image builds and boots cleanly, 1 = build/file/boot failure.

import { spawnSync } from "child_process";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");

const IMAGE_TAG = "pi2pi-backend-smoketest:local";
const CONTAINER_NAME = "pi2pi-backend-smoketest-run";
const REQUIRED_FILES = [
  "/app/server-arc.js",
  "/app/admin_routes.js",
  "/app/keeper-heartbeat.js",
  "/app/config/deployments.json",
];
const BOOT_WAIT_MS = 6000;

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
}

function cleanupContainer() {
  spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { cwd: ROOT, stdio: "ignore" });
}

// Removes both the container and the locally-built image. Called before
// every exit path (success or failure) so repeated runs never accumulate
// leftover local Docker state.
function cleanupAll() {
  cleanupContainer();
  spawnSync("docker", ["rmi", "-f", IMAGE_TAG], { cwd: ROOT, stdio: "ignore" });
}

function fail(msg) {
  cleanupAll();
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

// Docker daemon must be reachable — this is an environment precondition,
// not something the script can fix.
const dockerCheck = run("docker", ["info"], { stdio: "ignore" });
if (dockerCheck.status !== 0) {
  fail("Docker daemon not reachable (`docker info` failed). Start Docker and re-run.");
}

console.log("=== Building production backend image (same Dockerfile as flyctl deploy) ===");
const build = run("docker", ["build", "-t", IMAGE_TAG, "-f", "Dockerfile", "."]);
if (build.status !== 0) {
  console.error(build.stdout || "");
  console.error(build.stderr || "");
  fail("docker build failed.");
}
console.log("[ok] image built:", IMAGE_TAG);

console.log("\n=== Verifying required files are present in the image ===");
const missing = [];
for (const f of REQUIRED_FILES) {
  const check = run("docker", ["run", "--rm", "--entrypoint", "sh", IMAGE_TAG, "-c", `test -f '${f}'`]);
  if (check.status === 0) {
    console.log(`[ok] ${f}`);
  } else {
    console.log(`[missing] ${f}`);
    missing.push(f);
  }
}
if (missing.length) {
  fail(`Missing from image (Dockerfile COPY list is out of sync with the code's import graph): ${missing.join(", ")}`);
}

console.log("\n=== Booting container with dummy, non-production credentials ===");
cleanupContainer(); // in case a previous run left a stale container
const started = run("docker", [
  "run", "-d", "--name", CONTAINER_NAME,
  "-e", "SUPABASE_URL=http://127.0.0.1:1",
  "-e", "SUPABASE_SERVICE_KEY=test-fake-key-not-a-real-secret",
  "-e", "PORT=3001",
  IMAGE_TAG, "node", "server-arc.js",
]);
if (started.status !== 0) {
  console.error(started.stderr || "");
  fail("docker run failed to start the container.");
}

// Give the process time to resolve imports and reach server.listen().
spawnSync("sleep", [String(BOOT_WAIT_MS / 1000)]);

const inspect = run("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER_NAME]);
const isRunning = inspect.stdout.trim() === "true";
const logsResult = run("docker", ["logs", CONTAINER_NAME]);
const logs = (logsResult.stdout || "") + (logsResult.stderr || "");

const hasModuleNotFound = /ERR_MODULE_NOT_FOUND/.test(logs);
const hasListening = /pi2pi Arc Testnet server/.test(logs);

cleanupContainer();

if (hasModuleNotFound) {
  console.error("\n--- container logs ---\n" + logs);
  fail("Container crashed with ERR_MODULE_NOT_FOUND — Dockerfile is missing a file the code imports.");
}
if (!isRunning) {
  console.error("\n--- container logs ---\n" + logs);
  fail("Container exited before the boot-wait window elapsed (unexpected crash — see logs above).");
}
if (!hasListening) {
  console.error("\n--- container logs ---\n" + logs);
  fail("Container is running but never logged the startup banner — investigate before deploying.");
}

console.log("[ok] container booted, resolved all imports, reached server.listen() — no ERR_MODULE_NOT_FOUND");

// Success too: don't leave the built image sitting around locally.
spawnSync("docker", ["rmi", "-f", IMAGE_TAG], { cwd: ROOT, stdio: "ignore" });

console.log("\nOK: production Docker image is safe to deploy (import graph verified).");
process.exit(0);
