// Tests for the fail-closed frontend network model in helpers.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  NETWORK_CHAIN_IDS,
  NETWORK_CONFIGS,
  NetworkConfigError,
  resolveExpectedChainId,
  resolveNetworkConfig,
  isCircleSupported,
  ACTIVE_NETWORK_NAME,
  ACTIVE_CHAIN_ID_DEC,
  ARC_TESTNET_CHAIN,
  ESCROW_ADDRESS,
  RPC_URL,
  EXPLORER_BASE_URL,
  OTHER_NETWORK_APP_URL,
  OTHER_NETWORK_LABEL,
  resolveOtherNetworkLink,
  ACTIVE_NETWORK_APP_URL,
  resolveActiveNetworkAppUrl,
} from '../helpers.js';
import { t } from '../i18n/index.js';
import { STRINGS_EN } from '../i18n/en.js';
import { STRINGS_RU } from '../i18n/ru.js';
import { STRINGS_KA } from '../i18n/ka.js';
import { STRINGS_VI } from '../i18n/vi.js';
import { STRINGS_ES } from '../i18n/es.js';
import { STRINGS_PT } from '../i18n/pt.js';
import { STRINGS_TH } from '../i18n/th.js';
import { STRINGS_UK } from '../i18n/uk.js';

describe('resolveExpectedChainId — pure chainId mapping', () => {
  it('arc-testnet resolves to 5042002', () => {
    expect(resolveExpectedChainId('arc-testnet')).toBe(5042002);
  });

  it('arc-mainnet resolves to 5042 (chainId is known even though contract addresses are not)', () => {
    expect(resolveExpectedChainId('arc-mainnet')).toBe(5042);
  });

  it('unsupported network name fails closed', () => {
    expect(() => resolveExpectedChainId('arbitrum-sepolia')).toThrow(NetworkConfigError);
    expect(() => resolveExpectedChainId('mainnet')).toThrow(NetworkConfigError);
    expect(() => resolveExpectedChainId(undefined)).toThrow(NetworkConfigError);
  });

  it('testnet and mainnet never resolve to the same chainId', () => {
    expect(NETWORK_CHAIN_IDS['arc-testnet']).not.toBe(NETWORK_CHAIN_IDS['arc-mainnet']);
  });
});

describe('resolveNetworkConfig — full runtime config (RPC/addresses/Circle)', () => {
  it('arc-testnet has a verified full config', () => {
    const cfg = resolveNetworkConfig('arc-testnet');
    expect(cfg.escrowAddress).toBe('0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8');
    expect(cfg.usdcAddress).toBe('0x3600000000000000000000000000000000000000');
  });

  it('arc-mainnet has a verified full config (TASK 10A)', () => {
    const cfg = resolveNetworkConfig('arc-mainnet');
    expect(cfg.escrowAddress).toBe('0x06A2b584278f519ba7562c8ac27f4A5C31d52103');
    expect(cfg.propdepAddress).toBe('0x55dDa2FD8C37383E33DF32b15EED978Ac6B91532');
    expect(cfg.usdcAddress).toBe('0x3600000000000000000000000000000000000000');
    expect(cfg.rpcUrl).toBe('https://rpc.mainnet.arc.io');
    expect(cfg.blockExplorerUrl).toBe('https://explorer.arc.io');
    expect(cfg.chainIdHex).toBe('0x13b2'); // 5042
  });

  it('mainnet config never leaks a testnet address, and vice versa — regression guard for the exact failure mode this whole task is about', () => {
    const testnetCfg = NETWORK_CONFIGS['arc-testnet'];
    const mainnetCfg = NETWORK_CONFIGS['arc-mainnet'];
    expect(mainnetCfg).toBeDefined();
    expect(mainnetCfg.escrowAddress.toLowerCase()).not.toBe(testnetCfg.escrowAddress.toLowerCase());
    expect(mainnetCfg.propdepAddress.toLowerCase()).not.toBe(testnetCfg.propdepAddress.toLowerCase());
    expect(mainnetCfg.rpcUrl).not.toBe(testnetCfg.rpcUrl);
    expect(mainnetCfg.blockExplorerUrl).not.toBe(testnetCfg.blockExplorerUrl);
    // USDC is intentionally the same literal address on both networks (Arc's
    // native USDC precompile lives at the same address on every Arc chain) —
    // not a leak, a verified protocol-level fact.
    expect(mainnetCfg.usdcAddress).toBe(testnetCfg.usdcAddress);
  });

  it('mainnet Circle support is independently confirmed (TASK 10AO/10AS), not merely assumed', () => {
    expect(NETWORK_CONFIGS['arc-mainnet'].circleSupported).toBe(true);
  });

  it('unsupported network name fails before even checking address availability', () => {
    expect(() => resolveNetworkConfig('bogus')).toThrow(NetworkConfigError);
  });

  it('a missing production VITE_NETWORK (empty string, e.g. an omitted Docker build ARG) fails closed — never silently defaults to Testnet or Mainnet', () => {
    expect(() => resolveExpectedChainId('')).toThrow(NetworkConfigError);
    expect(() => resolveNetworkConfig('')).toThrow(NetworkConfigError);
  });
});

