/**
 * pi2pi Keeper — Enforcer bot (v2)
 *
 * Monitors RentalEscrow + PropDepEscrow agreements and calls permissionless
 * timeout-enforcement functions when deadlines pass.
 *
 * Uses contract's _now() (virtual time) — works with timeOffset for testing.
 * No subgraph dependency — scans 0..nextAgreementId directly.
 *
 * Enforcement actions (all permissionless):
 *   RentalEscrow:
 *     Active        + isLeaseExpired()   → endLease()        (checked FIRST)
 *     Active        + isRentOverdue()    → flagRentMissed()  (only if lease not expired)
 *     EarlyTermProp + timeout            → expireEarlyTermProposal()
 *     CheckoutProp  + timeout            → expireCheckout()
 *     DisputeOpen   + isFreezeExpired()  → releaseFrozenFunds()
 *     Any stuck     + safety net         → expireByLeaseEnd()
 *
 *   PropDepEscrow:
 *     Active        + window expired     → expirePropDepWindow()
 *     Claimed       + tenant silent      → executeExpiredClaim()
 *     Disputed      + no bond            → expireDamageClaim()
 *     Frozen        + freeze expired     → releaseFrozenFunds()
 *
 * Run: NETWORK=arc-testnet ESCROW_ADDRESS=0x... PROPDEP_ADDRESS=0x... RPC_URL=... KEEPER_PRIVATE_KEY=... npx tsx enforcer.ts
 * Loop: add LOOP_INTERVAL=15 (seconds)
 *
 * NETWORK is mandatory (see network.ts) — the keeper signs transactions, so it
 * refuses to run against a chain it wasn't explicitly configured for. There is
 * no default and no fallback network.
 */

import { ethers, Contract, JsonRpcProvider, Wallet } from "ethers";
import { resolveExpectedChainId, assertChainMatch, resolveMemoAddress, assertContractAddressesForNetwork, parseDryRun, NetworkMismatchError } from "./network.js";

// ─── Config ─────────────────────────────────────────────────────────────────

interface Config {
  network: string;
  expectedChainId: number;
  rpcUrl: string;
  escrowAddress: string;
  propDepAddress: string;
  privateKey: string;
  batchSize: number;
  dryRun: boolean;
  loopInterval: number; // 0 = run once
  heartbeatUrl: string; // backend URL for heartbeat POST
  heartbeatSecret: string; // shared secret for auth
}

