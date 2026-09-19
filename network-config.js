// pi2pi backend/admin — network identity (fail-closed)
//
// Explicit network name → expected chainId mapping shared by server-arc.js
// (and usable by any other root-level backend script). No implicit fallback:
// an unrecognized network name is always a fatal configuration error, never
// silently treated as testnet or mainnet.
//
// Kept as its own file so it can be unit tested without booting server-arc.js
// (which requires Supabase credentials at import time).

export const EXPECTED_CHAIN_IDS = Object.freeze({
  "arc-testnet": 5042002,
  "arc-mainnet": 5042,
});

export class NetworkConfigError extends Error {}
export class NetworkMismatchError extends Error {}

export function resolveExpectedChainId(network) {
  const chainId = EXPECTED_CHAIN_IDS[network];
  if (chainId === undefined) {
    throw new NetworkConfigError(
      `Unsupported NETWORK "${network}". Supported: ${Object.keys(EXPECTED_CHAIN_IDS).join(", ")}`
    );
  }
  return chainId;
}

/**
 * Fail-closed guard for any code path scoping a shared-table read/write by
 * network (TASK 10I) — throws if `network` isn't a recognized value. NETWORK
 * is already validated once at server-arc.js startup via
 * resolveExpectedChainId(), so this can never actually throw in a running
 * server, but every cross-cutting scoping helper that reuses this value
 * (marketplace read routes, admin_routes.js's injected network) re-asserts
 * it explicitly rather than silently trusting the caller's plumbing.
 */
export function assertSupportedNetwork(network) {
  if (network !== "arc-testnet" && network !== "arc-mainnet") {
    throw new NetworkConfigError(`assertSupportedNetwork: unsupported/missing network: ${JSON.stringify(network)}`);
  }
}

/** Throws NetworkMismatchError if the RPC's actual chainId doesn't match what NETWORK expects. */
export function assertChainMatch(network, expectedChainId, actualChainId) {
  if (actualChainId !== expectedChainId) {
    throw new NetworkMismatchError(
      `NETWORK MISMATCH — NETWORK=${network} expects chainId=${expectedChainId}, but RPC reports chainId=${actualChainId}.`
    );
  }
}

/** Fetches the actual chainId from a JSON-RPC endpoint via eth_chainId. fetchImpl is injectable for tests. */
export async function fetchChainId(rpcUrl, fetchImpl = fetch) {
  const r = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", id: 1, params: [] }),
  });
  const j = await r.json();
  return parseInt(j.result, 16);
}

// ─── Contract address resolution (fail-closed, network-aware) ─────────────

export class ContractAddressError extends Error {}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isValidNonZeroAddress(addr) {
  return typeof addr === "string" && ADDRESS_RE.test(addr) && addr.toLowerCase() !== ZERO_ADDRESS;
}

/**
 * Resolves RentalEscrow/PropDepEscrow/USDC addresses for the configured
 * network. Fail-closed, network-aware — never lets one network's addresses
 * become another network's default:
 *
 *   - If `deployments` has a verified entry under this network's expected
 *     chainId (currently only true for arc-testnet, chainId 5042002, via
 *     config/deployments.json — RentalEscrow/PropDepEscrow under `.active`,
 *     USDC at the top level of that entry), env vars may override any of
 *     them but are not required — this preserves existing Arc Testnet
 *     behavior.
 *   - Any network with NO verified manifest entry (currently arc-mainnet,
 *     and anything else) requires ALL THREE env vars to be explicitly set.
 *     There is no fallback of any kind for such networks — including USDC,
 *     which must never silently reuse Arc Testnet's address.
 *   - All three resolved addresses are validated as well-formed, non-zero
 *     Ethereum addresses before being returned.
 *
 * Throws ContractAddressError (never silently substitutes a value) if
 * anything required is missing or invalid.
 */
