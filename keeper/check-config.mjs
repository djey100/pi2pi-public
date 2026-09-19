#!/usr/bin/env node
/**
 * Keeper config verification — read-only, no transactions
 * Usage: RPC_URL=... ESCROW_ADDRESS=... PROPDEP_ADDRESS=... KEEPER_PRIVATE_KEY=... node check-config.mjs
 */
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL;
const ESCROW = process.env.ESCROW_ADDRESS;
const PROPDEP = process.env.PROPDEP_ADDRESS;
const KEY = process.env.KEEPER_PRIVATE_KEY;

if (!RPC_URL) { console.error("❌ RPC_URL required"); process.exit(1); }
if (!ESCROW) { console.error("❌ ESCROW_ADDRESS required"); process.exit(1); }
if (!PROPDEP) { console.error("❌ PROPDEP_ADDRESS required"); process.exit(1); }
if (!KEY) { console.error("❌ KEEPER_PRIVATE_KEY required"); process.exit(1); }

let ok = 0, fail = 0;
function check(label, pass) {
  if (pass) { console.log(`  ✅ ${label}`); ok++; }
  else { console.log(`  ❌ ${label}`); fail++; }
}

async function main() {
  console.log("=== Keeper Config Verification ===\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(KEY, provider);

  const network = await provider.getNetwork();
  check(`Chain ID = 5042002`, network.chainId === 5042002n);
  console.log("  Keeper wallet:", wallet.address); // address is public, not the key

  check("ESCROW_ADDRESS valid", ethers.isAddress(ESCROW));
  check("PROPDEP_ADDRESS valid", ethers.isAddress(PROPDEP));

  const escrowCode = await provider.getCode(ESCROW);
  check("RentalEscrow has bytecode", escrowCode.length > 2);

  const propDepCode = await provider.getCode(PROPDEP);
  check("PropDepEscrow has bytecode", propDepCode.length > 2);

  const abi = ["function nextAgreementId() view returns (uint256)", "function currentTime() view returns (uint256)"];
  const escrow = new ethers.Contract(ESCROW, abi, provider);

  try {
    const nextId = await escrow.nextAgreementId();
    check(`nextAgreementId() = ${nextId}`, nextId >= 0n);
  } catch { check("nextAgreementId() callable", false); }

  try {
    const ct = await escrow.currentTime();
    check(`currentTime() responds`, ct > 0n);
  } catch { check("currentTime() callable", false); }

  const balance = await provider.getBalance(wallet.address);
  check(`Keeper balance > 0.1 USDC`, balance > ethers.parseUnits("0.1", 18));

  console.log(`\n=== Result: ${ok} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
