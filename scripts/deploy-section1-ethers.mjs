#!/usr/bin/env node
/**
 * Section 1 deployment — ethers.js fallback with DRY_RUN safety
 *
 * Usage:
 *   DRY_RUN (default):  RPC_URL=... PRIVATE_KEY=... TREASURY_ADDRESS=... node scripts/deploy-section1-ethers.mjs
 *   LIVE DEPLOY:        CONFIRM_DEPLOY=true RPC_URL=... PRIVATE_KEY=... TREASURY_ADDRESS=... node scripts/deploy-section1-ethers.mjs
 *
 * Never logs PRIVATE_KEY.
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Config ──────────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL || "https://rpc.testnet.arc.network";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TREASURY = process.env.TREASURY_ADDRESS;
const USDC = process.env.USDC_ADDRESS;
const EXPECTED_CHAIN_ID = 5042002n;
const DRY_RUN = process.env.CONFIRM_DEPLOY !== "true";

if (!PRIVATE_KEY) { console.error("❌ Set PRIVATE_KEY env var"); process.exit(1); }
if (!TREASURY) { console.error("❌ Set TREASURY_ADDRESS env var"); process.exit(1); }
if (!USDC) { console.error("❌ Set USDC_ADDRESS env var (Arc Testnet: 0x3600000000000000000000000000000000000000)"); process.exit(1); }

// ─── Load compiled artifacts ─────────────────────────────────────────────────
function loadArtifact(name) {
  const path = resolve(ROOT, `contracts/out/${name}.sol/${name}.json`);
  const json = JSON.parse(readFileSync(path, "utf-8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

const RentalEscrowArtifact = loadArtifact("RentalEscrow");
const PropDepEscrowArtifact = loadArtifact("PropDepEscrow");

// ─── Deploy ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Section 1 Deploy ${DRY_RUN ? "(DRY RUN)" : "⚡ LIVE"} ===\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // Pre-flight checks
  const network = await provider.getNetwork();
  console.log("Chain ID:  ", network.chainId.toString());
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    console.error("❌ Wrong chain! Expected", EXPECTED_CHAIN_ID.toString(), "got", network.chainId.toString());
    process.exit(1);
  }

  const balance = await provider.getBalance(wallet.address);
  const balanceFormatted = ethers.formatUnits(balance, 18);
  console.log("Deployer:  ", wallet.address);
  console.log("Balance:   ", balanceFormatted, "USDC");
  console.log("USDC:      ", USDC);
  console.log("Treasury:  ", TREASURY);

  if (balance < ethers.parseUnits("1", 18)) {
    console.error("❌ Insufficient balance for deploy (need > 1 USDC for gas)");
    process.exit(1);
  }

  // Check nonce
  const nonce = await provider.getTransactionCount(wallet.address);
  console.log("Nonce:     ", nonce);
  const pendingNonce = await provider.getTransactionCount(wallet.address, "pending");
  if (pendingNonce !== nonce) {
    console.error(`❌ Pending txs detected (latest=${nonce}, pending=${pendingNonce}). Clear before deploy.`);
    process.exit(1);
  }

  // Bytecode sizes
  const escrowDeployed = RentalEscrowArtifact.bytecode.replace("0x","").length / 2;
  const propDepDeployed = PropDepEscrowArtifact.bytecode.replace("0x","").length / 2;
  console.log("RentalEscrow creation bytecode:", escrowDeployed, "bytes");
  console.log("PropDepEscrow creation bytecode:", propDepDeployed, "bytes");

  if (DRY_RUN) {
    console.log("\n🔒 DRY RUN — no transactions sent.");
    console.log("Set CONFIRM_DEPLOY=true to actually deploy.\n");
    console.log("Estimated addresses (deterministic from nonce):");
    const escrowAddr = ethers.getCreateAddress({ from: wallet.address, nonce });
    const propDepAddr = ethers.getCreateAddress({ from: wallet.address, nonce: nonce + 1 });
    console.log("  RentalEscrow: ", escrowAddr);
    console.log("  PropDepEscrow:", propDepAddr);
    return;
  }

  // ─── LIVE DEPLOY ───────────────────────────────────────────────────────────
  console.log("\n⚡ DEPLOYING...\n");

  // 1. Deploy RentalEscrow
  console.log("1/3 Deploying RentalEscrow...");
  const escrowFactory = new ethers.ContractFactory(RentalEscrowArtifact.abi, RentalEscrowArtifact.bytecode, wallet);
  const escrow = await escrowFactory.deploy(USDC, TREASURY);
  const escrowTx = escrow.deploymentTransaction();
  console.log("   TX:", escrowTx.hash);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("   ✅ RentalEscrow:", escrowAddr);

  // 2. Deploy PropDepEscrow
  console.log("2/3 Deploying PropDepEscrow...");
  const propDepFactory = new ethers.ContractFactory(PropDepEscrowArtifact.abi, PropDepEscrowArtifact.bytecode, wallet);
  const propDep = await propDepFactory.deploy(USDC, escrowAddr);
  const propDepTx = propDep.deploymentTransaction();
  console.log("   TX:", propDepTx.hash);
  await propDep.waitForDeployment();
  const propDepAddr = await propDep.getAddress();
  console.log("   ✅ PropDepEscrow:", propDepAddr);

  // 3. Wire setPropDepEscrow
  console.log("3/3 Wiring setPropDepEscrow...");
  const wireTx = await escrow.setPropDepEscrow(propDepAddr);
  console.log("   TX:", wireTx.hash);
  await wireTx.wait();
  console.log("   ✅ Wired");

  // ─── Verification ──────────────────────────────────────────────────────────
  console.log("\n=== Verification ===");
  const linked = await escrow.propDepEscrow();
  const mainRef = await propDep.mainContract();
  const owner = await escrow.owner();
  console.log("escrow.propDepEscrow():", linked, linked.toLowerCase() === propDepAddr.toLowerCase() ? "✅" : "❌ MISMATCH");
  console.log("propDep.mainContract():", mainRef, mainRef.toLowerCase() === escrowAddr.toLowerCase() ? "✅" : "❌ MISMATCH");
  console.log("escrow.owner():        ", owner);

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log("\n=== DEPLOY COMPLETE ===");
  console.log("RentalEscrow: ", escrowAddr);
  console.log("PropDepEscrow:", propDepAddr);
  console.log("Chain ID:     ", network.chainId.toString());
  console.log("Deployer:     ", wallet.address);
  console.log("TX 1 (escrow):", escrowTx.hash);
  console.log("TX 2 (propDep):", propDepTx.hash);
  console.log("TX 3 (wire):  ", wireTx.hash);
  console.log("\nNext: update addresses in helpers.js, Fly secrets, and redeploy.");
}

main().catch(e => { console.error("Deploy failed:", e.message); process.exit(1); });
