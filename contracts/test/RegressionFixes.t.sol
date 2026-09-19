// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RegressionFixes — behavioral regression tests for the 6 security fixes
 *
 * Each test is designed to FAIL on commit 03ee4554 and PASS on HEAD.
 * Tests do NOT rely on new custom-error selectors or new functions that
 * did not exist at 03ee4554 — they test behavior only.
 *
 *   R-1  devMode whitelist: unknown chain must disable devMode
 *   R-2  recovery split follows settlement outcome (flagRentMissed → 100% landlord)
 *   R-3  received==0 treated as hard failure (position must survive)
 *   R-4  unactivated rent returned to tenant on expiry
 *   R-5  _devForceFreezeExpired sets freezeEnd (not freezeStart)
 *   R-6  emergencySettleExpired opens PropDep inspection window
 */

import {Test} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {ILendingAdapter} from "../src/interfaces/ILendingAdapter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Inline mock token (no external dep on test/mocks/) ──────────────────────

contract RegrUSDC is ERC20 {
    constructor() ERC20("Regression USDC", "rUSDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ─── Adapters ─────────────────────────────────────────────────────────────────

/// @dev Adapter whose withdraw() starts paused, can be unpaused for recovery.
contract RegrPausedAdapter is ILendingAdapter {
    RegrUSDC public usdc;
    address public escrow;
    uint256 public stored;
    bool public paused = true;

    constructor(address _usdc, address _escrow) {
        usdc = RegrUSDC(_usdc);
        escrow = _escrow;
    }

    function supply(uint256 amount) external returns (uint256) {
        usdc.transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        require(!paused, "Aave paused");
        usdc.transfer(escrow, amount);
        stored = stored >= amount ? stored - amount : 0;
        return amount;
    }

    function getIndex() external pure returns (uint256) { return 1e27; }
    function unpause() external { paused = false; }
}

/// @dev Adapter whose withdraw() returns 0 without reverting.
contract RegrZeroAdapter is ILendingAdapter {
    RegrUSDC public usdc;
    address public escrow;
    uint256 public stored;

    constructor(address _usdc, address _escrow) {
        usdc = RegrUSDC(_usdc);
        escrow = _escrow;
    }

    function supply(uint256 amount) external returns (uint256) {
        usdc.transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256) external pure returns (uint256) { return 0; }
    function getIndex() external pure returns (uint256) { return 1e27; }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

contract RegressionFixesTest is Test {
    RegrUSDC usdc;
    RentalEscrow escrow;
    PropDepEscrow propDep;

    address tenant   = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address treasury = makeAddr("treasury");

    uint256 constant RENT     = 1_000e6;
    uint256 constant PROP_DEP = 2_000e6;

    function setUp() public {
        usdc    = new RegrUSDC();
        escrow  = new RentalEscrow(address(usdc), treasury);
        propDep = new PropDepEscrow(address(usdc), address(escrow));
        escrow.setPropDepEscrow(address(propDep));

        usdc.mint(tenant,   500_000e6);
        usdc.mint(landlord, 500_000e6);

        vm.prank(tenant);   usdc.approve(address(escrow), type(uint256).max);
        vm.prank(landlord); usdc.approve(address(escrow), type(uint256).max);
        vm.prank(landlord); usdc.approve(address(propDep), type(uint256).max);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _activate(uint256 propAmt) internal returns (uint256 id) {
        return _activateWithAdapter(propAmt, address(0));
    }

    function _activateWithAdapter(uint256 propAmt, address adapter) internal returns (uint256 id) {
        vm.prank(landlord);
        id = escrow.createAgreement(tenant, landlord, RENT, propAmt, 6, bytes32(0));
        if (adapter != address(0)) {
            escrow.setLendingAdapter(adapter);
            escrow.emergencyEnableLending();
        }
        vm.prank(tenant);   escrow.tenantDeposit(id);
        vm.prank(landlord); escrow.landlordDeposit(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  R-1: devMode whitelist — unknown chain must disable devMode
    //
    //  OLD (03ee4554): devMode=true by default, only ARC_MAINNET/ARBITRUM_ONE/
    //                  ETHEREUM_MAINNET flip it to false. Chain 9999999 → true.
    //  NEW (HEAD):     devMode=true only for whitelisted test chains. 9999999 → false.
    //
    //  FAILS old:  assertFalse(e.devMode()) fails because old gives devMode=true
    //  PASSES new: devMode is correctly false on unknown chain
    // ═════════════════════════════════════════════════════════════════════════

    function test_R1_devMode_false_on_unknown_chain() public {
        vm.chainId(9999999);
        RentalEscrow e = new RentalEscrow(address(usdc), treasury);
        assertFalse(e.devMode(),
            "R-1 FAIL: devMode must be false on unknown chainId 9999999");
    }

    function test_R1_devMode_false_on_polygon_mainnet() public {
        // Polygon mainnet (137) was NOT in old mainnet blacklist → old gives devMode=true.
        // New whitelist approach: 137 is not a test chain → devMode=false.
        vm.chainId(137);
        RentalEscrow e = new RentalEscrow(address(usdc), treasury);
        assertFalse(e.devMode(),
            "R-1 FAIL: devMode must be false on Polygon mainnet (chain 137)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  R-2: recovery split follows settlement outcome
    //
    //  Scenario: flagRentMissed with adapter paused → position survives.
    //  After adapter recovers, reclaimLentFundsAfterSettlement should give
    //  100% to landlord (not 50/50).
    //
    //  OLD: no _recoveryBps stored → 50/50 split → tenant gets ~50% wrongly.
    //  NEW: _markRecovery(id, 10000) stores landlord=100% → correct.
    //
    //  FAILS old:  assertEq(pendingWithdrawals(tenant), 0) fails (tenant got ~50%)
    //  PASSES new: tenant gets 0
    // ═════════════════════════════════════════════════════════════════════════

    function test_R2_recovery_flagRentMissed_landlordGetsAll() public {
        RegrPausedAdapter adapter = new RegrPausedAdapter(address(usdc), address(escrow));
        uint256 id = _activateWithAdapter(0, address(adapter));

        (uint256 lentPrincipal,) = escrow.lendingPositions(id);
        assertGt(lentPrincipal, 0, "pre: funds must be lent");

        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0, "pre: position must survive hard failure");

        // Recover: unpause and reclaim
        adapter.unpause();
        escrow.reclaimLentFundsAfterSettlement(id);

        // R-2 assertion: tenant must receive NOTHING after flagRentMissed
        assertEq(escrow.pendingWithdrawals(tenant), 0,
            "R-2 FAIL: tenant wrongly received recovery funds after flagRentMissed");
        assertEq(escrow.pendingWithdrawals(landlord), lentPrincipal,
            "R-2 FAIL: landlord must receive 100% of recovery funds");
    }

    function test_R2_recovery_exitWithLoss_tenant_landlordGetsAll() public {
        RegrPausedAdapter adapter = new RegrPausedAdapter(address(usdc), address(escrow));
        uint256 id = _activateWithAdapter(0, address(adapter));

        (uint256 lentPrincipal,) = escrow.lendingPositions(id);
        assertGt(lentPrincipal, 0);

        vm.prank(tenant);
        escrow.exitWithLoss(id);

        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0);

        adapter.unpause();
        escrow.reclaimLentFundsAfterSettlement(id);

        assertEq(escrow.pendingWithdrawals(tenant), 0,
            "R-2 FAIL: tenant (initiator of exitWithLoss) wrongly received recovery");
        assertEq(escrow.pendingWithdrawals(landlord), lentPrincipal,
            "R-2 FAIL: landlord must receive 100% after tenant exitWithLoss");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  R-3: received==0 must NOT delete position
    //
    //  OLD: _reclaimFromLending deletes position even when received==0 (no zero
    //       check before `delete lendingPositions[agreementId]`).
    //  NEW: Early return on received==0, position preserved.
    //
    //  FAILS old:  assertGt(posAfter.principal, 0) fails because old deletes it
    //  PASSES new: position survives
    // ═════════════════════════════════════════════════════════════════════════

    function test_R3_zeroReturn_positionSurvives_flagRentMissed() public {
        RegrZeroAdapter adapter = new RegrZeroAdapter(address(usdc), address(escrow));
        uint256 id = _activateWithAdapter(0, address(adapter));

        (uint256 lentPrincipal,) = escrow.lendingPositions(id);
        assertGt(lentPrincipal, 0);

        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0,
            "R-3 FAIL: position deleted when adapter returned 0 - recovery now impossible");
    }

    function test_R3_zeroReturn_positionSurvives_exitWithLoss() public {
        RegrZeroAdapter adapter = new RegrZeroAdapter(address(usdc), address(escrow));
        uint256 id = _activateWithAdapter(0, address(adapter));

        vm.prank(tenant);
        escrow.exitWithLoss(id);

        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0,
            "R-3 FAIL: position deleted on zero return during exitWithLoss");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  R-4: unactivated monthlyRent returned to tenant on expiry
    //
    //  Setup: tenant deposits (commitmentDeposit + monthlyRent), landlord never
    //         deposits → agreement never activates.
    //  OLD: expireByLeaseEnd returns only commitmentDeposit to tenant.
    //       monthlyRent (RENT) is lost in escrow.
    //  NEW: returns commitmentDeposit + monthlyRent = 2×RENT to tenant.
    //
    //  FAILS old:  assertEq(pending, RENT*2) fails — old only gives RENT
    //  PASSES new: tenant gets both back
    // ═════════════════════════════════════════════════════════════════════════

    function test_R4_unactivatedRent_expireByLeaseEnd_tenantGetsRentBack() public {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 1, bytes32(0));

        vm.prank(tenant);
        escrow.tenantDeposit(id); // pays commitmentDeposit + monthlyRent = 2*RENT

        RentalEscrow.Agreement memory a = escrow.getAgreement(id);
        assertEq(a.activatedAt, 0, "pre: must be unactivated");

        // expireByLeaseEnd: now > max(leaseEndTime=0, createdAt+180d) + 60d = 240d+
        vm.warp(block.timestamp + 241 days);
        escrow.expireByLeaseEnd(id);

        uint256 pending = escrow.pendingWithdrawals(tenant);
        assertEq(pending, RENT * 2,
            "R-4 FAIL: unactivated monthlyRent not returned - tenant only got commitmentDeposit");
    }

    function test_R4_unactivatedRent_emergencySettle_tenantGetsRentBack() public {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 1, bytes32(0));

        vm.prank(tenant);
        escrow.tenantDeposit(id);

        uint256 tBefore = usdc.balanceOf(tenant);
        vm.warp(block.timestamp + 200 days);
        escrow.emergencySettleExpired(id);

        uint256 tenantReceived = usdc.balanceOf(tenant) - tBefore;
        assertEq(tenantReceived, RENT * 2,
            "R-4 FAIL: emergencySettleExpired did not return unactivated monthlyRent");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  R-5: _devForceFreezeExpired must set freezeEnd, not freezeStart
    //
    //  OLD: sets `freezeStart = now - freezeDuration - 1`
    //       freezeEnd = freezeStart + freezeDuration (immutable snapshot from postBond)
    //       → freezeEnd still in the future → releaseFrozenFunds still blocked.
    //  NEW: directly sets `freezeEnd = now - 1`
    //       → releaseFrozenFunds can be called immediately.
    //
    //  FAILS old:  propDep.releaseFrozenFunds(id) reverts "Freeze not expired"
    //  PASSES new: release succeeds
    // ═════════════════════════════════════════════════════════════════════════

    function test_R5_devForceFreezeExpired_enablesRelease() public {
        uint256 id = _activate(PROP_DEP);

        propDep.setPropDepWindowDuration(7 days);
        escrow._devSetLeaseEndTime(id, block.timestamp + 10 days);
        vm.warp(block.timestamp + 4 days);

        uint256 claim = 700e6; // 35% of PROP_DEP=2000e6; above 30% MIN_DAMAGE_CLAIM_BPS floor
        vm.prank(landlord); propDep.fileDamageClaim(id, claim);
        vm.prank(tenant);   propDep.disputeClaim(id);
        vm.prank(landlord); propDep.postBond(id);

        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Frozen));

        // Verify it IS blocked before force-expire
        vm.expectRevert();
        propDep.releaseFrozenFunds(id);

        // Force-expire the freeze
        propDep._devForceFreezeExpired(id);

        // R-5: releaseFrozenFunds must succeed now
        // OLD: still reverts "Freeze not expired" because freezeEnd wasn't updated
        // NEW: succeeds because freezeEnd was set to now-1
        propDep.releaseFrozenFunds(id); // must not revert

        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Settled),
            "R-5 FAIL: releaseFrozenFunds did not settle after _devForceFreezeExpired");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  R-6: emergencySettleExpired must open PropDep inspection window
    //
    //  OLD: no call to _openPropDepWindowEarly → propDep.isWindowOpen returns false.
    //  NEW: calls _openPropDepWindowEarly before _setTerminalState.
    //
    //  FAILS old:  assertTrue(propDep.isWindowOpen(id)) fails
    //  PASSES new: window is open
    // ═════════════════════════════════════════════════════════════════════════

    function test_R6_emergencySettle_opensPropDepWindow() public {
        uint256 id = _activate(PROP_DEP);

        propDep.setPropDepWindowDuration(7 days);
        escrow._devSetLeaseEndTime(id, block.timestamp + 10 days);

        vm.warp(block.timestamp + 200 days);
        escrow.emergencySettleExpired(id);

        assertTrue(propDep.isWindowOpen(id),
            "R-6 FAIL: PropDep inspection window not opened by emergencySettleExpired");
    }
}
