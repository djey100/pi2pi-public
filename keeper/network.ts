/**
 * pi2pi Keeper — network identity (fail-closed)
 *
 * The keeper signs transactions, so it must never scan or write against a
 * chain it wasn't explicitly configured for. This module is the single
 * source of truth for "which Arc network am I supposed to be on" — no
 * implicit fallback, no "unknown → default" behavior. An unrecognized
 * network name or a chainId mismatch is always a fatal configuration error.
 *
 * Kept as a separate file (rather than inline in enforcer.ts) so it can be
 * unit tested without triggering enforcer.ts's side-effecting main().
 */

// Explicit network → chainId mapping. Add a new network here ONLY once its
// chainId is confirmed — never guess.
export const NETWORKS: Readonly<Record<string, number>> = Object.freeze({
  "arc-testnet": 5042002,
  "arc-mainnet": 5042,
});

export class NetworkConfigError extends Error {}
export class NetworkMismatchError extends Error {}

/** Resolves a network name to its expected chainId. Fails closed on anything unrecognized. */
export function resolveExpectedChainId(network: string): number {
  const chainId = NETWORKS[network];
  if (chainId === undefined) {
    throw new NetworkConfigError(
      `Unsupported NETWORK "${network}". Supported: ${Object.keys(NETWORKS).join(", ")}`,
    );
  }
  return chainId;
}

/** Throws NetworkMismatchError if the RPC's actual chainId doesn't match what was configured. */
export function assertChainMatch(network: string, expectedChainId: number, actualChainId: number): void {
  if (actualChainId !== expectedChainId) {
    throw new NetworkMismatchError(
      `FATAL NETWORK MISMATCH: NETWORK=${network} expects chainId=${expectedChainId}, ` +
        `but RPC reports chainId=${actualChainId}. Refusing to scan or write.`,
    );
  }
}

// Arc Memo predeploy — attaches structured metadata to on-chain calls (used
// to annotate rent payments). Only the Arc Testnet address has been verified
// in this repository. Do NOT assume the same address is valid on Arc Mainnet
// or any other network — an unverified network simply gets no Memo address,
// and Memo functionality is skipped for it (it's optional/annotation-only,
// never required for core keeper enforcement).
const MEMO_ADDRESSES: Readonly<Record<string, string>> = Object.freeze({
  "arc-testnet": "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
});

/** Returns the verified Memo address for this network, or null if none is verified. */
export function resolveMemoAddress(network: string): string | null {
  return MEMO_ADDRESSES[network] ?? null;
}

// ─── Contract address validation (fail-closed, network-aware) ─────────────

export class ContractAddressError extends Error {}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function isValidNonZeroAddress(addr: string): boolean {
  return typeof addr === "string" && ADDRESS_RE.test(addr) && addr.toLowerCase() !== ZERO_ADDRESS;
}

// Every RentalEscrow/PropDepEscrow address recorded in this repository for
// Arc Testnet (chainId 5042002) — active, historicalIntermediate, and every
// legacy entry. Used ONLY to detect cross-network reuse — e.g. a keeper
// configured for arc-mainnet accidentally still pointed at one of Arc
// Testnet's contracts (current OR retired), which would pass a naive syntax
// check but scan/write against the wrong network's escrow. This is NOT a
// mainnet allowlist and does not claim any other address is a genuine Pi2pi
// Mainnet deployment — no mainnet deployment is required (or assumed) to
// exist for this check to run.
//
// keeper/ is an isolated Docker build context (see keeper/Dockerfile — it
// only copies enforcer.ts/network.ts/tsconfig.json/package.json, not the
// repo root) and has no runtime access to config/deployments.json, so this
// list is hand-maintained rather than derived at import/runtime. It MUST be
// kept in sync with config/deployments.json's "5042002" entry by hand: every
// RentalEscrow/PropDepEscrow address under "active", "historicalIntermediate",
// and each "legacy" entry belongs here too. Last synced against that file
// 2026-09-17 (TASK 9G — 5 deployment generations, 10 addresses total: active,
// historicalIntermediate, legacy[0] "2026-06-12 pair", legacy[1] "pre-audit
// pair", legacy[2] "undocumented deployment discovered via TASK 9F
// provenance investigation" — see config/deployments.json's comment for that
// entry for the full story, including a correction to legacy[1]'s earlier,
// factually incorrect "not used by any runtime code" claim).
const KNOWN_ARC_TESTNET_CONTRACTS: ReadonlySet<string> = new Set(
  [
    // active (switched 2026-09-06)
    "0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8", // RentalEscrow
    "0xe2190997F3811B771C25525C8401504a0e5330c5", // PropDepEscrow
    // historicalIntermediate (deployed 2026-06-13T03:03:26Z, superseded minutes later by "active")
    "0x11184188c24ce546912617156c0693868a98b2a3", // RentalEscrow
    "0xfe7b14a5313e93d8e22c7c4edc62431eca0f0880", // PropDepEscrow
    // legacy[0] — "2026-06-12 pair", active 2026-06-12 to 2026-09-06
    "0x6cbF4d958dA24b7AdC98Fb7633213Ac26b5a6f3a", // RentalEscrow
    "0x7428B32B61Ee0678c6e3706cB7d5aa4Ece818082", // PropDepEscrow
    // legacy[1] — pre-audit pair (confirmed genuinely used in production — 14 real agreements)
    "0xEaC111678149818168dd8499882A234e2019A802", // RentalEscrow
    "0x9d9047E307FeFc1494e80A81E25A67653F6E96f7", // PropDepEscrow
    // legacy[2] — undocumented deployment discovered TASK 9F (33 real agreements, earliest-known usage window)
    "0xC7791a029384D03B0CCD4fF03FB283575E7F0D8f", // RentalEscrow
    "0x0B6d95a9cD6d5F0C298703F2D7fa140d4C329CF5", // PropDepEscrow
  ].map((a) => a.toLowerCase()),
);

