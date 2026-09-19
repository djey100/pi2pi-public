# Section 1 Smoke Test — Handoff for Next Session

**Created:** 2026-04-28
**Status:** Deployment complete, smoke tests NOT complete

---

## 1. Current Deployment

| Field | Value |
|---|---|
| Chain | Arc Testnet (chain ID 5042002) |
| RPC | `https://rpc-gel-sepolia.inkonchain.com/` |
| Deployer | `0x497924669F8aeA089E399639D254cB2c708c267A` |
| RentalEscrow | `0x05bB1eb6A91cF90AD4223f93Efb7a558CdcCfD91` |
| PropDepEscrow | `0x427F250Cf08951bB58b1AF5D5500aeCFD384c924` |
| USDC | `0x3600000000000000000000000000000000000000` (Arc native precompile) |
| Treasury | `0x497924669f8aea089e399639d254cb2c708c267a` (= deployer) |
| RentalEscrow deploy tx | `0xa5f9143a000f93991c12700e923f33815682d405390a097253d070fbccd5912f` |
| PropDepEscrow deploy tx | `0xdb9ed8f5f75ac1095ce01682e9de85b8e7e7768ecc40fb6cc68381227ca1e46c` |
| setPropDepEscrow tx | `0x58652cbed661421db27aab7b409a86e0453bf6ced8ca8e1365849d6db75aae2f` |
| Deploy method | ethers.js fallback (forge blocked by txpool congestion) |
| Timestamp | 2026-04-28 ~20:05 UTC |

**Verification result: 10/10 passed** (via `scripts/verify-section1-deploy.mjs`)

---

## 2. Services Updated

| Service | Status | Notes |
|---|---|---|
| Keeper Fly secrets | YES | ESCROW_ADDRESS + PROPDEP_ADDRESS updated |
| Keeper deployed | YES | `pi2pi-keeper` on Fly.io, region `syd` |
| Keeper logs verified | YES | Shows new addresses, scanning, 0 agreements |
| Frontend addresses | YES | `arc/src/helpers.js` — CONTRACT_VERSION=5 |
| Frontend built + deployed | YES | Main app `pi2pi-project` on Fly.io |
| Server defaults | YES | `server-arc.js` + `admin_routes.js` updated |
| `check-old-addresses.mjs` | CLEAN | 0 refs to old addresses in active files |

**Old addresses (DO NOT USE):**
- OLD RentalEscrow: `0x241b50869d2c1a7E65A5B9D5016BE0a0eda9D875`
- OLD PropDepEscrow: `0xb292e8dC58e0A86f05DE470e6E65725e7043676B`

---

## 3. Smoke Status

**Smoke tests are NOT complete.**

- Agreement #0 on the new contract is already **Settled** (state=8).
- Root cause: keeper called `flagRentMissed(0)` during an uncontrolled global time warp (`warp +40 days`). The warp was executed without Dmitriy's approval.
- **Do not reuse agreement #0.**
- New disposable agreements are required for testing.

---

## 4. Safety Warning for Next Session

**CRITICAL — read before doing ANYTHING:**

1. **Pause keeper** before any time manipulation (`warp`, `_devSetTimes`, `resetTime`)
   - Fly app name: `pi2pi-keeper`
   - Pause: `fly scale count 0 --app pi2pi-keeper`
   - Resume: `fly scale count 1 --app pi2pi-keeper`
   - Verify stopped: `fly status --app pi2pi-keeper` (should show 0 running machines)
   - Verify logs: `fly logs --app pi2pi-keeper` (no new scan entries after pause)

2. **Check timeOffset** before creating any agreements:
   ```js
   // Read-only — safe to run anytime
   const abi = ["function currentTime() view returns (uint256)", "function timeOffset() view returns (int256)"];
   const escrow = new ethers.Contract(ESCROW, abi, provider);
   const propDep = new ethers.Contract(PROPDEP, abi, provider);
   console.log("Escrow timeOffset:", await escrow.timeOffset());
   console.log("PropDep timeOffset:", await propDep.timeOffset());
   ```
   If timeOffset is non-zero, **ask Dmitriy before calling `resetTime()`**.

3. **Prefer `_devSetTimes` over global `warp`**:
   - `warp(delta)` shifts `timeOffset` globally — affects ALL agreements
   - `_devSetTimes(id, activatedAt, leaseEndTime, lastRentTimestamp)` changes timestamps on ONE agreement only
   - Always use `_devSetTimes` for smoke tests. Reserve `warp` only if absolutely necessary.

4. **No programmatic smoke with deployer key** unless Dmitriy explicitly approves each transaction.

5. **Ask before every tx.** No exceptions. Read-only checks are OK without asking.

---

## 5. Next Smoke Plan