export function resolveContractAddresses(network, { rentalEscrowEnv, propDepEscrowEnv, usdcEnv, deployments, expectedChainId }) {
  const manifestKey = String(expectedChainId);
  const manifestEntry = deployments?.[manifestKey] || null;
  const verifiedDeployment = manifestEntry?.active || null;

  const rentalEscrow = rentalEscrowEnv || verifiedDeployment?.RentalEscrow?.address;
  const propDepEscrow = propDepEscrowEnv || verifiedDeployment?.PropDepEscrow?.address;
  const usdc = usdcEnv || manifestEntry?.usdc;

  const missing = [];
  if (!rentalEscrow) missing.push("RENTAL_ESCROW_ADDRESS");
  if (!propDepEscrow) missing.push("PROPDEP_ESCROW_ADDRESS");
  if (!usdc) missing.push("USDC_ADDRESS");
  if (missing.length) {
    throw new ContractAddressError(
      `Missing required contract address env var(s) for NETWORK=${network}: ${missing.join(", ")}. ` +
      (manifestEntry
        ? "No value was provided and no fallback could fill it in."
        : `No verified deployment manifest exists for this network (config/deployments.json has no "${manifestKey}" entry) — these must be set explicitly.`)
    );
  }

  if (!isValidNonZeroAddress(rentalEscrow)) {
    throw new ContractAddressError(`RENTAL_ESCROW_ADDRESS is not a valid non-zero Ethereum address: "${rentalEscrow}"`);
  }
  if (!isValidNonZeroAddress(propDepEscrow)) {
    throw new ContractAddressError(`PROPDEP_ESCROW_ADDRESS is not a valid non-zero Ethereum address: "${propDepEscrow}"`);
  }
  if (!isValidNonZeroAddress(usdc)) {
    throw new ContractAddressError(`USDC_ADDRESS is not a valid non-zero Ethereum address: "${usdc}"`);
  }

  return { rentalEscrow, propDepEscrow, usdc };
}

/**
 * Resolves the set of RentalEscrow addresses that ARCHIVE/HISTORY reads
 * (closed, immutable records) should accept for the given network —
 * distinct from resolveContractAddresses(), which resolves the single
 * CURRENT deployment that active_contracts and new writes must use.
 *
 * Archive reads and active-contract reads have different correctness
 * requirements: an active contract only makes sense against the currently
 * live escrow (you can't act on a decommissioned contract), but a closed
 * historical record is still legitimately part of a user's history no
 * matter which now-superseded deployment it was created under. Arc
 * Testnet alone has had multiple RentalEscrow generations over time on the
 * SAME chainId (5042002) — config/deployments.json's "active",
 * "historicalIntermediate", and "legacy" entries for that chain — so a
 * chain_id + single-escrow_address filter would silently hide legitimate
 * history whenever the active deployment is redeployed.
 *
 * Per-network, not global: this reads ONLY the manifest entry for the
 * given network's own expected chainId — it can never pull in another
 * chain's addresses. Arc Mainnet currently has only its one "active" entry
 * (no historicalIntermediate/legacy yet recorded), so its allowlist is
 * exactly one address today; it naturally grows if/when Arc Mainnet is
 * ever redeployed and the manifest records that history too.
 *
 * `currentEscrowAddress` (the value resolveContractAddresses() actually
 * resolved, which may come from an env override rather than the manifest)
 * is always included, so newly-written archives are guaranteed to remain
 * visible even if an operator's env override hasn't been recorded in the
 * manifest yet.
 */
// ─── Proof-of-Funds background job scoping (TASK 10F) ──────────────────────
// checkListingsTablePoF/checkTenantIntentPoF (server-arc.js) read on-chain
// balances and suspend/block marketplace rows accordingly. TASK 10D showed
// what happens when that scan isn't network-scoped: the newly-started Arc
// Mainnet runtime read Arc Testnet `listings`/`users` rows (a DB shared
// across both network's web apps) and checked their balances over the
// Mainnet RPC, incorrectly suspending/blocking real Testnet users. These two
// functions are the single, pure, directly-testable source of truth for
// "does this row belong to this runtime" — server-arc.js wires them into its
// Supabase query builder but must never re-implement the decision itself.

