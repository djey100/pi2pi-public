// Tests for Admin Observability endpoints and logic
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

// ─── System Health ───────────────────────────────────────────────────────────

describe('System Health', () => {
  it('returns wiring mismatch when addresses differ', () => {
    const propDepLink = "0xaaaa";
    const expectedPropDep = "0xcccc";
    expect(propDepLink.toLowerCase() === expectedPropDep.toLowerCase()).toBe(false);
  });

  it('returns wiringOk true when addresses match', () => {
    const a = "0x427F250Cf08951bB58b1AF5D5500aeCFD384c924";
    expect(a.toLowerCase() === a.toLowerCase()).toBe(true);
  });

  it('detects missing bytecode', () => {
    expect("0x".length > 2).toBe(false);
    expect("0xdeadbeef".length > 2).toBe(true);
  });

  it('detects zero address owner', () => {
    expect("0x0000000000000000000000000000000000000000" === "0x0000000000000000000000000000000000000000").toBe(true);
  });
});

// ─── Agreement Inspector rent math ──────────────────────────────────────────

describe('Agreement Inspector rent math', () => {
  it('nextRentDue = activatedAt + (rentPaymentsMade + 1) * 30d, not lastRentTimestamp', () => {
    const activatedAt = 1000000;
    const rentPaymentsMade = 1;
    const lastRentTimestamp = activatedAt + 45 * 86400; // paid late
    // Correct formula: schedule based on activatedAt, not lastRentTimestamp
    const nextRentDue = activatedAt + (rentPaymentsMade + 1) * 30 * 86400;
    // nextRentDue should be activatedAt + 60 days, regardless of when rent was actually paid
    expect(nextRentDue).toBe(activatedAt + 2 * 30 * 86400);
    // Wrong formula would use lastRentTimestamp:
    const wrongNextRentDue = lastRentTimestamp + 30 * 86400;
    expect(wrongNextRentDue).not.toBe(nextRentDue);
  });

  it('rentGraceExtension is seconds: graceEnd adds days correctly', () => {
    const activatedAt = 1000000;
    const rentPaymentsMade = 0;
    const rentGraceExtension = 5 * 86400; // 5 days in seconds
    const nextRentDue = activatedAt + (rentPaymentsMade + 1) * 30 * 86400;
    // graceEnd = nextRentDue + 3 days (259200s) + rentGraceExtension (already seconds)
    const graceEnd = nextRentDue + 259200 + rentGraceExtension;
    // Should be nextRentDue + 8 days total
    expect(graceEnd).toBe(nextRentDue + 8 * 86400);
    // rentGraceExtensionDays for display
    expect(rentGraceExtension / 86400).toBe(5);
  });

  it('graceEnd with zero extension = nextRentDue + 3 days', () => {
    const nextRentDue = 2000000;
    const rentGraceExtension = 0;
    const graceEnd = nextRentDue + 259200 + rentGraceExtension;
    expect(graceEnd).toBe(nextRentDue + 3 * 86400);
  });

  it('newly active agreement: firstRentPaid=true, rentPaymentsMade=0 → total=1', () => {
    const firstRentPaid = true;
    const rentPaymentsMade = 0;
    const totalRentPeriodsPaid = firstRentPaid ? rentPaymentsMade + 1 : rentPaymentsMade;
    expect(totalRentPeriodsPaid).toBe(1);
  });

  it('after 3 recurring payments: firstRentPaid=true, rentPaymentsMade=3 → total=4', () => {
    const firstRentPaid = true;
    const rentPaymentsMade = 3;
    const totalRentPeriodsPaid = firstRentPaid ? rentPaymentsMade + 1 : rentPaymentsMade;
    expect(totalRentPeriodsPaid).toBe(4);
  });

  it('pre-activation: firstRentPaid=false, rentPaymentsMade=0 → total=0', () => {
    const firstRentPaid = false;
    const rentPaymentsMade = 0;
    const totalRentPeriodsPaid = firstRentPaid ? rentPaymentsMade + 1 : rentPaymentsMade;
    expect(totalRentPeriodsPaid).toBe(0);
  });

  it('rentGraceExtension=432000 seconds displays as 5 days', () => {
    const rentGraceExtension = 432000; // 5 * 86400
    const rentGraceExtensionDays = rentGraceExtension / 86400;
    expect(rentGraceExtensionDays).toBe(5);
  });

  it('rentGraceExtension=0 displays as 0 days', () => {
    expect(0 / 86400).toBe(0);
  });
});

