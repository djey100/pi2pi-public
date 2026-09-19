# Arc Mainnet deployment readiness — TASK 4

Prepared 2026-09-16. This was originally a **read-only preparation document**
written before any contract existed on Arc Mainnet. Sections 1-8 below are
kept as the historical pre-deployment record. See `AGENTS.md` for the
mandatory production-approval protocol before any production operation.

## 0. Status: MIGRATION COMPLETE — 2026-09-18

The deployment and domain cutover this document prepared for are now done.
Section 9's activation plan below is **superseded** — it was written
"BLOCKED pending real deployment" and is kept only as a historical record of
what was planned; the actual completed state is recorded here instead.

**Canonical domain → Fly app → network mapping:**

| Domain | Fly app | Network | Chain ID |
|---|---|---|---|
| `https://my.pi2pi.io` | `pi2pi-mainnet` | `arc-mainnet` | `5042` |
| `https://testnet.pi2pi.io` | `pi2pi-project` | `arc-testnet` | `5042002` |

- `pi2pi-mainnet.fly.dev` redirects to `https://my.pi2pi.io`; `pi2pi-project.fly.dev`
  redirects to `https://testnet.pi2pi.io`. Each app's TLS certificate for its
  branded domain belongs to that app only (`my.pi2pi.io` → `pi2pi-mainnet`
  exclusively; `testnet.pi2pi.io` → `pi2pi-project` exclusively) — no shared
  or duplicate certificate ownership. Mainnet's certificate validation DNS
  records (ACME challenge + ownership TXT) are retained for renewal; see Fly
  certs tooling for exact values, not duplicated here.

**Arc Mainnet contract addresses (live, matches `config/deployments.json["5042"]`):**

- USDC: `0x3600000000000000000000000000000000000000`
- RentalEscrow: `0x06A2b584278f519ba7562c8ac27f4A5C31d52103`
- PropDepEscrow: `0x55dDa2FD8C37383E33DF32b15EED978Ac6B91532`

**Arc Testnet contract addresses (live, active pair):**

- RentalEscrow: `0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8`
- PropDepEscrow: `0xe2190997F3811B771C25525C8401504a0e5330c5`

**Circle Smart Wallet support differs by network — this is intentional, not
a gap:** verified working on Arc Testnet (reaches the native WebAuthn/passkey
stage without error). Deliberately disabled on Arc Mainnet
(`isCircleSupported('arc-mainnet') === false` in `arc/src/helpers.js`,
enforced fail-closed in `wallet.js`) and the option is hidden from the
Mainnet wallet-connect UI entirely (`WalletModal.jsx`) rather than shown and
failing on click. MetaMask and WalletConnect are available on both networks.

**Mainnet secrets state (presence only, no values recorded):**

- `PINATA_JWT` — present, deployed (uploads/documents functional).
- `WORLDCOIN_APP_ID`, `WORLDCOIN_RP_ID` — absent. World ID personhood
  verification is unavailable on Mainnet until set.
- `RESEND_API_KEY` — absent. Email notifications are unavailable (feature
  degrades gracefully, no crash).
- `TELEGRAM_BOT_TOKEN` — absent. Telegram notifications are unavailable
  (feature degrades gracefully, no crash).
- `DEPLOYER_PRIVATE_KEY`, `ALLOW_ADMIN_TIME_TRAVEL` — intentionally absent.
  These gate the admin Time Travel route, which is additionally hard-blocked
  on any chain other than Arc Testnet (`5042002`) regardless of these
  values — there is no path for this to affect Mainnet.

These are known, non-blocking feature gaps — a scope decision, not a defect.

**Git baseline at migration completion:** branch `refactor/safety-baseline`,
commit `164a44562bd81d432362a5cbd3a9963350a460e8`.

## 1. Verified official Arc Mainnet parameters

All values below were independently verified on 2026-09-16, either by fetching
current official documentation pages or by making live, read-only JSON-RPC
calls directly against the Arc Mainnet RPC. None are carried over from memory
or from a prior session without re-verification.

