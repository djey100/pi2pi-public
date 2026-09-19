// Level 4: Characterization tests — verify cities and languages are consistent across all surfaces
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = (name) => readFileSync(resolve(__dirname, '..', name), 'utf-8');

describe('Level 4: Cities & Languages consistency', () => {
  const EXPECTED_CITIES_FULL = [
    'Tbilisi, Georgia', 'Batumi, Georgia',
    'Da Nang, Vietnam', 'Ho Chi Minh City, Vietnam', 'Nha Trang, Vietnam', 'Hanoi, Vietnam',
    'Buenos Aires, Argentina', 'São Paulo, Brazil',
    'Bangkok, Thailand', 'Samui, Thailand', 'Phuket, Thailand',
  ];

  const EXPECTED_CITIES_SHORT = [
    'Tbilisi', 'Batumi',
    'Da Nang', 'Ho Chi Minh City', 'Nha Trang', 'Hanoi',
    'Buenos Aires', 'São Paulo',
    'Bangkok', 'Samui', 'Phuket',
  ];

  const EXPECTED_LANG_CODES = ['en', 'ka', 'uk', 'vi', 'th', 'es', 'pt', 'ru'];

  it('LW_CITIES in wizard-config.js has all expected cities', () => {
    const src = readSrc('data/wizard-config.js');
    for (const city of EXPECTED_CITIES_FULL) {
      expect(src, `Missing city in LW_CITIES: ${city}`).toContain(`"${city}"`);
    }
  });

  it('mocks.js CITY_COORDS has all expected cities', () => {
    const src = readSrc('mocks.js');
    for (const city of EXPECTED_CITIES_FULL) {
      expect(src, `Missing city in CITY_COORDS: ${city}`).toContain(`"${city}"`);
    }
  });

  it('Dashboard.jsx feed/search filter has all expected cities (short names)', () => {
    const src = readSrc('components/Dashboard.jsx');
    for (const city of EXPECTED_CITIES_SHORT) {
      expect(src, `Missing city in feed filter: ${city}`).toContain(`value:"${city}"`);
    }
  });

  it('SUPPORTED_LANGS has all expected languages in correct order', async () => {
    const { SUPPORTED_LANGS } = await import('../i18n/index.js');
    const codes = SUPPORTED_LANGS.map(l => l.code);
    expect(codes).toEqual(EXPECTED_LANG_CODES);
  });

  it('STRINGS has all expected language keys', async () => {
    const { STRINGS } = await import('../i18n/index.js');
    for (const code of EXPECTED_LANG_CODES) {
      expect(STRINGS[code], `Missing STRINGS.${code}`).toBeDefined();
      expect(Object.keys(STRINGS[code]).length, `STRINGS.${code} is empty`).toBeGreaterThan(100);
    }
  });

  it('each city in LW_CITIES has at least 2 districts', () => {
    const src = readSrc('data/wizard-config.js');
    for (const city of EXPECTED_CITIES_FULL) {
      const cityEscaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`"${cityEscaped}":\\s*\\{[^}]*districts:\\s*\\[([^\\]]+)\\]`);
      const m = src.match(re);
      expect(m, `No districts found for ${city}`).toBeTruthy();
      if (m) {
        const districtCount = m[1].split(',').length;
        expect(districtCount, `${city} should have ≥2 districts`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('each city in LW_CITIES has centers with "Other" fallback', () => {
    const src = readSrc('data/wizard-config.js');
    for (const city of EXPECTED_CITIES_FULL) {
      const cityEscaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`"${cityEscaped}":\\s*\\{[^}]*centers:\\s*\\{([^}]+)\\}`);
      const m = src.match(re);
      expect(m, `No centers found for ${city}`).toBeTruthy();
      if (m) {
        expect(m[1], `${city} centers should include "Other"`).toContain('"Other"');
      }
    }
  });
});
