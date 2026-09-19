# USDC Decimals Migration Checklist

**Status:** Documentation only — do NOT change runtime code until chain migration.

## Current state (Arc Testnet)

Arc Testnet has split USDC decimals:
- **Native balance** (`eth_getBalance`): 18 decimals
- **ERC-20 precompile** (`approve`/`transferFrom`): 6 decimals

This means balance reads use `/1e18` but transaction amounts use `*1e6`.

## Files with Arc-specific `eth_getBalance / 1e18`

| File | Line | Current code | Migration change |
|---|---|---|---|
| `arc/src/wallet.js` | ~819 | `eth_getBalance` + `/1e18` | Change to `balanceOf(addr)` on USDC contract + `/1e6` |
| `server-arc.js` | ~88 | `eth_getBalance` + `/1e18` | Same — `balanceOf` + `/1e6` |
| `admin_routes.js` | N/A | Uses `arcEthCall` for contract reads, not balance | No change needed |

## Files with USDC_DECIMALS = 6 (correct for all EVM chains)

| File | Line | Code | Migration |
|---|---|---|---|
| `arc/src/helpers.js` | ~390 | `USDC_DECIMALS = 6` | No change — 6 is correct for Arbitrum USDC |

## Transaction encoding (correct for all chains)

| File | Usage | Decimals |
|---|---|---|
| `arc/src/App.jsx` | `BigInt(amount) * BigInt(10 ** USDC_DECIMALS)` | 6 — correct |
| `contracts/src/RentalEscrow.sol` | All amounts in 6-decimal USDC | 6 — correct |

## Migration steps (when switching to Arbitrum Sepolia or mainnet)

1. **wallet.js `readUsdcBalance`** (line ~819):
   - Remove `eth_getBalance` path
   - Add `balanceOf(addr)` call to USDC ERC-20 contract
   - Divide by `1e6` instead of `1e18`

2. **server-arc.js `readUsdcBalance`** (line ~88):
   - Same change as wallet.js
   - Update `USDC_ADDRESS` constant to actual Arbitrum USDC contract

3. **Update USDC_ADDRESS**:
   - Arc: `0x3600000000000000000000000000000000000000` (native precompile)
   - Arbitrum Sepolia: actual USDC contract address
   - Update in: `arc/src/helpers.js`, `server-arc.js`

4. **Test**:
   - Verify `readUsdcBalance` returns correct amount
   - Verify `checkUsdcBalance` pre-flight works
   - Verify PoF cron uses correct balance
   - Verify admin System tab shows correct balance reads

## Do NOT change until

- Chain migration is confirmed (Arbitrum Sepolia or mainnet)
- All on-chain contracts are redeployed on new chain
- Frontend/backend URLs updated to new RPC
