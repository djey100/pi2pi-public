// static-serve.test.js — regression tests for TASK 10M's
// ERR_HTTP_HEADERS_SENT fix.
//
// Root cause: serveStatic() used to call res.writeHead(200, headers) BEFORE
// readFileSync(full) — if the read then threw, the catch block's
// writeHead(500) ran on a response whose headers were already sent,
// crashing with Error [ERR_HTTP_HEADERS_SENT]. The fix reads the file
// first, so a read failure always leaves headers unsent.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { serveStatic, MIME } from "./static-serve.js";

function fakeRes() {
  const res = {
    statusCode: null,
    headers: null,
    body: null,
    headersSent: false,
    writeHeadCalls: 0,
  };
  res.writeHead = (status, headers) => {
    if (res.headersSent) throw new Error("TEST BUG: writeHead called twice — this is exactly the ERR_HTTP_HEADERS_SENT crash");
    res.statusCode = status;
    res.headers = headers || null;
    res.headersSent = true;
    res.writeHeadCalls++;
  };
  res.end = (body) => { res.body = body; };
  return res;
}

const dir = mkdtempSync(join(tmpdir(), "pi2pi-static-serve-test-"));
const otherDir = mkdtempSync(join(tmpdir(), "pi2pi-static-serve-test-other-"));

test.after(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(otherDir, { recursive: true, force: true });
});

test("successful file response: 200, correct content-type, correct body, exactly one writeHead call", () => {
  writeFileSync(join(dir, "index.html"), "<html>hi</html>");
  const res = fakeRes();
  serveStatic(res, "index.html", [dir]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "text/html");
  assert.equal(res.headers["Cache-Control"], "no-cache, no-store, must-revalidate");
  assert.equal(res.body.toString(), "<html>hi</html>");
  assert.equal(res.writeHeadCalls, 1);
});

test("checks candidate roots in order, serving from the first one where the file actually exists", () => {
  writeFileSync(join(otherDir, "only-in-second.js"), "console.log(1)");
  const res = fakeRes();
  serveStatic(res, "only-in-second.js", [dir, otherDir]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "application/javascript");
  assert.equal(res.body.toString(), "console.log(1)");
});

test("missing file: 404, exactly one writeHead call, no ERR_HTTP_HEADERS_SENT", () => {
  const res = fakeRes();
  serveStatic(res, "does-not-exist.png", [dir, otherDir]);
  assert.equal(res.statusCode, 404);
  assert.equal(res.writeHeadCalls, 1);
});

test("(TASK 10M repro) a read failure after the existence check never causes a second writeHead — 500, not a crash", () => {
  // A directory that EXISTS and matches the isFile()-guarded lookup by name
  // collision would still fail statSync's isFile() check, so to force a
  // genuine post-existence-check read failure we make the file
  // unreadable (chmod 000) after confirming it exists — reproducing the
  // exact race the original bug was vulnerable to (file present at the
  // existsSync/statSync check, but unreadable/gone by readFileSync).
  const filePath = join(dir, "unreadable.txt");
  writeFileSync(filePath, "secret");
  chmodSync(filePath, 0o000);
  const res = fakeRes();
  assert.doesNotThrow(() => serveStatic(res, "unreadable.txt", [dir]));
  assert.equal(res.statusCode, 500);
  assert.equal(res.writeHeadCalls, 1, "must never call writeHead twice for the same response");
  chmodSync(filePath, 0o644); // restore so afterEach cleanup can remove it
});

test("unknown extension falls back to application/octet-stream", () => {
  writeFileSync(join(dir, "file.unknownext"), "data");
  const res = fakeRes();
  serveStatic(res, "file.unknownext", [dir]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "application/octet-stream");
});

test("known static extensions map to their expected MIME types (regression guard for the extracted MIME table)", () => {
  const expected = { ".html": "text/html", ".css": "text/css", ".json": "application/json", ".xml": "application/xml; charset=utf-8", ".woff2": "font/woff2" };
  for (const [ext, mime] of Object.entries(expected)) {
    assert.equal(MIME[ext], mime, `MIME[${ext}] should be ${mime}`);
  }
});

test("images/JSON do not get the no-cache Cache-Control header (only HTML/JSX/JS)", () => {
  writeFileSync(join(dir, "data.json"), "{}");
  const res = fakeRes();
  serveStatic(res, "data.json", [dir]);
  assert.equal(res.headers["Cache-Control"], undefined);
});
