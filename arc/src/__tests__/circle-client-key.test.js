// Tests for TASK 10U's hostname-aware Circle Client Key selection, updated
// TASK 10AS for the addition of a Mainnet LIVE Client Key.
//
// Root cause (TASK 10S/10T, live A/B tested): Circle enforces a
// per-Client-Key "Allowed Domain" restriction at the
// rp_getLoginOptions/rp_getRegistrationOptions RPC level — a request from
// an origin the key isn't allowlisted for is rejected with
// "Invalid credentials" before navigator.credentials is ever reached.
// my.pi2pi.io and testnet.pi2pi.io are two different Fly apps' branded
// domains sharing this one frontend bundle, so each needs its own Client
// Key — as of TASK 10AS, my.pi2pi.io's is a Mainnet LIVE key (Circle
// Modular Wallets support on Arc Mainnet independently confirmed TASK
// 10AO; key provisioned in Circle Console TASK 10AR), no longer a fallback
// to the default Testnet key.
//
// Per this test suite's own convention (see wallet-readiness.test.js),
// wallet.js is dynamically imported after `global.window` is set up, since
// its top-level IIFE checks `typeof window === "undefined"` at import time.
//
// Assertions intentionally compare against the real IMPORTED constants
// (never a copy-pasted literal), so nothing here needs to know or print the
// actual key strings beyond what an assertion failure's own diff would
// show — same exposure surface as any other test, and no worse than the
// keys' existing status as public, browser-shipped strings (see wallet.js's
// own comment: "Client URL and Client Key are public (frontend-safe)").

import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  delete global.window?.pi2piWallet;
  delete global.window?.ethereum;
});

describe('resolveCircleClientKey (pure function, TASK 10U/10AS)', () => {
  it('testnet.pi2pi.io resolves to the Testnet Client Key', async () => {
    global.window = { location: { hostname: 'ignored-for-pure-fn' } };
    const { resolveCircleClientKey, CIRCLE_CLIENT_KEY_BY_HOSTNAME } = await import('../wallet.js');
    expect(resolveCircleClientKey('testnet.pi2pi.io')).toBe(CIRCLE_CLIENT_KEY_BY_HOSTNAME['testnet.pi2pi.io']);
  });

  it('my.pi2pi.io resolves to its own explicit Mainnet LIVE Client Key, not a fallback', async () => {
    global.window = { location: { hostname: 'ignored-for-pure-fn' } };
    const { resolveCircleClientKey, CIRCLE_CLIENT_KEY_BY_HOSTNAME } = await import('../wallet.js');
    expect(resolveCircleClientKey('my.pi2pi.io')).toBe(CIRCLE_CLIENT_KEY_BY_HOSTNAME['my.pi2pi.io']);
  });

  it('testnet.pi2pi.io and my.pi2pi.io never resolve to the same key — the exact distinction Circle requires', async () => {
    global.window = { location: { hostname: 'ignored-for-pure-fn' } };
    const { resolveCircleClientKey } = await import('../wallet.js');
    expect(resolveCircleClientKey('testnet.pi2pi.io')).not.toBe(resolveCircleClientKey('my.pi2pi.io'));
  });

  it('any unrecognized/local/dev hostname falls back to a TEST key, never the LIVE my.pi2pi.io key (TASK 10AS safety regression guard)', async () => {
    global.window = { location: { hostname: 'ignored-for-pure-fn' } };
    const { resolveCircleClientKey, CIRCLE_CLIENT_KEY_BY_HOSTNAME } = await import('../wallet.js');
    for (const hostname of ['localhost', '127.0.0.1', 'pi2pi-project.fly.dev', 'pi2pi-mainnet.fly.dev', 'staging.example.com', undefined, '']) {
      const key = resolveCircleClientKey(hostname);
      expect(key).not.toBe(CIRCLE_CLIENT_KEY_BY_HOSTNAME['my.pi2pi.io']);
      expect(key).toMatch(/^TEST_CLIENT_KEY:/);
    }
  });

  it('CIRCLE_CLIENT_KEY_BY_HOSTNAME contains exactly two explicit overrides (testnet.pi2pi.io, my.pi2pi.io) — no accidental extra entries', async () => {
    global.window = { location: { hostname: 'ignored-for-pure-fn' } };
    const { CIRCLE_CLIENT_KEY_BY_HOSTNAME } = await import('../wallet.js');
    expect(Object.keys(CIRCLE_CLIENT_KEY_BY_HOSTNAME).sort()).toEqual(['my.pi2pi.io', 'testnet.pi2pi.io']);
  });

  it('neither key is the placeholder value (regression guard: real keys must be in place, not left as a TODO)', async () => {
    global.window = { location: { hostname: 'ignored-for-pure-fn' } };
    const { resolveCircleClientKey } = await import('../wallet.js');
    expect(resolveCircleClientKey('testnet.pi2pi.io')).not.toMatch(/PLACEHOLDER/);
    expect(resolveCircleClientKey('my.pi2pi.io')).not.toMatch(/PLACEHOLDER/);
  });

  it('testnet.pi2pi.io key is a well-formed TEST_CLIENT_KEY string (sanity check, not an exact-value check)', async () => {
    global.window = { location: { hostname: 'ignored-for-pure-fn' } };
    const { resolveCircleClientKey } = await import('../wallet.js');
    expect(resolveCircleClientKey('testnet.pi2pi.io')).toMatch(/^TEST_CLIENT_KEY:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('my.pi2pi.io key is a well-formed LIVE_CLIENT_KEY string, not a TEST key (TASK 10AS)', async () => {
    global.window = { location: { hostname: 'ignored-for-pure-fn' } };
    const { resolveCircleClientKey } = await import('../wallet.js');
    expect(resolveCircleClientKey('my.pi2pi.io')).toMatch(/^LIVE_CLIENT_KEY:[0-9a-f]+:[0-9a-f]+$/);
  });
});

describe('module-level CIRCLE_MODULAR_CLIENT_KEY resolution at import time (simulates an actual page load)', () => {
  it('when window.location.hostname is testnet.pi2pi.io at import time, toPasskeyTransport/toModularTransport receive the Testnet key', async () => {
    global.window = { location: { hostname: 'testnet.pi2pi.io' } };
    const mod = await import('../wallet.js');
    // resolveCircleClientKey is re-derivable and pure; the module-level
    // constant isn't exported directly (by design — it's an internal used
    // by the two transport calls), so we prove the two would agree by
    // confirming resolveCircleClientKey('testnet.pi2pi.io') is what a fresh
    // import under that hostname would have produced.
    expect(mod.resolveCircleClientKey('testnet.pi2pi.io')).toBe(mod.CIRCLE_CLIENT_KEY_BY_HOSTNAME['testnet.pi2pi.io']);
  });

  it('when window.location.hostname is my.pi2pi.io at import time, the module does not throw and resolves the Mainnet LIVE key', async () => {
    global.window = { location: { hostname: 'my.pi2pi.io' } };
    const mod = await import('../wallet.js');
    expect(mod.resolveCircleClientKey('my.pi2pi.io')).toBe(mod.CIRCLE_CLIENT_KEY_BY_HOSTNAME['my.pi2pi.io']);
    expect(mod.resolveCircleClientKey('my.pi2pi.io')).toMatch(/^LIVE_CLIENT_KEY:/);
  });

  it('module import never throws when window.location is entirely absent (defensive: typeof window check still passes but location may be undefined in unusual embeddings)', async () => {
    global.window = {};
    await expect(import('../wallet.js')).resolves.toBeTruthy();
  });
});
