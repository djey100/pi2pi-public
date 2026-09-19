#!/usr/bin/env node
/**
 * Verify Section 1 deploy — read-only, no transactions
 * Usage: ESCROW_ADDRESS=0x... PROPDEP_ADDRESS=0x... node scripts/verify-section1-deploy.mjs
 */
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL || "https://rpc.testnet.arc.network";
const ESCROW = process.env.ESCROW_ADDRESS;
const PROPDEP = process.env.PROPDEP_ADDRESS;
const EXPECTED_CHAIN = 5042002n;

if (!ESCROW || !PROPDEP) { console.error("❌ Set ESCROW_ADDRESS and PROPDEP_ADDRESS"); process.exit(1); }

let ok = 0, fail = 0;
function check(label, pass) {
  if (pass) { console.log(`  ✅ ${label}`); ok++; }
  else { console.log(`  ❌ ${label}`); fail++; }
}

async function main() {
  console.log("=== Section 1 Deploy Verification ===\n");
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const network = await provider.getNetwork();
  check(`Chain ID = ${EXPECTED_CHAIN}`, network.chainId === EXPECTED_CHAIN);

  check("ESCROW_ADDRESS valid", ethers.isAddress(ESCROW));
  check("PROPDEP_ADDRESS valid", ethers.isAddress(PROPDEP));

  const escrowCode = await provider.getCode(ESCROW);
  check("RentalEscrow has bytecode", escrowCode.length > 2);

  const propDepCode = await provider.getCode(PROPDEP);
  check("PropDepEscrow has bytecode", propDepCode.length > 2);

  const escrowAbi = [
    "function propDepEscrow() view returns (address)",
    "function owner() view returns (address)",
    "function currentTime() view returns (uint256)",
    "function nextAgreementId() view returns (uint256)",
  ];
  const propDepAbi = [
    "function mainContract() view returns (address)",
    "function MIN_DAMAGE_CLAIM_BPS() view returns (uint256)",
    "function owner() view returns (address)",
  ];

  const escrow = new ethers.Contract(ESCROW, escrowAbi, provider);
  const propDep = new ethers.Contract(PROPDEP, propDepAbi, provider);

  try {
    const linked = await escrow.propDepEscrow();
    check(`propDepEscrow() == PROPDEP`, linked.toLowerCase() === PROPDEP.toLowerCase());
  } catch (e) { check("propDepEscrow() callable", false); }

  try {
    const main = await propDep.mainContract();
    check(`mainContract() == ESCROW`, main.toLowerCase() === ESCROW.toLowerCase());
  } catch (e) { check("mainContract() callable", false); }

  try {
    const owner = await escrow.owner();
    check(`owner() responds: ${owner.slice(0,10)}...`, ethers.isAddress(owner));
  } catch (e) { check("owner() callable", false); }

  try {
    const ct = await escrow.currentTime();
    check(`currentTime() responds: ${ct}`, ct > 0n);
  } catch (e) { check("currentTime() callable", false); }

  try {
    const nextId = await escrow.nextAgreementId();
    check(`nextAgreementId() == 0 (fresh deploy)`, nextId === 0n);
  } catch (e) { check("nextAgreementId() callable", false); }

  // PropDep-specific: minimum damage claim threshold
  try {
    const minBps = await propDep.MIN_DAMAGE_CLAIM_BPS();
    check(`MIN_DAMAGE_CLAIM_BPS() == 3000 (30%)`, minBps === 3000n);
  } catch (e) { check("MIN_DAMAGE_CLAIM_BPS() callable", false); }

  // PropDep owner
  try {
    const pdOwner = await propDep.owner();
    check(`PropDepEscrow.owner() responds: ${pdOwner.slice(0,10)}...`, ethers.isAddress(pdOwner));
  } catch (e) { check("PropDepEscrow.owner() callable", false); }

  console.log(`\n=== Result: ${ok} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
