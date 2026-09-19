# Section 1 Deploy Result

## Deployment

| Field | Value |
|---|---|
| Chain ID | 5042002 (Arc Testnet) |
| Deployer | 0x497924669F8aeA089E399639D254cB2c708c267A |
| RentalEscrow | 0x05bB1eb6A91cF90AD4223f93Efb7a558CdcCfD91 |
| PropDepEscrow | 0x427F250Cf08951bB58b1AF5D5500aeCFD384c924 |
| RentalEscrow deploy tx | 0xa5f9143a000f93991c12700e923f33815682d405390a097253d070fbccd5912f |
| PropDepEscrow deploy tx | 0xdb9ed8f5f75ac1095ce01682e9de85b8e7e7768ecc40fb6cc68381227ca1e46c |
| setPropDepEscrow tx | 0x58652cbed661421db27aab7b409a86e0453bf6ced8ca8e1365849d6db75aae2f |
| USDC address | 0x3600000000000000000000000000000000000000 |
| Treasury address | 0x497924669f8aea089e399639d254cb2c708c267a |
| Timestamp | 2026-04-28 ~20:05 UTC |
| Deploy method | ethers.js fallback (forge blocked by txpool congestion) |

## Verification

| Check | Result |
|---|---|
| RentalEscrow.propDepEscrow() == PropDepEscrow | ✅ |
| PropDepEscrow.mainContract() == RentalEscrow | ✅ |
| owner == deployer | ✅ |
| nextAgreementId() responds | ✅ (0) |
| currentTime() responds | ✅ |
| verify-section1-deploy.mjs | 10/10 ✅ |
| check-old-addresses.mjs | clean ✅ |
| Bundle new address refs | 4 ✅ |
| Bundle old address refs | 0 ✅ |

## Service deploys

| Service | Result |
|---|---|
| Keeper Fly secrets updated | ✅ |
| Keeper deployed + logs verified | ✅ new addresses, 0 agreements, scanning |
| Frontend addresses updated | ✅ CONTRACT_VERSION=5 |
| Frontend built + deployed | ✅ |
| Server defaults updated | ✅ server-arc.js + admin_routes.js |

## Post-deploy smoke

| Test | Result |
|---|---|
| Create agreement | ⏳ |
| Activate (both deposit) | ⏳ |
| isRentOverdue true mid-lease | ⏳ |
| flagRentMissed works mid-lease | ⏳ |
| isRentOverdue false after lease end | ⏳ |
| flagRentMissed reverts after lease end | ⏳ |
| endLease works after lease end | ⏳ |
| Keeper chooses endLease | ⏳ |

## Rollback decision

- [x] No rollback needed — infrastructure verified
- [ ] Smoke tests pending

## Old addresses

```
OLD RentalEscrow:  0x241b50869d2c1a7E65A5B9D5016BE0a0eda9D875
OLD PropDepEscrow: 0xb292e8dC58e0A86f05DE470e6E65725e7043676B
```
