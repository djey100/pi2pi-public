# Section 1 Post-Deploy Smoke Tests

Run after successful deploy of new RentalEscrow + PropDepEscrow pair.

## A. Verify deployment wiring

```bash
# Replace NEW_ESCROW and NEW_PROPDEP with actual deployed addresses
cast call $NEW_ESCROW "propDepEscrow()" --rpc-url https://rpc.testnet.arc.network
# Expected: $NEW_PROPDEP address

cast call $NEW_PROPDEP "mainContract()" --rpc-url https://rpc.testnet.arc.network
# Expected: $NEW_ESCROW address

cast call $NEW_ESCROW "nextAgreementId()" --rpc-url https://rpc.testnet.arc.network
# Expected: 0

cast call $NEW_ESCROW "currentTime()" --rpc-url https://rpc.testnet.arc.network
# Expected: current timestamp
```

## B. Create test agreement

1. Create agreement: `createAgreement(tenant, landlord, rent, propDep, durationMonths, contentHash)`
2. Tenant: `approve(escrow, amount)` then `tenantDeposit(id)`
3. Landlord: `approve(escrow, amount)` then `landlordDeposit(id)`
4. Verify: `getState(id)` == 3 (Active)

## C. Rent overdue BEFORE lease end

1. Use `warp(delta)` to advance time to day 34 (past rent due + 3-day grace, but within 6-month lease)
2. Check: `isLeaseExpired(id)` == false
3. Check: `isRentOverdue(id)` == true
4. Call: `flagRentMissed(id)` — should succeed
5. Verify: state changes to Settled, commitment deposit goes to landlord

## D. Lease end priority (THE FIX)

On a separate fresh agreement:

1. Create + activate new agreement
2. Use `warp(delta)` to advance time past leaseEndTime (e.g. day 181 for 6-month lease)
3. Check: `isLeaseExpired(id)` == **true**
4. Check: `isRentOverdue(id)` == **false** ← THIS IS THE FIX
5. Call: `flagRentMissed(id)` — should **REVERT** with "Lease ended"
6. Call: `endLease(id)` — should **succeed**
7. Verify: deposits returned to BOTH parties (not seized)

## E. Keeper priority

1. Create agreement, warp past lease end
2. Start keeper or wait for scan
3. Check keeper logs:
   - Should show `endLease` action, NOT `flagRentMissed`
   - Log line: `[tx] Lease expired → return deposits`

## F. DevMode / time offset

1. Verify `currentTime()` responds and includes timeOffset
2. Verify `warp(delta)` works (owner only)
3. Verify `disableDevMode()` is available but NOT called yet

## Checklist

- [ ] propDepEscrow() returns correct address
- [ ] mainContract() returns correct address
- [ ] nextAgreementId() returns 0
- [ ] currentTime() returns reasonable timestamp
- [ ] Can create agreement
- [ ] Can activate (both deposit)
- [ ] isRentOverdue true mid-lease ✅
- [ ] flagRentMissed works mid-lease ✅
- [ ] isRentOverdue false after lease end ✅ (THE FIX)
- [ ] flagRentMissed reverts after lease end ✅ (THE FIX)
- [ ] endLease works after lease end ✅
- [ ] Keeper chooses endLease over flagRentMissed ✅