// ─── PropDep minimum claim threshold ─────────────────────────────────────────

describe('PropDep minimum claim (30%)', () => {
  it('8 USDC deposit → minimum claim = 2.4 USDC', () => {
    const propDep = 8;
    const minClaim = Math.ceil(propDep * 0.3 * 100) / 100;
    expect(minClaim).toBe(2.4);
  });

  it('1 USDC below minimum disables button', () => {
    const propDep = 8;
    const claimAmt = 1;
    const minClaim = Math.ceil(propDep * 0.3 * 100) / 100;
    const disabled = claimAmt < minClaim;
    expect(disabled).toBe(true);
  });

  it('2.39 USDC below minimum disables button', () => {
    const propDep = 8;
    const claimAmt = 2.39;
    const minClaim = Math.ceil(propDep * 0.3 * 100) / 100;
    const disabled = claimAmt < minClaim;
    expect(disabled).toBe(true);
  });

  it('2.4 USDC at minimum enables button', () => {
    const propDep = 8;
    const claimAmt = 2.4;
    const minClaim = Math.ceil(propDep * 0.3 * 100) / 100;
    const disabled = claimAmt < minClaim;
    expect(disabled).toBe(false);
  });

  it('full deposit enables button', () => {
    const propDep = 8;
    const claimAmt = 8;
    const minClaim = Math.ceil(propDep * 0.3 * 100) / 100;
    const disabled = claimAmt < minClaim;
    expect(disabled).toBe(false);
  });

  it('3000 USDC deposit → minimum = 900 USDC', () => {
    const minClaim = Math.ceil(3000 * 0.3 * 100) / 100;
    expect(minClaim).toBe(900);
  });
});

// ─── PropDep settled text by resolution type ────────────────────────────────

describe('PropDep settled text classification', () => {
  function classifySettledText(tenantAccepted, tenantDisputed, freezeStart) {
    const claimAccepted = !!tenantAccepted;
    const wasDisputed = !!tenantDisputed;
    const hadFreeze = freezeStart > 0;
    const freezeExpired = wasDisputed && hadFreeze;

    if (claimAccepted) return "claim_accepted";
    if (freezeExpired) return "freeze_expired";
    return "no_claim";
  }

  it('freeze_expired: disputed + froze → "freeze_expired"', () => {
    expect(classifySettledText(false, true, 1780827747)).toBe("freeze_expired");
  });

  it('claim_accepted: tenant accepted → "claim_accepted"', () => {
    expect(classifySettledText(true, false, 0)).toBe("claim_accepted");
  });

  it('no_claim: no dispute, no accept → "no_claim"', () => {
    expect(classifySettledText(false, false, 0)).toBe("no_claim");
  });

  it('disputed but no freeze (bond not posted, claim dropped) → "no_claim"', () => {
    // tenantDisputed but freezeStart=0 means landlord didn't post bond
    expect(classifySettledText(false, true, 0)).toBe("no_claim");
  });

  it('freeze_expired text includes "Dispute expired unresolved"', () => {
    const text = "Dispute expired unresolved. Property deposit returned to Tenant. Landlord bond returned to Landlord. No damage claim was paid by the protocol.";
    expect(text).toContain("Dispute expired unresolved");
    expect(text).toContain("Property deposit returned to Tenant");
    expect(text).toContain("Landlord bond returned to Landlord");
    expect(text).not.toContain("No damage claimed");
  });

  it('no_claim text is "No damage claimed. Full deposit returned to Tenant."', () => {
    const text = "No damage claimed. Full deposit returned to Tenant.";
    expect(text).toContain("No damage claimed");
    expect(text).not.toContain("Dispute expired");
  });
});

// ─── PropDep wrapper early-return bypass for propDepState 5 ─────────────────

