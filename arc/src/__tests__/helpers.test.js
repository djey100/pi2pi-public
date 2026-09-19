// Level 2: Pure function unit tests — helpers.js
import { describe, it, expect } from 'vitest';
import {
  fmtCountdown, parseAgreement, parsePropDep,
  getDealView, getNextStep, getDealActions,
  extractRevertReason, mapRevertReason, REVERT_MAP, NETWORK_RE,
  encAddr, encUint, toDecAgreementId,
  ESCROW_ADDRESS, PROPDEP_ADDRESS, USDC_ADDRESS, CONTRACT_VERSION,
} from '../helpers.js';

// ─── fmtCountdown ────────────────────────────────────────────────────────────
describe('fmtCountdown', () => {
  it('returns empty for null/NaN', () => {
    expect(fmtCountdown(null)).toBe('');
    expect(fmtCountdown(undefined)).toBe('');
    expect(fmtCountdown(NaN)).toBe('');
  });
  it('returns expired for ≤0', () => {
    expect(fmtCountdown(0)).toBe('expired');
    expect(fmtCountdown(-100)).toBe('expired');
  });
  it('formats days + hours', () => {
    expect(fmtCountdown(86400 + 3600)).toBe('1d 1h');
    expect(fmtCountdown(86400 * 3)).toBe('3d 0h');
  });
  it('formats hours + minutes', () => {
    expect(fmtCountdown(3600 + 120)).toBe('1h 2m');
  });
  it('formats minutes only', () => {
    expect(fmtCountdown(300)).toBe('5m');
    expect(fmtCountdown(59)).toBe('0m');
  });
});

// ─── parseAgreement ──────────────────────────────────────────────────────────
describe('parseAgreement', () => {
  // Build a fake hex: 36 words of 64 hex chars each (72 chars per word with 0x prefix)
  // Word layout: 0=tenant, 1=landlord, 2=rent(6dec), 3=commitDep, ... 10=state
  const buildHex = (words) => {
    const parts = [];
    for (let i = 0; i < 36; i++) {
      if (words[i] !== undefined) {
        parts.push(String(words[i]).padStart(64, '0'));
      } else {
        parts.push('0'.repeat(64));
      }
    }
    return '0x' + parts.join('');
  };

  it('parses state correctly', () => {
    const hex = buildHex({ 10: '3' }); // state = 3 (Active)
    const agr = parseAgreement(hex);
    expect(agr.state).toBe(3);
  });

  it('parses rent with 6 decimals', () => {
    // rent = 1500 USDC = 1500000000 in 6 decimals
    const rentHex = (1500 * 1e6).toString(16);
    const hex = buildHex({ 2: rentHex });
    const agr = parseAgreement(hex);
    expect(agr.rent).toBe(1500);
  });

  it('parses tenant address', () => {
    const addr = 'abcdef1234567890abcdef1234567890abcdef12';
    const hex = buildHex({ 0: addr.padStart(64, '0') });
    const agr = parseAgreement(hex);
    expect(agr.tenant).toBe('0x' + addr);
  });

  it('returns frozen object', () => {
    const hex = buildHex({});
    const agr = parseAgreement(hex);
    expect(() => { agr.state = 99; }).toThrow();
  });
});

// ─── parsePropDep ────────────────────────────────────────────────────────────
describe('parsePropDep', () => {
  it('parses state and amount', () => {
    const words = {};
    words[3] = (2000 * 1e6).toString(16); // amount = 2000 USDC
    words[4] = '1'; // state = Active
    const parts = [];
    for (let i = 0; i < 16; i++) {
      parts.push((words[i] || '').padStart(64, '0'));
    }
    const hex = '0x' + parts.join('');
    const pd = parsePropDep(hex);
    expect(pd.state).toBe(1);
    expect(pd.amount).toBe(2000);
    expect(pd.freezeDuration).toBe(60 * 86400); // hardcoded 60 days
  });
});

