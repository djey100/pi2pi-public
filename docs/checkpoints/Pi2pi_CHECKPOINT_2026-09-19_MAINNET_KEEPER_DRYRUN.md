# pi2pi Checkpoint — Arc Mainnet Keeper Deployed (DRY_RUN)

**Date:** 2026-09-19
**Git HEAD:** `b0b12222e1fe40ea49d616f73d4a3f8accaaf83c` (branch `refactor/safety-baseline`)

## Summary

A dedicated Arc Mainnet keeper (enforcement bot) is now deployed and running in read-only `DRY_RUN=true` mode. This closes the one remaining item from the original Arc Mainnet migration plan (`docs/arc-mainnet-deployment-readiness.md` §9): Backend and Frontend activation were completed earlier (see §0 of that doc and `docs/checkpoints/Pi2pi_CHECKPOINT_2026-09-18_CIRCLE_COMPLETE.md`); Keeper activation had never been done until this checkpoint.

## What was done (TASK 10AW → 10BD)

- **TASK 10AW** — Read-only audit identified the Arc Mainnet keeper as the single remaining REQUIRED item from the original migration plan. No Fly app, no config, no deployment existed for a Mainnet keeper prior to this line of work.
- **TASK 10AX** — Local-only preparation: `keeper/fly.mainnet.toml` created (`app = "pi2pi-keeper-mainnet"`, `NETWORK = "arc-mainnet"`, `DRY_RUN = "true"`), mirroring the existing Testnet keeper's `[env]` pattern exactly. Contract addresses deliberately **not** hardcoded in the toml — the existing architecture supplies `RPC_URL`/`ESCROW_ADDRESS`/`PROPDEP_ADDRESS`/`KEEPER_PRIVATE_KEY` as Fly secrets, not plain env, confirmed by inspecting the existing `pi2pi-keeper` app's secret names. Full keeper test suite (26/26), typecheck, and build passed. Committed `b0b12222`.
- **TASK 10AY** — Pushed `b0b12222` to `origin/refactor/safety-baseline`.
- **TASK 10AZ** — Created the empty Fly app `pi2pi-keeper-mainnet` (same `personal` org as `pi2pi-mainnet`/`pi2pi-project`/`pi2pi-keeper`). No deploy, no secrets, no machines at this point.
- **TASK 10BA** — Staged the three non-signer secrets: `RPC_URL`, `ESCROW_ADDRESS`, `PROPDEP_ADDRESS`.
- **TASK 10BB** — Generated one new, dedicated Ethereum-compatible keypair via `ethers.Wallet.createRandom()` (never reusing the Testnet keeper's key), staged its private key as `KEEPER_PRIVATE_KEY`. The private key was never printed, logged, or committed — only written briefly to a `0600`-permission temp file, imported via `flyctl secrets import` over stdin, then deleted.
- **TASK 10BC** — First deploy. **Deploy note:** the first attempt, run from the repository root, failed at the Docker build stage — it picked up the root frontend/backend `Dockerfile` instead of `keeper/Dockerfile`, because `keeper/fly.mainnet.toml`'s `[build]` section (mirroring the existing `keeper/fly.toml` exactly) has no explicit Dockerfile path and resolves the build context from the invoking working directory. **The keeper must be deployed from inside the `keeper/` directory** (`cd keeper && flyctl deploy --config fly.mainnet.toml -a pi2pi-keeper-mainnet`) for the build context to correctly resolve to `keeper/Dockerfile` — this applies identically to the existing Testnet keeper, whose `fly.toml` has the same empty `[build]` section. The corrected retry succeeded: release `v1`, image built from `keeper/Dockerfile`, one primary machine + one standby machine launched.
- **TASK 10BD** (this document) — Closure audit and checkpoint.

## Current verified state

| | Arc Mainnet keeper | Arc Testnet keeper |
|---|---|---|
| Fly app | `pi2pi-keeper-mainnet` | `pi2pi-keeper` |
| Release | `v1` | `v27` (unchanged) |
| Primary machine | `8576077a472498` (`started`) | `d897ee5b5346d8` (`started`, unchanged) |
| NETWORK | `arc-mainnet` | `arc-testnet` |
| chainId | `5042` | `5042002` |
| DRY_RUN | `true` | `false` (live enforcement, unchanged) |
| RentalEscrow | `0x06A2b584278f519ba7562c8ac27f4A5C31d52103` | `0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8` |
| PropDepEscrow | `0x55dDa2FD8C37383E33DF32b15EED978Ac6B91532` | `0xe2190997F3811B771C25525C8401504a0e5330c5` |
| Signer address | `0x9a718444166662FD8F2beC7C14148fC153aFe851` | (unchanged, not modified this session) |
| Signer balance | `0` (intentionally unfunded) | unaffected |
| Memo support | disabled (no verified Mainnet Memo address — intentional, per `network.ts`) | enabled |
| HEARTBEAT_URL / KEEPER_HEARTBEAT_SECRET | not set (not part of this task's authorized secrets; heartbeat POST silently skipped, no error) | set |

Live-observed behavior at verification time:
- Continuous successful scan cycles every 15s (`[scan] 0 agreements | rental_now=... propdep_now=...`), no errors, no crash loop.
- `0` agreements currently exist on the Mainnet RentalEscrow contract.
- `0` write/transaction attempts, `0` transaction hashes — confirmed both by log inspection (no `[dry]`/`[tx]` action lines, since the zero-agreement scan path returns before the actions loop) and by re-checking the signer's on-chain balance (`0x0`, unchanged before/after multiple scan cycles).
- Testnet keeper (`pi2pi-keeper`) fully unaffected — same machines, same secrets, same digests throughout.

## MIGRATION COMPLETE vs. KEEPER LIVE ENFORCEMENT NOT YET ACTIVATED

These are two distinct, separately-evidenced statuses — do not conflate them:

**Infrastructure migration: COMPLETE.**
Per `docs/arc-mainnet-deployment-readiness.md` §9 (the original activation plan), three activation steps were required: Backend, Keeper, Frontend. All three are now done:
- Backend — network-aware, deployed (`pi2pi-mainnet`, prior sessions).
- Frontend — `NETWORK_CONFIGS["arc-mainnet"]` present, deployed, Circle Modular Wallet confirmed E2E (`Pi2pi_CHECKPOINT_2026-09-18_CIRCLE_COMPLETE.md`).
- Keeper — deployed and scanning Mainnet successfully (this checkpoint).

§9's own text states `DRY_RUN=true  # mandatory for the first run after any mainnet activation` — the doc frames `DRY_RUN=true` as the required state for completing activation, not `DRY_RUN=false`. No repository document states that `DRY_RUN=false` is required to consider the migration complete.

**Keeper live enforcement: NOT YET ACTIVATED.** This is a distinct, separate, later operational decision — not a migration blocker:
- `DRY_RUN` remains `true` — the keeper will never submit a write transaction in its current state, by design.
- The signer (`0x9a71...Fe851`) is intentionally unfunded — even if `DRY_RUN` were flipped, it could not currently pay gas for any enforcement transaction.
- No real Mainnet rental agreement has ever been enforced against by this keeper (none exist yet — `nextAgreementId() == 0` was observed live).
- Heartbeat/monitoring parity with the Testnet keeper (`HEARTBEAT_URL`/`KEEPER_HEARTBEAT_SECRET`) has not been set up for the Mainnet keeper.

## Post-migration operational items (not migration blockers)

- Fund the Mainnet keeper signer (`0x9a718444166662FD8F2beC7C14148fC153aFe851`) with a small amount of USDC for gas, once ready to enable live enforcement.
- Flip `DRY_RUN=false` on `pi2pi-keeper-mainnet` — a separate, explicitly-approved production action, not to be bundled with any other change.
- Wire up `HEARTBEAT_URL`/`KEEPER_HEARTBEAT_SECRET` for monitoring parity with the Testnet keeper.
- Exercise enforcement against a real Mainnet agreement once one exists, to validate the full write path end-to-end (currently impossible to test live — zero Mainnet agreements exist).

None of the above are required by any repository document to declare the Arc Mainnet migration itself complete.
