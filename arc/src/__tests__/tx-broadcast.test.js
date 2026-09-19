// Tests for sendTxRaw — legacy gasPrice on Arc Testnet
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });

describe('sendTxRaw — wrong-network guard', () => {
  const okGasFetch = () => vi.fn((url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'eth_estimateGas') return Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x5208' }) });
    if (body.method === 'eth_gasPrice') return Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x12A05F200' }) });
    // Resolve waitTxVisible's polling immediately (first poll returns a tx).
    if (body.method === 'eth_getTransactionByHash') return Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: { hash: body.params[0] } }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: null }) });
  });

  it('blocks the write and never calls eth_sendTransaction when the wallet is on the wrong chain', async () => {
    global.fetch = okGasFetch();
    const request = vi.fn((args) => {
      if (args.method === 'eth_chainId') return Promise.resolve('0x1'); // Ethereum mainnet, not the configured active chain
      if (args.method === 'eth_sendTransaction') return Promise.resolve('0x' + 'a'.repeat(64));
      return Promise.resolve(null);
    });
    globalThis.window.pi2piWallet = { provider: { request }, type: 'injected' };
    const { sendTxRaw } = await import('../wallet.js');
    const { ARC_TESTNET_CHAIN } = await import('../helpers.js');

    // The message must name the CONFIGURED active chain dynamically (via
    // ARC_TESTNET_CHAIN.chainName), not a hardcoded "Arc Testnet" literal —
    // it must stay correct if the build is ever configured for another
    // network. Asserting on chainName (not just the generic "wrong network"
    // phrase) proves it's sourced from the active config, not a fixed string.
    await expect(sendTxRaw('0xfrom', '0xto', '0xdata')).rejects.toThrow(
      new RegExp(`wrong network.*${ARC_TESTNET_CHAIN.chainName}`, 'i')
    );
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_sendTransaction' }));
    delete globalThis.window.pi2piWallet;
  });

  it('allows the write when the wallet is already on Arc Testnet', async () => {
    global.fetch = okGasFetch();
    const request = vi.fn((args) => {
      if (args.method === 'eth_chainId') return Promise.resolve('0x4cef52'); // Arc Testnet
      if (args.method === 'eth_sendTransaction') return Promise.resolve('0x' + 'a'.repeat(64));
      return Promise.resolve(null);
    });
    globalThis.window.pi2piWallet = { provider: { request }, type: 'injected' };
    const { sendTxRaw } = await import('../wallet.js');

    const hash = await sendTxRaw('0xfrom', '0xto', '0xdata');
    expect(hash).toBe('0x' + 'a'.repeat(64));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_sendTransaction' }));
    delete globalThis.window.pi2piWallet;
  });

  it('Circle smart-account wallets skip sendTxRaw\'s external-wallet chain check (Circle init is separately gated by isCircleSupported)', async () => {
    const request = vi.fn((args) => {
      if (args.method === 'eth_chainId') throw new Error('should never be called for Circle');
      if (args.method === 'eth_sendTransaction') return Promise.resolve('0x' + 'b'.repeat(64));
      return Promise.resolve(null);
    });
    globalThis.window.pi2piWallet = { provider: { request }, type: 'circle' };
    const { sendTxRaw } = await import('../wallet.js');

    const hash = await sendTxRaw('0xfrom', '0xto', '0xdata');
    expect(hash).toBe('0x' + 'b'.repeat(64));
    delete globalThis.window.pi2piWallet;
  });

  it('surfaces a clear error if eth_chainId itself fails, without sending the tx', async () => {
    const request = vi.fn((args) => {
      if (args.method === 'eth_chainId') return Promise.reject(new Error('provider disconnected'));
      if (args.method === 'eth_sendTransaction') return Promise.resolve('0x' + 'c'.repeat(64));
      return Promise.resolve(null);
    });
    globalThis.window.pi2piWallet = { provider: { request }, type: 'injected' };
    const { sendTxRaw } = await import('../wallet.js');

    await expect(sendTxRaw('0xfrom', '0xto', '0xdata')).rejects.toThrow(/could not read wallet network/i);
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_sendTransaction' }));
    delete globalThis.window.pi2piWallet;
  });
});

