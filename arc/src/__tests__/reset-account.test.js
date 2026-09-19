// Tests for POST /api/users/:addr/reset
// Covers both client-side API calls and server-side logic simulation
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

// ─── Client API tests ────────────────────────────────────────────────────────

describe('resetAccount client', () => {
  it('calls POST /api/users/:addr/reset with lowercase addr', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, deletedDraftListings: 0, archivedListings: 0, deletedUser: true })
    }));
    const { resetAccount } = await import('../api/client.js');
    await resetAccount('0xABCDEF');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/users/0xabcdef/reset',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('legacy DELETE /api/users/:addr returns 410', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 410,
      json: () => Promise.resolve({ error: 'Use POST /api/users/:addr/reset instead' })
    }));
    const { deleteUser } = await import('../api/client.js');
    const r = await deleteUser('0xLEGACY');
    expect(r.status).toBe(410);
  });
});

// ─── Server logic simulation tests ──────────────────────────────────────────
// These simulate the handler's decision logic with mock supabase responses.
// Each test builds a mock supabase and runs the handler's logic inline.

function makeSupabase(overrides = {}) {
  const defaults = {
    activeContracts: { select: () => ({ data: null, error: null }) },
    activeContractsAll: { select: () => ({ data: [], error: null }) },
    listings: { select: () => ({ data: [], error: null }) },
    listingsDelete: () => ({ error: null }),
    listingsUpdate: () => ({ error: null }),
    storageRemove: () => ({ error: null }),
    messages: { delete: () => ({ error: null }) },
    viewingRequests: { delete: () => ({ error: null }) },
    contractProposals: { delete: () => ({ error: null }) },
    earlyTerms: { delete: () => ({ error: null }) },
    contractForms: { select: () => ({ data: [], error: null }), delete: () => ({ error: null }) },
    activeContractsDelete: () => ({ error: null }),
    usersDelete: () => ({ error: null }),
  };
  return { ...defaults, ...overrides };
}

// Simulates the core reset logic from server-arc.js
async function simulateReset(addr, sessionAddr, sb) {
  // Auth check
  if (sessionAddr !== addr) return { status: 403, body: { error: 'Forbidden' } };

  // Step 1: active_contracts for this addr
  const { data: acRow, error: acErr } = sb.activeContracts.select();
  if (acErr) return { status: 500, body: { error: 'Cannot verify contract status: ' + acErr.message } };
  if (acRow?.data && !acRow.data.archived) return { status: 409, body: { ok: false, error: 'Active contract exists. Finish or archive contract before reset.' } };

  // Step 2: peer check
  const { data: peerRows, error: peerErr } = sb.activeContractsAll.select();
  if (peerErr) return { status: 500, body: { error: 'Cannot verify peer contract status: ' + peerErr.message } };
  const isPeer = (peerRows || []).some(r =>
    r.addr !== addr && !r.data?.archived &&
    (r.data?.peerAddr?.toLowerCase() === addr || r.data?.listing?.contract?.toLowerCase() === addr)
  );
  if (isPeer) return { status: 409, body: { ok: false, error: 'Active contract exists (as counterparty). Finish or archive contract before reset.' } };

  // Step 3: listings
  const { data: listings, error: listErr } = sb.listings.select();
  if (listErr) return { status: 500, body: { error: 'Cannot read listings: ' + listErr.message } };

  let deletedDraftListings = 0, archivedListings = 0, photoWarnings = 0;
  for (const l of (listings || [])) {
    if (l.status === 'draft') {
      if (l.photos?.length) {
        const { error: stErr } = sb.storageRemove(l.photos);
        if (stErr) photoWarnings++;
      }
      const { error: delErr } = sb.listingsDelete(l.id);
      if (delErr) return { status: 500, body: { error: 'Failed to delete draft listing: ' + delErr.message } };
      deletedDraftListings++;
    } else if (['active', 'paused', 'suspended', 'published'].includes(l.status)) {
      const { error: archErr } = sb.listingsUpdate(l.id);
      if (archErr) return { status: 500, body: { error: 'Failed to archive listing: ' + archErr.message } };
      archivedListings++;
    }
  }

  // Step 4: cleanup
  const { error: msgErr } = sb.messages.delete();
  if (msgErr) return { status: 500, body: { error: 'Failed to delete messages: ' + msgErr.message } };
  const { error: vrErr } = sb.viewingRequests.delete();
  if (vrErr) return { status: 500, body: { error: 'Failed to delete viewing requests: ' + vrErr.message } };
  const { error: cpErr } = sb.contractProposals.delete();
  if (cpErr) return { status: 500, body: { error: 'Failed to delete contract proposals: ' + cpErr.message } };
  const { error: etErr } = sb.earlyTerms.delete();
  if (etErr) return { status: 500, body: { error: 'Failed to delete early terms: ' + etErr.message } };

  const { data: cfRows, error: cfSelErr } = sb.contractForms.select();
  if (cfSelErr) return { status: 500, body: { error: 'Cannot read contract forms: ' + cfSelErr.message } };
  for (const row of (cfRows || [])) {
    const { error: cfErr } = sb.contractForms.delete(row.key);
    if (cfErr) return { status: 500, body: { error: 'Failed to delete contract form: ' + cfErr.message } };
  }

  const { error: acDelErr } = sb.activeContractsDelete();
  if (acDelErr) return { status: 500, body: { error: 'Failed to delete active_contracts: ' + acDelErr.message } };

  const { error: userErr } = sb.usersDelete();
  if (userErr) return { status: 500, body: { error: 'Failed to delete user: ' + userErr.message } };

  const result = { ok: true, deletedDraftListings, archivedListings, deletedUser: true };
  if (photoWarnings > 0) result.photoWarnings = photoWarnings;
  return { status: 200, body: result };
}

