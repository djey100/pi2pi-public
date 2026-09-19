// static-serve.js — serves a static file from the first matching candidate
// root directory (TASK 10M).
//
// Kept as its own file (mirrors network-config.js) so it can be unit tested
// without booting server-arc.js, which requires Supabase credentials and a
// live NETWORK/RPC_URL at import time.
//
// Response ordering is the load-bearing detail here: the file is read
// BEFORE any headers are written. The previous version wrote a 200 header
// first and read the file after — if the read then threw (e.g. the file
// was removed between the existence check and the read), the catch block's
// writeHead(500) fired on a response whose headers were already sent,
// crashing with ERR_HTTP_HEADERS_SENT. Reading first means a failure here
// always leaves headers unsent, so the 500 fallback is still safe to send.

import { existsSync, statSync, readFileSync } from "fs";
import { join, extname } from "path";

export const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".jsx": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".pdf": "application/pdf",
  ".woff2": "font/woff2", ".xml": "application/xml; charset=utf-8", // sitemap.xml
};

/**
 * Serves `filePath` from the first of `roots` (checked in order) where it
 * exists as a regular file. `res` needs writeHead/end/headersSent — a real
 * http.ServerResponse, or a fake with the same shape for tests.
 */
export function serveStatic(res, filePath, roots) {
  try {
    let full = null;
    for (const root of roots) {
      const candidate = join(root, filePath);
      if (existsSync(candidate) && statSync(candidate).isFile()) { full = candidate; break; }
    }
    if (!full) { res.writeHead(404); res.end("Not found"); return; }
    const content = readFileSync(full);
    const ext = extname(full);
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    // Force no-cache on HTML/JSX so JSX changes always reach the browser.
    // Images/manifest can stay on default browser heuristic.
    if (ext === ".html" || ext === ".jsx" || ext === ".js") {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    }
    res.writeHead(200, headers);
    res.end(content);
  } catch {
    // Defense-in-depth: never attempt a second writeHead() on a response
    // whose headers are already sent (e.g. if res.end() above itself threw
    // after writeHead(200) succeeded) — that's the exact crash this fixes.
    if (!res.headersSent) { res.writeHead(500); res.end("Error"); }
  }
}
