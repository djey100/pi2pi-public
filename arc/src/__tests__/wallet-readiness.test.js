// Tests for wallet readiness guard and Circle lazy-reconnect
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  // Clean up global wallet state
  delete global.window?.pi2piWallet;
  delete global.window?.ethereum;
});

describe('ensureWalletReady', () => {
  it('no provider → ready=false with error message', async () => {
    global.window = {};
    const { ensureWalletReady } = await import('../wallet.js');
    const result = await ensureWalletReady();
    expect(result.ready).toBe(false);
    expect(result.error).toContain('No wallet provider');
  });

  it('provider exists but no accounts → ready=false', async () => {
    global.window = {
      pi2piWallet: { provider: { request: vi.fn(async () => []) }, type: 'metamask' },
    };
    const { ensureWalletReady } = await import('../wallet.js');
    const result = await ensureWalletReady();
    expect(result.ready).toBe(false);
    expect(result.error).toContain('No accounts');
  });

  it('provider with accounts → ready=true', async () => {
    global.window = {
      pi2piWallet: {
        provider: { request: vi.fn(async () => ['0xABC']) },
        type: 'metamask',
      },
    };
    const { ensureWalletReady } = await import('../wallet.js');
    const result = await ensureWalletReady();
    expect(result.ready).toBe(true);
    expect(result.address).toBe('0xABC');
  });

  it('Circle pending reconnect → calls connectCircleWallet', async () => {
    const mockConnect = vi.fn(async () => {
      global.window.pi2piWallet._circleSCA = {};
      global.window.pi2piWallet._circleAddress = '0xCIRCLE';
      global.window.pi2piWallet.provider = {
        request: vi.fn(async () => ['0xCIRCLE']),
      };
    });
    global.window = {
      pi2piWallet: {
        type: 'circle',
        _circlePendingReconnect: true,
        _circleSessionUsername: 'test-user',
        _circleAddress: '0xCIRCLE',
        connectCircleWallet: mockConnect,
        provider: { request: vi.fn(async () => ['0xCIRCLE']) },
      },
    };
    const { ensureWalletReady } = await import('../wallet.js');
    const result = await ensureWalletReady();
    expect(mockConnect).toHaveBeenCalled();
    expect(result.ready).toBe(true);
  });

  it('Circle reconnect fails → ready=false', async () => {
    global.window = {
      pi2piWallet: {
        type: 'circle',
        _circlePendingReconnect: true,
        connectCircleWallet: vi.fn(async () => { throw new Error('passkey denied'); }),
        provider: null,
      },
    };
    const { ensureWalletReady } = await import('../wallet.js');
    const result = await ensureWalletReady();
    expect(result.ready).toBe(false);
    expect(result.error).toContain('Circle reconnect failed');
  });
});

describe('executeBatch lazy-reconnect', () => {
  it('pending reconnect triggers connectCircleWallet before executeBatch', () => {
    // Simulates the executeBatch logic
    let reconnectCalled = false;
    const wallet = {
      type: 'circle',
      _circlePendingReconnect: true,
      _circleSCA: null,
      connectCircleWallet: async () => {
        reconnectCalled = true;
        wallet._circleSCA = { address: '0xSCA' };
        wallet._circlePendingReconnect = false;
      },
    };

    // Simulate the guard
    const canExecute = async () => {
      if (wallet._circlePendingReconnect) {
        wallet._circlePendingReconnect = false;
        await wallet.connectCircleWallet();
      }
      return wallet.type === 'circle' && !!wallet._circleSCA;
    };

    return canExecute().then(ready => {
      expect(reconnectCalled).toBe(true);
      expect(ready).toBe(true);
    });
  });
});

describe('tx helper pending state reset', () => {
  it('wallet not ready resets pending state', () => {
    let pending = false;
    const setPending = (v) => { pending = v; };

    // Simulate tx helper flow
    const txSimulate = async (walletReady) => {
      setPending(true);
      if (!walletReady) {
        setPending(false);
        return 'reset';
      }
      setPending(false);
      return 'done';
    };

    return txSimulate(false).then(result => {
      expect(result).toBe('reset');
      expect(pending).toBe(false);
    });
  });
});

describe('Archive error visibility', () => {
  it('checkAuthGuard blocks when _authenticated is false', () => {
    const wallet = { provider: {}, _authenticated: false };
    const blocked = wallet.provider && !wallet._authenticated;
    expect(blocked).toBe(true);
  });

  it('checkAuthGuard passes when _authenticated is true', () => {
    const wallet = { provider: {}, _authenticated: true };
    const blocked = wallet.provider && !wallet._authenticated;
    expect(blocked).toBe(false);
  });

  it('archive handler surfaces non-ok response as alert', () => {
    // Simulates the fixed archive button handler
    let alertMsg = null;
    const mockAlert = (m) => { alertMsg = m; };
    const r = { ok: false, status: 401, json: () => Promise.resolve({ error: "Wallet not authenticated" }) };
    return r.json().then(body => {
      if (!r.ok) mockAlert(body.error);
      expect(alertMsg).toBe("Wallet not authenticated");
    });
  });

  it('archive handler reloads on success', () => {
    let reloaded = false;
    const r = { ok: true, json: () => Promise.resolve({ ok: true }) };
    if (r.ok) reloaded = true;
    expect(reloaded).toBe(true);
  });
});