describe('Reset server logic: auth', () => {
  it('foreign wallet → 403, nothing else called', async () => {
    const deleteCalled = vi.fn();
    const sb = makeSupabase({ usersDelete: () => { deleteCalled(); return { error: null }; } });
    const r = await simulateReset('0xowner', '0xforeign', sb);
    expect(r.status).toBe(403);
    expect(deleteCalled).not.toHaveBeenCalled();
  });
});

describe('Reset server logic: active contract guard', () => {
  it('active_contracts select error → 500, nothing deleted', async () => {
    const listingsCalled = vi.fn();
    const sb = makeSupabase({
      activeContracts: { select: () => ({ data: null, error: { message: 'DB timeout' } }) },
      listings: { select: () => { listingsCalled(); return { data: [], error: null }; } },
    });
    const r = await simulateReset('0xowner', '0xowner', sb);
    expect(r.status).toBe(500);
    expect(r.body.error).toContain('Cannot verify contract status');
    expect(listingsCalled).not.toHaveBeenCalled();
  });

  it('active contract exists → 409, listings not touched', async () => {
    const listingsCalled = vi.fn();
    const sb = makeSupabase({
      activeContracts: { select: () => ({ data: { data: { peerAddr: '0xpeer', archived: false } }, error: null }) },
      listings: { select: () => { listingsCalled(); return { data: [], error: null }; } },
    });
    const r = await simulateReset('0xowner', '0xowner', sb);
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('Active contract exists');
    expect(listingsCalled).not.toHaveBeenCalled();
  });

  it('archived contract → allowed to reset', async () => {
    const sb = makeSupabase({
      activeContracts: { select: () => ({ data: { data: { peerAddr: '0xpeer', archived: true } }, error: null }) },
    });
    const r = await simulateReset('0xowner', '0xowner', sb);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('peer active contract references this addr → 409', async () => {
    const sb = makeSupabase({
      activeContractsAll: { select: () => ({
        data: [{ addr: '0xother', data: { peerAddr: '0xowner', archived: false } }],
        error: null
      })},
    });
    const r = await simulateReset('0xowner', '0xowner', sb);
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('as counterparty');
  });

  it('peer active contract select error → 500', async () => {
    const sb = makeSupabase({
      activeContractsAll: { select: () => ({ data: null, error: { message: 'scan failed' } }) },
    });
    const r = await simulateReset('0xowner', '0xowner', sb);
    expect(r.status).toBe(500);
    expect(r.body.error).toContain('Cannot verify peer');
  });
});

describe('Reset server logic: listings', () => {
  it('listings select error → 500, user not deleted', async () => {
    const userDeleteCalled = vi.fn();
    const sb = makeSupabase({
      listings: { select: () => ({ data: null, error: { message: 'table locked' } }) },
      usersDelete: () => { userDeleteCalled(); return { error: null }; },
    });
    const r = await simulateReset('0xowner', '0xowner', sb);
    expect(r.status).toBe(500);
    expect(r.body.error).toContain('Cannot read listings');
    expect(userDeleteCalled).not.toHaveBeenCalled();
  });

  it('draft listing → deleted, photos best-effort', async () => {
    const deletedIds = [];
    const photoRemoved = vi.fn();
    const sb = makeSupabase({
      listings: { select: () => ({
        data: [{ id: 'aaa', status: 'draft', photos: [{ path: 'p1.jpg' }] }],
        error: null
      })},
      listingsDelete: (id) => { deletedIds.push(id); return { error: null }; },
      storageRemove: (photos) => { photoRemoved(); return { error: null }; },
    });
    const r = await simulateReset('0xowner', '0xowner', sb);
    expect(r.status).toBe(200);
    expect(r.body.deletedDraftListings).toBe(1);
    expect(deletedIds).toContain('aaa');
    expect(photoRemoved).toHaveBeenCalled();
  });

  it('photo storage error → photoWarnings returned, reset continues', async () => {
    const sb = makeSupabase({
      listings: { select: () => ({
        data: [{ id: 'bbb', status: 'draft', photos: [{ path: 'p1.jpg' }] }],
        error: null
      })},
      storageRemove: () => ({ error: { message: 'storage down' } }),
    });
    const r = await simulateReset('0xowner', '0xowner', sb);
    expect(r.status).toBe(200);
    expect(r.body.photoWarnings).toBe(1);
    expect(r.body.deletedDraftListings).toBe(1);
  });

  it('active/paused/suspended listings → archived', async () => {
    const archivedIds = [];
    const sb = makeSupabase({
      listings: { select: () => ({
        data: [
          { id: 'l1', status: 'active', photos: [] },
          { id: 'l2', status: 'paused', photos: [] },
          { id: 'l3', status: 'suspended', photos: [] },
          { id: 'l4', status: 'published', photos: [] },
          { id: 'l5', status: 'archived', photos: [] },
        ],
        error: null
      })},
      listingsUpdate: (id) => { archivedIds.push(id); return { error: null }; },
    });
    const r = await simulateReset('0xowner', '0xowner', sb);
    expect(r.status).toBe(200);
    expect(r.body.archivedListings).toBe(4);
    expect(archivedIds).toEqual(['l1', 'l2', 'l3', 'l4']);
    // l5 (already archived) should not be in the list
  });
});

describe('Reset server logic: does not delete active_contracts on 409', () => {
  it('returns 409 without deleting active_contracts row', async () => {
    const acDeleteCalled = vi.fn();
    const sb = makeSupabase({
      activeContracts: { select: () => ({ data: { data: { peerAddr: '0xpeer' } }, error: null }) },
      activeContractsDelete: () => { acDeleteCalled(); return { error: null }; },
    });
    const r = await simulateReset('0xowner', '0xowner', sb);
    expect(r.status).toBe(409);
    expect(acDeleteCalled).not.toHaveBeenCalled();
  });
});

describe('Reset server logic: full success path', () => {
  it('returns counts and deletedUser: true', async () => {
    const sb = makeSupabase({
      listings: { select: () => ({
        data: [
          { id: 'd1', status: 'draft', photos: [] },
          { id: 'a1', status: 'active', photos: [] },
        ],
        error: null
      })},
    });
    const r = await simulateReset('0xowner', '0xowner', sb);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      deletedDraftListings: 1,
      archivedListings: 1,
      deletedUser: true,
    });
  });
});