### Pre-flight (before any agreements)
1. Pause keeper: `fly scale count 0 --app pi2pi-keeper`
2. Verify keeper stopped: `fly status --app pi2pi-keeper`
3. Read `timeOffset()` on both contracts
4. If non-zero → propose `resetTime()` → wait for Dmitriy's approval → execute
5. Verify `currentTime()` ≈ `block.timestamp` (within a few seconds)

### Dmitriy creates 2 disposable agreements
- Both must reach **Active** state (tenant deposit + landlord deposit)
- Use test-amount funds only (e.g. 2 USDC MR)
- Record agreement IDs (will be `nextAgreementId` at creation time)

### Agreement A — Mid-lease rent overdue test (Section 1 fix: positive case)
1. Call `_devSetTimes(A, activatedAt-60days, leaseEndTime=now+90days, lastRent=activatedAt)` — sets rent overdue but lease NOT expired
2. **Verify (read-only):**
   - `isLeaseExpired(A)` → `false`
   - `isRentOverdue(A)` → `true`
3. **Ask Dmitriy** → call `flagRentMissed(A)` → should succeed
4. Verify state = Settled, landlord got funds

### Agreement B — Lease expired test (Section 1 fix: THE critical test)
1. Call `_devSetTimes(B, activatedAt-200days, leaseEndTime=now-1day, lastRent=activatedAt)` — lease expired AND rent technically overdue
2. **Verify (read-only):**
   - `isLeaseExpired(B)` → `true`
   - `isRentOverdue(B)` → `false` ← THIS IS THE FIX
   - `flagRentMissed(B)` staticCall → should revert with "Lease ended"
3. **Ask Dmitriy** → call `endLease(B)` → should succeed
4. Verify state = Settled, funds returned to both parties (no forfeit)

### Keeper scan test (after contract smoke passes)
1. Create one more disposable agreement C → Active
2. Use `_devSetTimes` to set lease expired
3. Resume keeper: `fly scale count 1 --app pi2pi-keeper`
4. Watch logs: `fly logs --app pi2pi-keeper`
5. Confirm keeper calls `endLease(C)`, NOT `flagRentMissed(C)`
6. Pause keeper again if needed

---

## 6. Current Git/Files State

```
git status --short (from pi2pi-project root):
 m .claude/worktrees/amazing-stonebraker-e8af97
 M pitch/deferred-fixes.md
```

Key files changed/created during this deploy session:
- `contracts/src/RentalEscrow.sol` — Section 1 fix (isRentOverdue + flagRentMissed)
- `contracts/test/RentalEscrowScenario.t.sol` — NEW: 4 scenario tests
- `contracts/test/AaveLendingFork.t.sol` — existing fork test
- `scripts/deploy-section1-ethers.mjs` — NEW: ethers.js deploy script
- `scripts/verify-section1-deploy.mjs` — NEW: 10-point verification
- `scripts/check-old-addresses.mjs` — NEW: old address grep
- `scripts/check-section1-deploy-readiness.mjs` — NEW: 14-point readiness
- `docs/section1-*` — NEW: deploy docs (5 files)
- `arc/src/helpers.js` — new addresses, CONTRACT_VERSION=5, parseAgreement fix
- `arc/src/wallet.js` — SIWE auth, removed legacy tx type
- `arc/src/api/client.js` — NEW: 108 API calls extracted from App.jsx
- `server-arc.js` — auth middleware, CSRF, rate limits, addr match
- `auth.js` — NEW: SIWE wallet auth
- `cid-auth.js` — NEW: CID authorization helper
- `keeper/enforcer.ts` — isLeaseExpired before isRentOverdue, removed legacy tx
- `keeper/Dockerfile` — npm ci
- `pitch/deferred-fixes.md` — updated with new items

---

## 7. Verification Commands Already Run

| Command | Location | Result |
|---|---|---|
| `forge test -vv` | contracts/ | All tests pass (including 4 new scenario tests) |
| `npm run typecheck` | keeper/ | Clean |
| `npm test` | arc/ | 102 tests pass (8 test files) |
| `npm run build` | arc/ | Clean build |
| `node scripts/check-old-addresses.mjs` | root | 0 old address refs |
| `node scripts/verify-section1-deploy.mjs` | root | 10/10 passed |
| `node keeper/check-config.mjs` | root | All checks passed |

---

## 8. Section 1 Fix Summary (for context)

**Problem:** When a lease expires and rent is also technically overdue, keeper (or landlord) could call `flagRentMissed` to seize the tenant's deposit — even though the lease ended normally and tenant shouldn't be penalized.

**Fix in RentalEscrow.sol:**
- `isRentOverdue(id)` now returns `false` if `_now() >= leaseEndTime`
- `flagRentMissed(id)` now requires `_now() < leaseEndTime`, reverts with "Lease ended"
- `keeper/enforcer.ts` checks `isLeaseExpired` BEFORE `isRentOverdue` in Active state

**Result:** Lease expiration always takes priority. Tenant gets their deposit back via `endLease`, not seized via `flagRentMissed`.
