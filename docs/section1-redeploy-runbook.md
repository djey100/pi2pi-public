# Section 1 Redeploy Runbook — leaseEnd vs rent overdue fix

## What changed
- `RentalEscrow.isRentOverdue()` returns false when lease expired
- `RentalEscrow.flagRentMissed()` reverts with "Lease expired - use endLease" after lease end
- Keeper checks `isLeaseExpired` BEFORE `isRentOverdue` in Active state

## 1. Preconditions

Run all tests before deploying:

```bash
# Foundry (contracts)
cd contracts && ~/.foundry/bin/forge test -vv
# Expected: 117 passed, 0 failed, 1 skipped

# Keeper typecheck
cd keeper && npm run typecheck
# Expected: no errors

# Frontend
cd arc && npm test
# Expected: 101 passed

cd arc && npm run build
# Expected: build success
```

Verify:
- [ ] Supabase doc_keys ACL migration applied (`migrations/2026-04-28-doc-keys-acl.sql`)
- [ ] `REQUIRE_WALLET_AUTH=true` set in Fly.io secrets
- [ ] Deployer wallet funded on Arc Testnet (need USDC for gas)
- [ ] RPC_URL = `https://rpc.testnet.arc.network`
- [ ] USDC = `0x3600000000000000000000000000000000000000`
- [ ] Treasury address confirmed

## 2. Contract Redeploy

**Important:** PropDepEscrow has immutable `mainContract` reference. Deploy as pair.

```bash
cd contracts

# Set env
export RPC_URL=https://rpc.testnet.arc.network
export PRIVATE_KEY=<deployer private key>

# Deploy
~/.foundry/bin/forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

This deploys:
1. New RentalEscrow
2. New PropDepEscrow (linked to new RentalEscrow)
3. Calls `setPropDepEscrow` on RentalEscrow
4. If AaveAdapter needed: deploy + wire

## 3. Record Addresses

After deploy, record:

```
RentalEscrow:  0x...
PropDepEscrow: 0x...
AaveAdapter:   0x... (if applicable)
Deployer:      0x...
Chain ID:      5042002
Deploy TX:     0x...
Date:          YYYY-MM-DD
```

## 4. Update Config

### Frontend (`arc/src/helpers.js`):
```js
export const ESCROW_ADDRESS  = "0x<new address>";
export const PROPDEP_ADDRESS = "0x<new address>";
```

### Keeper Fly.io secrets:
```bash
flyctl secrets set \
  ESCROW_ADDRESS=0x<new address> \
  PROPDEP_ADDRESS=0x<new address> \
  -a pi2pi-keeper
```

### Server (if any reference exists):
Check `server-arc.js` and `admin_routes.js` for hardcoded addresses.

### Admin panel:
Check `arc/admin.jsx` / `arc/admin-cities.html` for address references.

## 5. Redeploy Services

```bash
# Frontend + API
cd /path/to/pi2pi-project
flyctl deploy

# Keeper (from keeper directory)
cd keeper
flyctl deploy
```

### Verify keeper startup logs:
```
=== pi2pi Keeper v2 ===
Escrow   : 0x<new address>
PropDep  : 0x<new address>
RPC      : https://rpc.testnet.arc.network
```

Confirm addresses match newly deployed contracts.

## 6. Post-Deploy Smoke Tests

### A. Basic agreement lifecycle:
1. Create new agreement
2. Both parties deposit
3. Verify agreement activated

### B. Rent overdue BEFORE lease end:
1. Warp to 34 days (rent due + grace expired, but lease not over)
2. Verify `isRentOverdue(id) = true`
3. Verify `isLeaseExpired(id) = false`
4. Call `flagRentMissed(id)` — should succeed

### C. Lease expired (the fix):
1. Warp to 181+ days (past 6-month lease end)
2. Verify `isLeaseExpired(id) = true`
3. Verify `isRentOverdue(id) = false` ← THIS IS THE FIX
4. Call `flagRentMissed(id)` — should REVERT with "Lease expired - use endLease"
5. Call `endLease(id)` — should succeed, deposits returned to both

### D. Keeper priority:
1. Create agreement, warp past lease end
2. Keeper scans — should choose `endLease`, not `flagRentMissed`
3. Check keeper logs: `[tx] Lease expired → return deposits`

## 7. Legacy Agreements

Existing agreements on OLD RentalEscrow (`0x241b...D875`) do NOT migrate.

Plan:
- **Test agreements:** close/ignore manually, or let them settle naturally
- **Do NOT point frontend to new contract until old agreements are handled**
- Old keeper instance (if running) continues monitoring old contract
- New keeper monitors new contract only

## 8. Rollback Plan

If issues found after deploy:
1. Revert frontend addresses to old values
2. Redeploy frontend
3. Old contracts still work — no data lost
4. New contracts exist but unused until re-pointed