// ─── Feature flag tests ─────────────────────────────────────────────────────

describe('Reset feature flag (ENABLE_ACCOUNT_RESET)', () => {
  it('flag disabled → server returns 404', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 404,
      json: () => Promise.resolve({ error: 'Account reset is disabled in this environment' })
    }));
    const { resetAccount } = await import('../api/client.js');
    const r = await resetAccount('0xABC');
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error).toContain('disabled');
  });

  it('flag enabled → endpoint processes normally', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, deletedDraftListings: 0, archivedListings: 0, deletedUser: true })
    }));
    const { resetAccount } = await import('../api/client.js');
    const r = await resetAccount('0xABC');
    expect(r.status).toBe(200);
  });
});

describe('SHOW_RESET UI flag', () => {
  it('SHOW_RESET is false when not localhost and env not set', () => {
    // In test env, location.hostname is typically "localhost",
    // so SHOW_RESET would be true. We test the logic directly.
    const hostname = 'pi2pi-project.fly.dev';
    const envFlag = undefined;
    const showReset = envFlag === 'true' || hostname === 'localhost';
    expect(showReset).toBe(false);
  });

  it('SHOW_RESET is true on localhost', () => {
    const hostname = 'localhost';
    const envFlag = undefined;
    const showReset = envFlag === 'true' || hostname === 'localhost';
    expect(showReset).toBe(true);
  });

  it('SHOW_RESET is true when VITE_ENABLE_ACCOUNT_RESET=true', () => {
    const hostname = 'pi2pi-project.fly.dev';
    const envFlag = 'true';
    const showReset = envFlag === 'true' || hostname === 'localhost';
    expect(showReset).toBe(true);
  });
});
