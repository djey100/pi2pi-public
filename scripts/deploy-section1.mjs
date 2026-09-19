#!/usr/bin/env node
/**
 * DEPRECATED — use deploy-section1-ethers.mjs instead (has DRY_RUN safety).
 * Section 1 deployment — ethers.js fallback
 * Deploys RentalEscrow + PropDepEscrow pair to Arc Testnet
 *
 * Usage: PRIVATE_KEY=... TREASURY=... node scripts/deploy-section1.mjs
 *
 * DO NOT run without explicit approval.
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
const TREASURY = process.env.TREASURY;
const USDC = "0x3600000000000000000000000000000000000000";
const EXPECTED_CHAIN_ID = 5042002n;

if (!PRIVATE_KEY) { console.error("❌ Set PRIVATE_KEY env var"); process.exit(1); }
if (!TREASURY) { console.error("❌ Set TREASURY env var"); process.exit(1); }

// ─── Load compiled artifacts ─────────────────────────────────────────────────
function loadArtifact(name) {
  const path = resolve(ROOT, `contracts/out/${name}.sol/${name}.json`);
  const json = JSON.parse(readFileSync(path, "utf-8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

const RentalEscrow = loadArtifact("RentalEscrow");
const PropDepEscrow = loadArtifact("PropDepEscrow");

// ─── Deploy ──────────────────────────────────────────────────────────────────
async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // Pre-flight
  const network = await provider.getNetwork();
  console.log("Chain ID:", network.chainId);
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    console.error("❌ Wrong chain! Expected", EXPECTED_CHAIN_ID.toString(), "got", network.chainId.toString());
    process.exit(1);
  }

  const balance = await provider.getBalance(wallet.address);
  console.log("Deployer:", wallet.address);
  console.log("Balance:", ethers.formatUnits(balance, 18), "USDC");
  console.log("USDC:", USDC);
  console.log("Treasury:", TREASURY);
  console.log("");

  if (balance < ethers.parseUnits("1", 18)) {
    console.error("❌ Insufficient balance for deploy");
    process.exit(1);
  }

  // 1. Deploy RentalEscrow
  console.log("Deploying RentalEscrow...");
  const escrowFactory = new ethers.ContractFactory(RentalEscrow.abi, RentalEscrow.bytecode, wallet);
  const escrow = await escrowFactory.deploy(USDC, TREASURY);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("✅ RentalEscrow:", escrowAddr);

  // 2. Deploy PropDepEscrow
  console.log("Deploying PropDepEscrow...");
  const propDepFactory = new ethers.ContractFactory(PropDepEscrow.abi, PropDepEscrow.bytecode, wallet);
  const propDep = await propDepFactory.deploy(USDC, escrowAddr);
  await propDep.waitForDeployment();
  const propDepAddr = await propDep.getAddress();
  console.log("✅ PropDepEscrow:", propDepAddr);

  // 3. Wire setPropDepEscrow
  console.log("Wiring setPropDepEscrow...");
  const tx = await escrow.setPropDepEscrow(propDepAddr);
  await tx.wait();
  console.log("✅ Wired");

  // 4. Verify
  const linked = await escrow.propDepEscrow();
  const mainRef = await propDep.mainContract();
  console.log("");
  console.log("=== Verification ===");
  console.log("escrow.propDepEscrow():", linked, linked.toLowerCase() === propDepAddr.toLowerCase() ? "✅" : "❌ MISMATCH");
  console.log("propDep.mainContract():", mainRef, mainRef.toLowerCase() === escrowAddr.toLowerCase() ? "✅" : "❌ MISMATCH");
  console.log("escrow.owner():", await escrow.owner());
  console.log("");
  console.log("=== Summary ===");
  console.log("RentalEscrow: ", escrowAddr);
  console.log("PropDepEscrow:", propDepAddr);
  console.log("Chain ID:     ", network.chainId.toString());
  console.log("Deployer:     ", wallet.address);
}

main().catch(e => { console.error("Deploy failed:", e.message); process.exit(1); });
