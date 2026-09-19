# Section 1 Rollback Plan

## If deploy fails before frontend switch
- Old contracts still work
- No action needed — keep old addresses everywhere
- New contracts exist on-chain but unused

## If frontend switched but smoke fails
1. Revert `arc/src/helpers.js` to old addresses
2. Revert `arc/helpers.js` to old addresses
3. Run `cd arc && npm run build`
4. Deploy frontend: `flyctl deploy`
5. Old contracts resume normal operation

## If keeper switched but wrong address
1. Update Fly secrets back to old addresses:
```bash
flyctl secrets set \
  ESCROW_ADDRESS=0x241b50869d2c1a7E65A5B9D5016BE0a0eda9D875 \
  PROPDEP_ADDRESS=0xb292e8dC58e0A86f05DE470e6E65725e7043676B \
  -a pi2pi-keeper
```
2. Redeploy keeper: `cd keeper && flyctl deploy`
3. Verify logs show old addresses

## Legacy agreements
- All agreements on old RentalEscrow (0x241b...D875) are test-only
- No real funds at risk
- No migration needed — per Dmitriy confirmation
- Old agreements will naturally expire or can be ignored

## Old contract addresses (rollback targets)
```
RentalEscrow:  0x241b50869d2c1a7E65A5B9D5016BE0a0eda9D875
PropDepEscrow: 0xb292e8dC58e0A86f05DE470e6E65725e7043676B
```