describe('resolveOtherNetworkLink — cross-environment navigation (TASK 10A-REVISION)', () => {
  it('Testnet UI links to Mainnet (https://my.pi2pi.io)', () => {
    expect(resolveOtherNetworkLink('arc-testnet')).toEqual({ url: 'https://my.pi2pi.io', label: 'Mainnet' });
  });

  it('Mainnet UI links to Testnet (https://testnet.pi2pi.io)', () => {
    expect(resolveOtherNetworkLink('arc-mainnet')).toEqual({ url: 'https://testnet.pi2pi.io', label: 'Testnet' });
  });

  it('unknown networks get no cross-link — no hardcoded assumption about which environment is current', () => {
    expect(resolveOtherNetworkLink('bogus')).toBeNull();
    expect(resolveOtherNetworkLink(undefined)).toBeNull();
  });
});

describe('isCircleSupported — the actual gate used by wallet.js', () => {
  it('arc-testnet has verified Circle configuration', () => {
    expect(isCircleSupported('arc-testnet')).toBe(true);
  });

  it('arc-mainnet has verified Circle configuration (TASK 10AS)', () => {
    expect(isCircleSupported('arc-mainnet')).toBe(true);
  });

  it('unknown network names are never treated as Circle-supported', () => {
    expect(isCircleSupported('bogus')).toBe(false);
    expect(isCircleSupported(undefined)).toBe(false);
  });
});

describe('active build configuration (VITE_NETWORK=arc-testnet in this test env)', () => {
  it('resolves the active network to arc-testnet', () => {
    expect(ACTIVE_NETWORK_NAME).toBe('arc-testnet');
    expect(ACTIVE_CHAIN_ID_DEC).toBe(5042002);
  });

  it('ARC_TESTNET_CHAIN and ESCROW_ADDRESS reflect the active (testnet) config', () => {
    expect(ARC_TESTNET_CHAIN.chainId).toBe('0x4cef52');
    expect(ESCROW_ADDRESS).toBe('0x728FF16De0d6DfCAA1A8e7ed2FF95D9cB49663C8');
  });

  it('RPC_URL/EXPLORER_BASE_URL (TASK 10A) reflect the active (testnet) config, not a hardcoded literal', () => {
    expect(RPC_URL).toBe('https://rpc.testnet.arc.network');
    expect(EXPLORER_BASE_URL).toBe('https://testnet.arcscan.app');
  });

  it('OTHER_NETWORK_APP_URL/LABEL (TASK 10A) point at Mainnet while running on Testnet', () => {
    expect(OTHER_NETWORK_APP_URL).toBe('https://my.pi2pi.io');
    expect(OTHER_NETWORK_LABEL).toBe('Mainnet');
  });
});

describe('wallet modal "Connect your wallet · {network}" label (TASK 10M)', () => {
  // TASK 10M: this string used to hardcode "· Arc Testnet" directly into
  // every language's translation, in all 8 files — a second, stale source
  // of truth independent of ARC_TESTNET_CHAIN.chainName (the same value the
  // modal's MetaMask row already used correctly). Fixed by templating the
  // string with a {network} placeholder and passing
  // ARC_TESTNET_CHAIN.chainName in at render time (WalletModal.jsx).

  it('active (testnet) build: t() resolves to "Arc Testnet" via the real ARC_TESTNET_CHAIN.chainName value', () => {
    expect(ARC_TESTNET_CHAIN.chainName).toBe('Arc Testnet');
    expect(t('body.connect_wallet', { network: ARC_TESTNET_CHAIN.chainName })).toBe('Connect your wallet · Arc Testnet');
  });

  it('interpolation is build-agnostic: passing "Arc Mainnet" (what ARC_TESTNET_CHAIN.chainName resolves to under an arc-mainnet build) renders correctly', () => {
    // Proves both environments render the correct label without needing two
    // separate builds in the same test run — t()'s {network} substitution
    // doesn't know or care which network is active, only what it's given,
    // and ARC_TESTNET_CHAIN.chainName is exactly what changes per build
    // (verified directly for arc-mainnet in helpers.test.js/build output —
    // see resolveNetworkConfig('arc-mainnet') below, which is untouched by
    // which network this test file's own build happens to be running under).
    expect(resolveNetworkConfig('arc-mainnet').chainName).toBe('Arc Mainnet');
    expect(t('body.connect_wallet', { network: 'Arc Mainnet' })).toBe('Connect your wallet · Arc Mainnet');
  });

  it('every language\'s raw template uses the {network} placeholder, never a hardcoded "Arc Testnet"/"Arc Mainnet" literal', () => {
    const allLangs = { en: STRINGS_EN, ru: STRINGS_RU, ka: STRINGS_KA, vi: STRINGS_VI, es: STRINGS_ES, pt: STRINGS_PT, th: STRINGS_TH, uk: STRINGS_UK };
    for (const [code, strings] of Object.entries(allLangs)) {
      const raw = strings['body.connect_wallet'];
      expect(raw, `${code}: body.connect_wallet is missing`).toBeTruthy();
      expect(raw, `${code}: body.connect_wallet must use the {network} placeholder`).toMatch(/\{network\}/);
      expect(raw, `${code}: body.connect_wallet must not hardcode "Arc Testnet"`).not.toMatch(/Arc Testnet/);
      expect(raw, `${code}: body.connect_wallet must not hardcode "Arc Mainnet"`).not.toMatch(/Arc Mainnet/);
    }
  });

  it('t() with no params falls back to leaving {network} unresolved rather than throwing (regression guard for missing param)', () => {
    // Documents current t() behavior so a future caller that forgets to
    // pass `network` fails loudly/visibly (a literal "{network}" in the UI)
    // rather than silently, matching how every other {param} key in this
    // codebase already behaves.
    expect(() => t('body.connect_wallet')).not.toThrow();
    expect(t('body.connect_wallet')).toContain('{network}');
  });
});

