# pi2pi production state baseline — 2026-08-15

## Purpose

This is a handoff and safety baseline for future owners and agents. It records
what was directly verified after the production work of 2026-08-15, what was
not verified, and what must not be changed casually.

It is not a deployment instruction and does not authorize any production
operation. `AGENTS.md` contains the mandatory approval rules.

## Executive conclusion

At the time of the final read-only checks on 2026-08-15:

- the public site and `/api/version` returned HTTP 200;
- the backend Fly machine was started on release `v1012`;
- the keeper had one current started machine on release `v25`;
- the live frontend, backend, and observed keeper activity were aligned to
  contract pair A;
- the keeper repeatedly scanned one agreement and logged `No actions needed`;
- no current crash loop was observed;
- full production end-to-end financial and contract workflows were not tested.

Therefore the supported conclusion is:

> Infrastructure and the main public surfaces were operating. Product behavior
> was only partially verified. Do not deploy, restart, roll back, or change
> configuration merely to gain confidence; use read-only checks first and an
> isolated test workflow for state-changing scenarios.

## Active production contract pair

Network: Arc Testnet, chain ID `5042002`.

- RentalEscrow: `0x6cbF4d958dA24b7AdC98Fb7633213Ac26b5a6f3a`
- PropDepEscrow: `0x7428B32B61Ee0678c6e3706cB7d5aa4Ece818082`

Read-only RPC checks confirmed:

- both addresses contain bytecode;
- RentalEscrow and PropDepEscrow point to each other;
- `nextAgreementId()` was `1`;
- agreement `#0` returned populated state.

Candidate pair B was deployed and mutually linked but had
`nextAgreementId() == 0`:

- RentalEscrow: `0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8`
- PropDepEscrow: `0xe2190997F3811B771C25525C8401504a0e5330c5`

Do not switch any single layer to B. A contract-pair change must be planned as
one coordinated frontend/backend/keeper operation with explicit owner approval.

## Production evidence recorded on 2026-08-15

### Public application

- `GET https://my.pi2pi.io/` returned `200`.
- `GET https://my.pi2pi.io/api/version` returned `200` and pair A.
- The live frontend bundle contained pair A and did not contain pair B.
- Public listing and primary frontend routes were reported to render without
  browser console errors during a separate read-only QA pass.

### Fly.io

- Backend application: `pi2pi-project`, release `v1012`, machine state
  `started`.
- Keeper application: `pi2pi-keeper`, release `v25`, one current machine state
  `started`. A second stopped machine was the replaced instance, not by itself
  evidence of failure.
- Keeper logs repeatedly showed one agreement being scanned approximately every
  15–17 seconds and `No actions needed`.

### Local verification reported

- Frontend: 19 test files, 422 tests reported passing.
- Heartbeat unit tests: 10/10 passing.
- Keeper TypeScript check: reported successful.
- Address consistency check: successful across 116 runtime files.
- Foundry tests were not run in the final QA environment because `forge` was
  unavailable.
- The Docker smoke test was not run during the independent read-only audit
  because it creates and removes local Docker objects.

These local tests are not proof that all production end-to-end workflows work.

## Confirmed incident on 2026-08-15

Production releases `v1008` through `v1012` and keeper releases `v24` and `v25`
were created during the session.

At least one backend image omitted `keeper-heartbeat.js`. Fly logs directly
confirmed:

- `ERR_MODULE_NOT_FOUND` for `/app/keeper-heartbeat.js`;
- repeated machine restarts;
- the machine reaching its maximum restart count;
- a subsequent image starting successfully and serving pair A.

The current Dockerfile includes `keeper-heartbeat.js` and `config`, but its
per-file runtime copy design remains a maintenance risk. Do not infer from one
boot smoke test that every production workflow is safe.

## Current known defect

`GET /api/version` returns a misleading `buildTime` value. In
`server-arc.js`, it is calculated with `new Date().toISOString()` inside the
request handler, so it changes on every request. It is request time, not build
time or server start time.

Impact: observability only. It is not evidence of repeated builds or restarts
and does not affect contracts, payments, data, or normal site operation. Do not
make an emergency deployment solely for this defect.

Historical logs also contained `ERR_HTTP_HEADERS_SENT` after unauthorized admin
requests. The process remained running. This should be investigated locally in
a future normal development task, not treated as a reason for an emergency
production change.

## What remains unverified

The following production workflows were not independently executed after the
session because they mutate data, require authentication, or create blockchain
transactions:

- new-user registration and real wallet/passkey login;
- listing creation or modification;
- viewing requests and chat messages;
- contract form saves and signatures;
- agreement creation;
- tenant and landlord deposits;
- rent payment;
- missed-payment enforcement;
- early termination and disputes;
- PropDep claim, bond, freeze, and release;
- lease settlement, archive, and historical document preservation;
- direct inspection of the production heartbeat row, RLS, grants, and row count.

"Unverified" does not mean "broken". It means no state-changing production test
was performed.

## Repository state

Branch at the time of audit: `refactor/safety-baseline`.

HEAD contained these session commits:

1. `622eb6dc` — contract configuration and heartbeat implementation;
2. `7e07852f` — deployment documentation and public addresses;
3. `c7df4cd0` — Docker smoke test;
4. `3d6ed357` — address/deployment checklist;
5. `299fdaba` — Circle progress-update draft.

The repository had no Git remote configured.

The working tree was already heavily dirty, with modified generated contract
artifacts, frontend files, local tool files, and many untracked backups/build
outputs. Do not reset, clean, delete, commit, or fold these changes into another
task without first producing a read-only inventory and obtaining explicit owner
approval.

Some committed comments became stale after production was switched to pair A:

- `config/deployments.json` still described `/api/version` as returning B;
- `pitch/deferred-fixes.md` contained the same historical statement.

These are documentation defects, not proof of a current production mismatch.

## Safe procedure for a future task

1. Read this file and root `AGENTS.md`.
2. Start with read-only checks: Git status, public HTTP, `/api/version`, exact
   live frontend bundle, Fly status/logs, and Arc RPC.
3. State exactly what is proven and what is unknown.
4. For a code task, work locally and test locally. Do not infer production
   authorization.
5. If a production change appears necessary, stop and request the single-use
   explicit approval described in `AGENTS.md`.
6. Never use agreement `#0` as a test object. State-changing end-to-end testing
   requires isolated test accounts and a separately approved test agreement.

## Rollback reference, not authorization

The recorded pre-session Fly releases were backend `v1007` and keeper `v23`.
They are possible code rollback references, not a complete snapshot: Fly
secrets, Supabase state, frontend assets, and blockchain state are independent.
A future rollback must verify environment-variable compatibility and contract
alignment before any action. Never roll back only one layer.

## Addendum — 2026-08-18

A separate read-only Git-tree cleanup review found a third, previously
undocumented contract pair in `contracts/broadcast/`, confirmed on-chain via
3/3 successful receipts and a read-only `eth_call`:

- RentalEscrow: `0x11184188c24ce546912617156c0693868a98b2a3`
- PropDepEscrow: `0xfe7b14a5313e93d8e22c7c4edc62431eca0f0880`
- Deployed 2026-06-13T03:03:26Z, commit `46cdb8c2`, `nextAgreementId() == 0`.

No evidence was found that this intermediate pair was used by the production
frontend, backend, or keeper. It was superseded by the later candidate
deployment and has `nextAgreementId()==0`. Recorded in
`config/deployments.json` as `historicalIntermediate`. This addendum does not
change the Active production contract pair (Pair A) conclusion stated above.
