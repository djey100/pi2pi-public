# pi2pi Checkpoint — Circle Modular Wallet Recovery Complete

**Date:** 2026-09-18
**Git HEAD:** `6b019ed097057b8139e29c19d53029494cc87a06` (branch `refactor/safety-baseline`)

## Summary

Circle Modular Wallet (Passkey + Circle Modular SDK) is now confirmed working end-to-end on **both** Arc Mainnet and Arc Testnet, via real manual Touch ID passkey ceremonies performed by the user. This closes out the Circle recovery/migration effort that began after the `my.pi2pi.io` → Arc Mainnet domain cutover exposed a WebAuthn RP ID mismatch.

## Timeline

- **TASK 10AN** — Pre-Circle-migration checkpoint. Deployed the mock-isolation commits to `pi2pi-mainnet` (release v6). Live re-verification surfaced a new WebAuthn RP-ID error on Testnet, triggering the investigation that follows.
- **TASK 10AO** — Read-only root-cause audit. Proved via patched-`fetch` RPC capture that Circle was returning `rpId: "my.pi2pi.io"` for requests originating from `testnet.pi2pi.io` — previously masked by `my.pi2pi.io`'s old (pre-cutover) `.well-known/webauthn` manifest, exposed once that domain moved to Mainnet. Also confirmed via official Circle docs/SDK source that Circle Modular Wallets does support Arc Mainnet, with a documented `/arc` transport path.
- **TASK 10AP** — Authenticated Circle Console audit. Confirmed Passkey Domain is a single project-wide setting (not per-key), and Testnet's was still set to `my.pi2pi.io`.
- **TASK 10AQ** — Authorized mutation: **Testnet Passkey Domain changed from `my.pi2pi.io` to `testnet.pi2pi.io`.** Verified via fresh Console reload and live RPC capture (`rpId` now correctly returns `testnet.pi2pi.io`).
  - **Testnet manual Touch ID / passkey E2E: SUCCESS.** A **new passkey was created** under RP ID `testnet.pi2pi.io`.
- **TASK 10AR** — Authorized mutation: **Mainnet LIVE Client Key created** in Circle Console for `my.pi2pi.io` (Allowed Domain: `my.pi2pi.io`). Blocked once by a 2FA modal, completed by the user.
  - Mainnet Passkey Domain = `my.pi2pi.io` (pre-existing, unchanged — this is the domain the original passkey was already registered under, pre-cutover).
- **TASK 10AS** — Implementation, commit `6b019ed097057b8139e29c19d53029494cc87a06`:
  - `@circle-fin/modular-wallets-core` upgraded **1.0.13 → 1.0.16**.
  - Circle transport/chain config made **network-aware**:
    - **Mainnet:** transport path `/arc`, `defineChain({ testnet: false, ... })`, LIVE Client Key selected for `my.pi2pi.io`.
    - **Testnet:** transport path `/arcTestnet`, `defineChain({ testnet: true, ... })`, TEST Client Key selected for `testnet.pi2pi.io`.
  - Client Key selection is hostname-keyed (`CIRCLE_CLIENT_KEY_BY_HOSTNAME`), independent of which network's build serves the request — any unrecognized hostname falls back to a TEST key by design (fail-closed, never falls back to LIVE).
  - `circleSupported` flipped `true` for `arc-mainnet` in `helpers.js`, restoring the Circle Smart Wallet button on Mainnet via the existing `isCircleSupported` gate.
  - Full test suite (447/447) and both network builds passed. LIVE_CLIENT_KEY value never printed in any output/log/report throughout.
- **TASK 10AT** — Pushed commit `6b019ed0` to `origin/refactor/safety-baseline`.
- **TASK 10AU** — Deployed to `pi2pi-mainnet` only (**release v7**). Live-verified: correct network identity, Circle/MetaMask/WalletConnect all visible, `rp_getLoginOptions` returned `rpId: "my.pi2pi.io"` with no error, native WebAuthn/Face ID/Touch ID prompt reached. Testnet independently confirmed unaffected. No real passkey ceremony was attempted by automation (no authenticator hardware available) — left for manual completion.
  - **Mainnet manual Touch ID E2E: SUCCESS**, using the **existing** `my.pi2pi.io` passkey (reused, not re-registered).
- **TASK 10AV** (this document) — Final read-only closure verification of both networks plus git state, all items pass. Checkpoint recorded.

## Current State

**Circle Modular Wallet confirmed working on both networks:**

| | Mainnet | Testnet |
|---|---|---|
| Domain | `my.pi2pi.io` | `testnet.pi2pi.io` |
| Network / chainId | Arc Mainnet / `5042` | Arc Testnet / `5042002` |
| Transport path | `/arc` | `/arcTestnet` |
| `defineChain` testnet flag | `false` | `true` |
| Client Key | LIVE (Allowed Domain `my.pi2pi.io`) | TEST (Allowed Domain `testnet.pi2pi.io`) |
| Passkey Domain (RP ID) | `my.pi2pi.io` | `testnet.pi2pi.io` |
| Passkey ceremony result | Existing passkey reused successfully | New passkey created successfully |
| RentalEscrow | `0x06A2b584278f519ba7562c8ac27f4A5C31d52103` | `0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8` |
| PropDepEscrow | `0x55dDa2FD8C37383E33DF32b15EED978Ac6B91532` | `0xe2190997F3811B771C25525C8401504a0e5330c5` |
| Fly app / release | `pi2pi-mainnet` / v7 | `pi2pi-project` (unchanged) |

- MetaMask / Browser Wallet and WalletConnect remain preserved and unaffected on both networks.
- No DNS changes were required for this recovery (the earlier `my.pi2pi.io` DNS cutover to Mainnet was a separate, already-completed prior migration).
- No smart contract, database, or on-chain state changes were made as part of this recovery — this was frontend Circle SDK/config work plus two Circle Console settings changes (Testnet Passkey Domain, one new Mainnet LIVE Client Key).
- Mock listings/tenants and numeric mock-ID routes remain correctly absent/blocked on Mainnet; Testnet's demo mock data remains intentionally preserved.

## Explicit Status

**CIRCLE MODULAR WALLET RECOVERY COMPLETE.
BOTH MAINNET AND TESTNET VERIFIED WORKING.
NEXT SESSION MUST RETURN TO THE MAIN PROJECT LINE AFTER TASK 10AN / POST-MIGRATION WORK.
DO NOT REOPEN CIRCLE WORK UNLESS A REGRESSION IS OBSERVED.**