// ─── getDealView ─────────────────────────────────────────────────────────────
describe('getDealView', () => {
  const now = Date.now();

  it('returns loading for null agrData', () => {
    const v = getDealView(null, null, now);
    expect(v.state).toBe('loading');
  });

  it('returns dispute for state 7', () => {
    const v = getDealView({ state: 7, freezeStart: 0, freezeDuration: 0 }, null, now);
    expect(v.state).toBe('dispute');
    expect(v.tone).toBe('danger');
  });

  it('returns active for state 3 with far lease end', () => {
    const farFuture = Math.floor(now / 1000) + 86400 * 90;
    const v = getDealView({
      state: 3, activatedAt: Math.floor(now / 1000) - 86400 * 10, leaseEnd: farFuture,
      freezeStart: 0, freezeDuration: 0,
    }, null, now);
    expect(v.state).toBe('active');
    expect(v.tone).toBe('success');
  });

  it('returns ending for state 3 with ≤14 days left', () => {
    const soonEnd = Math.floor(now / 1000) + 86400 * 7;
    const v = getDealView({
      state: 3, activatedAt: Math.floor(now / 1000) - 86400 * 170, leaseEnd: soonEnd,
      freezeStart: 0, freezeDuration: 0,
    }, null, now);
    expect(v.state).toBe('ending');
    expect(v.tone).toBe('warning');
  });

  it('returns settled for state 8', () => {
    const v = getDealView({ state: 8, leaseEnd: 0, activatedAt: 0, freezeStart: 0, freezeDuration: 0 }, null, now);
    expect(v.state).toBe('settled');
  });

  it('returns provisional for state 0 (Created)', () => {
    const v = getDealView({ state: 0, leaseEnd: 0, activatedAt: 0, freezeStart: 0, freezeDuration: 0 }, null, now);
    expect(v.state).toBe('provisional');
  });

  it('returns et-proposed for state 4', () => {
    const v = getDealView({ state: 4, leaseEnd: 0, activatedAt: 0, freezeStart: 0, freezeDuration: 0 }, null, now);
    expect(v.state).toBe('et-proposed');
  });

  it('returns propdep-claimed when PropDep state=2', () => {
    const v = getDealView({ state: 3, leaseEnd: 0, activatedAt: 0, freezeStart: 0, freezeDuration: 0 }, { state: 2 }, now);
    expect(v.state).toBe('propdep-claimed');
    expect(v.tone).toBe('danger');
  });

  it('returns propdep-frozen when PropDep state=4', () => {
    const v = getDealView(
      { state: 3, leaseEnd: 0, activatedAt: 0, freezeStart: 0, freezeDuration: 0 },
      { state: 4, freezeStart: 0, freezeDuration: 0 },
      now
    );
    expect(v.state).toBe('propdep-frozen');
  });

  it('PropDep frozen overrides active state', () => {
    const farFuture = Math.floor(now / 1000) + 86400 * 90;
    const v = getDealView(
      { state: 3, activatedAt: Math.floor(now / 1000) - 86400, leaseEnd: farFuture, freezeStart: 0, freezeDuration: 0 },
      { state: 4, freezeStart: Math.floor(now / 1000), freezeDuration: 60 * 86400 },
      now
    );
    expect(v.state).toBe('propdep-frozen');
  });
});

// ─── getDealActions — flagRentMissed visibility (TASK 10BF) ─────────────────
// Regression coverage for the landlord flagRentMissed button's visibility
// condition, closing a previously-missing test gap (TASK 10BE's audit found
// getDealActions was imported but never directly exercised by any test).
// All nowMs values below are deterministic fixed timestamps — never
// Date.now() — so these tests can never flake based on wall-clock time.
describe('getDealActions — flagRentMissed visibility and grace extension', () => {
  const DAY = 86400;
  const RENT_PERIOD = 30 * DAY;
  const GRACE = 3 * DAY; // must match RentalEscrow.RENT_GRACE_PERIOD
  const activatedAtSec = 1_700_000_000; // fixed arbitrary epoch seconds, rentsPaid=0
  const nextDueSec = activatedAtSec + RENT_PERIOD; // (rentsPaid=0 + 1) * RENT_PERIOD
  const leaseEndSec = activatedAtSec + 6 * RENT_PERIOD; // far future — never expired in these tests

  const baseAgreement = (overrides = {}) => ({
    state: 3,
    activatedAt: activatedAtSec,
    rentPayments: 0,
    leaseEnd: leaseEndSec,
    rentGraceExtension: 0,
    firstRentPaid: true,
    leaseDurationMonths: 6,
    ...overrides,
  });

  const hasFlagRentMissed = (actions) => actions.some((a) => a.id === 'flagRentMissed');

  it('A. landlord + rent genuinely overdue (past base grace, no extension) → flagRentMissed present', () => {
    const nowMs = (nextDueSec + GRACE + 1) * 1000; // 1s past the unextended deadline
    const actions = getDealActions(null, 'landlord', baseAgreement(), null, null, nowMs);
    expect(hasFlagRentMissed(actions)).toBe(true);
  });

  it('B. landlord + rent not overdue (still within base grace) → flagRentMissed absent', () => {
    const nowMs = (nextDueSec + GRACE - 1) * 1000; // 1s before the unextended deadline
    const actions = getDealActions(null, 'landlord', baseAgreement(), null, null, nowMs);
    expect(hasFlagRentMissed(actions)).toBe(false);
  });

  it('C. landlord + would be overdue without extension, but rentGraceExtension keeps it inside the allowed period → flagRentMissed absent', () => {
    const ext = 5 * DAY;
    // 2 days past the UNEXTENDED deadline — would be overdue with ext=0 (per case A/B),
    // but still 3 days short of the extended deadline (base GRACE + ext = 8 days total).
    const nowMs = (nextDueSec + GRACE + 2 * DAY) * 1000;
    const actions = getDealActions(null, 'landlord', baseAgreement({ rentGraceExtension: ext }), null, null, nowMs);
    expect(hasFlagRentMissed(actions)).toBe(false);
  });

  it('D. landlord + extended grace deadline passed → flagRentMissed present', () => {
    const ext = 5 * DAY;
    const nowMs = (nextDueSec + GRACE + ext + 1) * 1000; // 1s past the extended deadline
    const actions = getDealActions(null, 'landlord', baseAgreement({ rentGraceExtension: ext }), null, null, nowMs);
    expect(hasFlagRentMissed(actions)).toBe(true);
  });

  it('E. tenant + rent overdue → flagRentMissed absent (visibility is landlord-only regardless of overdue state)', () => {
    const nowMs = (nextDueSec + GRACE + 1) * 1000; // same genuinely-overdue instant as case A
    const actions = getDealActions(null, 'tenant', baseAgreement(), null, null, nowMs);
    expect(hasFlagRentMissed(actions)).toBe(false);
  });
});

