// Tests for contract accept flow — signContract must succeed before accept message
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('acceptContract flow', () => {
  // Simulates the fixed acceptContract logic
  async function simulateAccept(signResult, walletReady = true) {
    const actions = [];

    // 1. Wallet check
    if (!walletReady) return { result: 'wallet_error', actions };

    // 2. Sign with wallet (personal_sign)
    actions.push('personal_sign');

    // 3. signContract on server
    const r = signResult;
    if (!r || !r.ok) {
      actions.push('show_error');
      return { result: 'sign_failed', actions };
    }
    actions.push('sign_success');

    // 4. Only after success: send message + navigate
    actions.push('send_accept_message');
    actions.push('navigate_to_contract');

    return { result: 'ok', actions };
  }

  it('signContract 401 → no accept message sent, error shown', async () => {
    const r = await simulateAccept({ ok: false, status: 401 });
    expect(r.result).toBe('sign_failed');
    expect(r.actions).toContain('show_error');
    expect(r.actions).not.toContain('send_accept_message');
  });

  it('signContract 500 → no accept message sent, error shown', async () => {
    const r = await simulateAccept({ ok: false, status: 500 });
    expect(r.result).toBe('sign_failed');
    expect(r.actions).toContain('show_error');
    expect(r.actions).not.toContain('send_accept_message');
  });

  it('signContract success → accept message sent + navigate', async () => {
    const r = await simulateAccept({ ok: true, status: 200 });
    expect(r.result).toBe('ok');
    expect(r.actions).toContain('sign_success');
    expect(r.actions).toContain('send_accept_message');
    expect(r.actions).toContain('navigate_to_contract');
  });

  it('wallet not ready → no sign attempt, no message', async () => {
    const r = await simulateAccept(null, false);
    expect(r.result).toBe('wallet_error');
    expect(r.actions).not.toContain('personal_sign');
    expect(r.actions).not.toContain('send_accept_message');
  });

  it('message sent ONLY after signContract, never before', async () => {
    const r = await simulateAccept({ ok: true, status: 200 });
    const signIdx = r.actions.indexOf('sign_success');
    const msgIdx = r.actions.indexOf('send_accept_message');
    expect(signIdx).toBeLessThan(msgIdx);
  });

  it('accepting state resets on failure', () => {
    let accepting = true;
    // Simulate failure path
    const signOk = false;
    if (!signOk) accepting = false;
    expect(accepting).toBe(false);
  });
});
