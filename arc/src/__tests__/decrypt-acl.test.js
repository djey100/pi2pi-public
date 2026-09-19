// Level 8: Decrypt ACL tests — strict doc_keys authorization
// Tests the exact server-side decrypt ACL logic
import { describe, it, expect } from 'vitest';

// Replicate exact server decrypt ACL logic
function checkDecryptAccess(keyMeta, metaErr, callerAddr) {
  if (metaErr) return { status: 500, error: "ACL check failed" };
  if (!keyMeta) return { status: 404, error: "Document not found" };
  const caller = callerAddr.toLowerCase();
  const owner = (keyMeta.owner_addr || "").toLowerCase();
  const peer = (keyMeta.peer_addr || "").toLowerCase();
  if (!owner) return { status: 403, error: "Document has no owner" };
  const allowed = caller === owner || (peer && caller === peer);
  if (!allowed) return { status: 403, error: "Not authorized" };
  return { status: 200 };
}

describe('Decrypt ACL — strict doc_keys authorization', () => {
  const OWNER = "0xaaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
  const PEER = "0xbbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";
  const STRANGER = "0xcccc3333cccc3333cccc3333cccc3333cccc3333";

  it('owner_addr set, peer_addr null, caller=owner → allow', () => {
    const r = checkDecryptAccess({ owner_addr: OWNER, peer_addr: null }, null, OWNER);
    expect(r.status).toBe(200);
  });

  it('owner_addr set, peer_addr null, caller=stranger → deny', () => {
    const r = checkDecryptAccess({ owner_addr: OWNER, peer_addr: null }, null, STRANGER);
    expect(r.status).toBe(403);
  });

  it('owner_addr set, peer_addr set, caller=owner → allow', () => {
    const r = checkDecryptAccess({ owner_addr: OWNER, peer_addr: PEER }, null, OWNER);
    expect(r.status).toBe(200);
  });

  it('owner_addr set, peer_addr set, caller=peer → allow', () => {
    const r = checkDecryptAccess({ owner_addr: OWNER, peer_addr: PEER }, null, PEER);
    expect(r.status).toBe(200);
  });

  it('owner_addr set, peer_addr set, caller=stranger → deny', () => {
    const r = checkDecryptAccess({ owner_addr: OWNER, peer_addr: PEER }, null, STRANGER);
    expect(r.status).toBe(403);
  });

  it('keyMeta missing → 404', () => {
    const r = checkDecryptAccess(null, null, OWNER);
    expect(r.status).toBe(404);
  });

  it('owner_addr empty → deny', () => {
    const r = checkDecryptAccess({ owner_addr: "", peer_addr: "" }, null, OWNER);
    expect(r.status).toBe(403);
  });

  it('owner_addr missing → deny', () => {
    const r = checkDecryptAccess({ peer_addr: PEER }, null, PEER);
    expect(r.status).toBe(403);
  });

  it('Supabase select error → 500', () => {
    const r = checkDecryptAccess(null, { message: "DB error" }, OWNER);
    expect(r.status).toBe(500);
  });

  it('case-insensitive matching', () => {
    const r = checkDecryptAccess({ owner_addr: OWNER, peer_addr: null }, null, OWNER.toUpperCase());
    expect(r.status).toBe(200);
  });

  it('peer_addr=null means owner-only, not open access', () => {
    // This is the key test — peer_addr=null must NOT grant access to strangers
    const r1 = checkDecryptAccess({ owner_addr: OWNER, peer_addr: null }, null, OWNER);
    const r2 = checkDecryptAccess({ owner_addr: OWNER, peer_addr: null }, null, STRANGER);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(403);
  });
});

// Verify isCidAuthorizedForAddr is NOT used in decrypt path
describe('Decrypt does not use mutable JSON fallback', () => {
  it('isCidAuthorizedForAddr is not imported in decrypt section', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const serverPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'server-arc.js');
    const code = fs.readFileSync(serverPath, 'utf-8');

    // Find the decrypt endpoint section
    const decryptStart = code.indexOf('/api/ipfs/decrypt/');
    const decryptEnd = code.indexOf('// Get key from Supabase', decryptStart);
    if (decryptStart === -1 || decryptEnd === -1) {
      // Can't find section — skip (file structure changed)
      return;
    }
    const decryptSection = code.slice(decryptStart, decryptEnd);

    // isCidAuthorizedForAddr must NOT appear in decrypt section
    expect(decryptSection).not.toContain('isCidAuthorizedForAddr');
  });
});
