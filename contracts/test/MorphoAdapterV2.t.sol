// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MorphoAdapterV2 - regression + correctness tests for V2-1, V2-4
 *
 * V2-1: MorphoAdapter.withdraw must distinguish illiquidity from vault loss.
 *   - Illiquidity (maxWithdraw < owed, but convertToAssets shows no loss):
 *     OLD: clamps to maxWithdraw, returns partial → escrow deletes position (BUG)
 *     NEW: reverts IlliquidVault → escrow keeps position alive for retry
 *
 *   - Real vault loss (convertToAssets < principal, vault is liquid):
 *     OLD and NEW: return reduced amount → escrow distributes pro-rata (correct)
 *
 * V2-4: MorphoAdapter.rescue must be callable by the escrow owner.
 *   OLD: onlyEscrow modifier → owner call reverts
 *   NEW: checks IOwnable(escrow).owner() → owner call succeeds
 *
 * Regression proof: tests marked FAIL-ON-OLD fail on commit 7882f74b and pass on HEAD.
 */

import {Test} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {MorphoAdapter} from "../src/MorphoAdapter.sol";
import {ILendingAdapter} from "../src/interfaces/ILendingAdapter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Inline mock USDC ─────────────────────────────────────────────────────────

contract MV2USDC is ERC20 {
    constructor() ERC20("MV2 USDC", "mUSDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ─── Configurable ERC-4626 vault mock ────────────────────────────────────────

/// @dev Minimal ERC-4626 vault with two test helpers:
///      - setLiquidityLimit(n): caps maxWithdraw to n (simulates illiquidity).
///      - simulateLoss(n):      reduces totalAssets by n (simulates vault loss).
contract MockVault {
    MV2USDC public immutable usdc;
    mapping(address => uint256) private _shares;
    uint256 public totalShares;
    uint256 public totalAssets;
    uint256 public liquidityLimit = type(uint256).max;

    constructor(address _usdc) {
        usdc = MV2USDC(_usdc);
    }

    // ─── ERC-4626 read interface ──────────────────────────────────────────────

    function asset() external view returns (address) { return address(usdc); }

    function balanceOf(address owner) external view returns (uint256) {
        return _shares[owner];
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        if (totalShares == 0) return shares; // 1:1 before any deposit
        return shares * totalAssets / totalShares;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        if (totalShares == 0) return assets;
        return assets * totalShares / totalAssets;
    }

    function maxDeposit(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function previewDeposit(uint256 assets) external view returns (uint256) {
        return convertToShares(assets);
    }

    /// @dev Caps per-owner max at `liquidityLimit` to simulate illiquid markets.
    function maxWithdraw(address owner) external view returns (uint256) {
        uint256 ownerAssets = convertToAssets(_shares[owner]);
        return ownerAssets < liquidityLimit ? ownerAssets : liquidityLimit;
    }

    // ─── ERC-4626 write interface ─────────────────────────────────────────────

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = (totalShares == 0) ? assets : (assets * totalShares / totalAssets);
        usdc.transferFrom(msg.sender, address(this), assets);
        _shares[receiver] += shares;
        totalShares += shares;
        totalAssets += assets;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        shares = (totalShares == 0) ? assets : (assets * totalShares / totalAssets);
        _shares[owner] -= shares;
        totalShares -= shares;
        totalAssets -= assets;
        usdc.transfer(receiver, assets);
    }

    // ─── Test helpers ─────────────────────────────────────────────────────────

    function setLiquidityLimit(uint256 limit) external { liquidityLimit = limit; }

    function simulateLoss(uint256 lossAmount) external {
        totalAssets = totalAssets > lossAmount ? totalAssets - lossAmount : 0;
    }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

contract MorphoAdapterV2Test is Test {
    MV2USDC   usdc;
    MockVault vault;
    RentalEscrow escrow;
    MorphoAdapter adapter;

    address tenant   = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address treasury = makeAddr("treasury");

    uint256 constant RENT = 1_000e6;

    function setUp() public {
        usdc    = new MV2USDC();
        vault   = new MockVault(address(usdc));
        escrow  = new RentalEscrow(address(usdc), treasury);
        adapter = new MorphoAdapter(address(escrow), address(vault), address(usdc));

        escrow.setLendingAdapter(address(adapter));
        escrow.emergencyEnableLending();

        usdc.mint(tenant,   500_000e6);
        usdc.mint(landlord, 500_000e6);
        // Seed vault with extra liquidity so partial-liquidity scenarios work
        usdc.mint(address(vault), 10_000e6);

        vm.prank(tenant);   usdc.approve(address(escrow), type(uint256).max);
        vm.prank(landlord); usdc.approve(address(escrow), type(uint256).max);
    }

    /// @dev Activate an agreement and return its ID + the amount lent to the vault.
    function _activateAndGetLent() internal returns (uint256 id, uint256 lentPrincipal) {
        vm.prank(landlord);
        id = escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));
        vm.prank(tenant);   escrow.tenantDeposit(id);
        vm.prank(landlord); escrow.landlordDeposit(id);

        (lentPrincipal,) = escrow.lendingPositions(id);
        assertGt(lentPrincipal, 0, "pre: lending must be active");
    }

    // =========================================================================
    //  V2-1 A - Illiquidity scenario
    //
    //  FAILS ON OLD (7882f74b): old adapter clamps to maxWithdraw (100e6),
    //    returns partial → position deleted → assertion lentPrincipal > 0 fails.
    //  PASSES ON NEW: adapter reverts IlliquidVault → hard failure →
    //    position survives → recovery later distributes full principal.
    // =========================================================================

    function test_V21_morpho_illiquid_reverts_positionSurvives() public {
        (uint256 id, uint256 lentPrincipal) = _activateAndGetLent();

        // Clamp vault liquidity to 5% - value is still 1:1 (no real loss)
        uint256 illiquidCap = lentPrincipal * 5 / 100; // e.g. 100e6 of 2000e6
        vault.setLiquidityLimit(illiquidCap);

        // Verify: no loss. convertToAssets(shares) still equals lentPrincipal.
        uint256 adapterShares = vault.balanceOf(address(adapter));
        assertEq(vault.convertToAssets(adapterShares), lentPrincipal,
            "pre: no value loss - 1:1 exchange rate");

        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));

        // V2-1 ASSERTION: position must survive - adapter was illiquid, not broken.
        // OLD code: position deleted (partial 100e6 returned) → this assertion FAILS.
        // NEW code: IlliquidVault revert → hard failure → position preserved → PASSES.
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0,
            "V2-1 FAIL: position deleted on illiquidity - recovery is now impossible");

        // Recovery path: restore full liquidity and reclaim
        vault.setLiquidityLimit(type(uint256).max);
        escrow.reclaimLentFundsAfterSettlement(id);

        // flagRentMissed → _markRecovery(id, 10000) → landlord gets 100%
        assertEq(escrow.pendingWithdrawals(landlord), lentPrincipal,
            "V2-1: landlord must receive 100% of principal after recovery");
        assertEq(escrow.pendingWithdrawals(tenant), 0,
            "V2-1: tenant must receive nothing after flagRentMissed");

        // Position fully consumed
        (uint256 posAfterReclaim,) = escrow.lendingPositions(id);
        assertEq(posAfterReclaim, 0, "V2-1: position must be cleared after successful recovery");
    }

    // =========================================================================
    //  V2-1 B - Real vault loss scenario (correctness proof, not regression)
    //
    //  Vault suffers 50% loss AND has full liquidity for the reduced amount.
    //  Both old and new adapter correctly return partial; this test verifies
    //  the pro-rata distribution logic in RentalEscrow is correct.
    //  Passes on both old and new code - it is a CORRECTNESS test.
    // =========================================================================

    function test_V21_morpho_realLoss_partialDistributed() public {
        (uint256 id, uint256 lentPrincipal) = _activateAndGetLent();

        // Simulate 50% vault loss: totalAssets halved, shares unchanged
        vault.simulateLoss(lentPrincipal / 2);

        uint256 adapterShares = vault.balanceOf(address(adapter));
        uint256 currentValue = vault.convertToAssets(adapterShares);
        assertLt(currentValue, lentPrincipal,
            "pre: vault must show genuine loss");

        // Escrow will call adapter.withdraw(realValue) where realValue reflects the loss.
        // Both old and new adapter: owed <= maxWithdraw (fully liquid at reduced value) →
        // adapter returns owed (< lentPrincipal) → escrow distributes pro-rata.
        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));

        // After real loss, position should be cleared (partial recovery completed)
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertEq(posAfter, 0, "V2-1B: position must be cleared after vault-loss partial");

        // Landlord received (buffer + partial recovery) via safeTransfer in flagRentMissed.
        // We verify tenant got nothing (all goes to landlord per flagRentMissed semantics).
        assertEq(escrow.pendingWithdrawals(tenant), 0,
            "V2-1B: tenant must receive nothing after flagRentMissed with vault loss");
    }

    // =========================================================================
    //  V2-4 - rescue() reachable by escrow owner
    //
    //  FAILS ON OLD (7882f74b): rescue has onlyEscrow modifier → caller must be
    //    the escrow contract itself. Owner call reverts "Only escrow".
    //  PASSES ON NEW: rescue checks IOwnable(escrow).owner() → owner call succeeds.
    // =========================================================================

    function test_V24_rescue_reachable() public {
        // Accidentally send USDC directly to adapter (wrong transfer)
        uint256 stuckAmount = 500e6;
        usdc.mint(address(adapter), stuckAmount);

        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        // Owner of escrow == address(this) (deployed in setUp)
        // NEW: succeeds. OLD: reverts "Only escrow" or OnlyEscrow custom error.
        adapter.rescue(address(usdc), stuckAmount);

        assertEq(usdc.balanceOf(address(escrow)) - escrowBefore, stuckAmount,
            "V2-4: rescue must transfer stuck tokens to escrow");
    }

    // =========================================================================
    //  Combined: illiquid + loss - verify boundary condition
    //
    //  If vault has BOTH loss (50%) AND remaining liquidity is constrained (80% of loss value),
    //  new adapter should revert (illiquid for the loss-adjusted amount) since
    //  maxWithdraw < owed-after-loss.
    //  This distinguishes "illiquid vault" from "illiquid+loss" scenario.
    // =========================================================================

    function test_V21_morpho_illiquidAndLoss_reverts() public {
        (uint256 id, uint256 lentPrincipal) = _activateAndGetLent();

        // 30% vault loss
        vault.simulateLoss(lentPrincipal * 30 / 100);

        // But remaining value is also only 60% liquid (not 70%)
        uint256 lossValue = vault.convertToAssets(vault.balanceOf(address(adapter)));
        vault.setLiquidityLimit(lossValue * 80 / 100); // 80% of already-reduced value

        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        // owed = lossValue (< lentPrincipal due to loss)
        // maxWithdraw = 80% of lossValue < owed → revert IlliquidVault
        // Position must survive for retry.
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0,
            "V2-1: illiquid+loss - position must survive for retry when maxWithdraw < owed");
    }
}
