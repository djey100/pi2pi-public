# Section 2 Redeploy Runbook — PropDep minimum claim 30%

## What changed
- `PropDepEscrow.MIN_DAMAGE_CLAIM_BPS = 3000` (30% minimum claim threshold)
- `fileDamageClaim()` reverts with "Claim below minimum" if `amount < ceil(propDep * 30%)`
- Prevents tiny claims from freezing the entire property deposit for 60 days
- RentalEscrow unchanged except redeployed as a pair

## Old addresses (current deployed, to be replaced)
```
RentalEscrow:  0x05bB1eb6A91cF90AD4223f93Efb7a558CdcCfD91
PropDepEscrow: 0x427F250Cf08951bB58b1AF5D5500aeCFD384c924
```

## 1. Preconditions

```bash
# Foundry (contracts)
cd contracts && ~/.foundry/bin/forge test -vv
# Expected: all pass including 4 new minimum-claim tests

# Keeper typecheck
cd keeper && npx tsc --noEmit

# Frontend + backend
cd arc && npm test && npm run build
node -c server-arc.js && node -c admin_routes.js
```

Verify PropDep fix is in code:
```bash
grep "MIN_DAMAGE_CLAIM_BPS" contracts/src/PropDepEscrow.sol
# Expected: uint256 public constant MIN_DAMAGE_CLAIM_BPS = 3000;
grep "Claim below minimum" contracts/src/PropDepEscrow.sol
# Expected: require(amount >= minClaim, "Claim below minimum");
```

## 2. Deploy (use deploy-section1-ethers.mjs ONLY)

**DO NOT use deploy-section1.mjs (deprecated, no DRY_RUN safety).**

```bash
# Dry run first
RPC_URL=https://rpc.testnet.arc.network \
PRIVATE_KEY=<deployer-key> \
TREASURY_ADDRESS=<deployer-addr> \
node scripts/deploy-section1-ethers.mjs

# Live deploy (after confirming dry run output)
CONFIRM_DEPLOY=true \
RPC_URL=https://rpc.testnet.arc.network \
PRIVATE_KEY=<deployer-key> \
TREASURY_ADDRESS=<deployer-addr> \
node scripts/deploy-section1-ethers.mjs
```

Record new addresses from output.

## 3. Verify deploy

```bash
ESCROW_ADDRESS=<new-rental> \
PROPDEP_ADDRESS=<new-propdep> \
node scripts/verify-section1-deploy.mjs
```

Expected checks (12 total):
- Chain ID = 5042002
- Both addresses valid
- Both have bytecode
- propDepEscrow() == new PropDep
- mainContract() == new Rental
- owner() responds
- currentTime() responds
- nextAgreementId() == 0
- **MIN_DAMAGE_CLAIM_BPS() == 3000**
- PropDepEscrow.owner() responds

## 4. Update all address references

Follow `docs/address-update-checklist.md` with new addresses:

### Frontend
```bash
# Update arc/src/helpers.js — ESCROW_ADDRESS, PROPDEP_ADDRESS, CONTRACT_VERSION=6
cd arc && npm run build
```

### Keeper (Fly secrets)
```bash
flyctl secrets set \
  ESCROW_ADDRESS=<new-rental> \
  PROPDEP_ADDRESS=<new-propdep> \
  -a pi2pi-keeper
cd keeper && flyctl deploy
```

### Main app (Fly secrets)
```bash
flyctl secrets set \
  RENTAL_ESCROW_ADDRESS=<new-rental> \
  PROPDEP_ESCROW_ADDRESS=<new-propdep> \
  -a pi2pi-project
```

### Server/admin defaults
Update hardcoded fallbacks in:
- `server-arc.js` — `RENTAL_ESCROW_ADDR`, `PROPDEP_ESCROW_ADDR`
- `admin_routes.js` — `RENTAL_ESCROW`, `PROPDEP_ESCROW`

### Grep for old addresses
```bash
node scripts/check-old-addresses.mjs
# Must show 0 refs to old addresses in active code
```

## 5. Deploy frontend + backend
```bash
flyctl deploy --app pi2pi-project
```

## 6. Post-deploy smoke

- [ ] Admin System tab shows new addresses
- [ ] nextAgreementId = 0
- [ ] currentTime ≈ block.timestamp (no warp offset)
- [ ] Create test agreement → activate → verify PropDep minimum claim
- [ ] Attempt claim below 30% → should revert "Claim below minimum"
- [ ] Attempt claim at 30% → should succeed
- [ ] Keeper paused during testing, resumed after

## Old addresses (DO NOT USE after redeploy)
```
OLD RentalEscrow:  0x05bB1eb6A91cF90AD4223f93Efb7a558CdcCfD91
OLD PropDepEscrow: 0x427F250Cf08951bB58b1AF5D5500aeCFD384c924
```