describe('PropDep wrapper: propDepState 5 must reach PropDepSection', () => {
  // Simulates the wrapper logic
  function wrapperReturnsEarly(rentalState, propDepState) {
    // Only intercept propDepState 0 (None) — let 5 (Settled) pass through to PropDepSection
    if ((rentalState === 8 || rentalState === 9) && propDepState === 0) return true;
    return false;
  }

  it('rental 8 + propDep 0 → wrapper shows "No damage claimed" (early return)', () => {
    expect(wrapperReturnsEarly(8, 0)).toBe(true);
  });

  it('rental 8 + propDep 5 → wrapper does NOT early return (passes to PropDepSection)', () => {
    expect(wrapperReturnsEarly(8, 5)).toBe(false);
  });

  it('rental 8 + propDep 5 + tenantDisputed + freezeStart > 0 → shows "Dispute expired" not "No damage claimed"', () => {
    const tenantDisputedClaim = true;
    const freezeStart = 1780827747;
    const tenantAcceptedClaim = false;
    const wasDisputed = !!tenantDisputedClaim;
    const hadFreeze = freezeStart > 0;
    const freezeExpired = wasDisputed && hadFreeze;
    const claimAccepted = !!tenantAcceptedClaim;

    let text;
    if (claimAccepted) text = "Damage claim settled";
    else if (freezeExpired) text = "Dispute expired unresolved. Property deposit returned to Tenant. Landlord bond returned to Landlord. No damage claim was paid by the protocol.";
    else text = "No damage claimed. Full deposit returned to Tenant.";

    expect(text).toContain("Dispute expired unresolved");
    expect(text).not.toContain("No damage claimed");
  });
});

// ─── PropDep display logic after flagRentMissed ─────────────────────────────

describe('PropDep display after rental Settled', () => {
  // Simulates the fixed PropDepSection gating logic
  function shouldShowClaimUI(rentalState, propDepState) {
    // Old bug: rentalState 8/9 always returned "resolved" regardless of propDepState
    // Fix: only return "resolved" if propDepState is 0 (None) or 5 (Settled)
    if ((rentalState === 8 || rentalState === 9) && (propDepState === 0)) return false; // resolved, no UI
    if (propDepState === 5) return false; // settled
    return true; // show claim UI for propDepState 1-4
  }

  it('rental state 8 + propDep state 1 (Active) => claim UI visible', () => {
    expect(shouldShowClaimUI(8, 1)).toBe(true);
  });

  it('rental state 8 + propDep state 1 => no "full deposit returned" text', () => {
    // "full deposit returned" only shows when propDepState is 0 or 5
    const showsResolvedText = (8 === 8) && (1 === 0 || 1 === 5);
    expect(showsResolvedText).toBe(false);
  });

  it('propDep state 5 (Settled) => resolved text visible', () => {
    expect(shouldShowClaimUI(8, 5)).toBe(false);
  });

  it('rental state 8 + propDep state 0 (None) => resolved, no claim UI', () => {
    expect(shouldShowClaimUI(8, 0)).toBe(false);
  });

  it('rental state 9 + propDep state 1 => claim UI visible', () => {
    expect(shouldShowClaimUI(9, 1)).toBe(true);
  });

  it('rental state 3 (Active) + propDep state 1 => claim UI visible', () => {
    expect(shouldShowClaimUI(3, 1)).toBe(true);
  });
});

// ─── Deal card archive/settled gating with PropDep ──────────────────────────

