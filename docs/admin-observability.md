# Admin Observability / Smart Contract Inspector

**Added:** 2026-04-29
**Status:** Local/offline only. Not deployed.

## New Admin Endpoints (all read-only)

### GET /api/admin/system-health
On-chain diagnostics and wiring check. Returns:
- Chain ID, latest block, RPC host
- Contract addresses, bytecode existence
- Owner addresses, cross-contract wiring verification
- nextAgreementId, currentTime on both contracts
- Server env flags (REQUIRE_WALLET_AUTH, ENABLE_ACCOUNT_RESET, NODE_ENV)
- ok/warnings/errors summary

### GET /api/admin/agreements/:id
Full on-chain agreement inspector. Returns:
- Decoded RentalEscrow agreement struct (40 fields)
- Decoded PropDepEscrow struct (18 fields)
- Boolean checks: isRentOverdue, isLeaseExpired, isDepositDeadlineExpired, isFreezeExpired
- Derived values: nextRentDue, graceEnd (with extension), freezeEnd
- Keeper diagnosis: shouldKeeperCall with reason
- DB consistency check: warns if chain says Settled but DB has non-archived active_contract

### GET /api/admin/wallet/:addr/diagnostics
Full wallet diagnostic report. Returns:
- User row, role, wallet type, display name, email status
- Listings grouped by status with summary counts
- Active contracts (as owner and as peer)
- Pending items: contract proposals, viewing requests, early terms
- Message count
- Warnings: orphan listings, missing user row, active contract without listing

### POST /api/keeper/heartbeat
Keeper health reporting (write endpoint, keeper-only auth via X-Keeper-Secret header).

### GET /api/admin/keeper/status
Latest keeper heartbeat with health status (healthy/stale/missing).

## New Admin UI Tabs

| Tab | Component | Shows |
|---|---|---|
| System | SystemHealthPage | Green/red checks for all system health items + keeper status |
| Inspector | AgreementInspectorPage | Input agreement ID, see full decoded state + keeper diagnosis |
| Wallet Diag | WalletDiagnosticsPage | Input wallet address, see all user data + warnings |

## Keeper Heartbeat

### How it works
1. Keeper sends POST /api/keeper/heartbeat after each scan
2. Backend stores in `keeper_heartbeats` Supabase table
3. Admin panel reads latest heartbeat via GET /api/admin/keeper/status
4. Status: healthy (<60s), stale (60-120s), missing (>120s or no data)

### Setup required
1. Run migration: `migrations/2026-04-29-keeper-heartbeats.sql`
2. Set Fly secret: `KEEPER_HEARTBEAT_SECRET=<random-string>` on both keeper and main app
3. Set keeper env: `HEARTBEAT_URL=https://pi2pi-project.fly.dev`

## Security notes
- All admin endpoints require admin auth (cookie-based)
- Keeper heartbeat uses shared secret (X-Keeper-Secret header)
- No destructive operations added
- Time-travel remains owner-only
- Agreement inspector is read-only (no state changes)

## Files changed

| File | Change |
|---|---|
| admin_routes.js | +system-health, +agreements/:id, +wallet diagnostics endpoints |
| server-arc.js | +keeper heartbeat POST, +keeper status GET |
| keeper/enforcer.ts | +heartbeat sending after each scan |
| arc/pi2pi-console.jsx | +SystemHealthPage, +AgreementInspectorPage, +WalletDiagnosticsPage, +nav tabs |
| migrations/2026-04-29-keeper-heartbeats.sql | New table |
| arc/src/__tests__/admin-observability.test.js | 17 tests |
