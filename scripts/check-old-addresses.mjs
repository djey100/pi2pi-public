#!/usr/bin/env node
/**
 * Check if old contract addresses remain in active code files
 * Usage: OLD_ESCROW=0x... OLD_PROPDEP=0x... node scripts/check-old-addresses.mjs
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const OLD_ESCROW = (process.env.OLD_ESCROW || "0x241b50869d2c1a7E65A5B9D5016BE0a0eda9D875").toLowerCase();
const OLD_PROPDEP = (process.env.OLD_PROPDEP || "0xb292e8dC58e0A86f05DE470e6E65725e7043676B").toLowerCase();

// Active code paths to check
const ACTIVE_PATHS = [
  "arc/src",
  "arc/helpers.js",
  "server-arc.js",
  "admin_routes.js",
  "auth.js",
  "cid-auth.js",
  "keeper/enforcer.ts",
  "keeper/check-config.mjs",
];

// Ignore patterns
const IGNORE = ["node_modules", "backups", ".git", "dist", "out", "broadcast", "__tests__"];

function walk(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (IGNORE.some(p => entry.includes(p))) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) files.push(...walk(full));
      else if (/\.(js|jsx|ts|mjs|json)$/.test(entry)) files.push(full);
    }
  } catch {}
  return files;
}

let found = 0;
console.log("=== Checking active files for old addresses ===\n");
console.log("OLD_ESCROW: ", OLD_ESCROW);
console.log("OLD_PROPDEP:", OLD_PROPDEP);
console.log("");

for (const p of ACTIVE_PATHS) {
  const full = resolve(ROOT, p);
  let files;
  try {
    const stat = statSync(full);
    files = stat.isDirectory() ? walk(full) : [full];
  } catch { continue; }

  for (const f of files) {
    try {
      const code = readFileSync(f, "utf-8").toLowerCase();
      const rel = f.replace(ROOT + "/", "");
      if (code.includes(OLD_ESCROW.toLowerCase())) {
        console.log(`  ❌ ${rel} — contains OLD ESCROW`);
        found++;
      }
      if (code.includes(OLD_PROPDEP.toLowerCase())) {
        console.log(`  ❌ ${rel} — contains OLD PROPDEP`);
        found++;
      }
    } catch {}
  }
}

if (found === 0) {
  console.log("  ✅ No old addresses found in active code files\n");
  process.exit(0);
} else {
  console.log(`\n  ⚠️  ${found} reference(s) to old addresses found. Update before go-live.\n`);
  process.exit(1);
}
