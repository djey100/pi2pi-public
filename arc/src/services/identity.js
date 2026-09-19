// =============================================================================
// IDENTITY VERIFICATION — Coinbase Verifications + Circle biometric badge
// Layered identity: Circle Biometric (device) + Coinbase Verified (KYC) + World ID (uniqueness)
// Each badge is independent — users can have any combination
// =============================================================================

import { readUsdcBalance } from '../wallet.js';
import { getUser, verifyWorldId } from '../api/client.js';
import { t } from '../i18n/index.js';

// Coinbase Verifications via EAS (Ethereum Attestation Service) on Base mainnet
// Schema: VerifiedAccount issued by Coinbase to KYC'd users
// Free, just one GraphQL query to easscan indexer
const COINBASE_VERIFIED_ACCOUNT_SCHEMA = "0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9";
const COINBASE_ATTESTER = "0x357458739F90461b99789350868CD7CF330Dd7EE";

// In-memory cache: { addr: { verified, checkedAt } }
const __pi2piIdentityCache = new Map();
const IDENTITY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export const checkCoinbaseVerification = async (address) => {
  if (!address) return false;
  const addr = address.toLowerCase();
  const cached = __pi2piIdentityCache.get("cb_" + addr);
  if (cached && Date.now() - cached.checkedAt < IDENTITY_CACHE_TTL) {
    return cached.verified;
  }
  try {
    const query = {
      query: "query A($s: String!, $r: String!, $a: String!) { attestations(where: { schemaId: { equals: $s }, recipient: { equals: $r }, attester: { equals: $a }, revoked: { equals: false } }) { id revocationTime expirationTime } }",
      variables: {
        s: COINBASE_VERIFIED_ACCOUNT_SCHEMA,
        r: addr,
        a: COINBASE_ATTESTER,
      },
    };
    const r = await fetch("https://base.easscan.org/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
    const data = await r.json();
    const atts = data?.data?.attestations || [];
    // Filter out expired
    const now = Math.floor(Date.now() / 1000);
    const valid = atts.some(a => a.expirationTime === 0 || a.expirationTime > now);
    __pi2piIdentityCache.set("cb_" + addr, { verified: valid, checkedAt: Date.now() });
    return valid;
  } catch (e) {
    console.warn("[identity/coinbase] check failed:", e.message);
    return false;
  }
};

// Circle Biometric Badge — true if user is connected via Circle passkey wallet
// This is not formal KYC but proves: real device with biometric (FaceID/TouchID)
export const isCircleBiometric = () => {
  return !!(window.pi2piWallet && window.pi2piWallet.type === "circle");
};

// Binance BAB (Binance Account Bound) — soulbound token on BNB Chain, issued to wallets
// that passed Binance KYC. Non-transferable. We check balanceOf(address) on the BABT contract;
// >0 means the wallet is bound to a KYC'd Binance account.
// Contract (BSC mainnet): 0x2B09d47D550061f995A3b5C6F0Fd58005215D7c8
const BABT_CONTRACT = "0x2B09d47D550061f995A3b5C6F0Fd58005215D7c8";
const BSC_RPC = "https://bsc-dataseed.binance.org";
export const checkBinanceBAB = async (address) => {
  if (!address) return false;
  const addr = address.toLowerCase();
  const cached = __pi2piIdentityCache.get("bab_" + addr);
  if (cached && Date.now() - cached.checkedAt < IDENTITY_CACHE_TTL) {
    return cached.verified;
  }
  try {
    const padded = addr.replace("0x", "").padStart(64, "0");
    const data = "0x70a08231" + padded; // balanceOf(address)
    const r = await fetch(BSC_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: BABT_CONTRACT, data }, "latest"] }),
    });
    const j = await r.json();
    // Response is a 32-byte hex uint256 — any non-zero means the wallet holds BAB
    const bal = j?.result ? BigInt(j.result) : 0n;
    const verified = bal > 0n;
    __pi2piIdentityCache.set("bab_" + addr, { verified, checkedAt: Date.now() });
    return verified;
  } catch (e) {
    console.warn("[identity/bab] check failed:", e.message);
    return false;
  }
};

// World ID — uses jsDelivr-bundled IIFE that registers window.IDKit
// (esm.sh doesn't bundle this package correctly; jsDelivr's pre-bundled IIFE works)
export const WORLDCOIN_APP_ID = "app_f91b29c468c68d04fce31a8722fd8114";
export const WORLDCOIN_ACTION = "pi2pi-personhood";

export const _loadIDKitGlobal = async () => {
  if (window.IDKit && typeof window.IDKit.init === "function") return window.IDKit;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@worldcoin/idkit-standalone@2.2.0/build/index.global.js";
    script.onload = () => {
      if (window.IDKit && typeof window.IDKit.init === "function") {
        console.log("[idkit] global loaded:", Object.keys(window.IDKit));
        resolve(window.IDKit);
      } else {
        reject(new Error("IDKit global not registered after script load"));
      }
    };
    script.onerror = (e) => reject(new Error("IDKit script failed to load: " + (e?.message || "unknown")));
    document.head.appendChild(script);
    setTimeout(() => { if (!window.IDKit) reject(new Error("IDKit load timeout")); }, 30000);
  });
};

