# Slither Static Analysis Report

Generated: 2026-06-12  
Tool: slither-analyzer 0.11.5  
Contracts: `RentalEscrow.sol`, `PropDepEscrow.sol`

---

## Summary

| Severity | Count | Disposition |
|----------|-------|-------------|
| High     | 0     | —           |
| Medium   | 1     | False positive (by design) |
| Low      | 3     | 2 accepted, 1 noted |
| Info     | 4     | Acknowledged |

---

## Findings

### M-1 — incorrect-equality (medium) — FALSE POSITIVE
**Location:** `RentalEscrow.inState` (line 265-268)  
**Finding:** Strict equality `==` on state enum.  
**Disposition:** FALSE POSITIVE. State enum is intentionally compared with `==`; this is the state machine guard. The detector fires because strict equality on integers can hide bugs (e.g., `balance == target`), but for enum membership checks this is correct and idiomatic.

---

### L-1 — reentrancy-no-eth (low) — ACCEPTED, LOW RISK
**Location:** `RentalEscrow._activate` — `propDepEscrow.createPropDep()` called before `a.hasPropDep = true`  
**Finding:** CEI pattern violation: state write (`hasPropDep`) follows external call.  
**Disposition:** LOW RISK. `propDepEscrow` is a trusted contract deployed and set by the owner (`setPropDepEscrow`). A malicious PropDepEscrow cannot exploit this because: (1) `_activate` is only reachable via `landlordDeposit` which has `nonReentrant`; (2) `hasPropDep` is a one-way flag that only gates the `_openPropDepWindowEarly` call path.  
**Fix considered:** Move `a.hasPropDep = true` before the external call. Not changed to avoid unintended side effects; tracked in `pitch/deferred-fixes.md`.

### L-2 — events-access (low) — NOTED
**Location:** `RentalEscrow.transferOwnership`  
**Finding:** No event emitted on ownership transfer.  
**Disposition:** NOTED. Low-frequency admin function. Tracked in `pitch/deferred-fixes.md`.

### L-3 — uninitialized-local (low) — FALSE POSITIVE
**Location:** `received` in `_reclaimFromLending` and `reclaimLentFundsAfterSettlement`; `userYield` in `expireByLeaseEnd`  
**Finding:** Local variables never explicitly initialized.  
**Disposition:** FALSE POSITIVE. In Solidity, uninitialized value types are always zero-initialized. The `received` variable is assigned inside a `try/catch` block and explicitly checked for zero after the block. Behavior is correct.

---

### INFO-1 — reentrancy-benign
`_activate` and `_devSetTimes` have reentrancy patterns classified as benign. No action needed.

### INFO-2 — reentrancy-events
Events emitted after external calls in `_reclaimFromLending`. No ETH involved; classified informational.

### INFO-3 — timestamp
`block.timestamp` used for time comparisons throughout (lease deadlines, rent due dates, freeze windows). Miner manipulation risk is accepted — all time windows are days/weeks granularity, making sub-minute manipulation economically irrelevant.

### INFO-4 — cyclomatic-complexity
`expireByLeaseEnd` has complexity 17 due to multiple settlement paths. Refactoring deferred — tracked in `pitch/deferred-fixes.md`.

---

## PropDepEscrow findings

Same detector types as RentalEscrow (`incorrect-equality`, `events-access`, `timestamp`, `naming-convention`). All are false positives or informational by the same reasoning above.
