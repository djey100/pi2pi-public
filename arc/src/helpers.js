// pi2pi helpers (ES module)
import { t } from './i18n/index.js';

// pi2pi helpers — pure functions extracted from JSX (Phase C1)
// Loaded via <script> before JSX. All exports are global.

// ─── Contract revert mapper ────────────────────────────────────────────────
// Catches raw revert reasons from wallet / RPC and maps them to friendly t()-keys.
// Priority: user-rejected → exact require() string match → custom error name → generic fallback.
// Input shapes supported: string, Error, MetaMask error { code, message, data }, ethers v6 BaseError.
export const REVERT_MAP = {
  "Not a party":"contract.revert.not_a_party",
  "Not tenant":"contract.revert.not_tenant",
  "Not landlord":"contract.revert.not_landlord",
  "Not owner":"contract.revert.not_owner",
  "Wrong state":"contract.revert.wrong_state",
  "Already set":"contract.revert.wrong_state",
  "Already deposited":"contract.revert.already_deposited",
  "Already settled":"contract.revert.already_settled",
  "Not active":"contract.revert.not_active",
  "Not Active":"contract.revert.not_active",
  "zero":"contract.revert.zero_amount",
  "Zero rent":"contract.revert.zero_amount",
  "Zero duration":"contract.revert.zero_amount",
  "Amount zero":"contract.revert.zero_amount",
  "USDC zero":"contract.revert.zero_address",
  "Main zero":"contract.revert.zero_address",
  "Same address":"contract.revert.same_address",
  "Zero address":"contract.revert.zero_address",
  "Lease expired":"contract.revert.lease_expired",
  "Lease end in past":"contract.revert.zero_address",
  "Not overdue yet":"contract.revert.not_overdue_yet",
  "Invalid extension":"contract.revert.invalid_extension",
  "Already extended this cycle":"contract.revert.already_extended",
  "Silence period not expired":"contract.revert.silence_not_expired",
  "Freeze not expired":"contract.revert.freeze_not_expired",
  "Only dispute initiator can cancel":"contract.revert.only_initiator_can_cancel",
  "Use exitWithLoss for InitiatorAccepts":"contract.revert.wrong_state",
  "Not mutual type":"contract.revert.not_mutual_type",
  "Initiator already signed":"contract.revert.initiator_already_signed",
  "Only counterparty can contest":"contract.revert.only_counterparty_can_contest",
  "Only initiator can concede":"contract.revert.only_initiator_can_concede",
  "Dispute initiator cannot accept own claim":"contract.revert.bond_poster_cannot_accept",
  "Settlement totals mismatch":"contract.revert.settlement_mismatch",
  "Amounts must equal total frozen funds":"contract.revert.settlement_mismatch",
  "No proposal":"contract.revert.no_proposal",
  "Proposer cannot confirm":"contract.revert.proposer_cannot_confirm",
  "Use confirmMutualSettlement":"contract.revert.wrong_state",
  "Invalid settlement confirmation":"contract.revert.settlement_mismatch",
  "Amounts != expected":"contract.revert.amounts_mismatch",
  "Amounts mismatch":"contract.revert.amounts_mismatch",
  "Deposits already placed":"contract.revert.deposits_already_placed",
  "Deposits mismatch":"contract.revert.amounts_mismatch",
  "Prop deposit > 3x MR":"contract.revert.prop_deposit_too_high",
  "Window not open":"contract.revert.window_not_open",
  "Window closed":"contract.revert.window_closed",
  "Window still open":"contract.revert.window_closed",
  "Invalid claim amount":"contract.revert.invalid_claim_amount",
  "Bond already posted":"contract.revert.bond_already_posted",
  "Bond posted: use acceptClaimAfterBond":"contract.revert.bond_posted_use_accept",
  "Response period expired":"contract.revert.response_expired",
  "Not disputed":"contract.revert.not_disputed",
  "Not frozen":"contract.revert.not_frozen",
  "Not in Frozen state":"contract.revert.not_frozen",
  "Not in Active state":"contract.revert.not_active",
  "No bond posted":"contract.revert.no_bond_posted",
  "Only bond poster can cancel":"contract.revert.only_bond_poster",
  "Tenant already responded":"contract.revert.tenant_already_responded",
  "Deadline not passed":"contract.revert.deadline_not_passed",
  "Cannot expire - claim active":"contract.revert.wrong_state",
  "Bond period not expired":"contract.revert.wrong_state",
  "Bond was posted":"contract.revert.bond_posted_use_accept",
  "Cannot sync after claim":"contract.revert.wrong_state",
  "PropDep does not exist":"contract.revert.wrong_state",
  "Already exists":"contract.revert.wrong_state",
  "Not main contract":"contract.revert.not_owner",
  "Adapter not set":"contract.revert.wrong_state",
  "Cannot rescue USDC while agreements are active":"contract.revert.wrong_state",
  "Agreement does not exist":"contract.revert.wrong_state",
  "Not expired (180 days)":"contract.revert.wrong_state",
  "Not expired yet":"contract.revert.freeze_not_expired",
  "LendingUnavailable":"contract.revert.lending_unavailable",
  "OnlyEscrow":"contract.revert.not_owner",
  "ZeroAddress":"contract.revert.zero_address",
  "BufferOutOfRange":"contract.revert.wrong_state",
  "ProtocolFeeTooHigh":"contract.revert.wrong_state"
};
// Extract raw revert reason text from an error of any common shape.
export function extractRevertReason(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  // MetaMask nested .data.message or .data.originalError.message
  const nestedData = err.data && (err.data.message || (err.data.originalError && err.data.originalError.message));
  if (nestedData) return String(nestedData);
  // ethers v6 BaseError.shortMessage / .info.error.message
  if (err.shortMessage) return String(err.shortMessage);
  if (err.info && err.info.error && err.info.error.message) return String(err.info.error.message);
  if (err.reason) return String(err.reason);
  if (err.message) return String(err.message);
  return "";
}
// Map raw error → translated user-facing message. Never returns raw technical string.
// Network / RPC connectivity failure detector. Runs BEFORE revert lookup so that
// pure network issues (no tx ever on-chain) are not mislabeled as on-chain reverts.
// Kept narrow: only matches unambiguous network/offline/RPC terms that do NOT
// appear in any contract require() string in REVERT_MAP.
export const NETWORK_RE = /\b(ECONNREFUSED|ETIMEDOUT|ENETUNREACH|ENOTFOUND|EAI_AGAIN|ECONNRESET)\b|network\s*(is\s+)?(unavailable|error|failure|issue|down)|fetch\s+failed|failed\s+to\s+fetch|(request|connection|socket)\s+timed\s+out|could\s+not\s+(establish\s+)?connect|(rpc|provider|endpoint)\s*(is\s+)?(error|failure|unavailable|timeout|down|disconnected|failed)|\boffline\b|no\s+(internet|connection|network)|could\s+not\s+detect\s+network/i;
export function mapRevertReason(err) {
  // 1. User-rejected in wallet (MetaMask code 4001)
  if (err && (err.code === 4001 || err.code === "ACTION_REJECTED")) return t("contract.revert.user_rejected");
  // 1b. Explicit ethers-style network error codes — skip on-chain reasoning entirely.
  if (err && (err.code === "NETWORK_ERROR" || err.code === "SERVER_ERROR" || err.code === "TIMEOUT")) {
    const rawCode = extractRevertReason(err);
    return t("err.network_error", {error: rawCode || String(err.code)});
  }
  const raw = extractRevertReason(err);
  if (!raw) return t("err.failed");
  // 2. Network / connectivity detection — before revert substring lookup.
  //    Matches narrow patterns that do NOT appear in REVERT_MAP keys.
  if (NETWORK_RE.test(raw)) {
    return t("err.network_error", {error: raw.slice(0, 120)});
  }
  // 3. Direct lookup by substring (covers "execution reverted: Wrong state" and bare "Wrong state")
  for (const needle of Object.keys(REVERT_MAP)) {
    if (raw.indexOf(needle) !== -1) return t(REVERT_MAP[needle]);
  }
  // 4. Custom error name match (ethers formats as "reverted with custom error 'Name()'")
  const m = raw.match(/custom error ['"]?([A-Za-z0-9_]+)/);
  if (m && REVERT_MAP[m[1]]) return t(REVERT_MAP[m[1]]);
  // 5. Generic fallback — short raw reason in details, never the full stack
  const short = raw.replace(/^execution reverted:?\s*/i, "").slice(0, 120);
  return t("contract.revert.generic", {reason: short || t("err.failed")});
}

export function fmtCountdown(secondsLeft) {
  if (secondsLeft == null || isNaN(secondsLeft)) return "";
  if (secondsLeft <= 0) return "expired";
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── A1: Centralized hex parsing for on-chain structs ─────────────────────────
export function parseAgreement(hex) {
  const w = (i) => parseInt(hex.slice(2+i*64, 2+(i+1)*64), 16);
  const a = (i) => "0x" + hex.slice(2+i*64+24, 2+(i+1)*64);
  return Object.freeze({
    tenant: a(0).toLowerCase(), landlord: a(1).toLowerCase(),
    rent: w(2)/1e6, commitDep: w(3)/1e6, hostDep: w(4)/1e6, propDep: w(5)/1e6,
    duration: w(6), createdAt: w(7), activatedAt: w(8), leaseEnd: w(9),
    state: w(10), tenantDep: w(11)/1e6, landlordDep: w(12)/1e6,
    firstRentPaid: w(13), lastRentTimestamp: w(14), rentPayments: w(15),
    landlordWantsRenew: w(16) !== 0, tenantWantsRenew: w(17) !== 0,
    landlordVoted: w(18) !== 0, tenantVoted: w(19) !== 0,
    llVoted: w(18), tnVoted: w(19),
    leaseDurationMonths: w(6),
    disputeBond: w(24)/1e6, disputeBondPoster: a(25).toLowerCase(),
    freezeStart: w(26), freezeDuration: w(27),
    earlyTermType: w(28), earlyTermInitiator: a(29).toLowerCase(),
    earlyTermProposedAt: w(30),
    checkoutStartedAt: w(31),
    settlementProposer: a(32).toLowerCase(),
    hasSettlementProposal: w(32) !== 0,
    settlementToLL: w(33)/1e6, settlementToTN: w(34)/1e6,
    earlySettlementMode: w(35) !== 0,
    contentHash: "0x" + hex.slice(2+36*64, 2+37*64),
    hasPropDep: w(37) !== 0,
    rentGraceExtension: w(38),
    vacateDeadline: w(39),
  });
}

export function parsePropDep(hex) {
  const w = (i) => parseInt(hex.slice(2+i*64, 2+(i+1)*64), 16);
  const a = (i) => "0x" + hex.slice(2+i*64+24, 2+(i+1)*64);
  return Object.freeze({
    leaseId: w(0), tenant: a(1).toLowerCase(), landlord: a(2).toLowerCase(),
    amount: w(3)/1e6, state: w(4),
    leaseEndTime: w(5), windowStart: w(6), windowEnd: w(7),
    claimAmount: w(8)/1e6, claimDeadline: w(9),
    tenantAccepted: w(10), tenantDisputed: w(11),
    disputeBond: w(12)/1e6, bondPoster: a(13).toLowerCase(),
    freezeStart: w(14), freezeDuration: 60*86400,
  });
}

export function getDealView(agrData, propDepData, nowMs) {
  if (!agrData) return { state:"loading", label:"Loading…", tone:"neutral", detail:"" };
  const st = Number(agrData.state);
  const pdSt = propDepData ? Number(propDepData.state) : null; // 0 None, 1 Active, 2 Claimed, 3 Disputed, 4 Frozen, 5 Settled
  const leaseEnd = Number(agrData.leaseEnd) || 0;
  const activated = Number(agrData.activatedAt) || 0;
  const now = Math.floor((nowMs || Date.now()) / 1000);
  const daysLeft = leaseEnd > 0 ? Math.max(0, Math.floor((leaseEnd - now) / 86400)) : null;
  const totalDurationDays = (activated > 0 && leaseEnd > 0) ? Math.floor((leaseEnd - activated) / 86400) : null;
  const daysElapsed = (activated > 0) ? Math.floor((now - activated) / 86400) : null;
  const freezeStart = Number(agrData.freezeStart) || 0;
  const freezeDuration = Number(agrData.freezeDuration) || 0;
  const freezeEnd = freezeStart > 0 ? freezeStart + freezeDuration : 0;
  const freezeLeft = freezeEnd > 0 ? freezeEnd - now : null;
  const pdWindowEnd = propDepData ? Number(propDepData.windowEnd || 0) : 0;
  const pdWindowLeft = pdWindowEnd > 0 ? pdWindowEnd - now : null;
  const pdFreezeStart = propDepData ? Number(propDepData.freezeStart || 0) : 0;
  const pdFreezeDuration = propDepData ? Number(propDepData.freezeDuration || 0) : 0;
  const pdFreezeEnd = pdFreezeStart > 0 ? pdFreezeStart + pdFreezeDuration : 0;
  const pdFreezeLeft = pdFreezeEnd > 0 ? pdFreezeEnd - now : null;

  // Priority 1: DisputeOpen on Agreement
  if (st === 7) {
    const detail = freezeLeft != null
      ? (freezeLeft > 0 ? t("banner.dispute.frozen_countdown", {countdown: fmtCountdown(freezeLeft)}) : t("banner.dispute.freeze_expired"))
      : t("banner.dispute.resolving");
    return { state:"dispute", label:t("deal.dispute"), tone:"danger", detail };
  }
  // Priority 2: PropDep Frozen (bond posted → 60d freeze)
  if (pdSt === 4) {
    const detail = pdFreezeLeft != null
      ? (pdFreezeLeft > 0 ? t("banner.propdep.bond_countdown", {countdown: fmtCountdown(pdFreezeLeft)}) : t("banner.propdep.freeze_expired"))
      : t("banner.propdep.bond_offchain");
    return { state:"propdep-frozen", label:t("deal.propdep_frozen"), tone:"danger", detail };
  }
  // Priority 3: PropDep Disputed
  if (pdSt === 3) return { state:"propdep-disputed", label:t("deal.propdep_disputed"), tone:"danger", detail:t("banner.propdep.disputed_awaiting_bond") };
  // Priority 4: PropDep Claimed (damage filed)
  if (pdSt === 2) return { state:"propdep-claimed", label:t("deal.propdep_claimed"), tone:"danger", detail:t("banner.propdep.claimed_response") };
  // Priority 5: DamageClaimed on Agreement (legacy — usually migrated to PropDep)
  if (st === 6) return { state:"damage", label:t("deal.damage"), tone:"danger", detail:t("banner.damage.response_required") };
  // Priority 6: LeaseEnded + PropDep still Active → Inspection window open
  if (st === 9 && (pdSt === 1 || pdSt === null)) {
    const detail = pdWindowLeft != null && pdWindowLeft > 0
      ? t("banner.ended.inspection_countdown", {countdown: fmtCountdown(pdWindowLeft)})
      : (pdWindowEnd > 0 ? t("banner.ended.inspection_expired") : t("banner.ended.concluded"));
    return { state:"ended", label:t("deal.ended"), tone:"warning", detail };
  }
  // Priority 7: EarlyTermProposed
  if (st === 4) return { state:"et-proposed", label:t("deal.et_proposed"), tone:"warning", detail:t("banner.et.awaiting_response") };
  // Priority 8: CheckoutProposed
  if (st === 5) return { state:"checkout", label:t("deal.checkout"), tone:"warning", detail:t("banner.checkout.lease_ending") };
  // Priority 9: Ending soon (Active + ≤14 days left)
  if (st === 3 && daysLeft !== null && daysLeft <= 14) {
    return { state:"ending", label:t("deal.ending", {days: daysLeft, dayWord: daysLeft===1 ? t("misc.day") : t("misc.days")}), tone:"warning", detail:t("banner.ending.prepare_checkout") };
  }
  // Priority 10: Active (live)
  if (st === 3) {
    const detail = daysLeft !== null && daysElapsed !== null
      ? t("banner.active.month_progress", {month: Math.floor(daysElapsed/30)+1, total: Math.ceil(totalDurationDays/30)||"?", daysLeft})
      : t("banner.active.onchain");
    return { state:"active", label:t("deal.live"), tone:"success", detail };
  }
  // Priority 11: Provisional (pending signatures/deposits)
  if (st >= 0 && st <= 2) {
    const subKeys = ["banner.provisional.created","banner.provisional.awaiting_landlord","banner.provisional.awaiting_tenant"];
    const subState = subKeys[st] ? t(subKeys[st]) : t("banner.provisional.pending");
    return { state:"provisional", label:t("deal.pending"), tone:"info", detail: subState };
  }
  // Priority 12: Settled (Agreement + PropDep both closed)
  // Fail-closed: if agreement has a property deposit but propDepData is null (fetch failed/loading),
  // do NOT treat as settled — show "settling" instead.
  const hasPropDep = agrData.hasPropDep || (agrData.propDep > 0);
  const propDepResolved = pdSt === 5 || pdSt === 0 || (!hasPropDep && pdSt === null);
  if (st === 8 && propDepResolved) {
    return { state:"settled", label:t("deal.settled"), tone:"neutral", detail:t("banner.settled.closed") };
  }
  // Priority 13: Agreement settled but PropDep still open or unknown
  if (st === 8) return { state:"settled-partial", label:t("deal.settled_partial"), tone:"neutral", detail:t("banner.settled_partial.pending_propdep") };
  return { state:"unknown", label:t("status.unknown"), tone:"neutral", detail:t("banner.unknown.state_code", {code: st}) };
}

// Sprint 9b: "Next step" — the single most relevant action for the given state + role.
// Informational hint (not a button) — actual action buttons remain scattered in existing UI.
export function getNextStep(view, role, agrData, propDepData) {
  const isLL = role === "landlord";
  const st = view.state;
  if (st === "loading") return null;
  if (st === "active") {
    if (isLL) return { text:t("nextstep.active.landlord"), who:"landlord" };
    return { text:t("nextstep.active.tenant"), who:"tenant" };
  }
  if (st === "ending") return { text:t("nextstep.ending.both"), who:"both" };
  if (st === "checkout") return { text:t("nextstep.checkout.vacate"), who:isLL?"landlord":"tenant" };
  if (st === "et-proposed") {
    const amInitiator = agrData && agrData.earlyTermInitiator && role && (agrData.earlyTermInitiator.toLowerCase() === (agrData.tenant||"").toLowerCase() ? !isLL : isLL);
    if (amInitiator) return { text:t("nextstep.et.initiator"), who:"you" };
    return { text:t("nextstep.et.counterparty"), who:"counterparty" };
  }
  if (st === "dispute") return { text:t("nextstep.dispute.both"), who:"both" };
  if (st === "propdep-claimed") {
    if (isLL) return { text:t("nextstep.propdep_claimed.landlord"), who:"landlord" };
    return { text:t("nextstep.propdep_claimed.tenant"), who:"tenant" };
  }
  if (st === "propdep-disputed") {
    if (isLL) return { text:t("nextstep.propdep_disputed.landlord"), who:"landlord" };
    return { text:t("nextstep.propdep_disputed.tenant"), who:"tenant" };
  }
  if (st === "propdep-frozen") return { text:t("nextstep.propdep_frozen.both"), who:"both" };
  if (st === "ended") {
    if (isLL) return { text:t("nextstep.ended.landlord"), who:"landlord" };
    return { text:t("nextstep.ended.tenant"), who:"tenant" };
  }
  if (st === "provisional") {
    if (st === "provisional" && agrData) {
      const ast = Number(agrData.state);
      if (ast === 0) return { text:t("nextstep.provisional.both"), who:"both" };
      if (ast === 1) return { text:t("nextstep.provisional.tenant_waiting"), who:isLL?"landlord":"tenant" };
      if (ast === 2) return { text:t("nextstep.provisional.landlord_waiting"), who:isLL?"landlord":"tenant" };
    }
    return { text:t("nextstep.provisional.awaiting"), who:"both" };
  }
  if (st === "settled-partial") return { text:t("nextstep.settled_partial.both"), who:"both" };
  if (st === "settled") return null; // closed, nothing to do
  return null;
}

export function getDealActions(view, role, agrData, propDepData, connectedAddr, nowMs) {
  if (!agrData) return [];
  const st = Number(agrData.state);
  const isLL = role === "landlord";
  const now = Math.floor((nowMs || Date.now()) / 1000);
  const actions = [];

  if (st === 3) {
    const RENT_PERIOD = 30*86400;
    const GRACE = 3*86400; // must match RentalEscrow.RENT_GRACE_PERIOD
    const ext = agrData.rentGraceExtension || 0;
    const rentsPaid = agrData.rentPayments || 0;
    const nextDue = (agrData.activatedAt || 0) + (rentsPaid + 1) * RENT_PERIOD;
    const leaseEnd = agrData.leaseEnd || 0;
    const canPay = now >= nextDue - 5*86400 && now < leaseEnd;
    const leaseExpired = leaseEnd > 0 && now >= leaseEnd;
    const rentOverdue = agrData.activatedAt > 0 && now > nextDue + GRACE + ext;
    const within21 = leaseEnd > 0 && now >= leaseEnd - 21*86400;

    // Pay Rent: visible for tenant during Active
    // Allow early payment but block if fully paid
    const firstRentPaid = agrData.firstRentPaid !== false && agrData.firstRentPaid !== 0;
    const totalPaid = (firstRentPaid ? 1 : 0) + rentsPaid;
    const duration = agrData.leaseDurationMonths || agrData.duration || 6;
    const fullyPaid = totalPaid >= duration;
    if (!isLL && !leaseExpired) {
      if (rentOverdue || fullyPaid) {
        actions.push({ id:"payRent", label: fullyPaid ? "Rent fully paid" : "Pay Rent", tone:"muted", icon:"", disabled: true });
      } else {
        actions.push({ id:"payRent", label:"Pay Rent", tone:"accent", icon:"" });
      }
    }
    if (leaseExpired) actions.push({ id:"endLease", label:t("btn.end_lease"), tone:"success", icon:"" });
    if (isLL && rentOverdue) actions.push({ id:"flagRentMissed", label:t("btn.flag_rent_missed"), tone:"danger", icon:"" });
    if (isLL) actions.push({ id:"grantGrace", label:t("btn.grant_grace"), tone:"outline-warning", icon:"" });
    if (within21) actions.push({ id:"leaseEndingInfo", label:"_info", tone:"info" });
    actions.push({ id:"terminateEarly", label:t("btn.terminate_early"), tone:"outline-danger", icon:"" });
  }

  if (st === 4) {
    actions.push({ id:"openETForm", label:t("btn.open_et_form"), tone:"warning", icon:"" });
  }

  if (st === 7) {
    const freezeEnd = (agrData.freezeStart || 0) + (agrData.freezeDuration || 0);
    const expired = Math.max(0, freezeEnd - now) === 0 && agrData.freezeStart > 0;
    const amInitiator = agrData.earlyTermInitiator && connectedAddr && agrData.earlyTermInitiator.toLowerCase() === connectedAddr;
    const amClaimant = agrData.disputeBondPoster && connectedAddr && agrData.disputeBondPoster.toLowerCase() === connectedAddr;
    if (expired) actions.push({ id:"releaseFrozenFunds", label:t("btn.release_frozen"), tone:"success", icon:"" });
    if (!expired && !amClaimant) actions.push({ id:"acceptClaim", label:t("btn.accept_claim"), tone:"success", icon:"" });
    if (!expired && amClaimant) actions.push({ id:"disputeWaiting", label:"_info", tone:"muted" });
  }

  return actions;
}

// ─── WEB3 CONFIG (network-explicit, fail-closed) ──────────────────────────────
// Build-time network selection via VITE_NETWORK (see arc/.env.production /
// .env.development / .env.test — non-secret, checked in, same role as
// fly.toml's NETWORK for the backend/keeper). No implicit fallback: an
// unrecognized or unconfigured network throws at module evaluation time,
// failing the APP closed rather than silently reusing another network's
// values. Note this is not a build-time failure: `vite build` is a pure
// bundler/transpiler that never executes application code, so it cannot fail
// on a bad VITE_NETWORK — the throw only fires when the bundle is actually
// loaded and run (in a browser, or any test/Node context that executes it).
//
// Two separate layers on purpose:
//   1. NETWORK_CHAIN_IDS — pure chainId mapping, known for every network name
//      (a chainId is just a number, not a security-sensitive value).
//   2. NETWORK_CONFIGS — full usable runtime config (RPC, contract addresses,
//      Circle support). Only populated for networks with addresses verified
//      in this repository. Arc Mainnet has none yet — intentionally absent,
//      never guessed. A build configured for a network in (1) but missing
//      from (2) fails clearly instead of falling back to testnet addresses.

export const NETWORK_CHAIN_IDS = Object.freeze({
  "arc-testnet": 5042002,
  "arc-mainnet": 5042,
});

export class NetworkConfigError extends Error {}

export function resolveExpectedChainId(network) {
  const chainId = NETWORK_CHAIN_IDS[network];
  if (chainId === undefined) {
    throw new NetworkConfigError(`Unsupported network "${network}". Supported: ${Object.keys(NETWORK_CHAIN_IDS).join(", ")}`);
  }
  return chainId;
}

export const NETWORK_CONFIGS = Object.freeze({
  "arc-testnet": {
    chainIdHex: "0x4cef52", // 5042002
    chainName: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrl: "https://rpc.testnet.arc.network",
    blockExplorerUrl: "https://testnet.arcscan.app",
    // RentalEscrow: full security audit (round-2 + Codex round-3 C-1/C-2/C-3 + F-13-strict), switched active 2026-09-06
    escrowAddress: "0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8",
    propdepAddress: "0xe2190997F3811B771C25525C8401504a0e5330c5", // PropDepEscrow (same switch, 2026-09-06)
    usdcAddress: "0x3600000000000000000000000000000000000000",
    circleSupported: true,
  },
  "arc-mainnet": {
    chainIdHex: "0x13b2", // 5042
    chainName: "Arc Mainnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrl: "https://rpc.mainnet.arc.io",
    blockExplorerUrl: "https://explorer.arc.io",
    // First Arc Mainnet deployment — controlled beta, TASK 6C/6D browser-wallet-signed broadcast, 2026-09-17. See config/deployments.json["5042"].
    escrowAddress: "0x06A2b584278f519ba7562c8ac27f4A5C31d52103",
    propdepAddress: "0x55dDa2FD8C37383E33DF32b15EED978Ac6B91532",
    usdcAddress: "0x3600000000000000000000000000000000000000",
    // Circle Modular Wallets support on Arc Mainnet independently confirmed
    // TASK 10AO (developers.circle.com/wallets/supported-blockchains lists
    // Arc ARC/ARC-TESTNET with MSCA support; official /arc mainnet transport
    // path documented in circlefin/skills). Mainnet LIVE Client Key + RP ID
    // provisioned in Circle Console TASK 10AR/10AS. See wallet.js for the
    // network-aware transport path/defineChain/Client Key selection.
    circleSupported: true,
  },
});

export function resolveNetworkConfig(network) {
  resolveExpectedChainId(network); // validates the name itself first, independent of address availability
  const cfg = NETWORK_CONFIGS[network];
  if (!cfg) {
    throw new NetworkConfigError(`Network "${network}" has no verified runtime configuration (contract addresses/RPC/Circle) in this repository yet — cannot build or run for it.`);
  }
  return cfg;
}

/** Whether the given network has verified Circle Wallets configuration. Never assumed true by default. */
export function isCircleSupported(network) {
  return NETWORK_CONFIGS[network]?.circleSupported === true;
}

export const ACTIVE_NETWORK_NAME = import.meta.env.VITE_NETWORK;
const ACTIVE_NETWORK_CONFIG = resolveNetworkConfig(ACTIVE_NETWORK_NAME); // throws at module load if unset/unsupported/unconfigured
export const ACTIVE_CHAIN_ID_DEC = resolveExpectedChainId(ACTIVE_NETWORK_NAME);

export const CONTRACT_VERSION = 8; // bump on every redeploy — forces stale tabs to reload
export const ESCROW_ADDRESS  = ACTIVE_NETWORK_CONFIG.escrowAddress;
export const PROPDEP_ADDRESS = ACTIVE_NETWORK_CONFIG.propdepAddress;
export const USDC_ADDRESS    = ACTIVE_NETWORK_CONFIG.usdcAddress;
// Name kept for backward compatibility (many call sites pass this directly as
// EIP-3085 wallet_addEthereumChain params) — its VALUE now reflects whichever
// network ACTIVE_NETWORK_NAME resolves to, not a permanent testnet literal.
export const ARC_TESTNET_CHAIN = {
  chainId: ACTIVE_NETWORK_CONFIG.chainIdHex,
  chainName: ACTIVE_NETWORK_CONFIG.chainName,
  nativeCurrency: ACTIVE_NETWORK_CONFIG.nativeCurrency,
  rpcUrls: [ACTIVE_NETWORK_CONFIG.rpcUrl],
  blockExplorerUrls: [ACTIVE_NETWORK_CONFIG.blockExplorerUrl],
};
export const USDC_DECIMALS = 6; // Arc: ERC-20 precompile uses 6 decimals for approve/transfer (both Arc Testnet and Arc Mainnet per Arc docs)
// Network-aware RPC/explorer base — replaces the scattered hardcoded
// "rpc.testnet.arc.network" / "testnet.arcscan.app" literals that used to
// live in individual components (TASK 10A). Always reflects whichever
// network ACTIVE_NETWORK_NAME resolves to.
export const RPC_URL = ACTIVE_NETWORK_CONFIG.rpcUrl;
export const EXPLORER_BASE_URL = ACTIVE_NETWORK_CONFIG.blockExplorerUrl;

// Minimal cross-environment navigation (TASK 10A / 10A-REVISION target
// architecture: my.pi2pi.io = Arc Mainnet, testnet.pi2pi.io = Arc Testnet).
// A hardcoded two-way map, not a generic "any network" mechanism —
// deliberately small, matching only the two hosts this app is actually
// deployed to.
const OTHER_NETWORK_HOSTS = Object.freeze({
  "arc-mainnet": { url: "https://testnet.pi2pi.io", label: "Testnet" },
  "arc-testnet": { url: "https://my.pi2pi.io", label: "Mainnet" },
});
/**
 * Pure function version — takes a network name explicitly rather than
 * always reading the active build's fixed ACTIVE_NETWORK_NAME, so both
 * directions (testnet→mainnet link, mainnet→testnet link) are directly
 * testable from a single test build without needing two separate Vite
 * builds. Returns null for any network with no configured cross-link.
 */
export function resolveOtherNetworkLink(network) {
  return OTHER_NETWORK_HOSTS[network] ?? null;
}
const _otherNetworkLink = resolveOtherNetworkLink(ACTIVE_NETWORK_NAME);
export const OTHER_NETWORK_APP_URL = _otherNetworkLink?.url ?? null;
export const OTHER_NETWORK_LABEL = _otherNetworkLink?.label ?? null;

// This build's OWN branded app URL (TASK 10P) — the mirror image of
// OTHER_NETWORK_HOSTS above (arc-testnet's own URL is arc-mainnet's OTHER
// url, and vice versa), kept as an explicit separate table rather than
// derived from it so this addition can't accidentally perturb
// OTHER_NETWORK_APP_URL/LABEL's already-tested values. Previously
// components hardcoded "https://my.pi2pi.io" directly into share links
// regardless of which network was active (TASK 10O audit finding) — this
// is the single authoritative replacement.
const ACTIVE_NETWORK_HOSTS = Object.freeze({
  "arc-testnet": "https://testnet.pi2pi.io",
  "arc-mainnet": "https://my.pi2pi.io",
});
export function resolveActiveNetworkAppUrl(network) {
  return ACTIVE_NETWORK_HOSTS[network] ?? null;
}
export const ACTIVE_NETWORK_APP_URL = resolveActiveNetworkAppUrl(ACTIVE_NETWORK_NAME);

// Normalize any agreementId representation ("0x00...02" / number / string) → decimal string for display.
export function toDecAgreementId(id) {
  if (id === null || id === undefined) return "";
  const s = typeof id === "string" ? id : String(id);
  if (!s) return "";
  try { return s.startsWith("0x") ? BigInt(s).toString() : s; }
  catch { return s; }
}

export const SEL = {
  // Main RentalEscrow
  createAgreement: "0x92300c47",
  tenantDeposit:   "0x450c2620",
  landlordDeposit: "0x23cdd301",
  payRent:         "0xd9e8843f",
  approve:         "0x095ea7b3",
  transfer:        "0xa9059cbb", // ERC-20 transfer(address,uint256)
  balanceOf:       "0x70a08231",
  allowance:       "0xdd62ed3e",
  getAgreement:    "0x4f9f6fe6",
  nextAgreementId: "0xc9b99dab",
  // Lease end
  endLease:                "0x91ef935c", // (uint256 id) — anyone, after leaseEndTime
  extendRentGrace:         "0xb44d86ee", // (uint256 id, uint256 days) — landlord
  flagRentMissed:          "0xe36b1564", // (uint256 id) — permissionless
  // Early termination
  proposeEarlyTermination: "0x9b083c4b",
  signMutualExit:          "0x394ce516",
  executeInitiatorAcceptsLoss: "0x12ab8d4a",
  postEarlyTermBond:       "0xba31bfc8",
  waiveInitiatorLoss:      "0x733f3034",
  counterpartyContest:     "0x5852aa73",
  cancelDisputeExit:       "0x77ebd8fd",
  concedeDispute:          "0x6d486997",
  acceptDisputeExit:       "0xf1f0c8f5",
  acceptInitiatorLoss:     "0x775eabdc",
  // Early term dispute resolution (in main)
  releaseFrozenFunds:      "0x17f08eda",
  proposeEarlySettlement:  "0x0d90ed9c",
  confirmEarlySettlement:  "0xddf516bb", // (uint256 id, uint256 expectedToLandlord, uint256 expectedToTenant)
  // DEV / owner
  _devSetLeaseEndTime:      "0x6c35b820", // (uint256 id, uint256 newLeaseEndTime)
  _devSetTimes:             "0x423a8cf6", // (uint256 id, uint256 activatedAt, uint256 leaseEnd, uint256 lastRent, uint256 rentPaymentsMade) — sentinel uint256.max = leave unchanged
  cancelUnfunded:           "0x41e8a42a", // (uint256 id) — permissionless after DEPOSIT_DEADLINE (24h)
  currentTime:              "0xd18e81b3", // () view — returns virtual time (_now())
  nextRentDue:              "0x67073bfe", // (uint256 id) view — returns next rent due timestamp
  exitWithLoss:             "0x8a7beca2", // (uint256 id) — Sprint 4: atomic exit, initiator's deposit → counterparty
  _devForceFreezeExpired:   "0x51695eba", // (uint256 id) — owner only, sets freezeStart to past so releaseFrozenFunds works
};

// PropDepEscrow selectors (separate contract)
export const SEL_PROPDEP = {
  fileDamageClaim:         "0x3cc5f1db", // (uint256 leaseId, uint256 amount) — landlord
  withdrawClaim:           "0xa224dcb7", // (uint256 leaseId) — landlord
  postBond:                "0xd89b73d0", // (uint256 leaseId) — landlord
  acceptClaim:             "0x974e527a", // (uint256 leaseId) — tenant
  disputeClaim:            "0x9302f104", // (uint256 leaseId) — tenant
  acceptClaimAfterBond:    "0xe650e3a4", // (uint256 leaseId) — tenant
  expirePropDepWindow:     "0x3d237db4", // (uint256 leaseId) — anyone, after windowEnd
  releaseDepositEarly:     "0xf4a5a9b1", // (uint256 leaseId) — landlord, any time during Active
  expireDamageClaim:       "0x7eb91fac", // (uint256 leaseId) — anyone
  executeExpiredClaim:     "0x720147c4", // (uint256 leaseId) — anyone
  releaseFrozenFunds:      "0x17f08eda", // (uint256 leaseId) — anyone
  cancelDispute:           "0xdf02935c", // (uint256 leaseId) — bondPoster
  proposeMutualSettlement: "0xd7397ffc", // (uint256 leaseId, uint256 toL, uint256 toT)
  confirmMutualSettlement: "0x0147aebe", // (uint256 leaseId, uint256 expectedToLandlord, uint256 expectedToTenant)
  getPropDep:              "0xc55ab8e7", // (uint256 leaseId) view
  getState:                "0x44c9af28", // (uint256 leaseId) view
  isResolved:              "0xcc4e1954", // (uint256 leaseId) view
  isWindowOpen:            "0x1f30484d", // (uint256 leaseId) view
  setPropDepWindowDuration:"0x6938ec6a", // (uint256) owner
  setFreezeDuration:       "0x6ca2aa95", // (uint256) owner
  _devForceFreezeExpired:  "0x51695eba", // (uint256 leaseId) owner — sets freezeStart to past
  _devForceWindowExpired:  "0xcebf2c09", // (uint256 leaseId) owner — sets windowEnd to past
};

export const encAddr = (a) => a.toLowerCase().replace("0x","").padStart(64,"0");
export const encUint = (n) => BigInt(n).toString(16).padStart(64,"0");