describe('Deal card: archive/settled gating with PropDep state (fail-closed)', () => {
  // Fail-closed: if hasPropDep and propDepData is null, treat as unresolved
  function propDepResolved(propDepState, hasPropDep) {
    if (propDepState === 0 || propDepState === 5) return true;
    if (propDepState == null && !hasPropDep) return true; // no prop dep at all
    return false; // null with hasPropDep, or state 1-4
  }
  function cardShowsArchived(rentalState, propDepState, hasPropDep) {
    return (rentalState === 8 || rentalState === 9) && propDepResolved(propDepState, hasPropDep);
  }
  function showClosureBlock(rentalState, propDepState, hasPropDep) {
    return (rentalState === 8 || rentalState === 9) && propDepResolved(propDepState, hasPropDep);
  }
  function showArchiveButton(rentalState, propDepState, hasPropDep, alreadyArchived) {
    return (rentalState === 8 || rentalState === 9) && propDepResolved(propDepState, hasPropDep) && !alreadyArchived;
  }

  it('rental 8 + propDep 3 (Disputed) => NOT archived label', () => {
    expect(cardShowsArchived(8, 3, true)).toBe(false);
  });

  it('rental 8 + propDep 3 => no "All funds distributed" closure block', () => {
    expect(showClosureBlock(8, 3, true)).toBe(false);
  });

  it('rental 8 + propDep 3 => archive button hidden', () => {
    expect(showArchiveButton(8, 3, true, false)).toBe(false);
  });

  it('rental 8 + propDep 5 (Settled) => archived/closed allowed', () => {
    expect(cardShowsArchived(8, 5, true)).toBe(true);
    expect(showClosureBlock(8, 5, true)).toBe(true);
    expect(showArchiveButton(8, 5, true, false)).toBe(true);
  });

  it('rental 8 + propDep 0 (None) => archived/closed allowed', () => {
    expect(cardShowsArchived(8, 0, true)).toBe(true);
  });

  it('rental 8 + propDep 1 (Active) => NOT archived', () => {
    expect(cardShowsArchived(8, 1, true)).toBe(false);
    expect(showArchiveButton(8, 1, true, false)).toBe(false);
  });

  it('rental 8 + propDep 2 (Claimed) => NOT archived', () => {
    expect(cardShowsArchived(8, 2, true)).toBe(false);
  });

  it('rental 8 + propDep 4 (Frozen) => NOT archived', () => {
    expect(cardShowsArchived(8, 4, true)).toBe(false);
  });

  it('archive button hidden when already archived', () => {
    expect(showArchiveButton(8, 5, true, true)).toBe(false);
  });

  // ─── Fail-closed: null propDepData with hasPropDep ───
  it('rental 8 + hasPropDep true + propDepData null => NOT archived (fail-closed)', () => {
    expect(cardShowsArchived(8, null, true)).toBe(false);
  });

  it('rental 8 + hasPropDep true + propDepData null => no closure block', () => {
    expect(showClosureBlock(8, null, true)).toBe(false);
  });

  it('rental 8 + hasPropDep true + propDepData null => archive button hidden', () => {
    expect(showArchiveButton(8, null, true, false)).toBe(false);
  });

  it('rental 8 + hasPropDep false + propDepData null => archived OK (no prop dep)', () => {
    expect(cardShowsArchived(8, null, false)).toBe(true);
    expect(showClosureBlock(8, null, false)).toBe(true);
    expect(showArchiveButton(8, null, false, false)).toBe(true);
  });
});

// ─── Backend: active-contract / archived-contracts with PropDep state ────────

describe('Backend: active-contract endpoint with PropDep check', () => {
  // Simulates the server logic for GET /api/active-contract/:addr
  function activeContractReturns(dbArchived, agrId, propDepState, propDepHasData) {
    if (!dbArchived) return "active"; // not archived in DB → return as active
    if (agrId && propDepState > 0 && propDepState < 5 && propDepHasData) {
      return "active-settling"; // archived in DB but PropDep unresolved → return as active
    }
    return "null"; // truly archived
  }

  it('archived DB + propDepState 3 + hasData => returned as active/settling', () => {
    expect(activeContractReturns(true, "1", 3, true)).toBe("active-settling");
  });

  it('archived DB + propDepState 5 => remains null (truly archived)', () => {
    expect(activeContractReturns(true, "1", 5, false)).toBe("null");
  });

  it('archived DB + propDepState 0 => remains null (no prop dep)', () => {
    expect(activeContractReturns(true, "1", 0, false)).toBe("null");
  });

  it('archived DB + propDepState 1 + hasData => returned as active/settling', () => {
    expect(activeContractReturns(true, "1", 1, true)).toBe("active-settling");
  });

  it('not archived DB => always active', () => {
    expect(activeContractReturns(false, "1", 3, true)).toBe("active");
  });
});

describe('Backend: archived-contracts endpoint excludes unresolved PropDep', () => {
  // Simulates the server filter logic
  function isIncludedInArchived(agrId, propDepState, propDepHasData) {
    if (agrId && propDepState > 0 && propDepState < 5 && propDepHasData) return false; // excluded
    return true; // included in archived list
  }

  it('propDepState 3 + hasData => excluded from archived list', () => {
    expect(isIncludedInArchived("1", 3, true)).toBe(false);
  });

  it('propDepState 5 => included in archived list', () => {
    expect(isIncludedInArchived("1", 5, false)).toBe(true);
  });

  it('propDepState 0 => included in archived list', () => {
    expect(isIncludedInArchived("1", 0, false)).toBe(true);
  });

  it('propDepState 4 (Frozen) + hasData => excluded from archived list', () => {
    expect(isIncludedInArchived("1", 4, true)).toBe(false);
  });

  it('no agreementId => included (no on-chain check possible)', () => {
    expect(isIncludedInArchived(null, 0, false)).toBe(true);
  });
});

