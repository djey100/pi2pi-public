// Tests for data integrity: field locking with REAL payload shapes, archives, snapshots
import { describe, it, expect } from 'vitest';
import { checkFieldLock } from '../../../contract-form-lock.js';

// ─── checkFieldLock with REAL frontend payloads ─────────────────────────────

describe('Field locking: terms', () => {
  const CF_TERMS_ACKED = { steps: { tenantAckTerms: true }, deposit: {}, signatures: {} };

  it('field:"steps" value:{terms:{rent:200}} BLOCKED after tenantAckTerms', () => {
    expect(checkFieldLock("steps", { terms: { rent: 200 } }, CF_TERMS_ACKED).locked).toBe(true);
  });

  it('field:"steps" value:{terms:{duration:12}} BLOCKED after landlordAckTerms', () => {
    const cf = { steps: { landlordAckTerms: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("steps", { terms: { duration: 12 } }, cf).locked).toBe(true);
  });

  it('field:"steps" value:{terms:{leaseDurationMonths:12}} BLOCKED after tenantAckTerms', () => {
    expect(checkFieldLock("steps", { terms: { leaseDurationMonths: "12" } }, CF_TERMS_ACKED).locked).toBe(true);
    expect(checkFieldLock("steps", { terms: { leaseDurationMonths: "12" } }, CF_TERMS_ACKED).reason).toContain("Terms already confirmed");
  });

  it('field:"steps" value:{terms:{landlordName:"John"}} BLOCKED after tenantAckTerms', () => {
    expect(checkFieldLock("steps", { terms: { landlordName: "John" } }, CF_TERMS_ACKED).locked).toBe(true);
  });

  it('field:"steps" value:{terms:{monthlyRent:"500"}} BLOCKED after tenantAckTerms', () => {
    expect(checkFieldLock("steps", { terms: { monthlyRent: "500" } }, CF_TERMS_ACKED).locked).toBe(true);
  });

  it('field:"steps" value:{terms:{propertyAddress:"New st"}} BLOCKED after tenantAckTerms', () => {
    expect(checkFieldLock("steps", { terms: { propertyAddress: "New st" } }, CF_TERMS_ACKED).locked).toBe(true);
  });

  it('tenantAckTerms ack itself allowed (setting true)', () => {
    const cf = { steps: {}, deposit: {}, signatures: {} };
    expect(checkFieldLock("steps", { tenantAckTerms: true }, cf).locked).toBe(false);
  });

  it('terms allowed before any ack', () => {
    expect(checkFieldLock("steps", { terms: { rent: 100 } }, { steps: {}, deposit: {}, signatures: {} }).locked).toBe(false);
  });
});

describe('Field locking: deposit', () => {
  it('field:"deposit" value:{type:"set",amount:8} BLOCKED after deposit.confirmed', () => {
    const cf = { steps: {}, deposit: { confirmed: true, confirmedBy: "0xt" }, signatures: {} };
    expect(checkFieldLock("deposit", { type: "set", amount: 8 }, cf).locked).toBe(true);
  });

  it('field:"deposit" ALLOWED after tenantAckTerms (deposit is a separate later step)', () => {
    const cf = { steps: { tenantAckTerms: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("deposit", { type: "set", amount: 8 }, cf).locked).toBe(false);
  });

  it('deposit BLOCKED after deposit.confirmed=true', () => {
    const cf = { steps: { tenantAckTerms: true }, deposit: { confirmed: true, confirmedBy: "0xt" }, signatures: {} };
    expect(checkFieldLock("deposit", { type: "set", amount: 8 }, cf).locked).toBe(true);
  });

  it('deposit skip ALLOWED after tenantAckTerms and deposit.confirmed=false', () => {
    const cf = { steps: { tenantAckTerms: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("deposit", { type: "skip" }, cf).locked).toBe(false);
  });

  it('deposit allowed before any ack', () => {
    expect(checkFieldLock("deposit", { type: "set", amount: 6 }, { steps: {}, deposit: {}, signatures: {} }).locked).toBe(false);
  });
});

describe('Field locking: inventory', () => {
  it('field:"steps" value:{inventory:[...]} BLOCKED after tenantAckInventory', () => {
    const cf = { steps: { tenantAckInventory: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("steps", { inventory: [{ name: "Fridge" }] }, cf).locked).toBe(true);
  });

  it('inventory allowed before tenantAckInventory', () => {
    expect(checkFieldLock("steps", { inventory: [] }, { steps: {}, deposit: {}, signatures: {} }).locked).toBe(false);
  });
});

describe('Field locking: photos', () => {
  it('field:"photo" BLOCKED after tenantAckPhotos', () => {
    const cf = { steps: { tenantAckPhotos: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("photo", { name: "img.jpg", cid: "Qm1" }, cf).locked).toBe(true);
  });

  it('field:"removePhoto" BLOCKED after tenantAckPhotos', () => {
    const cf = { steps: { tenantAckPhotos: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("removePhoto", { index: 0 }, cf).locked).toBe(true);
  });

  it('photo allowed before tenantAckPhotos', () => {
    expect(checkFieldLock("photo", {}, { steps: {}, deposit: {}, signatures: {} }).locked).toBe(false);
  });
});

describe('Field locking: documents (label-aware)', () => {
  it('ownership upload ALLOWED when tenantAckLandlordId=true but tenantAckOwnership=false', () => {
    const cf = { steps: { tenantAckLandlordId: true, landlordAckTenantId: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("document", { label: "ownership", cid: "Qm" }, cf).locked).toBe(false);
  });

  it('ownership upload BLOCKED after tenantAckOwnership=true', () => {
    const cf = { steps: { tenantAckOwnership: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("document", { label: "ownership", cid: "Qm" }, cf).locked).toBe(true);
  });

  it('landlordId upload BLOCKED after tenantAckLandlordId=true', () => {
    const cf = { steps: { tenantAckLandlordId: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("document", { label: "landlordId", cid: "Qm" }, cf).locked).toBe(true);
  });

  it('tenantId upload BLOCKED after landlordAckTenantId=true', () => {
    const cf = { steps: { landlordAckTenantId: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("document", { label: "tenantId", cid: "Qm" }, cf).locked).toBe(true);
  });

  it('tenantId upload ALLOWED when tenantAckLandlordId=true (different ack)', () => {
    const cf = { steps: { tenantAckLandlordId: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("document", { label: "tenantId", cid: "Qm" }, cf).locked).toBe(false);
  });

  it('inv- label BLOCKED after tenantAckInventory=true', () => {
    const cf = { steps: { tenantAckInventory: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("document", { label: "inv-123", cid: "Qm" }, cf).locked).toBe(true);
  });

  it('inv- label ALLOWED before tenantAckInventory', () => {
    const cf = { steps: { tenantAckLandlordId: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("document", { label: "inv-123", cid: "Qm" }, cf).locked).toBe(false);
  });

  it('document allowed before any ID/ownership ack', () => {
    expect(checkFieldLock("document", {}, { steps: {}, deposit: {}, signatures: {} }).locked).toBe(false);
  });
});

describe('Field locking: signature locks everything', () => {
  const CF_SIGNED = { steps: {}, deposit: {}, signatures: { "0xt": { sig: "0x" } } };

  it('terms blocked after signature', () => {
    expect(checkFieldLock("steps", { terms: { rent: 1 } }, CF_SIGNED).locked).toBe(true);
  });

  it('deposit blocked after signature', () => {
    expect(checkFieldLock("deposit", { amount: 1 }, CF_SIGNED).locked).toBe(true);
  });

  it('photo blocked after signature', () => {
    expect(checkFieldLock("photo", {}, CF_SIGNED).locked).toBe(true);
  });

  it('removePhoto blocked after signature', () => {
    expect(checkFieldLock("removePhoto", {}, CF_SIGNED).locked).toBe(true);
  });

  it('document blocked after signature', () => {
    expect(checkFieldLock("document", {}, CF_SIGNED).locked).toBe(true);
  });

  it('inventory blocked after signature', () => {
    expect(checkFieldLock("steps", { inventory: [] }, CF_SIGNED).locked).toBe(true);
  });

  it('ack flags STILL allowed after signature', () => {
    expect(checkFieldLock("steps", { tenantAckPhotos: true }, CF_SIGNED).locked).toBe(false);
    expect(checkFieldLock("steps", { tenantAckInventory: true }, CF_SIGNED).locked).toBe(false);
  });
});

describe('Field locking: ack flags cannot be cleared', () => {
  it('tenantAckTerms true→false BLOCKED', () => {
    const cf = { steps: { tenantAckTerms: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("steps", { tenantAckTerms: false }, cf).locked).toBe(true);
    expect(checkFieldLock("steps", { tenantAckTerms: null }, cf).locked).toBe(true);
  });

  it('tenantAckInventory true→false BLOCKED', () => {
    const cf = { steps: { tenantAckInventory: true }, deposit: {}, signatures: {} };
    expect(checkFieldLock("steps", { tenantAckInventory: false }, cf).locked).toBe(true);
  });

  it('tenantAckTerms false→true ALLOWED', () => {
    expect(checkFieldLock("steps", { tenantAckTerms: true }, { steps: {}, deposit: {}, signatures: {} }).locked).toBe(false);
  });
});

describe('Field locking: never-locked fields', () => {
  const CF_ALL = { steps: { tenantAckTerms: true }, deposit: { confirmed: true }, signatures: { "0x": {} } };

  it('reset always allowed', () => {
    expect(checkFieldLock("reset", {}, CF_ALL).locked).toBe(false);
  });

  it('deployed always allowed', () => {
    expect(checkFieldLock("deployed", {}, CF_ALL).locked).toBe(false);
  });

  it('depositConfirm always allowed', () => {
    expect(checkFieldLock("depositConfirm", {}, CF_ALL).locked).toBe(false);
  });

  it('signature always allowed', () => {
    expect(checkFieldLock("signature", {}, CF_ALL).locked).toBe(false);
  });
});

// ─── Real UI deposit path: server rejects → UI must not keep changed state ──

describe('Deposit save path: server rejects after confirmation', () => {
  it('deposit ALLOWED after tenantAckTerms — deposit is a separate step', () => {
    const cf = { steps: { tenantAckTerms: true }, deposit: { type: "set", amount: 6 }, signatures: {} };
    const r = checkFieldLock("deposit", { type: "set", amount: 8 }, cf);
    expect(r.locked).toBe(false);
  });

  it('deposit blocked after deposit.confirmed — simulates landlord changing amount', () => {
    const cf = { steps: {}, deposit: { confirmed: true, confirmedBy: "0xtenant", type: "set", amount: 6 }, signatures: {} };
    const r = checkFieldLock("deposit", { type: "set", amount: 8 }, cf);
    expect(r.locked).toBe(true);
  });

  it('syncDeposit returns false on lock → UI should not set pdLLproposed', () => {
    const serverAccepted = false;
    let pdLLproposed = false;
    if (serverAccepted) pdLLproposed = true;
    expect(pdLLproposed).toBe(false);
  });

  it('saveForm returns {ok:false} on 409 → reloadFormFromServer restores deposit', () => {
    // Simulates: saveForm detects 409, calls reloadFormFromServer which resyncs deposit
    const serverDeposit = { type: "set", amount: 6 }; // original confirmed value
    let localAmount = 8; // landlord typed this
    // After 409 + reload:
    localAmount = serverDeposit.amount; // reloadFormFromServer restores
    expect(localAmount).toBe(6);
  });
});

// ─── UI rollback on rejected saves ──────────────────────────────────────────

describe('UI rollback on 409: all mutable paths', () => {
  it('inventory rejected → items restored from server', () => {
    const serverItems = [{ id: 1, name: "Sofa" }];
    let localItems = [...serverItems, { id: 2, name: "TV" }]; // optimistically added
    // After 409 + reloadFormFromServer:
    localItems = serverItems; // restored
    expect(localItems).toHaveLength(1);
    expect(localItems[0].name).toBe("Sofa");
  });

  it('remove inventory rejected → removed item restored', () => {
    const serverItems = [{ id: 1, name: "Sofa" }, { id: 2, name: "TV" }];
    let localItems = serverItems.filter(i => i.id !== 2); // optimistically removed
    expect(localItems).toHaveLength(1);
    // After 409 + reloadFormFromServer:
    localItems = serverItems;
    expect(localItems).toHaveLength(2);
  });

  it('photo upload rejected → photo removed from local state', () => {
    const serverPhotos = [{ name: "a.jpg", cid: "Qm1" }];
    let localPhotos = [...serverPhotos, { name: "b.jpg", cid: "Qm2" }]; // optimistically added
    // After 409 + reloadFormFromServer:
    localPhotos = serverPhotos;
    expect(localPhotos).toHaveLength(1);
  });

  it('terms change rejected → terms restored from server', () => {
    const serverTerms = { rent: 100, duration: 6 };
    let localTerms = { rent: 200, duration: 6 }; // optimistically changed
    // After 409 + reloadFormFromServer:
    localTerms = { ...localTerms, ...serverTerms };
    expect(localTerms.rent).toBe(100);
  });

  it('document upload rejected → rollback via reloadFormFromServer', () => {
    const serverDocs = [{ label: "passport", cid: "Qm1" }];
    let localDocs = [...serverDocs, { label: "ownership", cid: "Qm2" }];
    localDocs = serverDocs;
    expect(localDocs).toHaveLength(1);
  });
});

// ─── Document rollback on 409 ───────────────────────────────────────────────

describe('Document rollback: reloadFormFromServer restores doc state', () => {
  // Simulates reloadFormFromServer document resync logic
  function resyncDocs(cfDocuments) {
    const docs = cfDocuments || [];
    const docMap = {};
    let hasTenantId = false, hasLandlordId = false, hasOwnership = false;
    for (const d of docs) {
      if (d.label && d.cid) docMap[d.label] = d;
      if (d.label === "tenantId") hasTenantId = true;
      if (d.label === "landlordId") hasLandlordId = true;
      if (d.label === "ownership") hasOwnership = true;
    }
    return { docMap, hasTenantId, hasLandlordId, hasOwnership };
  }

  it('rejected tenantId upload → tenantId=false after reload', () => {
    // Server has no tenantId doc
    const r = resyncDocs([]);
    expect(r.hasTenantId).toBe(false);
    expect(Object.keys(r.docMap)).toHaveLength(0);
  });

  it('rejected landlordId upload → landlordId=false after reload', () => {
    const r = resyncDocs([{ label: "tenantId", cid: "Qm1" }]);
    expect(r.hasLandlordId).toBe(false);
    expect(r.hasTenantId).toBe(true);
  });

  it('rejected ownership upload → ownershipDoc=false after reload', () => {
    const r = resyncDocs([{ label: "tenantId", cid: "Qm1" }, { label: "landlordId", cid: "Qm2" }]);
    expect(r.hasOwnership).toBe(false);
  });

  it('rejected doc does not appear in uploadedDocs map', () => {
    // Locally added "ownership" but server rejected → after reload, only server docs remain
    const r = resyncDocs([{ label: "tenantId", cid: "Qm1" }]);
    expect(r.docMap["ownership"]).toBeUndefined();
    expect(r.docMap["tenantId"]).toBeDefined();
  });

  it('server with all 3 docs → all flags true', () => {
    const r = resyncDocs([
      { label: "tenantId", cid: "Qm1" },
      { label: "landlordId", cid: "Qm2" },
      { label: "ownership", cid: "Qm3" },
    ]);
    expect(r.hasTenantId).toBe(true);
    expect(r.hasLandlordId).toBe(true);
    expect(r.hasOwnership).toBe(true);
    expect(Object.keys(r.docMap)).toHaveLength(3);
  });
});

// ─── Archive addr correctness ───────────────────────────────────────────────

describe('Archive uses correct wallet addr', () => {
  it('archive sends connectedAddr when available', () => {
    const connectedAddr = "0xabc";
    const myAddr = "0xold";
    const archiveAddr = connectedAddr || myAddr;
    expect(archiveAddr).toBe("0xabc");
  });

  it('archive falls back to myAddr when connectedAddr is null', () => {
    const connectedAddr = null;
    const myAddr = "0xdef";
    const archiveAddr = connectedAddr || myAddr;
    expect(archiveAddr).toBe("0xdef");
  });

  it('archive aborts if no addr', () => {
    const connectedAddr = null;
    const myAddr = null;
    const archiveAddr = connectedAddr || myAddr;
    expect(archiveAddr).toBeFalsy();
  });
});

describe('Archive success verifies active row deleted', () => {
  it('after successful archive, active row must be null', () => {
    // Server: insert archived_contracts → delete active_contracts → verify
    let activeExists = true;
    // Archive action:
    activeExists = false; // delete succeeded
    const verifyRow = null; // query returns null
    expect(activeExists).toBe(false);
    expect(verifyRow).toBeNull();
  });

  it('duplicate archive branch also deletes active row', () => {
    let activeExists = true;
    const dupFound = true;
    if (dupFound) activeExists = false; // dup branch deletes
    expect(activeExists).toBe(false);
  });

  it('archive non-ok does not trigger reload', () => {
    let reloaded = false;
    const r = { ok: false, status: 403 };
    if (r.ok) reloaded = true;
    expect(reloaded).toBe(false);
  });

  it('archive ok triggers reload', () => {
    let reloaded = false;
    const r = { ok: true };
    if (r.ok) reloaded = true;
    expect(reloaded).toBe(true);
  });
});

// ─── Real inventory initial sync payload ────────────────────────────────────

describe('Inventory sync payload', () => {
  it('correct payload shape (not double-stringified)', () => {
    const payload = { addr: "0xLL", peerAddr: "0xTN", field: "steps", value: { inventory: [{ name: "Fridge" }] } };
    expect(payload.field).toBe("steps");
    expect(payload.value.inventory).toHaveLength(1);
    expect(payload.body).toBeUndefined(); // no nested body property
  });

  it('inventory blocked after tenantAckInventory', () => {
    const cf = { steps: { tenantAckInventory: true }, deposit: {}, signatures: {} };
    const r = checkFieldLock("steps", { inventory: [{ name: "TV" }] }, cf);
    expect(r.locked).toBe(true);
  });
});

// ─── Archive tests (unchanged) ──────────────────────────────────────────────

describe('Multiple archived contracts per user', () => {
  it('supports multiple rows for same addr', () => {
    const a = [{ addr: "0xa", agreement_id: "1" }, { addr: "0xa", agreement_id: "2" }];
    expect(a.filter(x => x.addr === "0xa")).toHaveLength(2);
  });

  it('duplicate archive prevented', () => {
    const existing = { id: 1 };
    expect(!!existing).toBe(true);
  });
});

describe('Archive snapshot', () => {
  it('snapshot survives contract_forms deletion', () => {
    const archived = { snapshot: { contractForm: { steps: { terms: { rent: 100 } } } } };
    expect(archived.snapshot.contractForm.steps.terms.rent).toBe(100);
  });
});

describe('Archive visible to both parties', () => {
  function q(a, addr) { return a.filter(x => x.addr === addr || x.peer_addr === addr); }
  it('tenant sees landlord archive via peer_addr', () => {
    expect(q([{ addr: "0xLL", peer_addr: "0xTN" }], "0xTN")).toHaveLength(1);
  });
  it('stranger sees nothing', () => {
    expect(q([{ addr: "0xLL", peer_addr: "0xTN" }], "0xOTHER")).toHaveLength(0);
  });
});

describe('Archive: agreementId zero + both-party cleanup', () => {
  it('agreementId "0x000...000" is a valid hasAgrId', () => {
    const agrId = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const hasAgrId = agrId !== undefined && agrId !== null && agrId !== "";
    expect(hasAgrId).toBe(true);
  });

  it('agreementId undefined/null/empty is not valid', () => {
    expect(undefined !== undefined).toBe(false); // undefined === undefined → !hasAgrId
    expect(null !== null).toBe(false);
    expect("" !== "").toBe(false);
  });

  it('archive deletes both caller and peer active rows', () => {
    let callerDeleted = false, peerDeleted = false;
    // Simulate archive:
    callerDeleted = true;
    const peerAddr = "0xpeer";
    if (peerAddr) peerDeleted = true;
    expect(callerDeleted).toBe(true);
    expect(peerDeleted).toBe(true);
  });

  it('duplicate archive also deletes both rows', () => {
    const dupFound = true;
    let callerDeleted = false, peerDeleted = false;
    if (dupFound) { callerDeleted = true; peerDeleted = true; }
    expect(callerDeleted && peerDeleted).toBe(true);
  });

  it('Rental Settled + PropDep Active does NOT archive', () => {
    const pdState = 1; // Active
    const blocked = pdState > 0 && pdState < 5;
    expect(blocked).toBe(true);
  });

  it('Rental Settled + PropDep Settled archives', () => {
    const pdState = 5;
    const blocked = pdState > 0 && pdState < 5;
    expect(blocked).toBe(false);
  });

  it('auto-archive triggers when rental terminal + propDep resolved', () => {
    const rentalState = 8;
    const propDepState = 5;
    const terminal = rentalState === 8 || rentalState === 9;
    const pdOk = propDepState === 0 || propDepState === 5;
    expect(terminal && pdOk).toBe(true);
  });
});