// Submit World ID proof to backend for validation
export const submitWorldIDProof = async (myAddr, proof) => {
  try {
    const r = await verifyWorldId({
        addr: myAddr,
        proof: proof.proof,
        merkle_root: proof.merkle_root,
        nullifier_hash: proof.nullifier_hash,
        verification_level: proof.verification_level,
      });
    const j = await r.json();
    if (!r.ok) {
      alert(t("err.verification_failed", {error: (j.message || j.error || t("err.error"))}));
      return false;
    }
    alert(t("alert.world_id_verified"));
    return true;
  } catch (e) {
    alert(t("err.network_error", {error: e.message}));
    return false;
  }
};

// Check if user has World ID verification (from server)
export const checkWorldIDVerification = async (address) => {
  if (!address) return false;
  try {
    const data = await getUser(address);
    return !!data?.verifications?.worldid?.verified;
  } catch { return false; }
};

// Get all identity badges for an address (returns array of badge objects)
// Used in profile, listings, contract details
export const getIdentityBadges = async (address, isCurrentUser = false) => {
  const badges = [];
  if (isCurrentUser && isCircleBiometric()) {
    badges.push({ id: "circle_biometric", label: "Biometric Wallet", icon: "", color: "#6366f1", desc: "Circle passkey wallet — real device with biometric authentication" });
  }
  const [cbVerified, wIdVerified, babVerified] = await Promise.all([
    checkCoinbaseVerification(address),
    checkWorldIDVerification(address),
    checkBinanceBAB(address),
  ]);
  if (cbVerified) {
    badges.push({ id: "coinbase_verified", label: "Coinbase Verified", icon: "", color: "var(--color-info)", desc: "Verified Coinbase account — KYC completed" });
  }
  if (wIdVerified) {
    badges.push({ id: "worldid_verified", label: "World ID", icon: "", color: "#000000", desc: "Verified human via World ID — proof of personhood" });
  }
  if (babVerified) {
    badges.push({ id: "binance_bab", label: "Binance Verified", icon: "", color: "#F3BA2F", desc: "Wallet holds Binance Account Bound token — KYC via Binance" });
  }
  return badges;
};

// =============================================================================
// PROGRESSIVE VERIFICATION GATES
// pi2pi has 3 independent proofs:
//   - Proof of Humanity = ANY of {World ID, Coinbase Verified, Circle Biometric}
//   - Proof of Funds    = USDC balance >= 1× MR
//   - Proof of Intent   = wallet signature on contract (final action)
//
// Access rules:
//   ENTER PROTOCOL (browse, see things) — requires at least 1 of {Humanity, Funds}
//   PUBLISH LISTING                      — requires Proof of Funds specifically
//   SIGN CONTRACT (Proof of Intent)      — requires BOTH Humanity AND Funds
//
// Principle: progressive onboarding — don't cut user off completely if they
// have at least one proof. Let them inside, let them do something.
// =============================================================================

const MIN_BALANCE_FOR_FUNDS_PROOF = 1; // 1 USDC minimum for testnet

// Compute verification state for an address
// Returns { hasHumanity, hasFunds, canEnter, canPublishListing, canSignContract, badges, balance }
export const getVerificationState = async (address, isCurrentUser = false) => {
  if (!address) return { hasHumanity: false, hasFunds: false, canEnter: false, canPublishListing: false, canSignContract: false, badges: [], balance: 0 };
  const [badges, balance] = await Promise.all([
    getIdentityBadges(address, isCurrentUser),
    readUsdcBalance(address),
  ]);
  const hasHumanity = badges.length > 0;
  const hasFunds = balance >= MIN_BALANCE_FOR_FUNDS_PROOF;
  return {
    hasHumanity,
    hasFunds,
    badges,
    balance,
    // Access gates
    canEnter: hasHumanity || hasFunds,        // 1+ proof to be inside
    canPublishListing: hasFunds,              // Funds specifically (listing requires money)
    canSignContract: hasHumanity && hasFunds, // Both for Proof of Intent
  };
};

// Permission helpers — soft-block (return true unless ENFORCE_VERIFICATION_GATES is on)
// When ENFORCE_VERIFICATION_GATES = true, these become hard blocks
export const ENFORCE_VERIFICATION_GATES = false; // Set to true to enable hard gating

export const canEnterProtocol = (state) => {
  if (!ENFORCE_VERIFICATION_GATES) return true;
  return state?.canEnter || false;
};
export const canPublishListing = (state) => {
  if (!ENFORCE_VERIFICATION_GATES) return true;
  return state?.canPublishListing || false;
};
export const canSignContract = (state) => {
  if (!ENFORCE_VERIFICATION_GATES) return true;
  return state?.canSignContract || false;
};