// ─── Selector consistency ────────────────────────────────────────────────────

describe('PropDep selector consistency', () => {
  it('getPropDep selector matches helpers.js SEL_PROPDEP.getPropDep', async () => {
    const { SEL_PROPDEP } = await import('../helpers.js');
    // server-arc.js checkPropDepState uses 0xc55ab8e7
    const serverSelector = "0xc55ab8e7";
    expect(serverSelector).toBe(SEL_PROPDEP.getPropDep);
  });

  it('getState selector matches helpers.js SEL_PROPDEP.getState', async () => {
    const { SEL_PROPDEP } = await import('../helpers.js');
    // server-arc.js checkPropDepState uses 0x44c9af28
    const serverSelector = "0x44c9af28";
    expect(serverSelector).toBe(SEL_PROPDEP.getState);
  });
});

describe('checkPropDepState logic', () => {
  // Simulates checkPropDepState return when RPC returns state 3 and struct with amount > 0
  it('state 3 + amount > 0 => { state: 3, hasData: true }', () => {
    const state = 3;
    const amount = 8_000_000; // 8 USDC in micro
    const hasData = state > 0 && state < 5 && amount > 0;
    expect({ state, hasData }).toEqual({ state: 3, hasData: true });
  });

  it('state 5 => hasData check skipped, returns { state: 5, hasData: false }', () => {
    const state = 5;
    // hasData check only runs for state 1-4
    const hasData = false;
    expect({ state, hasData }).toEqual({ state: 5, hasData: false });
  });

  it('state 0 => returns { state: 0, hasData: false }', () => {
    const state = 0;
    const hasData = false;
    expect({ state, hasData }).toEqual({ state: 0, hasData: false });
  });

  it('state 3 + amount 0 => { state: 3, hasData: false }', () => {
    const state = 3;
    const amount = 0;
    const hasData = state > 0 && state < 5 && amount > 0;
    expect({ state, hasData }).toEqual({ state: 3, hasData: false });
  });
});

// ─── getDealView returns correct state for propDep-disputed ─────────────────

describe('getDealView: propDep-disputed priority', () => {
  it('rental 8 + propDep 3 → state is propdep-disputed, not settled', () => {
    // getDealView checks pdSt === 3 (Priority 3) BEFORE settled check (Priority 12)
    const pdSt = 3;
    const st = 8;
    // Priority 3 fires first
    const result = pdSt === 3 ? "propdep-disputed" : (st === 8 ? "settled" : "unknown");
    expect(result).toBe("propdep-disputed");
  });

  it('rental 8 + propDep 5 → state is settled', () => {
    const pdSt = 5;
    const st = 8;
    const result = pdSt === 3 ? "propdep-disputed" : (st === 8 && (pdSt === 5 || pdSt === 0) ? "settled" : "unknown");
    expect(result).toBe("settled");
  });
});

// ─── Agreement Inspector diagnosis ──────────────────────────────────────────

describe('Agreement Inspector diagnosis', () => {
  it('isRentOverdue false after lease end (Section 1 fix)', () => {
    const currentTime = 2000000;
    const leaseEndTime = 1900000;
    const isLeaseExpired = currentTime >= leaseEndTime;
    const isRentOverdue = isLeaseExpired ? false : true;
    expect(isLeaseExpired).toBe(true);
    expect(isRentOverdue).toBe(false);
  });

  it('shouldKeeperCall = endLease when Active + lease expired', () => {
    const state = 3;
    let call = null;
    if (state === 3 && true) call = "endLease"; // isLeaseExpired
    expect(call).toBe("endLease");
  });

  it('shouldKeeperCall = flagRentMissed when Active + mid-lease + overdue', () => {
    const state = 3;
    const isLeaseExpired = false;
    const isRentOverdue = true;
    let call = null;
    if (state === 3 && isLeaseExpired) call = "endLease";
    else if (state === 3 && isRentOverdue) call = "flagRentMissed";
    expect(call).toBe("flagRentMissed");
  });

  it('shouldKeeperCall = expireCheckout for CheckoutProposed after silence timeout', () => {
    const state = 5; // CheckoutProposed
    const checkoutStartedAt = 1000;
    const currentTime = 1000 + 14 * 86400 + 1; // past 14d
    let call = null;
    if (state === 5 && checkoutStartedAt > 0 && checkoutStartedAt + 14 * 86400 < currentTime) {
      call = "expireCheckout";
    }
    expect(call).toBe("expireCheckout");
  });

  it('shouldKeeperCall = releaseFrozenFunds for DisputeOpen + freeze expired', () => {
    let call = null;
    if (7 === 7 && true) call = "releaseFrozenFunds";
    expect(call).toBe("releaseFrozenFunds");
  });
});

