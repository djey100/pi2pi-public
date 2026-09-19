// Level 1: Build & Import test — verifies all modules parse and export correctly
import { describe, it, expect } from 'vitest';

describe('Level 1: Build & Imports', () => {
  it('imports helpers.js without errors', async () => {
    const mod = await import('../helpers.js');
    expect(mod.REVERT_MAP).toBeDefined();
    expect(mod.extractRevertReason).toBeTypeOf('function');
    expect(mod.mapRevertReason).toBeTypeOf('function');
    expect(mod.fmtCountdown).toBeTypeOf('function');
    expect(mod.parseAgreement).toBeTypeOf('function');
    expect(mod.parsePropDep).toBeTypeOf('function');
    expect(mod.getDealView).toBeTypeOf('function');
    expect(mod.getNextStep).toBeTypeOf('function');
    expect(mod.getDealActions).toBeTypeOf('function');
    expect(mod.ESCROW_ADDRESS).toBeTypeOf('string');
    expect(mod.PROPDEP_ADDRESS).toBeTypeOf('string');
    expect(mod.USDC_ADDRESS).toBeTypeOf('string');
    expect(mod.SEL).toBeDefined();
    expect(mod.SEL_PROPDEP).toBeDefined();
    expect(mod.encAddr).toBeTypeOf('function');
    expect(mod.encUint).toBeTypeOf('function');
    expect(mod.toDecAgreementId).toBeTypeOf('function');
    expect(mod.CONTRACT_VERSION).toBeTypeOf('number');
  });

  it('imports i18n/index.js without errors', async () => {
    const mod = await import('../i18n/index.js');
    expect(mod.t).toBeTypeOf('function');
    expect(mod.setLang).toBeTypeOf('function');
    expect(mod.getLang).toBeTypeOf('function');
    expect(mod.SUPPORTED_LANGS).toBeInstanceOf(Array);
    expect(mod.SUPPORTED_LANGS.length).toBe(8);
    expect(mod.STRINGS).toBeDefined();
    expect(mod.STRINGS.en).toBeDefined();
    expect(mod.STRINGS.ru).toBeDefined();
    expect(mod.STRINGS.th).toBeDefined();
    expect(mod.STRINGS.uk).toBeDefined();
  });

  it('imports mocks.js without errors', async () => {
    const mod = await import('../mocks.js');
    expect(mod.LISTINGS).toBeInstanceOf(Array);
    expect(mod.LISTINGS.length).toBeGreaterThan(0);
    expect(mod.TENANTS).toBeInstanceOf(Array);
    expect(mod.TENANTS.length).toBeGreaterThan(0);
  });

  it('imports wallet.js without errors', async () => {
    const mod = await import('../wallet.js');
    expect(mod.withWalletLock).toBeTypeOf('function');
    expect(mod.sendTxRaw).toBeTypeOf('function');
    expect(mod.ethCallRpc).toBeTypeOf('function');
    expect(mod.readUsdcBalance).toBeTypeOf('function');
  });

  it('all 8 i18n language files load', async () => {
    const codes = ['en', 'ru', 'ka', 'vi', 'es', 'pt', 'th', 'uk'];
    for (const code of codes) {
      const mod = await import(`../i18n/${code}.js`);
      const key = `STRINGS_${code.toUpperCase()}`;
      expect(mod[key]).toBeDefined();
      expect(typeof mod[key]).toBe('object');
      // Each language should have at least 100 keys
      expect(Object.keys(mod[key]).length).toBeGreaterThan(100);
    }
  });

  it('contract addresses are valid and distinct', async () => {
    const { ESCROW_ADDRESS, PROPDEP_ADDRESS } = await import('../helpers.js');
    const ZERO = '0x0000000000000000000000000000000000000000';
    expect(ESCROW_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(PROPDEP_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(ESCROW_ADDRESS.toLowerCase()).not.toBe(PROPDEP_ADDRESS.toLowerCase());
    expect(ESCROW_ADDRESS.toLowerCase()).not.toBe(ZERO);
    expect(PROPDEP_ADDRESS.toLowerCase()).not.toBe(ZERO);
    // After deploy, uncomment to verify not old addresses:
    // expect(ESCROW_ADDRESS.toLowerCase()).not.toBe('0x241b50869d2c1a7e65a5b9d5016be0a0eda9d875');
    // expect(PROPDEP_ADDRESS.toLowerCase()).not.toBe('0xb292e8dc58e0a86f05de470e6e65725e7043676b');
  });
});