function loadConfig(): Config {
  const req = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Missing: ${k}`); return v; };
  const network = req("NETWORK");
  return {
    network,
    expectedChainId: resolveExpectedChainId(network), // throws NetworkConfigError for anything unrecognized
    rpcUrl: req("RPC_URL"),
    escrowAddress: req("ESCROW_ADDRESS"),
    propDepAddress: req("PROPDEP_ADDRESS"),
    privateKey: req("KEEPER_PRIVATE_KEY"),
    batchSize: Number(process.env.BATCH_SIZE ?? "100"),
    dryRun: parseDryRun(process.env.DRY_RUN),
    loopInterval: Number(process.env.LOOP_INTERVAL ?? "0"),
    heartbeatUrl: process.env.HEARTBEAT_URL || "",
    heartbeatSecret: process.env.KEEPER_HEARTBEAT_SECRET || "",
  };
}

// ─── ABIs (minimal — only what keeper needs) ────────────────────────────────

const ESCROW_ABI = [
  "function nextAgreementId() view returns (uint256)",
  "function getState(uint256 id) view returns (uint8)",
  "function currentTime() view returns (uint256)",
  "function isRentOverdue(uint256 id) view returns (bool)",
  "function isLeaseExpired(uint256 id) view returns (bool)",
  "function isFreezeExpired(uint256 id) view returns (bool)",
  "function isEarlyTermExpired(uint256 id) view returns (bool)",
  "function isCheckoutExpired(uint256 id) view returns (bool)",
  "function isDepositDeadlineExpired(uint256 id) view returns (bool)",
  "function flagRentMissed(uint256 id)",
  "function endLease(uint256 id)",
  "function expireEarlyTermProposal(uint256 id)",
  "function expireCheckout(uint256 id)",
  "function releaseFrozenFunds(uint256 id)",
  "function expireByLeaseEnd(uint256 id)",
  "function cancelUnfunded(uint256 id)",
  "function expireRenewalVote(uint256 id)",
  "function getAgreement(uint256 id) view returns (tuple(address tenant, address landlord, uint256 monthlyRent, uint256 commitmentDeposit, uint256 hostingDeposit, uint256 propSecurityDeposit, uint256 leaseDurationMonths, uint256 createdAt, uint256 activatedAt, uint256 leaseEndTime, uint8 state, bool tenantDeposited, bool landlordDeposited, bool firstRentPaid, uint256 lastRentTimestamp, uint256 rentPaymentsMade, uint256 damageClaim, uint256 damageClaimDeadline, bool tenantAcceptedClaim, bool tenantDisputedClaim, uint256 disputeBond, address disputeBondPoster, uint256 freezeStart, uint256 freezeDuration, uint8 earlyTermType, address earlyTermInitiator, uint256 earlyTermProposedAt, address mutualSettlementProposer, uint256 mutualSettlementToLandlord, uint256 mutualSettlementToTenant, bool earlySettlementMode, bytes32 contentHash, bool hasPropDep, uint256 rentGraceExtension, uint256 vacateDeadline))",
];

// ─── Arc Memo contract ───────────────────────────────────────────────────────
// Attaches structured metadata to any on-chain call. Used to annotate rent
// payments with: agreement ID, month number, amount.
// memoId = keccak256(agreementId, month) — indexed, queryable without block range.
// Address is resolved per-network via resolveMemoAddress() (network.ts) — only
// Arc Testnet has a verified address; Memo is skipped entirely on any network
// without one (see runOnce()). It is annotation-only, never required for core
// enforcement.

const MEMO_ABI = [
  "function memo(address target, bytes data, bytes32 memoId, bytes memoData)",
];

// ─── Rent payment tracking (persists across runOnce cycles) ─────────────────
// On cold start, first scan sets baseline (current rentPaymentsMade).
// Subsequent scans detect new payments and record Memo for each.

const lastKnownPayments = new Map<string, number>(); // agreementId → last known count
const baselined = new Set<string>();                 // agreements seen at least once

// Optional: MEMO_BASELINE_JSON={"0":1,"1":3} — pre-seed baselines to skip retroactive Memos
// and force detection of payments already on-chain at startup.
// If set, the specified agreements skip the cold-start "set baseline" phase.
console.log(`[memo-init] MEMO_BASELINE_JSON=${process.env.MEMO_BASELINE_JSON ?? "(not set)"}`);
try {
  const raw = process.env.MEMO_BASELINE_JSON;
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, number>;
    for (const [k, v] of Object.entries(parsed)) {
      lastKnownPayments.set(k, v);
      baselined.add(k);
      console.log(`[memo-seed] agreement #${k} baseline=${v} (from MEMO_BASELINE_JSON)`);
    }
  }
} catch (e) { console.warn(`[memo-seed-err] ${e}`); }

const PROPDEP_ABI = [
  "function getState(uint256 leaseId) view returns (uint8)",
  "function currentTime() view returns (uint256)",
  "function getPropDep(uint256 leaseId) view returns (tuple(uint256 leaseId, address tenant, address landlord, uint256 amount, uint8 state, uint256 leaseEndTime, uint256 windowStart, uint256 windowEnd, uint256 claimAmount, uint256 claimDeadline, bool tenantAccepted, bool tenantDisputed, uint256 disputeBond, address bondPoster, uint256 freezeStart, uint256 freezeEnd, address settlementProposer, uint256 settlementToLandlord, uint256 settlementToTenant))",
  "function expirePropDepWindow(uint256 leaseId)",
  "function executeExpiredClaim(uint256 leaseId)",
  "function expireDamageClaim(uint256 leaseId)",
  "function releaseFrozenFunds(uint256 leaseId)",
];

