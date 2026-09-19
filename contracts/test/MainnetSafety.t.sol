// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MainnetSafety — TASK 3B regression tests encoding the TASK 3 audit findings
 *
 * Converts the read-only TASK 3 mainnet audit into executable tests. Covers:
 *   PART 1  Arc Mainnet (chainId 5042) devMode/dev-function inaccessibility,
 *           for every externally callable dev-only function on BOTH contracts.
 *   PART 2  Fresh deployment lending-disabled-by-default state.
 *   PART 3  rescueTokens() invariants (active agreements, pendingWithdrawals).
 *   PART 4  PropDep linking (setPropDepEscrow one-time, constructor zero-checks).
 *   PART 5  Owner config boundaries (fee/buffer bps ceilings, adapter wiring).
 *   PART 6  Ownership transfer regression tests (current single-step model).
 *
 * These tests exercise the REAL production functions and REAL accounting state —
 * no test-only duplicate logic. Does not change escrow business logic, does not
 * enable lending, does not touch writeOffLendingPosition or Ownable2Step.
 */

import {Test} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PausableAdapter} from "./mocks/TestAdapters.sol";

contract MainnetSafetyUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev Second, unrelated ERC20 used only to test non-USDC stray-token rescue.
contract StrayToken is ERC20 {
    constructor() ERC20("Stray Token", "STRAY") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MainnetSafetyTest is Test {
    uint256 constant ARC_MAINNET = 5042;

    MainnetSafetyUSDC usdc;
    address treasury = makeAddr("treasury");
    address tenant = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address stranger = makeAddr("stranger");

    uint256 constant RENT = 1500e6;
    uint256 constant PROP_DEP = 3000e6;

    function setUp() public {
        usdc = new MainnetSafetyUSDC();
        usdc.mint(tenant, 10_000_000e6);
        usdc.mint(landlord, 10_000_000e6);
    }

    /// @dev Deploys a correctly-linked pair on Arc Mainnet (chainId 5042).
    function _deployMainnetPair() internal returns (RentalEscrow escrow, PropDepEscrow propDep) {
        vm.chainId(ARC_MAINNET);
        escrow = new RentalEscrow(address(usdc), treasury);
        propDep = new PropDepEscrow(address(usdc), address(escrow));
        escrow.setPropDepEscrow(address(propDep));
    }

    /// @dev Deploys on Arc Mainnet AND activates one agreement with a property
    ///      deposit, so a real PropDep exists — needed to isolate the devMode
    ///      guard on PropDepEscrow's dev functions that also carry a
    ///      `propDepExists` modifier (which would otherwise revert first).
    function _deployMainnetPairWithRealPropDep() internal returns (RentalEscrow escrow, PropDepEscrow propDep, uint256 id) {
        (escrow, propDep) = _deployMainnetPair();

        vm.prank(landlord);
        id = escrow.createAgreement(tenant, landlord, RENT, PROP_DEP, 6, bytes32(0));

        vm.startPrank(tenant);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        vm.startPrank(landlord);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.landlordDeposit(id); // activates -> creates the PropDep
        vm.stopPrank();
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PART 1 — ARC MAINNET DEV SAFETY (both contracts, vm.chainId(5042))
    // ═════════════════════════════════════════════════════════════════════════

    function test_arcMainnet_RentalEscrow_devMode_false() public {
        (RentalEscrow escrow,) = _deployMainnetPair();
        assertFalse(escrow.devMode(), "RentalEscrow.devMode() must be false on Arc Mainnet (5042)");
    }

    function test_arcMainnet_PropDepEscrow_devMode_false() public {
        (, PropDepEscrow propDep) = _deployMainnetPair();
        assertFalse(propDep.devMode(), "PropDepEscrow.devMode() must be false on Arc Mainnet (5042)");
    }

    // ─── RentalEscrow: every externally callable dev-only function ────────────
    // None of these carry an "existence" modifier ahead of `require(devMode)`,
    // so id=0 (no agreement created) is sufficient to isolate the devMode guard.

    function test_arcMainnet_RentalEscrow_warp_reverts() public {
        (RentalEscrow escrow,) = _deployMainnetPair();
        vm.expectRevert();
        escrow.warp(1);
    }

    function test_arcMainnet_RentalEscrow_resetTime_reverts() public {
        (RentalEscrow escrow,) = _deployMainnetPair();
        vm.expectRevert();
        escrow.resetTime();
    }

    function test_arcMainnet_RentalEscrow_devSetLeaseEndTime_reverts() public {
        (RentalEscrow escrow,) = _deployMainnetPair();
        vm.expectRevert();
        escrow._devSetLeaseEndTime(0, block.timestamp + 1);
    }

    function test_arcMainnet_RentalEscrow_devSetTimes_reverts() public {
        (RentalEscrow escrow,) = _deployMainnetPair();
        vm.expectRevert();
        escrow._devSetTimes(0, 0, 0, 0, type(uint256).max);
    }

    function test_arcMainnet_RentalEscrow_devForceFreezeExpired_reverts() public {
        (RentalEscrow escrow,) = _deployMainnetPair();
        vm.expectRevert();
        escrow._devForceFreezeExpired(0);
    }

    // ─── PropDepEscrow: warp/resetTime (no existence modifier) ────────────────

    function test_arcMainnet_PropDepEscrow_warp_reverts() public {
        (, PropDepEscrow propDep) = _deployMainnetPair();
        vm.expectRevert();
        propDep.warp(1);
    }

    function test_arcMainnet_PropDepEscrow_resetTime_reverts() public {
        (, PropDepEscrow propDep) = _deployMainnetPair();
        vm.expectRevert();
        propDep.resetTime();
    }

    // ─── PropDepEscrow: dev functions gated by `propDepExists` — use a real
    //     PropDep so the devMode guard (checked inside the body) is what
    //     actually fires, not the existence modifier. ─────────────────────────

    function test_arcMainnet_PropDepEscrow_devSetLeaseEndTime_reverts() public {
        (, PropDepEscrow propDep, uint256 id) = _deployMainnetPairWithRealPropDep();
        vm.expectRevert();
        propDep._devSetLeaseEndTime(id, block.timestamp + 1);
    }

    function test_arcMainnet_PropDepEscrow_devForceFreezeExpired_reverts() public {
        (, PropDepEscrow propDep, uint256 id) = _deployMainnetPairWithRealPropDep();
        vm.expectRevert();
        propDep._devForceFreezeExpired(id);
    }

    function test_arcMainnet_PropDepEscrow_devForceWindowExpired_reverts() public {
        (, PropDepEscrow propDep, uint256 id) = _deployMainnetPairWithRealPropDep();
        vm.expectRevert();
        propDep._devForceWindowExpired(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PART 2 — FRESH MAINNET LENDING STATE
    // ═════════════════════════════════════════════════════════════════════════

    function test_freshMainnetDeployment_lendingDisabledByDefault() public {
        (RentalEscrow escrow,) = _deployMainnetPair();
        assertFalse(escrow.lendingEnabled(), "lendingEnabled must default false");
        assertEq(address(escrow.lendingAdapter()), address(0), "lendingAdapter must default to zero");
    }

    function test_emergencyEnableLending_revertsWithoutAdapterConfigured() public {
        (RentalEscrow escrow,) = _deployMainnetPair();
        vm.expectRevert();
        escrow.emergencyEnableLending();
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PART 3 — RESCUE / PENDING WITHDRAWAL INVARIANTS (rescueTokens)
    // ═════════════════════════════════════════════════════════════════════════

    function test_rescueTokens_USDC_revertsWhileActiveAgreementExists() public {
        (RentalEscrow escrow,) = _deployMainnetPair();
        vm.prank(landlord);
        escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));
        assertEq(escrow.activeAgreementCount(), 1);

        vm.expectRevert();
        escrow.rescueTokens(address(usdc), 1);
    }

    /// @dev Creates a real settled-but-unwithdrawn state via the actual
    ///      expireByLeaseEnd() safety net, so totalPendingWithdrawals > 0 and
    ///      activeAgreementCount == 0 using genuine production accounting.
    function _settleViaExpireByLeaseEnd() internal returns (RentalEscrow escrow, PropDepEscrow propDep, uint256 id) {
        (escrow, propDep) = _deployMainnetPair();

        vm.prank(landlord);
        id = escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));

        vm.startPrank(tenant);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        vm.startPrank(landlord);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.landlordDeposit(id); // activates
        vm.stopPrank();

        // 6 months lease + 60 day freeze buffer + margin, matching expireByLeaseEnd's guard.
        vm.warp(block.timestamp + (6 * 30 days) + 60 days + 1 days);
        escrow.expireByLeaseEnd(id);

        assertEq(escrow.activeAgreementCount(), 0, "sanity: agreement must be terminal");
        assertGt(escrow.totalPendingWithdrawals(), 0, "sanity: pendingWithdrawals must be nonzero");
    }

    function test_rescueTokens_USDC_revertsIfItWouldDipBelowPendingWithdrawals() public {
        (RentalEscrow escrow,,) = _settleViaExpireByLeaseEnd();

        // Contract balance == totalPendingWithdrawals exactly in this flow
        // (nothing was paid out directly). Any positive rescue dips below it.
        assertEq(usdc.balanceOf(address(escrow)), escrow.totalPendingWithdrawals());

        vm.expectRevert();
        escrow.rescueTokens(address(usdc), 1);
    }

    function test_rescueTokens_USDC_succeedsWhenObligationsAbsentAndPendingCovered() public {
        (RentalEscrow escrow,,) = _settleViaExpireByLeaseEnd();

        // Simulate a stray/mistaken direct USDC transfer to the contract —
        // genuinely "free" balance beyond what's owed via pendingWithdrawals.
        uint256 strayAmount = 500e6;
        usdc.mint(address(escrow), strayAmount);

        uint256 pendingBefore = escrow.totalPendingWithdrawals();
        // rescueTokens always pays `owner`, which is this test contract (the deployer).
        uint256 thisBalBefore = usdc.balanceOf(address(this));
        escrow.rescueTokens(address(usdc), strayAmount);

        assertEq(usdc.balanceOf(address(this)), thisBalBefore + strayAmount, "owner must receive exactly the rescued stray amount");
        assertEq(usdc.balanceOf(address(escrow)), pendingBefore, "contract balance must still exactly cover pendingWithdrawals");
        assertEq(escrow.totalPendingWithdrawals(), pendingBefore, "rescue must not touch pendingWithdrawals accounting");
    }

    function test_rescueTokens_pendingWithdrawalsRemainWithdrawableAfterAllowedRescue() public {
        (RentalEscrow escrow,, uint256 id) = _settleViaExpireByLeaseEnd();
        RentalEscrow.Agreement memory a = escrow.getAgreement(id);

        uint256 tenantPending = escrow.pendingWithdrawals(a.tenant);
        uint256 landlordPending = escrow.pendingWithdrawals(a.landlord);
        assertGt(tenantPending, 0);
        assertGt(landlordPending, 0);

        // Allowed rescue: mint stray funds first, then rescue exactly that.
        uint256 strayAmount = 250e6;
        usdc.mint(address(escrow), strayAmount);
        escrow.rescueTokens(address(usdc), strayAmount);

        // Both parties can still withdraw their full recorded balances.
        uint256 tenantBalBefore = usdc.balanceOf(a.tenant);
        vm.prank(a.tenant);
        escrow.withdraw();
        assertEq(usdc.balanceOf(a.tenant), tenantBalBefore + tenantPending);
        assertEq(escrow.pendingWithdrawals(a.tenant), 0);

        uint256 landlordBalBefore = usdc.balanceOf(a.landlord);
        vm.prank(a.landlord);
        escrow.withdraw();
        assertEq(usdc.balanceOf(a.landlord), landlordBalBefore + landlordPending);
        assertEq(escrow.pendingWithdrawals(a.landlord), 0);
    }

    function test_rescueTokens_nonUSDC_strayTokenAlwaysAllowed() public {
        (RentalEscrow escrow,) = _deployMainnetPair();

        // Even WITH an active agreement (which blocks USDC rescue), a
        // non-USDC stray token must still be rescuable — current design.
        vm.prank(landlord);
        escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));
        assertGt(escrow.activeAgreementCount(), 0);

        StrayToken stray = new StrayToken();
        stray.mint(address(escrow), 1000e18);

        uint256 thisBalBefore = stray.balanceOf(address(this));
        escrow.rescueTokens(address(stray), 1000e18);
        assertEq(stray.balanceOf(address(this)), thisBalBefore + 1000e18);
        assertEq(stray.balanceOf(address(escrow)), 0);
    }

    function test_rescueTokens_revertsIfNotOwner() public {
        (RentalEscrow escrow,) = _deployMainnetPair();
        vm.prank(stranger);
        vm.expectRevert();
        escrow.rescueTokens(address(usdc), 1);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PART 4 — PROPDEP LINKING
    // ═════════════════════════════════════════════════════════════════════════

    function test_setPropDepEscrow_ownerCanSetValidNonZeroAddressOnce() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PropDepEscrow propDep = new PropDepEscrow(address(usdc), address(escrow));

        escrow.setPropDepEscrow(address(propDep));
        assertEq(address(escrow.propDepEscrow()), address(propDep));
    }

    function test_setPropDepEscrow_secondCallReverts() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PropDepEscrow propDep = new PropDepEscrow(address(usdc), address(escrow));
        escrow.setPropDepEscrow(address(propDep));

        PropDepEscrow anotherPropDep = new PropDepEscrow(address(usdc), address(escrow));
        vm.expectRevert();
        escrow.setPropDepEscrow(address(anotherPropDep));
    }

    function test_setPropDepEscrow_zeroAddressReverts() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        vm.expectRevert();
        escrow.setPropDepEscrow(address(0));
    }

    function test_setPropDepEscrow_revertsIfNotOwner() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PropDepEscrow propDep = new PropDepEscrow(address(usdc), address(escrow));

        vm.prank(stranger);
        vm.expectRevert();
        escrow.setPropDepEscrow(address(propDep));
    }

    function test_PropDepEscrow_constructor_revertsOnZeroMainContract() public {
        vm.expectRevert();
        new PropDepEscrow(address(usdc), address(0));
    }

    function test_PropDepEscrow_constructor_revertsOnZeroUsdc() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        vm.expectRevert();
        new PropDepEscrow(address(0), address(escrow));
    }

    function test_correctPairDeployment_bothGettersMatch() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PropDepEscrow propDep = new PropDepEscrow(address(usdc), address(escrow));
        escrow.setPropDepEscrow(address(propDep));

        assertEq(address(escrow.propDepEscrow()), address(propDep), "RentalEscrow.propDepEscrow() must equal deployed PropDepEscrow");
        assertEq(propDep.mainContract(), address(escrow), "PropDepEscrow.mainContract() must equal deployed RentalEscrow");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PART 5 — OWNER CONFIG BOUNDARIES
    // ═════════════════════════════════════════════════════════════════════════

    function test_setProtocolFeeBps_boundary() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);

        escrow.setProtocolFeeBps(5000);
        assertEq(escrow.protocolFeeBps(), 5000);

        vm.expectRevert(RentalEscrow.ProtocolFeeTooHigh.selector);
        escrow.setProtocolFeeBps(5001);
    }

    function test_setProtocolFeeBps_revertsIfNotOwner() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setProtocolFeeBps(1000);
    }

    function test_setBufferBps_boundary() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);

        escrow.setBufferBps(10000);
        assertEq(escrow.bufferBps(), 10000);

        vm.expectRevert(RentalEscrow.BufferOutOfRange.selector);
        escrow.setBufferBps(10001);
    }

    function test_setBufferBps_revertsIfNotOwner() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setBufferBps(1000);
    }

    function test_setLendingAdapter_zeroAddressReverts() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        vm.expectRevert(RentalEscrow.ZeroAddress.selector);
        escrow.setLendingAdapter(address(0));
    }

    function test_setLendingAdapter_revertsIfNotOwner() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PausableAdapter adapter = new PausableAdapter(address(usdc), address(escrow));
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setLendingAdapter(address(adapter));
    }

    function test_setLendingAdapter_validAdapterCanBeSetWhenNoPrincipalLent() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PausableAdapter adapter = new PausableAdapter(address(usdc), address(escrow));

        escrow.setLendingAdapter(address(adapter));
        assertEq(address(escrow.lendingAdapter()), address(adapter));
        assertEq(escrow.totalLentPrincipal(), 0);
    }

    function test_setLendingAdapter_replacementBlockedWhilePrincipalLent() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PropDepEscrow propDep = new PropDepEscrow(address(usdc), address(escrow));
        escrow.setPropDepEscrow(address(propDep));

        PausableAdapter adapter = new PausableAdapter(address(usdc), address(escrow));
        escrow.setLendingAdapter(address(adapter));
        escrow.emergencyEnableLending();

        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));

        vm.startPrank(tenant);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        vm.startPrank(landlord);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.landlordDeposit(id); // activates -> lends commitment+hosting to the adapter
        vm.stopPrank();

        assertGt(escrow.totalLentPrincipal(), 0, "sanity: principal must be lent");

        PausableAdapter adapter2 = new PausableAdapter(address(usdc), address(escrow));
        vm.expectRevert();
        escrow.setLendingAdapter(address(adapter2));
    }

    function test_emergencyEnableLending_ownerOnlyAndStateTransition() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PausableAdapter adapter = new PausableAdapter(address(usdc), address(escrow));
        escrow.setLendingAdapter(address(adapter));

        vm.prank(stranger);
        vm.expectRevert();
        escrow.emergencyEnableLending();

        vm.expectEmit(false, false, false, true, address(escrow));
        emit RentalEscrow.LendingEnabled(true);
        escrow.emergencyEnableLending();
        assertTrue(escrow.lendingEnabled());
    }

    function test_emergencyDisableLending_ownerOnlyAndStateTransition() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PausableAdapter adapter = new PausableAdapter(address(usdc), address(escrow));
        escrow.setLendingAdapter(address(adapter));
        escrow.emergencyEnableLending();
        assertTrue(escrow.lendingEnabled());

        vm.prank(stranger);
        vm.expectRevert();
        escrow.emergencyDisableLending();

        vm.expectEmit(false, false, false, true, address(escrow));
        emit RentalEscrow.LendingEnabled(false);
        escrow.emergencyDisableLending();
        assertFalse(escrow.lendingEnabled());
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PART 6 — OWNERSHIP SAFETY (regression tests for the CURRENT model only)
    // ═════════════════════════════════════════════════════════════════════════

    function test_ownership_nonOwnerCannotCallOwnerOnlyFunctions_RentalEscrow() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);

        vm.startPrank(stranger);
        vm.expectRevert();
        escrow.setProtocolTreasury(stranger);
        vm.expectRevert();
        escrow.transferOwnership(stranger);
        vm.expectRevert();
        escrow.setBufferBps(0);
        vm.stopPrank();
    }

    function test_ownership_nonOwnerCannotCallOwnerOnlyFunctions_PropDepEscrow() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PropDepEscrow propDep = new PropDepEscrow(address(usdc), address(escrow));

        vm.startPrank(stranger);
        vm.expectRevert();
        propDep.transferOwnership(stranger);
        vm.expectRevert();
        propDep.setFreezeDuration(30 days);
        vm.stopPrank();
    }

    function test_transferOwnership_revertsOnZeroAddress_RentalEscrow() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        vm.expectRevert();
        escrow.transferOwnership(address(0));
    }

    function test_transferOwnership_revertsOnZeroAddress_PropDepEscrow() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PropDepEscrow propDep = new PropDepEscrow(address(usdc), address(escrow));
        vm.expectRevert();
        propDep.transferOwnership(address(0));
    }

    function test_transferOwnership_validTransfer_oldLosesNewGains_RentalEscrow() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        address newOwner = makeAddr("newOwnerRental");

        escrow.transferOwnership(newOwner);
        assertEq(escrow.owner(), newOwner);

        // Old owner (this test contract) has lost privileges.
        vm.expectRevert();
        escrow.setProtocolTreasury(stranger);

        // New owner has gained privileges.
        vm.prank(newOwner);
        escrow.setProtocolTreasury(stranger);
        assertEq(escrow.protocolTreasury(), stranger);
    }

    function test_transferOwnership_validTransfer_oldLosesNewGains_PropDepEscrow() public {
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        PropDepEscrow propDep = new PropDepEscrow(address(usdc), address(escrow));
        address newOwner = makeAddr("newOwnerPropDep");

        propDep.transferOwnership(newOwner);
        assertEq(propDep.owner(), newOwner);

        // Old owner (this test contract) has lost privileges.
        vm.expectRevert();
        propDep.setFreezeDuration(30 days);

        // New owner has gained privileges.
        vm.prank(newOwner);
        propDep.setFreezeDuration(30 days);
        assertEq(propDep.freezeDuration(), 30 days);
    }
}
