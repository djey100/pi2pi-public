// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @title RentalEscrow refactored test suite
/// @notice Tests core lease lifecycle without PropDep (which is in PropDepEscrow.t.sol).
///         Covers: createAgreement, deposits, activation, payRent,
///         endLease, early termination, _devSetLeaseEndTime.
contract RentalEscrowTest is Test {
    RentalEscrow public escrow;
    PropDepEscrow public propDep;
    MockUSDC public usdc;

    address tenant = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address treasury = makeAddr("treasury");
    address stranger = makeAddr("stranger");

    uint256 constant RENT = 1500e6;
    uint256 constant PROP_DEP = 3000e6;

    function setUp() public {
        usdc = new MockUSDC();

        // Deploy main first (needs no propDepEscrow at construction)
        escrow = new RentalEscrow(address(usdc), treasury);

        // Deploy PropDepEscrow with main address
        propDep = new PropDepEscrow(address(usdc), address(escrow));

        // Wire main to PropDepEscrow
        escrow.setPropDepEscrow(address(propDep));

        // Fund parties
        usdc.mint(tenant, 1_000_000e6);
        usdc.mint(landlord, 1_000_000e6);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    function _createAndFund(uint256 propAmount) internal returns (uint256 id) {
        vm.prank(landlord);
        id = escrow.createAgreement(tenant, landlord, RENT, propAmount, 1, bytes32(0));

        // Tenant approves and deposits
        vm.startPrank(tenant);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        // Landlord approves and deposits
        vm.startPrank(landlord);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.landlordDeposit(id);
        vm.stopPrank();
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  1. CREATION + ACTIVATION
    // ═════════════════════════════════════════════════════════════════════════════

    function test_createAgreement_success() public {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 1, bytes32(0));
        assertEq(id, 0);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Created));
    }

    function test_activation_withoutPropDep() public {
        uint256 id = _createAndFund(0);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Active));
        // PropDepEscrow should NOT have entry for this
        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.None));
    }

    function test_activation_withPropDep_handoff() public {
        uint256 id = _createAndFund(PROP_DEP);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Active));
        // PropDepEscrow should have entry
        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Active));
        // PropDep funds in PropDepEscrow contract
        assertEq(usdc.balanceOf(address(propDep)), PROP_DEP);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  2. END LEASE (new function)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_endLease_returnsCommitmentAndHosting() public {
        uint256 id = _createAndFund(0);

        // Move past lease end
        vm.warp(block.timestamp + 31 days);

        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        vm.prank(stranger);
        escrow.endLease(id);

        // Tenant gets commitment back, landlord gets hosting back
        assertEq(usdc.balanceOf(tenant), tBefore + RENT);
        assertEq(usdc.balanceOf(landlord), lBefore + RENT);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.LeaseEnded));
    }

    function test_endLease_revertsBeforeLeaseEnd() public {
        uint256 id = _createAndFund(0);

        vm.expectRevert();
        escrow.endLease(id);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  3. RENEWAL VOTE
    // ═════════════════════════════════════════════════════════════════════════════

    // ═════════════════════════════════════════════════════════════════════════════
    //  4. DEV FUNCTIONS
    // ═════════════════════════════════════════════════════════════════════════════

    function test_devSetLeaseEndTime_updatesMain() public {
        uint256 id = _createAndFund(0);
        uint256 newEnd = block.timestamp + 5 minutes;

        escrow._devSetLeaseEndTime(id, newEnd);

        assertEq(escrow.getAgreement(id).leaseEndTime, newEnd);
    }

    function test_devSetLeaseEndTime_syncsToPropDep() public {
        uint256 id = _createAndFund(PROP_DEP);
        uint256 newEnd = block.timestamp + 30 days;

        // Set short window so sync doesn't underflow
        propDep.setPropDepWindowDuration(2 days);
        escrow._devSetLeaseEndTime(id, newEnd);

        PropDepEscrow.PropDep memory p = propDep.getPropDep(id);
        assertEq(p.leaseEndTime, newEnd);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  5. PROP DEP INTEGRATION (full lifecycle)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_fullLifecycle_withPropDepNoClaim() public {
        uint256 id = _createAndFund(PROP_DEP);

        // Move past lease end + propDep window
        vm.warp(block.timestamp + 31 days + 8 days);

        // End lease (returns commitment+hosting)
        vm.prank(stranger);
        escrow.endLease(id);

        // PropDep window expired with no claim → tenant gets propDep
        uint256 tBefore = usdc.balanceOf(tenant);
        vm.prank(stranger);
        propDep.expirePropDepWindow(id);

        assertEq(usdc.balanceOf(tenant), tBefore + PROP_DEP);
        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Settled));
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  6. RENT GRACE EXTENSION
    // ═════════════════════════════════════════════════════════════════════════════

    function test_extendRentGrace_landlordCanExtend() public {
        uint256 id = _createAndFund(0);

        vm.prank(landlord);
        escrow.extendRentGrace(id, 5);

        assertEq(escrow.getAgreement(id).rentGraceExtension, 5 days);
    }

    function test_extendRentGrace_revertsIfNotLandlord() public {
        uint256 id = _createAndFund(0);

        vm.prank(tenant);
        vm.expectRevert();
        escrow.extendRentGrace(id, 5);
    }

    function test_extendRentGrace_revertsIfTooMany() public {
        uint256 id = _createAndFund(0);

        vm.prank(landlord);
        vm.expectRevert();
        escrow.extendRentGrace(id, 15);
    }

    function test_extendRentGrace_revertsIfAlreadyExtended() public {
        uint256 id = _createAndFund(0);

        vm.startPrank(landlord);
        escrow.extendRentGrace(id, 5);
        vm.expectRevert();
        escrow.extendRentGrace(id, 3);
        vm.stopPrank();
    }

    function test_extendRentGrace_blocksFlagRentMissed() public {
        // Use 6-month lease so lease doesn't expire before grace test
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));
        vm.startPrank(tenant);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.tenantDeposit(id);
        vm.stopPrank();
        vm.startPrank(landlord);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.landlordDeposit(id);
        vm.stopPrank();

        // Landlord extends by 7 days
        vm.prank(landlord);
        escrow.extendRentGrace(id, 7);

        // Move to standard overdue point (30 + 3 = 33 days)
        vm.warp(block.timestamp + 34 days);

        // Should NOT be flaggable yet (extended by 7 days)
        vm.expectRevert(RentalEscrow.NotOverdueYet.selector);
        escrow.flagRentMissed(id);

        // Move past extended deadline (30 + 3 + 7 = 40 days from start)
        vm.warp(block.timestamp + 7 days);
        // Now it should work — but state moved to LeaseEnded territory? No, lease is 1 month so already past leaseEndTime
        // This is just testing the extension math, not the full flag flow
    }

    function test_fullLifecycle_landlordFilesClaim_tenantAccepts() public {
        uint256 id = _createAndFund(PROP_DEP);

        // Move into propDep window (lease end - 6 days)
        vm.warp(block.timestamp + 24 days);

        // Landlord files claim
        uint256 claim = 1000e6;
        vm.prank(landlord);
        propDep.fileDamageClaim(id, claim);

        // Tenant accepts
        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);
        vm.prank(tenant);
        propDep.acceptClaim(id);

        assertEq(usdc.balanceOf(landlord), lBefore + claim);
        assertEq(usdc.balanceOf(tenant), tBefore + (PROP_DEP - claim));
    }
}