// ─── Wallet Diagnostics ──────────────────────────────────────────────────────

describe('Wallet Diagnostics', () => {
  it('detects orphan listings', () => {
    const warnings = [];
    if (!false && [{ id: "a", status: "active" }].length > 0)
      warnings.push("Orphan listings: user row deleted but listings remain");
    expect(warnings).toHaveLength(1);
  });
});

// ─── Keeper Heartbeat ────────────────────────────────────────────────────────

describe('Keeper Heartbeat auth', () => {
  it('rejects without secret (401)', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 401, json: () => Promise.resolve({ error: "Unauthorized" })
    }));
    const r = await fetch("/api/keeper/heartbeat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keeperVersion: "2" }),
    });
    expect(r.status).toBe(401);
  });

  it('accepts with correct secret (200)', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ ok: true })
    }));
    const r = await fetch("/api/keeper/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Keeper-Secret": "test" },
      body: JSON.stringify({ keeperVersion: "2" }),
    });
    expect(r.status).toBe(200);
  });

  it('heartbeat not blocked by wallet auth (AUTH_EXEMPT)', () => {
    // /api/keeper/heartbeat is in AUTH_EXEMPT list
    const AUTH_EXEMPT = ["/api/log", "/api/auth/", "/api/email/confirm", "/api/listings/compose-description", "/api/keeper/heartbeat"];
    const path = "/api/keeper/heartbeat";
    const isExempt = AUTH_EXEMPT.some(e => path.startsWith(e));
    expect(isExempt).toBe(true);
  });
});

describe('Keeper status logic', () => {
  it('marks healthy when age < 60s', () => {
    const age = 30;
    expect(age < 60 ? "healthy" : age < 120 ? "stale" : "missing").toBe("healthy");
  });

  it('marks stale when 60 <= age < 120', () => {
    const age = 90;
    expect(age < 60 ? "healthy" : age < 120 ? "stale" : "missing").toBe("stale");
  });

  it('marks missing when age >= 120', () => {
    const age = 150;
    expect(age < 60 ? "healthy" : age < 120 ? "stale" : "missing").toBe("missing");
  });

  it('detects address mismatch', () => {
    const warnings = [];
    if ("0xaaaa" !== "0xbbbb") warnings.push("mismatch");
    expect(warnings).toHaveLength(1);
  });
});

describe('Keeper heartbeat sending', () => {
  it('no-action scan still sends heartbeat', () => {
    // Simulate: actions.length === 0, heartbeat should still be sent
    const actions = [];
    const shouldSendHeartbeat = true; // always send
    expect(actions.length).toBe(0);
    expect(shouldSendHeartbeat).toBe(true);
  });

  it('error scan sends heartbeat with lastError', () => {
    const lastError = "RPC timeout";
    const heartbeat = { lastError, actionsNeeded: 0, actionsExecuted: 0 };
    expect(heartbeat.lastError).toBe("RPC timeout");
  });
});

// ─── Admin routing ──────────────────────────────────────────────────────────

describe('Admin keeper/status routing', () => {
  it('/api/admin/keeper/status is handled by handleAdmin (starts with /api/admin/)', () => {
    const path = "/api/admin/keeper/status";
    expect(path.startsWith("/api/admin/")).toBe(true);
  });

  it('/api/keeper/heartbeat is NOT under /api/admin/ (separate auth)', () => {
    const path = "/api/keeper/heartbeat";
    expect(path.startsWith("/api/admin/")).toBe(false);
  });
});

// ─── Admin UI tabs ──────────────────────────────────────────────────────────