describe('ACTIVE_NETWORK_APP_URL (TASK 10P)', () => {
  // TASK 10O audit found MyListingsPage.jsx/MyIntentPage.jsx hardcoding
  // "https://my.pi2pi.io" directly into share links regardless of which
  // network was active — a real, already-live bug (a Mainnet user sharing
  // a listing generated a link to the Testnet domain). This is the single
  // authoritative replacement, the mirror image of the already-tested
  // OTHER_NETWORK_APP_URL.

  it('arc-testnet resolves to https://testnet.pi2pi.io', () => {
    expect(resolveActiveNetworkAppUrl('arc-testnet')).toBe('https://testnet.pi2pi.io');
  });

  it('arc-mainnet resolves to https://my.pi2pi.io', () => {
    expect(resolveActiveNetworkAppUrl('arc-mainnet')).toBe('https://my.pi2pi.io');
  });

  it('unknown network has no configured app URL', () => {
    expect(resolveActiveNetworkAppUrl('bogus')).toBeNull();
    expect(resolveActiveNetworkAppUrl(undefined)).toBeNull();
  });

  it('active build configuration (VITE_NETWORK=arc-testnet in this test env): ACTIVE_NETWORK_APP_URL matches, and is never the Mainnet domain', () => {
    expect(ACTIVE_NETWORK_APP_URL).toBe('https://testnet.pi2pi.io');
    expect(ACTIVE_NETWORK_APP_URL).not.toBe('https://my.pi2pi.io');
  });

  it('ACTIVE_NETWORK_APP_URL and OTHER_NETWORK_APP_URL are always different domains, and each network\'s ACTIVE equals the other\'s OTHER (consistency check across both directions)', () => {
    expect(resolveActiveNetworkAppUrl('arc-testnet')).toBe(resolveOtherNetworkLink('arc-mainnet').url);
    expect(resolveActiveNetworkAppUrl('arc-mainnet')).toBe(resolveOtherNetworkLink('arc-testnet').url);
    expect(resolveActiveNetworkAppUrl('arc-testnet')).not.toBe(resolveActiveNetworkAppUrl('arc-mainnet'));
  });
});

describe('share links use ACTIVE_NETWORK_APP_URL, not a hardcoded domain (TASK 10O/10P)', () => {
  const dir = join(process.cwd(), 'src/components');

  it('MyListingsPage.jsx imports ACTIVE_NETWORK_APP_URL and its share link uses it, with no hardcoded my.pi2pi.io literal remaining', () => {
    const src = readFileSync(join(dir, 'MyListingsPage.jsx'), 'utf8');
    expect(src).toMatch(/import\s*\{\s*ACTIVE_NETWORK_APP_URL\s*\}\s*from\s*['"]\.\.\/helpers\.js['"]/);
    expect(src).toMatch(/\$\{ACTIVE_NETWORK_APP_URL\}\/#\/listing\/real-/);
    expect(src).not.toMatch(/https:\/\/my\.pi2pi\.io/);
  });

  it('MyIntentPage.jsx imports ACTIVE_NETWORK_APP_URL and its share link uses it, with no hardcoded my.pi2pi.io literal remaining', () => {
    const src = readFileSync(join(dir, 'MyIntentPage.jsx'), 'utf8');
    expect(src).toMatch(/import\s*\{\s*ACTIVE_NETWORK_APP_URL\s*\}\s*from\s*['"]\.\.\/helpers\.js['"]/);
    expect(src).toMatch(/\$\{ACTIVE_NETWORK_APP_URL\}\/#\/tenant\//);
    expect(src).not.toMatch(/https:\/\/my\.pi2pi\.io/);
  });
});