// State enums
const RentalState = { Created: 0, AwaitingLL: 1, AwaitingTN: 2, Active: 3, EarlyTermProposed: 4, CheckoutProposed: 5, DamageClaimed: 6, DisputeOpen: 7, Settled: 8, LeaseEnded: 9 };
const PropDepState = { None: 0, Active: 1, Claimed: 2, Disputed: 3, Frozen: 4, Settled: 5 };

// ─── Action types ───────────────────────────────────────────────────────────

interface Action {
  contract: "rental" | "propdep";
  id: bigint;
  method: string;
  label: string;
}

// ─── Rent Memo: record new payments via Arc Memo contract ───────────────────

async function sendRentMemo(
  memo: Contract,
  escrowAddr: string,
  id: bigint,
  month: number,
  monthlyRent: bigint,
  dryRun: boolean,
): Promise<void> {
  const tag = `[memo] #${id} month=${month} rent=${(Number(monthlyRent) / 1e6).toFixed(2)}USDC`;

  if (dryRun) {
    console.log(`  [dry] ${tag}`);
    return;
  }

  // memoId = keccak256(abi.encodePacked(agreementId, month)) — deterministic, indexed
  const memoId = ethers.solidityPackedKeccak256(
    ["uint256", "uint256"],
    [id, BigInt(month)],
  );

  // Inner calldata: getAgreement(id) — view function, never reverts, Memo executes it
  // Selector 0x4f9f6fe6 = keccak256("getAgreement(uint256)")[:4]
  const innerData = "0x4f9f6fe6" + id.toString(16).padStart(64, "0");

  const memoData = ethers.toUtf8Bytes(
    JSON.stringify({
      type: "RENT",
      agreement: Number(id),
      month,
      amount_usdc: Number(monthlyRent) / 1e6,
    }),
  );

  try {
    console.log(`  [tx] ${tag}`);
    const tx = await memo.memo(escrowAddr, innerData, memoId, memoData);
    const receipt = await tx.wait();
    console.log(`  [ok] ${tag} tx=${receipt.hash.slice(0, 16)}...`);
  } catch (e) {
    // Non-critical: rent payment already succeeded on-chain, memo is annotation only
    console.warn(`  [warn] ${tag} failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function checkRentMemo(
  escrow: Contract,
  memo: Contract,
  id: bigint,
  dryRun: boolean,
): Promise<void> {
  const key = id.toString();
  try {
    // Only Active agreements can receive new rent payments
    const state = Number(await escrow.getState(id));
    if (state !== RentalState.Active) return;

    const agr = await escrow.getAgreement(id);
    const currentPayments = Number(agr.rentPaymentsMade);

    if (!baselined.has(key)) {
      // First time seeing this agreement — set baseline, do NOT send retroactive Memos
      lastKnownPayments.set(key, currentPayments);
      baselined.add(key);
      if (currentPayments > 0) {
        console.log(`  [memo-base] #${id} baseline=${currentPayments} (retroactive Memos skipped)`);
      }
      return;
    }

    const lastKnown = lastKnownPayments.get(key) ?? currentPayments;

    if (currentPayments > lastKnown) {
      console.log(`  [memo-new] #${id} payments ${lastKnown}→${currentPayments}`);
      for (let month = lastKnown + 1; month <= currentPayments; month++) {
        await sendRentMemo(memo, escrow.target as string, id, month, agr.monthlyRent, dryRun);
      }
      lastKnownPayments.set(key, currentPayments);
    }
  } catch (e) {
    console.warn(`  [memo-err] #${id}: ${e instanceof Error ? e.message : e}`);
  }
}

// ─── Check logic ────────────────────────────────────────────────────────────