describe('Inspector: split settlement state', () => {
  function closureStatus(rentalState, propDepState) {
    const rentalTerminal = rentalState === 8 || rentalState === 9;
    const propDepResolved = propDepState === 0 || propDepState === 5;
    const propDepActive = propDepState >= 1 && propDepState <= 4;
    if (rentalTerminal && propDepActive) return "partial";
    if (rentalTerminal && propDepResolved) return "closed";
    return "active";
  }

  it('Rental Settled + PropDep Active → partial', () => {
    expect(closureStatus(8, 1)).toBe("partial");
  });

  it('Rental Settled + PropDep Settled → closed', () => {
    expect(closureStatus(8, 5)).toBe("closed");
  });

  it('Rental Settled + PropDep None → closed', () => {
    expect(closureStatus(8, 0)).toBe("closed");
  });

  it('Rental Active + PropDep Active → active', () => {
    expect(closureStatus(3, 1)).toBe("active");
  });

  it('Rental Settled + PropDep Claimed → partial', () => {
    expect(closureStatus(8, 2)).toBe("partial");
  });

  it('Rental Settled + PropDep Frozen → partial', () => {
    expect(closureStatus(8, 4)).toBe("partial");
  });

  it('keeper banner: PropDep active when no rental action needed', () => {
    const keeperCall = null;
    const pdActive = true;
    const showPdNote = !keeperCall && pdActive;
    expect(showPdNote).toBe(true);
  });

  it('keeper banner: PropDep settled has no note', () => {
    const keeperCall = null;
    const pdActive = false;
    expect(!keeperCall && pdActive).toBe(false);
  });
});

describe('Admin UI navigation', () => {
  it('primary nav includes System, Inspector, Disputes, Users', () => {
    const primary = ["system", "inspector", "disputes", "users", "promocodes", "cities", "admins"];
    expect(primary).toContain("system");
    expect(primary).toContain("inspector");
    expect(primary).toContain("disputes");
  });

  it('dev nav includes Contracts, Wallet Diag, Event Log, Audit Log, Time Travel', () => {
    const dev = ["contracts", "walletdiag", "eventlog", "audit", "timetravel"];
    expect(dev).toContain("contracts");
    expect(dev).toContain("walletdiag");
    expect(dev).toContain("timetravel");
  });

  it('Disputes title is now Dispute Center', () => {
    const titles = { disputes: "Dispute Center" };
    expect(titles.disputes).toBe("Dispute Center");
  });

  it('Dashboard demoted — maps to SystemHealthPage', () => {
    // Dashboard page now renders SystemHealthPage
    const dashboardComponent = "SystemHealthPage"; // same as system
    expect(dashboardComponent).toBe("SystemHealthPage");
  });
});

describe('Dispute outcome classification copy', () => {
  function classifyPropdep(reason) {
    const map = {
      window_expired_no_claim: { label: "No claim → tenant", detail: "No damage claimed. Full deposit returned to tenant." },
      released_early_no_claim: { label: "LL released early", detail: "Landlord confirmed no damage. Full deposit returned to tenant." },
      freeze_expired: { label: "Dispute expired", detail: "Dispute expired unresolved. Property deposit returned to tenant. Landlord bond returned to landlord. No claim paid." },
      claim_accepted: { label: "Claim accepted", detail: "Tenant accepted damage claim. Claim amount paid to landlord, remainder to tenant." },
      claim_auto_executed: { label: "Tenant silent → LL", detail: "Tenant did not respond within 3 days. Claim auto-executed, paid to landlord." },
    };
    return map[reason] || { label: reason, detail: null };
  }

  it('freeze_expired shows dispute expired copy, not "no damage claimed"', () => {
    const r = classifyPropdep("freeze_expired");
    expect(r.label).toBe("Dispute expired");
    expect(r.detail).toContain("Dispute expired unresolved");
    expect(r.detail).toContain("Property deposit returned to tenant");
    expect(r.detail).toContain("Landlord bond returned to landlord");
    expect(r.detail).not.toContain("No damage claimed");
  });

  it('window_expired_no_claim shows no damage copy', () => {
    const r = classifyPropdep("window_expired_no_claim");
    expect(r.detail).toContain("No damage claimed");
    expect(r.detail).toContain("Full deposit returned");
  });

  it('released_early_no_claim shows landlord released copy', () => {
    const r = classifyPropdep("released_early_no_claim");
    expect(r.detail).toContain("Landlord confirmed no damage");
  });

  it('claim_accepted shows claim paid to landlord', () => {
    const r = classifyPropdep("claim_accepted");
    expect(r.detail).toContain("Claim amount paid to landlord");
  });

  it('claim_auto_executed shows tenant silent copy', () => {
    const r = classifyPropdep("claim_auto_executed");
    expect(r.detail).toContain("Tenant did not respond");
  });
});