| Parameter | Value | Source | Verified how |
|---|---|---|---|
| Chain ID | `5042` | docs.arc.io — "Connect to Arc" (`arc/references/connect-to-arc.md`) | Doc fetch **and** live `eth_chainId` → `0x13b2` = 5042 |
| Primary RPC URL | `https://rpc.mainnet.arc.io` | docs.arc.io — "Connect to Arc" | Doc fetch **and** live call succeeded |
| Alternate RPCs | Alchemy (`arc-mainnet.g.alchemy.com` — needs API key), Blockdaemon, dRPC, QuickNode (`*.mainnet.arc.io`) | docs.arc.io — "Connect to Arc" | Doc fetch only (not exercised) |
| Block explorer | `https://explorer.arc.io` | docs.arc.io — "Connect to Arc" | Doc fetch **and** HTTP 200 live |
| USDC (ERC-20 interface) address | `0x3600000000000000000000000000000000000000` | docs.arc.io — "Contract Addresses" (`arc/references/contract-addresses.md`) | Doc fetch **and** live `eth_getCode` (real bytecode present), `decimals()`→6, `symbol()`→"USDC", `totalSupply()`→623,472,550.624 USDC |
| USDC decimals (ERC-20) | `6` | docs.arc.io — "Contract Addresses" + "Gas and Fees" | Doc fetch **and** live `eth_call decimals()` → `0x06` |
| Native gas precision | `18` decimals internally; **same underlying balance as the 6-decimal ERC-20 view** ("not two separate tokens") | docs.arc.io — "Gas and Fees" | Doc fetch only |
| Memo predeploy address | `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` | docs.arc.io — "Contract Addresses" | Doc fetch **and** live `eth_getCode` (real bytecode present) |
| EVM/Foundry notes | Standard EVM-compatible chain per docs; no Arc-specific Foundry caveat found on the pages checked | docs.arc.io | Doc fetch only |

None of these required guessing — the official contract-addresses page
explicitly lists Mainnet values (identical to Testnet for USDC and Memo), and
none of the fetched pages contain any "not yet available" / "coming soon"
caveat for Mainnet. This is recorded as authoritative per the task's own
"if it says not available, treat as unverified" rule — it does **not** say
that, so these values are treated as verified.

## 2. Values explicitly NOT verified / not available from official sources

- **Arc Mainnet Aave V3 Pool address** — not needed (lending stays disabled for
  this deployment) and not published by any source checked.
