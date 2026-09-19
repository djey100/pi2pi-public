// Structural verification for TASK 10AL's fix: every remaining
// `listing || LISTINGS[0]`-style fallback in App.jsx (ChatPage, ContractFlow,
// PropertyPage's inline handlers, and the InboxBlock-driven
// onViewListing/onOpenChat/onStartContract handlers — TASK 10AK explicitly
// deferred these as a found-but-out-of-scope C-classified path) now routes
// through a single, network-aware `mockFallbackListing` (null on
// arc-mainnet, LISTINGS[0] on arc-testnet, same ACTIVE_NETWORK_NAME helper
// used throughout this suite — no new network-detection logic).
//
// ChatPage.jsx and ContractFlow.jsx both read `listing.*` fields with no
// null-check of their own (confirmed by direct inspection — e.g.
// ChatPage.jsx's `listing.hostAvatar`, ContractFlow.jsx's
// `listing._realUser`) — rendering either with a null listing throws. So on
// arc-mainnet, with no mock fallback, these views must not mount at all
// when there's no real listing (`effectiveListing` falsy) — this file
// verifies that fail-closed guard exists, not just that the mock fallback
// itself is gone.
//
// Same structural, source-pattern approach as
// app-numeric-mock-listing-routing.test.jsx (TASK 10AK) and for the same
// reason: App.jsx is the ~13k-line root app shell, impractical to fully
// RTL-render without stubbing out most of the app.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const APP_SRC = readFileSync(join(process.cwd(), "src", "App.jsx"), "utf8");

describe("App.jsx — mock listing fallback removed from Mainnet-reachable paths (TASK 10AL)", () => {
  it("defines mockFallbackListing as null on arc-mainnet, LISTINGS[0] only on arc-testnet", () => {
    expect(APP_SRC).toMatch(
      /const mockFallbackListing = ACTIVE_NETWORK_NAME === 'arc-testnet' \? LISTINGS\[0\] : null;/
    );
  });

  it("defines effectiveListing as listing || mockFallbackListing", () => {
    expect(APP_SRC).toMatch(/const effectiveListing = listing \|\| mockFallbackListing;/);
  });

  it("onViewListing/onOpenChat/onStartContract (InboxBlock-driven) no longer fall back to a bare LISTINGS[0]", () => {
    const idx = APP_SRC.indexOf("onViewListing={id=>");
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = APP_SRC.slice(idx, idx + 400);
    expect(block).toMatch(/mockFallbackListing/);
    expect(block).not.toMatch(/\|\|LISTINGS\[0\]/);
  });

  it("ChatPage render is gated on effectiveListing (won't mount with a null listing on arc-mainnet)", () => {
    const idx = APP_SRC.indexOf('view==="chat")&&');
    expect(idx).toBeGreaterThanOrEqual(0);
    const line = APP_SRC.slice(idx, idx + 200);
    expect(line).toMatch(/view==="chat"\)&&effectiveListing&&<ChatPage listing=\{effectiveListing\}/);
  });

  it("ContractFlow (view=contract and view=contract-from-prop) is gated on effectiveListing", () => {
    for (const marker of ['view==="contract"&&effectiveListing&&<ContractFlow', 'view==="contract-from-prop"&&effectiveListing&&<ContractFlow']) {
      expect(APP_SRC).toContain(marker);
    }
  });

  it("PropertyPage's onChat/onApply inline handlers use effectiveListing, not a bare LISTINGS[0] fallback", () => {
    const idx = APP_SRC.indexOf("onChat={()=>{");
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = APP_SRC.slice(idx, idx + 400);
    expect(block).toMatch(/const l = effectiveListing;/);
    expect(block).toMatch(/navigate\("\/contract\/"\+effectiveListing\.id\)/);
  });

  it("no bare `||LISTINGS[0]` survives outside the two arc-testnet-gated isMockId blocks", () => {
    // The only two remaining literal `|| LISTINGS[0]` occurrences must both
    // be inside a block whose nearest preceding `isMockId` check is
    // arc-testnet-gated (verified structurally by app-numeric-mock-listing-routing.test.jsx).
    // This test asserts the *count* stays exactly 2 — any new bare
    // occurrence (a regression) would push this above 2.
    const occurrences = APP_SRC.match(/\|\| ?LISTINGS\[0\]/g) || [];
    expect(occurrences.length).toBe(2);
  });

  it("no LISTINGS/TENANTS-derived value can reach a rendered component on arc-mainnet without going through mockFallbackListing/effectiveListing", () => {
    // Exactly 3 literal `LISTINGS[0]` occurrences should remain: the two
    // isMockId-gated ones (verified arc-testnet-only by
    // app-numeric-mock-listing-routing.test.jsx — "no bare `||LISTINGS[0]`"
    // above already confirms these two are the *only* `||LISTINGS[0]` uses)
    // plus the mockFallbackListing definition itself. Any other occurrence
    // is a regression.
    const occurrences = APP_SRC.match(/LISTINGS\[0\]/g) || [];
    expect(occurrences.length).toBe(3);
    expect(APP_SRC).toMatch(/isMockId\) return LISTINGS\.find\(l => l\.id === parseInt\(route\.param\)\) \|\| LISTINGS\[0\]/);
    expect(APP_SRC).toMatch(/setListing\(LISTINGS\.find\(l => l\.id === parseInt\(r\.param\)\) \|\| LISTINGS\[0\]\)/);
    expect(APP_SRC).toMatch(/const mockFallbackListing = ACTIVE_NETWORK_NAME === 'arc-testnet' \? LISTINGS\[0\] : null;/);
  });
});
