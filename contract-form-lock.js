// Contract form field locking logic — shared between server-arc.js and tests.
//
// Rule: once a counterparty has confirmed/acknowledged a section, that section
// is frozen for BOTH parties. Only "reset" can unlock all sections.
//
// Lock matrix (rows = ack flag, cols = what gets locked):
//   tenantAckTerms / landlordAckTerms  → field:"steps" value.terms, field:"deposit"
//   deposit.confirmed                  → field:"deposit"
//   tenantAckInventory                 → field:"steps" value.inventory
//   tenantAckPhotos                    → field:"photo", field:"removePhoto"
//   tenantAckOwnership / *AckId        → field:"document"
//   any signature                      → ALL protected fields

// ACK flags that cannot be set from true back to false/null/undefined
const ACK_FLAGS = new Set([
  "tenantAckTerms", "landlordAckTerms",
  "tenantAckTenantId", "landlordAckTenantId",
  "tenantAckLandlordId",
  "tenantAckOwnership",
  "tenantAckPhotos",
  "tenantAckInventory",
]);

/**
 * Check if a contract form mutation should be blocked.
 * @param {string} field - "steps"|"deposit"|"depositConfirm"|"photo"|"removePhoto"|"document"|"signature"|"reset"|"deployed"
 * @param {object|null} value - the value being written
 * @param {object} cf - current contract form state { steps, deposit, signatures, ... }
 * @returns {{ locked: boolean, reason?: string }}
 */
export function checkFieldLock(field, value, cf) {
  // Never-locked fields
  if (field === "reset" || field === "deployed" || field === "depositConfirm" || field === "signature") {
    return { locked: false };
  }

  const steps = cf.steps || {};
  const deposit = cf.deposit || {};
  const sigs = cf.signatures || {};
  const hasSig = Object.keys(sigs).length > 0;

  // ── Block clearing ack flags (true → false/null/undefined) ──
  if (field === "steps" && value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      if (ACK_FLAGS.has(k) && steps[k] === true && !value[k]) {
        return { locked: true, reason: "Cannot clear confirmation — use reset to renegotiate" };
      }
    }
  }

  // ── Signature locks everything except ack flags ──
  if (hasSig) {
    if (field === "deposit") return { locked: true, reason: "Contract signed — deposit locked" };
    if (field === "photo" || field === "removePhoto") return { locked: true, reason: "Contract signed — photos locked" };
    if (field === "document") return { locked: true, reason: "Contract signed — documents locked" };
    if (field === "steps" && value && typeof value === "object") {
      const keys = Object.keys(value);
      const onlyAckFlags = keys.every(k => ACK_FLAGS.has(k));
      if (!onlyAckFlags) return { locked: true, reason: "Contract signed — form locked" };
    }
    return { locked: false }; // pure ack flags still allowed with signature
  }

  // ── Deposit locking — only after deposit itself is confirmed, not after terms ack ──
  if (field === "deposit") {
    if (deposit.confirmed === true) return { locked: true, reason: "Deposit already confirmed" };
    return { locked: false };
  }

  // ── Photo / removePhoto locking ──
  if (field === "photo" || field === "removePhoto") {
    if (steps.tenantAckPhotos === true) return { locked: true, reason: "Photos already confirmed" };
    return { locked: false };
  }

  // ── Document locking — label-aware ──
  if (field === "document") {
    const label = value?.label || "";
    if (label === "ownership") {
      if (steps.tenantAckOwnership === true) return { locked: true, reason: "Ownership already confirmed" };
      return { locked: false };
    }
    if (label === "tenantId") {
      if (steps.landlordAckTenantId === true) return { locked: true, reason: "Tenant ID already confirmed" };
      return { locked: false };
    }
    if (label === "landlordId") {
      if (steps.tenantAckLandlordId === true) return { locked: true, reason: "Landlord ID already confirmed" };
      return { locked: false };
    }
    if (label.startsWith("inv-")) {
      if (steps.tenantAckInventory === true) return { locked: true, reason: "Inventory already confirmed" };
      return { locked: false };
    }
    // Unknown label — lock if any document ack exists (fail-safe)
    if (steps.tenantAckOwnership === true || steps.landlordAckTenantId === true || steps.tenantAckLandlordId === true) {
      return { locked: true, reason: "Document section already confirmed" };
    }
    return { locked: false };
  }

  // ── Steps field: value-aware ──
  if (field === "steps" && value && typeof value === "object") {
    const keys = Object.keys(value);

    // Check terms mutation
    if (keys.includes("terms")) {
      if (steps.tenantAckTerms === true || steps.landlordAckTerms === true) {
        return { locked: true, reason: "Terms already confirmed" };
      }
    }

    // Check inventory mutation
    if (keys.includes("inventory")) {
      if (steps.tenantAckInventory === true) {
        return { locked: true, reason: "Inventory already confirmed" };
      }
    }

    return { locked: false };
  }

  return { locked: false };
}
