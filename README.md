# pi2pi

Peer-to-peer rental agreements settled in USDC, with deposits held in smart-contract escrow — built on [Arc](https://arc.network), Circle's USDC-native L1.

Tenants and landlords enter direct on-chain rental agreements. Deposits are locked in escrow until settlement. Rent is paid in USDC. No platform fees, no commissions, no token.

## Networks

| | Mainnet | Testnet |
|---|---|---|
| App | https://my.pi2pi.io | https://testnet.pi2pi.io |
| Network | `arc-mainnet` | `arc-testnet` |
| Chain ID | `5042` | `5042002` |
| RentalEscrow | `0x06A2b584278f519ba7562c8ac27f4A5C31d52103` | `0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8` |
| PropDepEscrow | `0x55dDa2FD8C37383E33DF32b15EED978Ac6B91532` | `0xe2190997F3811B771C25525C8401504a0e5330c5` |
| USDC | `0x3600000000000000000000000000000000000000` (same on both — Arc's native USDC) |

## Architecture

```
arc/                    Frontend (Vite + React, React Router, HashRouter)
  src/
    App.jsx             Root component + routing + state hub
    wallet.js           Wallet abstraction: Circle Modular Wallets / MetaMask / WalletConnect
    helpers.js          ABI selectors, parsing, network config, state machine
    api/client.js        Server API client
    components/          UI components
    i18n/                 Multi-language UI strings
    lease-text-*.js       Legal agreement text per language
server-arc.js            Express API + static file serving (network-aware, fail-closed)
auth.js                  Wallet-signature session auth (HMAC-signed cookie)
admin_routes.js           Admin panel API endpoints (session-authenticated)
contracts/                Solidity (Foundry) — RentalEscrow, PropDepEscrow, yield adapters
keeper/                    Enforcement bot: scans agreements, calls permissionless timeout functions
subgraph/                  TheGraph indexer
```

## Smart contracts

**RentalEscrow** — state machine: `Created → AwaitingLandlordDep/AwaitingTenantDep → Active → CheckoutProposed/EarlyTermProposed/DamageClaimed → DisputeOpen → Settled`.

Deposit model ("equal stakes" — symmetric):
- Commitment Deposit (tenant) = 1× monthly rent
- Hosting Deposit (landlord) = 1× monthly rent
- Property Security Deposit (tenant, optional) = 0–3× monthly rent

Deposits can earn yield via ERC-4626 adapters (Aave, Morpho); yield splits 70% to parties / 30% to protocol treasury.

**PropDepEscrow** — handles property security deposit claims, disputes, and time-bound resolution windows independently of the rental agreement's own lifecycle.

## Keeper

`keeper/enforcer.ts` is a permissionless enforcement bot: it scans on-chain agreements and calls timeout-based functions once a deadline has passed (e.g. missed rent, expired dispute freeze, unfunded deposit deadline). Anyone can run an equivalent bot — the contract functions it calls have no special-caller restriction. See `keeper/network.ts` for the network-identity fail-closed design (a keeper refuses to scan/write against a chain it wasn't explicitly configured for).

## Local development

```bash
# Frontend
cd arc && npm install && npm run build

# Contracts
cd contracts && forge build && forge test

# Keeper (dry run — no transactions)
cd keeper && npm install && DRY_RUN=true npm run enforce
```

## Environment variables

Copy `.env.example` to `.env` and fill in real values locally. **Never commit a real `.env` file or a real secret value.**

Names only — see `.env.example` for the full list and which service each one belongs to (Supabase, Pinata/IPFS, Circle, World ID, Telegram, Resend/email, admin session, keeper).

## Contributing

No functional/product-safety change should be made without understanding the state machine in `contracts/src/RentalEscrow.sol` and `PropDepEscrow.sol` first — the frontend, backend, and keeper all mirror the same on-chain state model and must stay in sync with it.

## Security

See [`SECURITY.md`](SECURITY.md) for how to report a vulnerability.

## License

No license has been selected yet. All rights reserved until a license is added.