- **Whether USDC is *confirmed* the native gas asset specifically on Mainnet**
  — the "Gas and Fees" doc page states it describes **Testnet** configuration
  ("The parameters on this page reflect the current Arc Testnet
  configuration... may change before mainnet launch") and does not carry an
  equivalent explicit Mainnet statement on that specific page. However, the
  "Connect to Arc" reference page independently lists Mainnet's native
  currency as USDC with 18 decimals, and the live RPC/USDC contract
  cross-check above (same address, real bytecode, real supply, live chain)
  corroborates it operationally. No contradiction was found between sources —
  just one page (`gas-and-fees.md`) that hedges its specific numeric fee
  parameters (min/max base fee, throughput) as testnet-only and subject to
  change.
- **No conflict between official Arc docs and official Circle sources was
  found** — `developers.circle.com` was not separately checked in this pass
  because `docs.arc.io` (which is Circle's own Arc documentation) already
  supplied every value needed with no internal contradiction.

## 3. Deployer / owner / treasury model (traced from `Deploy.s.sol` + constructors)

- `RentalEscrow.owner` = `msg.sender` at construction = whichever address
  broadcasts the deploy transactions (the `--sender`/signer used with
  `forge script ... --broadcast`).
- `PropDepEscrow.owner` = `msg.sender` at construction = the **same**
  broadcasting address (both contracts are deployed inside the same
  `vm.startBroadcast()` block).
- `protocolTreasury` = whatever `TREASURY_ADDRESS` env var is supplied — an
  **independently operator-supplied** address, not derived from the deployer.
  Nothing in the code assumes or requires deployer == treasury.
- Operational recommendation for the controlled beta: it is acceptable for
  deployer and treasury to be the same address initially, since deployer
  authority (owner) is already able to call `setProtocolTreasury` later to
  redirect yield-fee collection without redeploying. **No architecture change
  is being made for this** — this is purely an operational choice at deploy
  time, using the existing `TREASURY_ADDRESS` env var.

## 4. Required environment variables (non-secret template)

Consistent with the existing convention (`fly.toml`/`keeper/fly.toml` already
declare `NETWORK`/`RPC_URL` as plain, non-secret config). **Never put a
private key, seed phrase, mnemonic, or Circle API secret in this repo.**

```bash
# Foundry deploy script (contracts/script/Deploy.s.sol) — set before running forge script
RPC_URL=https://rpc.mainnet.arc.io          # verified official Arc Mainnet RPC
USDC_ADDRESS=0x3600000000000000000000000000000000000000  # verified official Arc Mainnet USDC
TREASURY_ADDRESS=<operator-supplied address, non-zero, valid checksum>
# Deployer/broadcaster identity is supplied via Foundry wallet flags
# (--account/--ledger/--private-key at broadcast time), never as a plain env var.
```

## 5. Exact no-broadcast dry-run command used

```bash
cd contracts
TREASURY_ADDRESS=<placeholder-for-dry-run-only> \
USDC_ADDRESS=0x3600000000000000000000000000000000000000 \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.mainnet.arc.io \
  --sender <DEPLOYER_ADDRESS> \
  -vvv
```

No `--broadcast`, no `--private-key`/`--account`/`--ledger`/`--unlocked`, no
signing of any kind. `--sender <address>` only tells Forge which address
context to simulate from — a public address, never a secret.

**Result of the dry run actually executed for this task** (using Foundry's
well-known public Anvil test addresses purely as placeholders — not real
production keys, nothing persisted, nothing broadcast):
- `Chain ID: 5042` (confirmed live via the RPC by the script itself)
- `Post-deployment verification passed` (the TASK 3B `_verifyPostDeployment`
  check ran successfully against the live-simulated state)
- `SIMULATION COMPLETE. To broadcast these transactions, add --broadcast and
  wallet configuration(s) to the previous command.` — Forge's own explicit
  confirmation that nothing was sent.
- All 3 simulated transactions (RentalEscrow deploy, PropDepEscrow deploy,
  `setPropDepEscrow` call) recorded `"hash": null` and `receipts: []` in the
  local dry-run artifact — direct evidence nothing was mined/broadcast.
- Estimated gas price: `46.192369098 gwei`
- Estimated total gas: `10,388,717` gas units
- Estimated funding required: `~0.4799` (native units, 18-decimal) ≈
  **~0.48 USDC**, since Arc's native gas balance and the 6-decimal ERC-20 view
  share the same underlying balance per official docs.
- **Recommended operational funding target: 2 USDC** on the deployer address
  before a real deploy, as a safety margin (~4x the estimate) against gas
  price movement between now and the real deploy — not because the estimate
  is expected to be wrong, but because Arc's fee page itself says testnet
  parameters "may change before mainnet launch," and this is cheap enough
  that a wide margin costs nothing meaningful.

The local dry-run artifact this produced
(`contracts/broadcast/Deploy.s.sol/5042/dry-run/run-latest.json`) was deleted
after being inspected, to leave the working tree exactly as it was before —
it contained no secrets, only `hash: null` placeholders and the addresses
computed for the placeholder deployer/treasury used in the simulation.

## 6. Post-deploy read-only verification checklist

Run all of these as plain `cast call`/`eth_call` reads — **no write calls**.
Do not proceed to activate any runtime component until every item passes.

1. `eth_chainId` on the RPC used for the deploy == `5042`
2. `eth_getCode` on the deployed RentalEscrow address returns non-empty bytecode
3. `eth_getCode` on the deployed PropDepEscrow address returns non-empty bytecode
4. `RentalEscrow.owner()` == the expected deployer/owner address
5. `PropDepEscrow.owner()` == the expected deployer/owner address
6. `RentalEscrow.usdc()` == the verified Arc Mainnet USDC address above
7. `PropDepEscrow.usdc()` == the verified Arc Mainnet USDC address above
8. `RentalEscrow.propDepEscrow()` == the deployed PropDepEscrow address
9. `PropDepEscrow.mainContract()` == the deployed RentalEscrow address
10. `RentalEscrow.devMode()` == `false`
11. `PropDepEscrow.devMode()` == `false`
12. `RentalEscrow.lendingEnabled()` == `false`
13. `address(RentalEscrow.lendingAdapter())` == `address(0)`
14. `RentalEscrow.protocolTreasury()` == the expected treasury address
15. `RentalEscrow.nextAgreementId()` == `0`
16. `RentalEscrow.activeAgreementCount()` == `0`

Note: items 8-13 are also already enforced automatically **inside** the deploy
script itself (`_verifyPostDeployment`, added in TASK 3B) — the script would
have reverted before completing if any of those failed. This checklist is the
independent, off-chain re-confirmation step, run separately from the deploy
transaction itself.

## 7. Interruption recovery procedure

`Deploy.s.sol`'s `run()` issues three sequential broadcast transactions
(RentalEscrow deploy → PropDepEscrow deploy → `setPropDepEscrow` link), plus
a fourth read-only verification step. A real deploy could be interrupted
between any of these steps (RPC failure, operator Ctrl-C, out-of-gas,
hardware wallet disconnect, etc.).

**A. RentalEscrow deployed, PropDepEscrow not deployed**
- Check first: `eth_getCode` on the RentalEscrow address from the failed
  run's output/logs — confirm it has bytecode.
- Safe to resume: yes. `RentalEscrow.propDepEscrow()` will read as
  `address(0)` — expected, matches a fresh, not-yet-linked deploy.
- Write needed later: deploy `PropDepEscrow` (constructor arg = the already-
  deployed RentalEscrow address), then call `setPropDepEscrow`.
- Do NOT redeploy a second RentalEscrow — reuse the one that exists.
- Avoiding duplicates: before deploying `PropDepEscrow`, re-verify on-chain
  that the RentalEscrow address from the failed run truly has code and a
  sane `owner()`/`usdc()` before treating it as the "real" one to link
  against.

**B. Both deployed, linkage tx not executed**
- Check first: `RentalEscrow.propDepEscrow()` — if it reads `address(0)`,
  linkage did not happen.
- Safe to resume: yes — `setPropDepEscrow` is idempotent-safe to call once;
  it will simply succeed if not yet set.
- Write needed later: a single `escrow.setPropDepEscrow(address(propDep))`
  call as owner, then re-run the checklist in §6.
- Do NOT deploy a new PropDepEscrow "just in case" — verify the existing one
  first (`PropDepEscrow.mainContract()` should already equal the RentalEscrow
  address, since that's set immutably at its own construction).

**C. Linkage executed but local deployment record/output lost**
- Check first: re-derive everything from chain state, not from memory. Query
  the deployer address's transaction history via the block explorer
  (`explorer.arc.io`) or `eth_getTransactionCount`/`eth_getLogs` for
  `AgreementCreated`-style or contract-creation events near the expected
  time, to recover the addresses.
- Safe to resume: yes, this is a pure record-keeping gap, not a chain-state
  problem. No further transaction is needed — only re-populate
  `config/deployments.json` (§8) once the addresses are confirmed via
  read-only calls matching the full checklist in §6.
- Never guess an address from partial memory — always re-verify via
  `eth_getCode` + `owner()`/`usdc()`/`propDepEscrow()`/`mainContract()` reads
  before recording it anywhere.

**D. Script fails after linkage during post-deploy verification**
  (`_verifyPostDeployment` reverts)
- This means the deploy succeeded on-chain (RentalEscrow + PropDepEscrow +
  link all landed) but the script's own sanity check caught something
  unexpected — devMode true, lending pre-enabled, or a link mismatch.
- Check first: read the revert reason (`DeploymentVerificationFailed(string)`)
  — it names exactly which invariant failed.
- Safe to resume: **NO — stop and investigate before doing anything else.**
  A revert here means either (a) a genuine bug/regression in the contracts
  that TASK 3/3B did not catch, or (b) the deploy actually ran against an
  unexpected chain (chainId mismatch) despite `--rpc-url` pointing where
  expected. Do not attempt further transactions against these contracts
  until the specific failed invariant is understood.
- Do NOT redeploy blindly — the already-deployed contracts may be entirely
  fine and the fix may only be operational (e.g., re-run the read-only
  verification independently to confirm/deny the script's own finding).

**E. Accidental rerun of the deployment command**
- Each `run()` invocation deploys a **brand new** RentalEscrow/PropDepEscrow
  pair — Foundry does not deduplicate. An accidental second `--broadcast` run
  creates a second, entirely independent, unlinked-to-the-first pair.
- Check first: compare the newly-logged addresses against any previously
  recorded ones (§8's manifest, once populated) — if they differ, a
  duplicate pair now exists on-chain.
- Safe to resume: the OLD pair is unaffected (each pair is independent,
  nothing about creating a second pair can corrupt the first). But now there
  are two live pairs — this is a **manifest/runtime-configuration risk**, not
  a fund-safety risk: nothing has funds yet on a fresh deploy on either pair.
- When NOT to redeploy: never re-run `forge script ... --broadcast` against
  Arc Mainnet without first confirming via `eth_getCode`/owner reads that no
  prior successful deploy already exists at the expected addresses. Treat a
  second broadcast attempt as equivalent in risk to a real fund-moving
  action and require the same explicit approval as any other mainnet write,
  per `AGENTS.md`.
- Avoiding duplicates going forward: always run the read-only checklist
  (§6) and check `config/deployments.json`/Fly secrets for an existing
  mainnet entry **before** ever adding `--broadcast` to a mainnet command.

No recovery writes were executed in this task — this section is
documentation only.

## 8. `config/deployments.json` — planned schema for AFTER a successful deploy

**Not added yet — no deployment exists.** Per the existing Arc Testnet
convention already in this file, the future entry would be a new top-level
`"5042"` key, structured identically to the existing `"5042002"` entry:

```jsonc
"5042": {
  "network": "arc-mainnet",
  "chainId": 5042,
  "usdc": "0x3600000000000000000000000000000000000000",

  "active": {
    "_comment": "<fill in: audit status, security fix set, verification notes, exactly like the testnet '_comment' fields above>",
    "deployedAt": "<ISO-8601 UTC timestamp of the RentalEscrow deployment tx>",
    "deployer": "<actual broadcaster address — filled in only after real deploy>",
    "RentalEscrow": {
      "address": "<deployed address>",
      "deploymentTx": "<tx hash>"
    },
    "PropDepEscrow": {
      "address": "<deployed address>",
      "deploymentTx": "<tx hash>"
    },
    "linkingTx": "<setPropDepEscrow tx hash>"
  }
}
```

`historicalIntermediate` and `legacy` arrays are testnet-specific artifacts
of this project's own deployment history — they only get populated for
mainnet if/when a mainnet pair is ever superseded. Not created preemptively.

## 9. Runtime activation plan (historical — superseded, see §0)

**This section is kept only as the original pre-deployment plan.** Every
"BLOCKED" marker below was resolved once the real deployment happened; see
§0 for the actual completed addresses, secrets, and domain state. The
content below is unmodified from when it was written on 2026-09-16.

**Backend** (`server-arc.js` via `NETWORK`/`RPC_URL` mandatory env, TASK 2):
```
NETWORK=arc-mainnet
RPC_URL=https://rpc.mainnet.arc.io          # verified
RENTAL_ESCROW_ADDRESS=<BLOCKED — no deployment exists yet>
PROPDEP_ESCROW_ADDRESS=<BLOCKED — no deployment exists yet>
USDC_ADDRESS=0x3600000000000000000000000000000000000000  # verified, ready
```

**Keeper** (`enforcer.ts` via `NETWORK` mandatory env + contract-address deny-list, TASK 2/3B):
```
NETWORK=arc-mainnet
RPC_URL=https://rpc.mainnet.arc.io          # verified
ESCROW_ADDRESS=<BLOCKED — no deployment exists yet>
PROPDEP_ADDRESS=<BLOCKED — no deployment exists yet>
# Memo: no verified Arc Mainnet Memo config wired into the keeper's
# resolveMemoAddress() map (only arc-testnet has an entry, by design —
# TASK 3B). Even though the official docs list a Mainnet Memo address
# (§1), the keeper intentionally does not reuse it without an explicit,
# reviewed addition to keeper/network.ts — Memo stays BLOCKED/disabled on
# Arc Mainnet until that's done as a deliberate follow-up, not silently.
DRY_RUN=true                                 # mandatory for the first run after any mainnet activation
```

**Frontend** (`arc/.env.production`-style `VITE_NETWORK`, TASK 2):
```
VITE_NETWORK=arc-mainnet
# Requires a NETWORK_CONFIGS["arc-mainnet"] entry in arc/src/helpers.js —
# does not exist yet (TASK 2 deliberately left it absent). BLOCKED until
# added with real contract addresses post-deployment.
# rpcUrl: https://rpc.mainnet.arc.io          # verified, ready to use once unblocked
# usdcAddress: 0x3600000000000000000000000000000000000000  # verified, ready
# escrowAddress / propdepAddress: BLOCKED — no deployment exists yet
# circleSupported: false unless/until a verified Arc Mainnet Circle
#   client URL/key/transport path is confirmed — not attempted in this task.
```

**Every activation step above was BLOCKED at the time this was written** on
the same missing input: no RentalEscrow/PropDepEscrow deployment existed
yet. That deployment has since happened — see §0 for the resolved state,
including the deliberate final decision on Circle support (disabled and
hidden on Mainnet, not merely "unconfirmed").
