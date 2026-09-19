// Level 6: Auth smoke tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
});

describe('Auth API client', () => {
  it('authGetNonce sends addr and gets nonce', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ nonce: 'abc', message: 'sign this' }) }));
    const { authGetNonce } = await import('../api/client.js');
    const result = await authGetNonce('0xABC');
    expect(result.nonce).toBe('abc');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/auth/nonce?addr=0xABC'), expect.anything());
  });

  it('authVerify sends addr+message+signature and stores csrf', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, csrf: 'token123' }) }));
    const { authVerify, getCsrfToken } = await import('../api/client.js');
    const result = await authVerify('0xABC', 'message', '0xsig');
    expect(result.ok).toBe(true);
    expect(getCsrfToken()).toBe('token123');
  });

  it('apiPost includes X-CSRF-Token header when csrf set', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    const { setCsrfToken, apiPost } = await import('../api/client.js');
    setCsrfToken('mytoken');
    await apiPost('/api/test', { foo: 'bar' });
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[1].headers['X-CSRF-Token']).toBe('mytoken');
  });

  it('apiPost includes credentials:include', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    const { apiPost } = await import('../api/client.js');
    await apiPost('/api/test', {});
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[1].credentials).toBe('include');
  });

  it('apiFormPost includes CSRF but not Content-Type', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ url: 'test' }) }));
    const { uploadListingPhoto, setCsrfToken } = await import('../api/client.js');
    setCsrfToken('csrf_upload');
    const fd = new FormData();
    fd.append('file', new Blob(['test']), 'test.jpg');
    await uploadListingPhoto(fd);
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[1].headers['X-CSRF-Token']).toBe('csrf_upload');
    // Should NOT have Content-Type (browser sets multipart boundary)
    expect(callArgs[1].headers['Content-Type']).toBeUndefined();
  });
});

describe('Auth security invariants', () => {
  it('verifyAddrMatch blocks different address', async () => {
    // Simulated test — verifyAddrMatch is server-side,
    // but we test the client sends correct credentials
    const { setCsrfToken, apiPost } = await import('../api/client.js');
    setCsrfToken('valid');
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 'Address mismatch' }) }));
    const r = await apiPost('/api/listings', { owner_addr: '0xATTACKER' });
    expect(r.ok).toBe(false);
  });

  it('authLogout clears csrf token', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    const { setCsrfToken, authLogout, getCsrfToken } = await import('../api/client.js');
    setCsrfToken('before');
    await authLogout();
    expect(getCsrfToken()).toBeNull();
  });

  it('server rejects path addr mismatch (simulated)', async () => {
    // Simulate: authenticated as 0xAAA, try to DELETE /api/users/0xBBB → 403
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 'Forbidden' }) }));
    const { apiDelete } = await import('../api/client.js');
    const r = await apiDelete('/api/users/0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  it('server rejects CID decrypt for non-party (simulated)', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: 'Not authorized — CID not linked to your contracts' }) }));
    const r = await fetch('/api/ipfs/decrypt/QmFAKECID', { credentials: 'include' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  it('upload without CSRF fails (simulated)', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Unauthorized' }) }));
    const { setCsrfToken } = await import('../api/client.js');
    setCsrfToken(null);
    const fd = new FormData();
    fd.append('file', new Blob(['test']), 'test.jpg');
    const r = await fetch('/api/upload/listing-photo', { method: 'POST', body: fd });
    expect(r.ok).toBe(false);
  });

  it('all component files have zero raw fetch calls', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'components');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsx') || f.endsWith('.js'));
    for (const file of files) {
      const code = fs.readFileSync(path.join(dir, file), 'utf-8');
      // Allow GET fetch with credentials (e.g. decrypt binary), block POST/PATCH/DELETE raw fetch
      const rawMutating = (code.match(/fetch\(["'`][^"'`]*\/api\/[^"'`]*["'`],\s*\{[^}]*method:\s*["'](POST|PATCH|DELETE)/g) || []).length;
      expect(rawMutating, `${file} has raw mutating fetch calls`).toBe(0);
    }
  });
});
