// Structural verification for TASK 10AS: wallet.js's Circle modular
// transport path and defineChain "testnet" flag are network-aware
// (ACTIVE_NETWORK_NAME-driven), not hardcoded to Testnet.
//
// This logic lives inside _ensureCircleClientsInitialized(), an internal
// method that lazily loads the real @circle-fin/modular-wallets-core SDK
// and constructs live viem clients — calling it directly in a unit test
// would require mocking the entire SDK initialization chain for very
// little added confidence over a structural check. The authoritative,
// stronger verification already performed manually (TASK 10AS) was at the
// built-artifact level: grepping the actual minified VITE_NETWORK=arc-mainnet
// and VITE_NETWORK=arc-testnet bundles confirmed the ternary below resolves
// to exactly "/arc" (mainnet build) or "/arcTestnet" (testnet build) with
// no cross-contamination — this file is the fast, repeatable regression
// guard for the same source logic, following the same structural-test
// convention already used elsewhere in this suite for comparable cases
// (app-numeric-mock-listing-routing.test.jsx, domain-hostname-scoping.test.js).

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const WALLET_SRC = readFileSync(join(process.cwd(), "src", "wallet.js"), "utf8");
const PACKAGE_JSON = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

describe("wallet.js — Circle transport path and defineChain are network-aware (TASK 10AS)", () => {
  it("chainPathSegment picks /arc on arc-mainnet, /arcTestnet otherwise", () => {
    expect(WALLET_SRC).toMatch(
      /const chainPathSegment = ACTIVE_NETWORK_NAME === "arc-mainnet" \? "\/arc" : "\/arcTestnet";/
    );
  });

  it("Circle's defineChain testnet flag is derived from ACTIVE_NETWORK_NAME, not hardcoded", () => {
    const idx = WALLET_SRC.indexOf("const arcTestnet = defineChain({");
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = WALLET_SRC.slice(idx, idx + 500);
    expect(block).toMatch(/testnet: ACTIVE_NETWORK_NAME !== "arc-mainnet",/);
    // Regression guard: the old unconditional `testnet: true,` must not have come back.
    expect(block).not.toMatch(/testnet: true,/);
  });

  it("no leftover hardcoded '/arcTestnet' string outside the network-aware ternary itself", () => {
    const literalOccurrences = WALLET_SRC.match(/["'`]\/arcTestnet["'`]/g) || [];
    // Exactly one: inside the chainPathSegment ternary checked above.
    expect(literalOccurrences.length).toBe(1);
  });
});

describe("package.json — Circle SDK version (TASK 10AS)", () => {
  it("@circle-fin/modular-wallets-core is pinned to 1.0.16 (was 1.0.13)", () => {
    expect(PACKAGE_JSON.dependencies["@circle-fin/modular-wallets-core"]).toBe("^1.0.16");
  });
});