async function checkRentalAgreement(escrow: Contract, id: bigint): Promise<Action | null> {
  try {
    const state = Number(await escrow.getState(id));

    switch (state) {
      case RentalState.AwaitingLL:
      case RentalState.AwaitingTN: {
        const expired = await escrow.isDepositDeadlineExpired(id);
        if (expired) return { contract: "rental", id, method: "cancelUnfunded", label: "Deposit deadline expired → cancel & refund" };
        break;
      }
      case RentalState.Active: {
        // Priority: lease expiry FIRST, then rent overdue
        // endLease returns deposits fairly; flagRentMissed seizes tenant deposit
        const leaseExpired = await escrow.isLeaseExpired(id);
        if (leaseExpired) return { contract: "rental", id, method: "endLease", label: "Lease expired → return deposits" };
        const overdue = await escrow.isRentOverdue(id);
        if (overdue) return { contract: "rental", id, method: "flagRentMissed", label: "Rent overdue → forfeit deposit" };
        break;
      }
      case RentalState.EarlyTermProposed: {
        const expired = await escrow.isEarlyTermExpired(id);
        if (expired) return { contract: "rental", id, method: "expireEarlyTermProposal", label: "ET response timeout → return deposits" };
        break;
      }
      case RentalState.CheckoutProposed: {
        const expired = await escrow.isCheckoutExpired(id);
        if (expired) return { contract: "rental", id, method: "expireCheckout", label: "Checkout timeout → clean settle" };
        break;
      }
      case RentalState.DisputeOpen: {
        const expired = await escrow.isFreezeExpired(id);
        if (expired) return { contract: "rental", id, method: "releaseFrozenFunds", label: "60d freeze expired → wash settlement" };
        break;
      }
    }
  } catch (e) {
    console.error(`[rental] #${id} check error: ${e instanceof Error ? e.message : e}`);
  }
  return null;
}

async function checkPropDep(propDep: Contract, id: bigint, now: bigint): Promise<Action | null> {
  try {
    const state = Number(await propDep.getState(id));

    switch (state) {
      case PropDepState.Active: {
        const pd = await propDep.getPropDep(id);
        if (pd.windowEnd > 0n && now > pd.windowEnd) {
          return { contract: "propdep", id, method: "expirePropDepWindow", label: "PropDep window expired → return to tenant" };
        }
        break;
      }
      case PropDepState.Claimed: {
        const pd = await propDep.getPropDep(id);
        if (!pd.tenantAccepted && !pd.tenantDisputed && pd.claimDeadline > 0n && now > pd.claimDeadline) {
          return { contract: "propdep", id, method: "executeExpiredClaim", label: "Tenant silent → auto-execute claim" };
        }
        break;
      }
      case PropDepState.Disputed: {
        const pd = await propDep.getPropDep(id);
        const BOND_PERIOD = 3n * 24n * 3600n;
        if (pd.disputeBond === 0n && pd.claimDeadline > 0n && now > pd.claimDeadline + BOND_PERIOD) {
          return { contract: "propdep", id, method: "expireDamageClaim", label: "Landlord no bond → drop claim" };
        }
        break;
      }
      case PropDepState.Frozen: {
        const pd = await propDep.getPropDep(id);
        if (pd.freezeEnd > 0n && now >= pd.freezeEnd) {
          return { contract: "propdep", id, method: "releaseFrozenFunds", label: "PropDep freeze expired → return funds" };
        }
        break;
      }
    }
  } catch (e) {
    console.error(`[propdep] #${id} check error: ${e instanceof Error ? e.message : e}`);
  }
  return null;
}

// ─── Execute with callStatic pre-check ──────────────────────────────────────