/**
 * Validates ESCROW_ADDRESS/PROPDEP_ADDRESS before any signer or Contract
 * object is constructed:
 *   1. both must be syntactically valid, non-zero Ethereum addresses;
 *   2. on any network other than arc-testnet, neither may be a known Arc
 *      Testnet contract address — this is the specific cross-network-reuse
 *      bug this function exists to close.
 * arc-testnet itself is validated only for well-formedness (rule 1) —
 * existing deployed keeper behavior is unchanged, since its own contracts
 * are naturally allowed to be... themselves.
 */
export function assertContractAddressesForNetwork(network: string, escrowAddress: string, propDepAddress: string): void {
  if (!isValidNonZeroAddress(escrowAddress)) {
    throw new ContractAddressError(`ESCROW_ADDRESS is not a valid non-zero Ethereum address: "${escrowAddress}"`);
  }
  if (!isValidNonZeroAddress(propDepAddress)) {
    throw new ContractAddressError(`PROPDEP_ADDRESS is not a valid non-zero Ethereum address: "${propDepAddress}"`);
  }

  if (network !== "arc-testnet") {
    if (KNOWN_ARC_TESTNET_CONTRACTS.has(escrowAddress.toLowerCase())) {
      throw new ContractAddressError(
        `ESCROW_ADDRESS "${escrowAddress}" is a known Arc Testnet contract — refusing to use it for NETWORK=${network}.`,
      );
    }
    if (KNOWN_ARC_TESTNET_CONTRACTS.has(propDepAddress.toLowerCase())) {
      throw new ContractAddressError(
        `PROPDEP_ADDRESS "${propDepAddress}" is a known Arc Testnet contract — refusing to use it for NETWORK=${network}.`,
      );
    }
  }
}

// ─── DRY_RUN parsing (fail-closed, no silent default in either direction) ──

export class DryRunConfigError extends Error {}

/**
 * DRY_RUN was previously parsed in enforcer.ts as
 * `process.env.DRY_RUN === "true"` — fail OPEN: unset, empty, misspelled, or
 * any value other than the exact string "true" silently resolved to false
 * (writes enabled). That is backwards for a keeper that signs and sends real
 * transactions, especially ahead of an Arc Mainnet keeper whose very first
 * config should be a safe DRY_RUN=true with no possibility of accidentally
 * defaulting to live writes (TASK 10A).
 *
 * No default in either direction: DRY_RUN must be exactly "true" or "false"
 * (case-sensitive, matching every other env var convention in this project)
 * or the keeper refuses to start at all — the same fail-closed pattern every
 * other required keeper env var already uses.
 */
export function parseDryRun(raw: string | undefined): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new DryRunConfigError(
    `DRY_RUN must be set to exactly "true" or "false" — got ${JSON.stringify(raw)}. No default is assumed in either direction; an explicit, valid value is always required before the keeper will start.`,
  );
}
