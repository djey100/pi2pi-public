#!/usr/bin/env node
// Section 1 deploy readiness checker — does NOT deploy, only validates
// Run: node scripts/check-section1-deploy-readiness.mjs

import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
let ok = 0, fail = 0;

function check(label, condition) {
  if (condition) { console.log(`  ✅ ${label}`); ok++; }
  else { console.log(`  ❌ ${label}`); fail++; }
}

function readSafe(path) {
  try { return readFileSync(resolve(ROOT, path), 'utf-8'); } catch { return ''; }
}

console.log('=== Section 1 Deploy Readiness ===\n');

console.log('Files:');
check('contracts/src/RentalEscrow.sol', existsSync(resolve(ROOT, 'contracts/src/RentalEscrow.sol')));
check('contracts/script/Deploy.s.sol', existsSync(resolve(ROOT, 'contracts/script/Deploy.s.sol')));
check('keeper/enforcer.ts', existsSync(resolve(ROOT, 'keeper/enforcer.ts')));
check('keeper/package-lock.json', existsSync(resolve(ROOT, 'keeper/package-lock.json')));
check('keeper/Dockerfile uses npm ci', readSafe('keeper/Dockerfile').includes('npm ci'));
check('docs/section1-redeploy-runbook.md', existsSync(resolve(ROOT, 'docs/section1-redeploy-runbook.md')));
check('migrations/2026-04-28-doc-keys-acl.sql', existsSync(resolve(ROOT, 'migrations/2026-04-28-doc-keys-acl.sql')));

console.log('\nTools:');
check('forge available', existsSync(resolve(process.env.HOME, '.foundry/bin/forge')));

console.log('\nContract fix:');
const sol = readSafe('contracts/src/RentalEscrow.sol');
check('isRentOverdue checks leaseEndTime', sol.includes('_now() >= a.leaseEndTime) return false'));
check('flagRentMissed reverts on lease ended', sol.includes('Lease ended'));

console.log('\nKeeper fix:');
const keeper = readSafe('keeper/enforcer.ts');
const leaseIdx = keeper.indexOf('isLeaseExpired(id)');
const rentIdx = keeper.indexOf('isRentOverdue(id)');
check('leaseExpired checked before rentOverdue', leaseIdx > 0 && rentIdx > 0 && leaseIdx < rentIdx);
check('No diagnostic encodeFunctionData', !keeper.includes('encodeFunctionData'));

console.log('\nFrontend:');
const helpers = readSafe('arc/src/helpers.js');
check('ESCROW_ADDRESS in helpers.js', helpers.includes('ESCROW_ADDRESS'));
check('PROPDEP_ADDRESS in helpers.js', helpers.includes('PROPDEP_ADDRESS'));

console.log(`\n=== Result: ${ok} passed, ${fail} failed ===`);
if (fail > 0) { console.log('\n⚠️  Fix failures before deploying.'); process.exit(1); }
else { console.log('\n✅ Ready. Follow docs/section1-redeploy-runbook.md'); }