async function execute(contract: Contract, action: Action, dryRun: boolean): Promise<string | null> {
  const tag = `[${action.contract}] #${action.id} ${action.label}`;

  if (dryRun) {
    console.log(`  [dry] ${tag}`);
    return null;
  }

  try {
    // Pre-check: simulate call to avoid wasting gas on revert
    await contract[action.method].staticCall(action.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  [skip] ${tag} — would revert: ${msg.slice(0, 80)}`);
    return null;
  }

  try {
    console.log(`  [tx] ${tag}`);
    const tx = await contract[action.method](action.id); // let ethers.js handle EIP-1559 gas params
    const receipt = await tx.wait();
    console.log(`  [ok] tx=${receipt.hash.slice(0, 14)}... gas=${receipt.gasUsed}`);
    return receipt.hash;
  } catch (e) {
    console.error(`  [err] ${tag}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ─── Main scan ──────────────────────────────────────────────────────────────

async function runOnce(config: Config): Promise<number> {
  const provider = new JsonRpcProvider(config.rpcUrl);

  // Mandatory network check — MUST happen before any signer/contract is used
  // for reads or writes. Fails closed: throws NetworkMismatchError, which the
  // caller (main) treats as fatal and exits the process without retrying, so
  // zero scans and zero writes ever happen against the wrong chain.
  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);
  assertChainMatch(config.network, config.expectedChainId, chainId);

  const signer = new Wallet(config.privateKey, provider);
  const escrow = new Contract(config.escrowAddress, ESCROW_ABI, signer);
  const propDep = new Contract(config.propDepAddress, PROPDEP_ABI, signer);

  // Memo is optional/annotation-only — only wired up on networks with a
  // verified address. Never blocks core enforcement.
  const memoAddress = resolveMemoAddress(config.network);
  const memoContract = memoAddress ? new Contract(memoAddress, MEMO_ABI, signer) : null;
  if (!memoContract) {
    console.log(`[memo] disabled - no verified Memo address configured for network "${config.network}"`);
  }

  let rpcHost: string;
  try { rpcHost = new URL(config.rpcUrl).hostname; } catch { rpcHost = config.rpcUrl; }

  let count = 0;
  let lastError: string | null = null;
  let lastAction: string | null = null;
  let lastTxHash: string | null = null;

  try {
    // Read virtual time and agreement count
    const [nextId, rentalNow, propDepNow] = await Promise.all([
      escrow.nextAgreementId(),
      escrow.currentTime(),
      propDep.currentTime(),
    ]);

    count = Number(nextId);
    console.log(`[scan] ${count} agreements | rental_now=${rentalNow} propdep_now=${propDepNow}`);

    if (count === 0) {
      // Still send heartbeat even with 0 agreements
      await sendHeartbeat(config, {
        keeperVersion: "2", chainId, rpcUrlHost: rpcHost,
        escrowAddress: config.escrowAddress, propDepAddress: config.propDepAddress,
        nextAgreementId: count, scannedCount: 0,
        actionsNeeded: 0, actionsExecuted: 0,
        lastAction: null, lastTxHash: null, lastError: null,
        flyRegion: process.env.FLY_REGION || null, instanceId: process.env.FLY_ALLOC_ID || null,
      });
      return 0;
    }

    // Check all agreements
    const actions: { action: Action; contract: Contract }[] = [];

    for (let i = 0; i < Math.min(count, config.batchSize); i++) {
      const id = BigInt(i);
      const rentalAction = await checkRentalAgreement(escrow, id);
      if (rentalAction) actions.push({ action: rentalAction, contract: escrow });
      const pdAction = await checkPropDep(propDep, id, propDepNow);
      if (pdAction) actions.push({ action: pdAction, contract: propDep });
      // Check for new rent payments and record via Arc Memo contract (skipped
      // on networks without a verified Memo address — see resolveMemoAddress)
      if (memoContract) await checkRentMemo(escrow, memoContract, id, config.dryRun);
    }

    if (actions.length === 0) {
      console.log("[scan] No actions needed");
    } else {
      console.log(`[exec] ${actions.length} action(s) to execute:`);
    }

    // Execute sequentially (same signer = same nonce)
    let executed = 0;
    for (const { action, contract } of actions) {
      const hash = await execute(contract, action, config.dryRun);
      if (hash) { executed++; lastTxHash = hash; }
      lastAction = action.method;
    }

    if (actions.length > 0) console.log(`[done] ${executed}/${actions.length} executed`);

    // Always send heartbeat — including zero-action scans
    await sendHeartbeat(config, {
      keeperVersion: "2", chainId, rpcUrlHost: rpcHost,
      escrowAddress: config.escrowAddress, propDepAddress: config.propDepAddress,
      nextAgreementId: count, scannedCount: Math.min(count, config.batchSize),
      actionsNeeded: actions.length, actionsExecuted: executed,
      lastAction, lastTxHash, lastError: null,
      flyRegion: process.env.FLY_REGION || null, instanceId: process.env.FLY_ALLOC_ID || null,
    });

    return executed;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    console.error(`[scan-error] ${lastError}`);

    // Send heartbeat with error
    await sendHeartbeat(config, {
      keeperVersion: "2", chainId, rpcUrlHost: rpcHost,
      escrowAddress: config.escrowAddress, propDepAddress: config.propDepAddress,
      nextAgreementId: count, scannedCount: 0,
      actionsNeeded: 0, actionsExecuted: 0,
      lastAction, lastTxHash, lastError,
      flyRegion: process.env.FLY_REGION || null, instanceId: process.env.FLY_ALLOC_ID || null,
    });

    throw e; // re-throw so main() loop catches it
  }
}

// ─── Heartbeat ──────────────────────────────────────────────────────────────

interface HeartbeatData {
  keeperVersion: string;
  chainId: number; // always the verified actual chainId — assertChainMatch() already ran before this is ever sent
  rpcUrlHost: string;
  escrowAddress: string;
  propDepAddress: string;
  nextAgreementId: number;
  scannedCount: number;
  actionsNeeded: number;
  actionsExecuted: number;
  lastAction: string | null;
  lastTxHash: string | null;
  lastError: string | null;
  flyRegion: string | null;
  instanceId: string | null;
}

async function sendHeartbeat(config: Config, data: HeartbeatData): Promise<void> {
  if (!config.heartbeatUrl || !config.heartbeatSecret) return;
  try {
    const r = await fetch(config.heartbeatUrl + "/api/keeper/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Keeper-Secret": config.heartbeatSecret },
      body: JSON.stringify(data),
    });
    if (!r.ok) console.warn(`[heartbeat] server returned ${r.status}`);
  } catch (e) {
    console.warn(`[heartbeat] failed: ${e instanceof Error ? e.message : e}`);
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main() {
  const config = loadConfig();

  // Fail-closed contract-address validation — after config loading, before
  // any signer or Contract object is constructed (runOnce() does both).
  // Propagates to the top-level main().catch() below on failure, same as a
  // NetworkConfigError from loadConfig() itself.
  assertContractAddressesForNetwork(config.network, config.escrowAddress, config.propDepAddress);

  console.log("=== pi2pi Keeper v2 ===");
  console.log(`Network  : ${config.network} (expected chainId ${config.expectedChainId})`);
  console.log(`Escrow   : ${config.escrowAddress}`);
  console.log(`PropDep  : ${config.propDepAddress}`);
  console.log(`RPC      : ${config.rpcUrl}`);
  console.log(`Dry run  : ${config.dryRun}`);
  console.log(`Loop     : ${config.loopInterval > 0 ? config.loopInterval + "s" : "once"}`);
  console.log();

  if (config.loopInterval > 0) {
    // Loop mode
    while (true) {
      try {
        await runOnce(config);
      } catch (e) {
        if (e instanceof NetworkMismatchError) {
          // Not a transient/retryable condition — stop the process rather than
          // spinning forever against a misconfigured or wrong-network RPC.
          console.error(`[fatal] ${e.message}`);
          console.error("[fatal] Exiting — refusing to retry after a network mismatch. No writes were performed.");
          process.exit(1);
        }
        console.error(`[fatal] ${e instanceof Error ? e.message : e}`);
      }
      console.log(`[wait] ${config.loopInterval}s...`);
      console.log();
      await new Promise(r => setTimeout(r, config.loopInterval * 1000));
    }
  } else {
    await runOnce(config);
  }
}

main().catch(e => { console.error("[fatal]", e); process.exit(1); });