// ─── extractRevertReason ─────────────────────────────────────────────────────
describe('extractRevertReason', () => {
  it('returns empty for null/undefined', () => {
    expect(extractRevertReason(null)).toBe('');
    expect(extractRevertReason(undefined)).toBe('');
  });
  it('returns string as-is', () => {
    expect(extractRevertReason('Wrong state')).toBe('Wrong state');
  });
  it('extracts from Error object', () => {
    expect(extractRevertReason(new Error('Not tenant'))).toBe('Not tenant');
  });
  it('extracts from nested MetaMask error', () => {
    expect(extractRevertReason({ data: { message: 'execution reverted: Not active' } }))
      .toBe('execution reverted: Not active');
  });
  it('extracts from ethers v6 shortMessage', () => {
    expect(extractRevertReason({ shortMessage: 'call revert exception' }))
      .toBe('call revert exception');
  });
});

// ─── NETWORK_RE ──────────────────────────────────────────────────────────────
describe('NETWORK_RE', () => {
  it('matches ECONNREFUSED', () => {
    expect(NETWORK_RE.test('Error: connect ECONNREFUSED 127.0.0.1:8545')).toBe(true);
  });
  it('matches fetch failed', () => {
    expect(NETWORK_RE.test('TypeError: fetch failed')).toBe(true);
  });
  it('does NOT match contract revert strings', () => {
    expect(NETWORK_RE.test('Not tenant')).toBe(false);
    expect(NETWORK_RE.test('Wrong state')).toBe(false);
    expect(NETWORK_RE.test('Already deposited')).toBe(false);
  });
});

// ─── encAddr / encUint ───────────────────────────────────────────────────────
describe('encoding helpers', () => {
  it('encAddr pads to 64 chars', () => {
    const result = encAddr('0xAbC123');
    expect(result.length).toBe(64);
    expect(result).toMatch(/^0+abc123$/);
  });
  it('encUint pads to 64 chars', () => {
    const result = encUint(255);
    expect(result.length).toBe(64);
    expect(result.endsWith('ff')).toBe(true);
  });
  it('encUint handles large numbers', () => {
    const result = encUint(1500000000n);
    expect(result.length).toBe(64);
  });
});

// ─── toDecAgreementId ────────────────────────────────────────────────────────
describe('toDecAgreementId', () => {
  it('converts hex to decimal string', () => {
    expect(toDecAgreementId('0x0a')).toBe('10');
  });
  it('handles already-decimal input', () => {
    const result = toDecAgreementId(5);
    expect(result).toBe('5');
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────
describe('Constants', () => {
  it('ESCROW_ADDRESS is a valid address', () => {
    expect(ESCROW_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
  it('PROPDEP_ADDRESS is a valid address', () => {
    expect(PROPDEP_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
  it('USDC_ADDRESS is a valid address', () => {
    expect(USDC_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
  it('CONTRACT_VERSION is a positive integer', () => {
    expect(CONTRACT_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(CONTRACT_VERSION)).toBe(true);
  });
});

// ─── i18n ────────────────────────────────────────────────────────────────────
describe('i18n', () => {
  it('t() returns key for missing translations', async () => {
    const { t } = await import('../i18n/index.js');
    expect(t('nonexistent.key.xyz')).toBe('nonexistent.key.xyz');
  });
  it('t() interpolates params', async () => {
    const { t, STRINGS } = await import('../i18n/index.js');
    // Find a key with {param} pattern
    const result = t('deal.ending', { days: 5, dayWord: 'days' });
    expect(result).not.toBe('deal.ending'); // should be translated
  });
  it('all supported languages have same key count (±5%)', async () => {
    const { STRINGS } = await import('../i18n/index.js');
    const enCount = Object.keys(STRINGS.en).length;
    for (const [lang, dict] of Object.entries(STRINGS)) {
      const count = Object.keys(dict).length;
      const ratio = count / enCount;
      expect(ratio, `${lang} has ${count} keys vs EN ${enCount}`).toBeGreaterThan(0.95);
    }
  });
});
