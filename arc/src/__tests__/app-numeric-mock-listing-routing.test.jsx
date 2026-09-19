// Structural verification for TASK 10AK's fix: numeric-ID deep links
// (e.g. /listing/0) only resolve to a mocks.js LISTINGS entry on
// arc-testnet. On arc-mainnet, a numeric route.param must fall through to
// the same "not found" path a bad/unknown real UUID already takes (App.jsx
// never had dedicated not-found UI for that case — listing stays null and
// the relevant view simply doesn't render — TASK 10AK deliberately reuses
// that existing behavior rather than inventing new UI).
//
// App.jsx is the ~13k-line root app shell (routing, wallet init, dozens of
// child components) — a full React Testing Library render+navigate test
// would need to stub out nearly the entire app surface to avoid unrelated
// crashes, for very little added confidence over directly verifying the
// three call sites that changed. This follows the same structural
// source-pattern style already used in this suite for comparable cases
// (see domain-hostname-scoping.test.js) rather than a component render.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const APP_SRC = readFileSync(join(process.cwd(), "src", "App.jsx"), "utf8");

describe("App.jsx — numeric mock listing routing gated by ACTIVE_NETWORK_NAME (TASK 10AK)", () => {
  it("imports ACTIVE_NETWORK_NAME from helpers.js", () => {
    expect(APP_SRC).toMatch(/ACTIVE_NETWORK_NAME/);
    expect(APP_SRC).toMatch(/from '\.\/helpers\.js'/);
  });

  it("useState(listing) initializer: numeric mock id only resolves on arc-testnet", () => {
    const idx = APP_SRC.indexOf("const [listing, setListing] = useState(() => {");
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = APP_SRC.slice(idx, idx + 700);
    expect(block).toMatch(/const isMockId = ACTIVE_NETWORK_NAME === 'arc-testnet' && \/\^\\d\+\$\/\.test\(route\.param\);/);
    // Regression guard: the old unconditional form must not have come back.
    expect(block).not.toMatch(/const isMockId = \/\^\\d\+\$\/\.test\(route\.param\);/);
  });

  it("URL-sync effect: numeric mock id only resolves on arc-testnet (same gate as the initializer)", () => {
    const idx = APP_SRC.indexOf('if (r.view === "prop" || r.view === "chat" || r.view === "contract")');
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = APP_SRC.slice(idx, idx + 400);
    expect(block).toMatch(/const isMockId = ACTIVE_NETWORK_NAME === 'arc-testnet' && \/\^\\d\+\$\/\.test\(r\.param\);/);
    expect(block).not.toMatch(/const isMockId = \/\^\\d\+\$\/\.test\(r\.param\);/);
  });

  it("PropertyPage render condition: numeric route.param only bypasses the null-listing guard on arc-testnet", () => {
    // TASK 10AL added an additional `effectiveListing&&` guard ahead of this
    // same condition — search for the stable inner fragment rather than the
    // exact start-of-condition string, which changed.
    const idx = APP_SRC.indexOf('(listing||!route.param||');
    expect(idx).toBeGreaterThanOrEqual(0);
    const line = APP_SRC.slice(idx, idx + 200);
    expect(line).toMatch(/\(ACTIVE_NETWORK_NAME==='arc-testnet'&&\/\^\\d\+\$\/\.test\(route\.param\)\)/);
    // Regression guard: plain unconditional numeric test must not have come back.
    expect(line).not.toMatch(/\(listing\|\|!route\.param\|\|\/\^\\d\+\$\/\.test\(route\.param\)\)&&/);
  });

  it("all three numeric-mock-id gates check arc-testnet specifically, never arc-mainnet (fail-closed direction)", () => {
    const occurrences = APP_SRC.match(/ACTIVE_NETWORK_NAME\s*===?\s*'arc-testnet'/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
    expect(APP_SRC).not.toMatch(/isMockId[\s\S]{0,80}ACTIVE_NETWORK_NAME\s*===?\s*'arc-mainnet'/);
  });
});