/**
 * Decides whether a marketplace row (a listing, or a tenant intent) tagged
 * with `rowNetwork` may be read/mutated by a PoF job running under
 * `currentNetwork`.
 *
 * Mainnet is always strict: only rows explicitly tagged "arc-mainnet" are
 * in scope. A missing/null tag, or an explicit "arc-testnet" tag, is NEVER
 * in scope for Mainnet — this is the exact guard TASK 10D was missing.
 *
 * Testnet is transitional: it also accepts untagged legacy rows (every row
 * that existed before this fix has no `network` column/field at all, and —
 * verified during the TASK 10D/10E incident review — every one of them was
 * created by the Testnet app, the only network with real traffic to date).
 * Once a row is opportunistically or explicitly tagged, Testnet still only
 * accepts its own tag, never an explicit Mainnet one.
 *
 * Fails closed (throws) if currentNetwork isn't a recognized network —
 * mirrors resolveExpectedChainId()'s behavior so a PoF job can never run
 * against an unresolved/misconfigured network by silently doing nothing (or
 * worse, doing something) instead of refusing to start.
 */
export function isPofRowInScope(rowNetwork, currentNetwork) {
  if (currentNetwork !== "arc-testnet" && currentNetwork !== "arc-mainnet") {
    throw new NetworkConfigError(
      `isPofRowInScope: unsupported/missing currentNetwork: ${JSON.stringify(currentNetwork)}`
    );
  }
  if (currentNetwork === "arc-mainnet") {
    return rowNetwork === "arc-mainnet";
  }
  return rowNetwork === "arc-testnet" || rowNetwork === null || rowNetwork === undefined || rowNetwork === "";
}

/**
 * Builds the PostgREST filter clause matching isPofRowInScope()'s decision,
 * for server-arc.js to apply to both the SELECT that picks PoF candidates
 * and, as a defense-in-depth guard, every UPDATE that acts on one — so even
 * a future call site that forgets to pre-filter its SELECT still cannot
 * write outside its own network's rows.
 *
 * `column` is the PostgREST column reference to filter on — a plain column
 * name for `listings.network`, or a JSON-path expression such as
 * `"data->intent->>network"` for a field nested inside `users.data`.
 *
 * Returns a plain description rather than a Supabase query object so this
 * function has no Supabase dependency and can be unit tested in isolation;
 * the caller applies it with `.eq()` or `.or()` as appropriate.
 */
export function pofNetworkFilterClause(column, currentNetwork) {
  if (currentNetwork !== "arc-testnet" && currentNetwork !== "arc-mainnet") {
    throw new NetworkConfigError(
      `pofNetworkFilterClause: unsupported/missing currentNetwork: ${JSON.stringify(currentNetwork)}`
    );
  }
  if (currentNetwork === "arc-mainnet") {
    return { mode: "eq", column, value: currentNetwork };
  }
  return { mode: "or", filter: `${column}.eq.${currentNetwork},${column}.is.null` };
}

export function resolveArchiveEscrowAllowlist(network, { deployments, expectedChainId, currentEscrowAddress }) {
  const manifestKey = String(expectedChainId);
  const manifestEntry = deployments?.[manifestKey] || null;

  const addrs = new Set();
  const add = (a) => { if (a) addrs.add(a.toLowerCase()); };

  add(currentEscrowAddress);
  if (manifestEntry) {
    add(manifestEntry.active?.RentalEscrow?.address);
    add(manifestEntry.historicalIntermediate?.RentalEscrow?.address);
    for (const legacyEntry of manifestEntry.legacy || []) {
      add(legacyEntry.RentalEscrow?.address);
    }
  }

  if (addrs.size === 0) {
    throw new ContractAddressError(
      `No RentalEscrow addresses available for NETWORK=${network} (chainId ${expectedChainId}) — cannot build an archive-read allowlist.`
    );
  }

  return [...addrs];
}
