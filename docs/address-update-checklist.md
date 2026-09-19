# Address Update Checklist — After Contract Redeploy

> Updated 2026-08-15 after a production incident: contracts were redeployed
> and Fly secrets were updated for backend + keeper, but frontend
> (`arc/src/helpers.js`) was never updated/rebuilt — production ran on two
> different contract pairs (frontend vs. backend/keeper) for over two months
> undetected. A second, separate incident the same day: a new file
> (`keeper-heartbeat.js`) was added to the backend's import graph but not to
> `Dockerfile`'s per-file `COPY` list — the build succeeded, the deploy
> succeeded, and the container crash-looped in production on every restart.
>
> **The redeploy is not done until frontend, backend, keeper, and
> `config/deployments.json` all agree — one layer updated is not a completed
> redeploy, it is a new inconsistency.**

## 1. Before deploy

- [ ] Decide the canonical active pair explicitly (write it down — address + chainId + deployer + deployment tx)
- [ ] Update `config/deployments.json` — move the new pair into `active`, keep the previous `active` as an entry under `legacy` (or `latestDeployedCandidate` if it's deployed but not yet cut over)
- [ ] Update frontend: `arc/src/helpers.js` — `ESCROW_ADDRESS` and `PROPDEP_ADDRESS` — then `cd arc && npm run build`
- [ ] Check `server-arc.js` and `admin_routes.js` env var names are still `RENTAL_ESCROW_ADDRESS` / `PROPDEP_ESCROW_ADDRESS` (they read the manifest as fallback — verify the fallback resolves to the new `active` pair, not a stale import)
- [ ] Check `keeper/enforcer.ts` env var names are still `ESCROW_ADDRESS` / `PROPDEP_ADDRESS` (no fallback — required, keeper refuses to start without them)
- [ ] `npm run check-addresses` — must exit 0 before touching anything production
- [ ] `npm run test:docker` — must exit 0 before touching anything production. This is the check that would have caught both incidents above: it builds the real `Dockerfile`, confirms every runtime-imported file (including anything new) actually lands in the image, and boots the container to catch `ERR_MODULE_NOT_FOUND` before it reaches Fly.

**Do not proceed to production changes if either check fails.**

## 2. Order of production changes

Do these **in order**, verifying each layer before moving to the next — do not queue up multiple `flyctl secrets set` calls back to back "to save time":

1. **Backend** (`pi2pi-project`) — set `RENTAL_ESCROW_ADDRESS` / `PROPDEP_ESCROW_ADDRESS`, wait for the release, confirm healthy (§3) before continuing
2. **Keeper** (`pi2pi-keeper`) — set `ESCROW_ADDRESS` / `PROPDEP_ADDRESS`, wait for the release, confirm healthy (§3) before continuing
3. **Frontend** — `flyctl deploy` (rebuilds and redeploys `pi2pi-project`, which serves the frontend bundle) using the `arc/src/helpers.js` change from §1
4. **Cross-check**: confirm all three layers report the *same* addresses — `/api/version` (backend), keeper startup banner / heartbeat row (keeper), and the live frontend JS bundle (grep the deployed `/assets/index.vite-*.js` for both addresses). A redeploy that leaves any one of these three disagreeing with the others is the exact failure mode from June 2026 — treat a mismatch as a stop-the-line issue, not a follow-up task.

## 3. Required post-deploy checks

- [ ] `GET /api/version` — returns the new addresses
- [ ] Live frontend bundle contains the new pair and does **not** contain the previous pair (fetch `/`, extract the `/assets/index.vite-*.js` reference, grep it directly — do not trust a locally cached build)
- [ ] Keeper startup banner (`flyctl logs -a pi2pi-keeper --no-tail`) shows the new `Escrow`/`PropDep` lines
- [ ] Keeper heartbeat row in `keeper_heartbeats` reflects the new addresses and `updated_at` is advancing (~every `LOOP_INTERVAL`)
- [ ] `nextAgreementId()` on the new RentalEscrow via RPC — confirms the contract is live and reachable, and tells you whether this is a fresh contract (0) or one with existing history
- [ ] RentalEscrow ↔ PropDepEscrow linkage — `propDepEscrow()` on RentalEscrow and `mainContract()` on PropDepEscrow point at each other
- [ ] No crash loop on either app — `flyctl status` shows `started`, not `stopped`/repeated restarts; check logs for a single clean boot, not a restart cycle

## 4. Warnings

- `flyctl secrets set` restarts the app it's applied to — every secret change is a production restart, not a no-op config update
- Restarting keeper can automatically trigger routine on-chain actions (e.g. Arc Memo payment attestation) as soon as it resumes scanning a contract with real agreement state — this is expected keeper behavior, not something to react to as an anomaly, but it means "just restart keeper to check something" is never a side-effect-free action
- `Dockerfile` copies backend runtime files **by name**, not by directory — adding a new file to the backend's import graph (or a new `readFileSync`/config path) without adding a matching `COPY` line will build and deploy successfully and then crash-loop in production. This is exactly why `npm run test:docker` exists — it is not optional
- **Deploy is prohibited if `npm run test:docker` did not pass.** No exceptions for "small" changes — the file that broke production last time was one line.

## 5. Rollback

- [ ] Before making any change, record: previous addresses, previous Fly release/version for each app, and current `/api/version` output — this is your rollback target, capture it *before* you need it
- [ ] Roll back all three layers **together** — backend secrets, keeper secrets, and frontend build/deploy. Rolling back one layer while the others stay on the new pair recreates the exact cross-layer mismatch this checklist exists to prevent
- [ ] After rollback, re-run the checks in §3 against the restored addresses before declaring the rollback complete

## Verification

```bash
npm run check-addresses
npm run test:docker
```

Both must exit 0. `config/deployments.json` is the single source of truth for what "active" means — if these checks disagree with what you believe is deployed, trust the checks and investigate, don't override them.
