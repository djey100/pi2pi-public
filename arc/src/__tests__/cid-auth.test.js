// Level 7: CID authorization tests — imports real production helper
import { describe, it, expect, vi } from 'vitest';
import { isCidAuthorizedForAddr } from '../../../cid-auth.js';

// Mock Supabase client
function mockSupabase(cfRows, acRows, cfErr = null, acErr = null) {
  return {
    from: (table) => ({
      select: () => ({
        limit: () => Promise.resolve(
          table === "contract_forms"
            ? { data: cfRows, error: cfErr }
            : { data: acRows, error: acErr }
        ),
        // without limit
        then: (fn) => Promise.resolve(
          table === "contract_forms"
            ? { data: cfRows, error: cfErr }
            : { data: acRows, error: acErr }
        ).then(fn),
      }),
    }),
  };
}

describe('isCidAuthorizedForAddr', () => {
  const CID = "QmTestCid123abc";
  const PARTY_A = "0xaaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
  const PARTY_B = "0xbbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";
  const STRANGER = "0xcccc3333cccc3333cccc3333cccc3333cccc3333";

  // Key format: sorted addr1-addr2
  const CF_KEY = [PARTY_A, PARTY_B].sort().join("-");

  const CF_WITH_CID = [
    { key: CF_KEY, form: { documents: [{ cid: CID, name: "passport.pdf" }], photos: [] } },
  ];
  const CF_WITHOUT_CID = [
    { key: CF_KEY, form: { documents: [{ cid: "QmOtherCid", name: "other.pdf" }] } },
  ];
  const AC_WITH_CID = [
    { addr: PARTY_A, data: { peerAddr: PARTY_B, ipfsCid: CID } },
  ];

  it('contract_forms: cid found, caller is first party → true', async () => {
    const sb = mockSupabase(CF_WITH_CID, []);
    expect(await isCidAuthorizedForAddr(sb, CID, PARTY_A)).toBe(true);
  });

  it('contract_forms: cid found, caller is second party → true', async () => {
    const sb = mockSupabase(CF_WITH_CID, []);
    expect(await isCidAuthorizedForAddr(sb, CID, PARTY_B)).toBe(true);
  });

  it('contract_forms: cid found, caller is stranger → false', async () => {
    const sb = mockSupabase(CF_WITH_CID, []);
    expect(await isCidAuthorizedForAddr(sb, CID, STRANGER)).toBe(false);
  });

  it('contract_forms: cid not found → false', async () => {
    const sb = mockSupabase(CF_WITHOUT_CID, []);
    expect(await isCidAuthorizedForAddr(sb, CID, PARTY_A)).toBe(false);
  });

  it('active_contracts: cid found, caller is addr → true', async () => {
    const sb = mockSupabase([], AC_WITH_CID);
    expect(await isCidAuthorizedForAddr(sb, CID, PARTY_A)).toBe(true);
  });

  it('active_contracts: cid found, caller is peerAddr → true', async () => {
    const sb = mockSupabase([], AC_WITH_CID);
    expect(await isCidAuthorizedForAddr(sb, CID, PARTY_B)).toBe(true);
  });

  it('active_contracts: cid found, caller is stranger → false', async () => {
    const sb = mockSupabase([], AC_WITH_CID);
    expect(await isCidAuthorizedForAddr(sb, CID, STRANGER)).toBe(false);
  });

  it('supabase error on contract_forms does not grant access', async () => {
    const sb = mockSupabase(null, [], { message: "DB error" });
    expect(await isCidAuthorizedForAddr(sb, CID, PARTY_A)).toBe(false);
  });

  it('uses column form not data', async () => {
    // If code used cf.data instead of cf.form, CID would not be found
    const wrongColumn = [{ key: CF_KEY, data: { documents: [{ cid: CID }] }, form: {} }];
    const sb = mockSupabase(wrongColumn, []);
    // CID is in .data not .form → should NOT authorize
    expect(await isCidAuthorizedForAddr(sb, CID, PARTY_A)).toBe(false);
  });

  it('case-insensitive addr matching', async () => {
    const sb = mockSupabase(CF_WITH_CID, []);
    expect(await isCidAuthorizedForAddr(sb, CID, PARTY_A.toUpperCase())).toBe(true);
  });

  it('key uses dash separator not underscore', async () => {
    const wrongSep = [{ key: CF_KEY.replace(/-/g, "_"), form: { documents: [{ cid: CID }] } }];
    const sb = mockSupabase(wrongSep, []);
    // Key split by "-" won't find addr in underscore-separated key
    expect(await isCidAuthorizedForAddr(sb, CID, PARTY_A)).toBe(false);
  });
});