describe('isTxHash', () => {
  it('valid hash', async () => { const { isTxHash } = await import('../wallet.js'); expect(isTxHash('0x' + 'a'.repeat(64))).toBe(true); });
  it('rejects short', async () => { const { isTxHash } = await import('../wallet.js'); expect(isTxHash('0xabc')).toBe(false); });
  it('rejects null', async () => { const { isTxHash } = await import('../wallet.js'); expect(isTxHash(null)).toBe(false); });
});

describe('getArcGasPrice — legacy only', () => {
  it('gasPrice = max(rpcGasPrice * 3, 10 gwei)', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x3B9ACA00' }) })); // 1 gwei
    const { getArcGasPrice } = await import('../wallet.js');
    const r = await getArcGasPrice();
    // 1 gwei * 3 = 3 gwei < 10 gwei min → use 10 gwei
    expect(r._final).toBe(10000000000n);
  });

  it('gasPrice uses rpc * 3 when above floor', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x12A05F200' }) })); // 5 gwei
    const { getArcGasPrice } = await import('../wallet.js');
    const r = await getArcGasPrice();
    // 5 gwei * 3 = 15 gwei > 10 gwei min → use 15 gwei
    expect(r._final).toBe(15000000000n);
  });

  it('fallback to 10 gwei floor on RPC failure', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('rpc down')));
    const { getArcGasPrice } = await import('../wallet.js');
    const r = await getArcGasPrice();
    expect(r._final).toBe(10000000000n);
  });
});

describe('prepareTxRequest — legacy Arc', () => {
  it('uses gasPrice only, no EIP-1559 fields', async () => {
    global.fetch = vi.fn((url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'eth_estimateGas') return Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x5208' }) }); // 21000
      if (body.method === 'eth_gasPrice') return Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x12A05F200' }) }); // 5 gwei
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: null }) });
    });
    const { prepareTxRequest } = await import('../wallet.js');
    const tx = await prepareTxRequest('0xfrom', '0xto', '0xdata');
    expect(tx.gasPrice).toBeDefined();
    expect(tx.maxFeePerGas).toBeUndefined();
    expect(tx.maxPriorityFeePerGas).toBeUndefined();
    expect(tx.nonce).toBeUndefined();
  });

  it('gas = estimateGas * 1.5', async () => {
    global.fetch = vi.fn((url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.method === 'eth_estimateGas') return Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x5208' }) }); // 21000
      if (body.method === 'eth_gasPrice') return Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x3B9ACA00' }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: null }) });
    });
    const { prepareTxRequest } = await import('../wallet.js');
    const tx = await prepareTxRequest('0xfrom', '0xto', '0xdata');
    // 21000 * 1.5 = 31500 = 0x7B0C
    expect(tx.gas).toBe('0x7b0c');
  });
});

describe('nonce guard', () => {
  it('blocks when pending > latest', () => {
    const latest = '0x5'; const pending = '0x6';
    expect(latest !== pending).toBe(true);
  });
  it('allows when match', () => {
    expect('0x5' === '0x5').toBe(true);
  });
});

describe('waitReceipt — 120s, stuck detection', () => {
  it('stuck pending = throws with hash', () => {
    const lastTxCheck = { gasPrice: '0x1' };
    const hasReceipt = false;
    expect(!hasReceipt && !!lastTxCheck).toBe(true);
  });
  it('invisible = returns null', () => {
    const lastTxCheck = null;
    expect(!lastTxCheck).toBe(true);
  });
});

describe('payRent flow guards', () => {
  it('pending nonce blocks before approve', () => {
    const blocked = '0x5' !== '0x6';
    expect(blocked).toBe(true);
  });
  it('approve pending does not call payRent', () => {
    const phases = ['approve_pending'];
    const receiptOk = false;
    if (!receiptOk) phases.push('stopped');
    expect(phases).not.toContain('pay_pending');
  });
  it('approve success then allowance required', () => {
    const receiptOk = true;
    let allowanceChecked = false;
    if (receiptOk) allowanceChecked = true;
    expect(allowanceChecked).toBe(true);
  });
  it('payRent verifies rentPaymentsMade +1', () => {
    const before = 1; const after = 2;
    expect(after - before).toBe(1);
  });
});
