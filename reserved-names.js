// =============================================================================
// RESERVED NAMES — prevents impersonation of team, admin, support
// Blocks any display name that contains reserved words in any position.
// Case-insensitive, matches substrings (e.g. "xAdmin99" is blocked).
// Leet speak normalized (4dm1n → admin).
// Only Latin names allowed by regex, so no need for non-Latin variants.
// =============================================================================

const RESERVED_WORDS = [
  // Team / official roles
  "admin", "administrator", "moderator", "support", "helpdesk",
  "staff", "official", "verified", "operator", "manager",
  "customercare", "customerservice", "customersupport",
  "concierge", "assistant",

  // Brand
  "pi2pi",

  // System / technical
  "system", "autobot", "robot", "chatbot",
  "server", "daemon", "service",
  "root", "superuser", "sudo",

  // Security / verification
  "security", "verification", "verify", "verifier", "validator",
  "kyc", "aml", "authority", "authorized", "recovery",

  // Trust signals / legal
  "escrow", "arbiter", "arbitrator", "judge",
  "mediator", "resolver", "disputes",
  "compliance", "legal", "lawyer", "attorney", "notary",
  "auditor", "inspector", "regulator", "ombudsman",

  // Finance
  "treasury", "vault", "walletofficial",
  "payment", "payments", "refund", "cashback", "finance",
  "billing", "invoice", "transaction", "withdrawal", "payout",

  // Rental-specific
  "landlord", "lessor", "lessee", "realtor", "realty", "broker",
  "lease", "leasing", "deposit", "booking", "reservation",
  "listing", "listings", "property", "properties",

  // Crypto / platform
  "circle", "usdc", "aave", "oracle",
  "faucet", "airdrop", "giveaway", "rewardsofficial",

  // Communications
  "notification", "announcement", "noreply", "mailer",

  // Impersonation — founders + titles
  "founder", "ceo", "cto", "cfo", "coo",
  "dmitrii", "dmitry", "dimitri", "ulybin", "ulibin",
  "danil", "konovalov",
  "anthropic",
];

// Normalize: lowercase, collapse spaces/dots/hyphens/underscores, leet speak
function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[\s._\-]+/g, "")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a");
}

/**
 * Check if a display name is reserved / blocked.
 * @param {string} name
 * @returns {{ blocked: boolean, reason: string|null }}
 */
export function checkDisplayName(name) {
  if (!name || typeof name !== "string") return { blocked: false, reason: null };
  const norm = normalize(name);
  for (const word of RESERVED_WORDS) {
    const normWord = normalize(word);
    if (norm.includes(normWord)) {
      return { blocked: true, reason: "reserved_name" };
    }
  }
  return { blocked: false, reason: null };
}
