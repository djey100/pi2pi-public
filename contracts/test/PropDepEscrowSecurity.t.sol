// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC3 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @title PropDepEscrow Security Tests
/// @notice Covers: postBond deadline, settlement front-run, withdrawClaim in all states,
///         full dispute lifecycle, expiry functions, access control.
contract PropDepEscrowSecurityTest is Test {
    RentalEscrow public escrow;
    PropDepEscrow public propDep;
    MockUSDC3 public usdc;

    address tenant = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address treasury = makeAddr("treasury");
    address stranger = makeAddr("stranger");

    uint256 constant RENT = 1500e6;
    uint256 constant PROP_DEP_AMT = 3000e6;

    function setUp() public {
        usdc = new MockUSDC3();
        escrow = new RentalEscrow(address(usdc), treasury);
        propDep = new PropDepEscrow(address(usdc), address(escrow));
        escrow.setPropDepEscrow(address(propDep));

        usdc.mint(tenant, 10_000_000e6);
        usdc.mint(landlord, 10_000_000e6);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _createAndActivateWithPropDep() internal returns (uint256 id) {
        vm.prank(landlord);
        id = escrow.createAgreement(tenant, landlord, RENT, PROP_DEP_AMT, 6, bytes32(0));

        vm.startPrank(tenant);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        vm.startPrank(landlord);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.landlordDeposit(id);
        vm.stopPrank();
    }

    function _moveIntoWindow(uint256 id) internal {
        // Window opens at leaseEndTime - 7 days
        PropDepEscrow.PropDep memory p = propDep.getPropDep(id);
        vm.warp(p.windowStart + 1);
    }

    function _fileAndDisputeClaim(uint256 id, uint256 claimAmount) internal {
        _moveIntoWindow(id);

        vm.prank(landlord);
        propDep.fileDamageClaim(id, claimAmount);

        vm.prank(tenant);
        propDep.disputeClaim(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  FULL DISPUTE LIFECYCLE
    // ═════════════════════════════════════════════════════════════════════════

    function test_fullLifecycle_claim_dispute_bond_freeze_release() public {
        uint256 id = _createAndActivateWithPropDep();
        uint256 claimAmount = 1000e6;

        _fileAndDisputeClaim(id, claimAmount);
        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Disputed));

        // Landlord posts bond
        vm.startPrank(landlord);
        usdc.approve(address(propDep), claimAmount);
        propDep.postBond(id);
        vm.stopPrank();

        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Frozen));

        // Wait 61 days for freeze to expire
        vm.warp(block.timestamp + 61 days);

        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        vm.prank(stranger);
        propDep.releaseFrozenFunds(id);

        // Deposit → tenant, bond → landlord
        assertEq(usdc.balanceOf(tenant), tBefore + PROP_DEP_AMT);
        assertEq(usdc.balanceOf(landlord), lBefore + claimAmount);
        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Settled));
    }

    function test_fullLifecycle_claim_dispute_noBond_claimDropped() public {
        uint256 id = _createAndActivateWithPropDep();

        _fileAndDisputeClaim(id, 1000e6);

        // Wait past bond posting period (claimDeadline + 3 days)
        PropDepEscrow.PropDep memory p = propDep.getPropDep(id);
        vm.warp(p.claimDeadline + 3 days + 1);

        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(stranger);
        propDep.expireDamageClaim(id);

        assertEq(usdc.balanceOf(tenant), tBefore + PROP_DEP_AMT);
        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Settled));
    }

    function test_fullLifecycle_claim_tenantSilent_autoExecute() public {
        uint256 id = _createAndActivateWithPropDep();
        uint256 claimAmount = 2000e6;

        _moveIntoWindow(id);

        vm.prank(landlord);
        propDep.fileDamageClaim(id, claimAmount);

        // Tenant doesn't respond within 3 days
        PropDepEscrow.PropDep memory p = propDep.getPropDep(id);
        vm.warp(p.claimDeadline + 1);

        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        vm.prank(stranger);
        propDep.executeExpiredClaim(id);

        assertEq(usdc.balanceOf(landlord), lBefore + claimAmount);
        assertEq(usdc.balanceOf(tenant), tBefore + (PROP_DEP_AMT - claimAmount));
        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Settled));
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  ACCEPT CLAIM (various states)
    // ═════════════════════════════════════════════════════════════════════════

    function test_acceptClaim_fromClaimed() public {
        uint256 id = _createAndActivateWithPropDep();
        uint256 claimAmount = 1500e6;

        _moveIntoWindow(id);
        vm.prank(landlord);
        propDep.fileDamageClaim(id, claimAmount);

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(tenant);
        propDep.acceptClaim(id);

        assertEq(usdc.balanceOf(landlord), lBefore + claimAmount);
        assertEq(usdc.balanceOf(tenant), tBefore + (PROP_DEP_AMT - claimAmount));
    }

    function test_acceptClaim_fromDisputed_tenantChangedMind() public {
        uint256 id = _createAndActivateWithPropDep();
        uint256 claimAmount = 1000e6;

        _fileAndDisputeClaim(id, claimAmount);

        uint256 lBefore = usdc.balanceOf(landlord);

        // Tenant changes mind and accepts
        vm.prank(tenant);
        propDep.acceptClaim(id);

        assertEq(usdc.balanceOf(landlord), lBefore + claimAmount);
    }

    function test_acceptClaimAfterBond_fromFrozen() public {
        uint256 id = _createAndActivateWithPropDep();
        uint256 claimAmount = 1000e6;

        _fileAndDisputeClaim(id, claimAmount);

        vm.startPrank(landlord);
        usdc.approve(address(propDep), claimAmount);
        propDep.postBond(id);
        vm.stopPrank();

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(tenant);
        propDep.acceptClaimAfterBond(id);

        // Landlord gets: bond back + claim amount
        assertEq(usdc.balanceOf(landlord), lBefore + claimAmount + claimAmount);
        // Tenant gets: deposit - claim
        assertEq(usdc.balanceOf(tenant), tBefore + (PROP_DEP_AMT - claimAmount));
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  WITHDRAW CLAIM
    // ═════════════════════════════════════════════════════════════════════════

    function test_withdrawClaim_fromClaimed() public {
        uint256 id = _createAndActivateWithPropDep();
        _moveIntoWindow(id);

        vm.prank(landlord);
        propDep.fileDamageClaim(id, 1000e6);

        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(landlord);
        propDep.withdrawClaim(id);

        assertEq(usdc.balanceOf(tenant), tBefore + PROP_DEP_AMT);
        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Settled));
    }

    function test_withdrawClaim_fromFrozen_returnsBond() public {
        uint256 id = _createAndActivateWithPropDep();
        uint256 claimAmount = 1000e6;

        _fileAndDisputeClaim(id, claimAmount);

        vm.startPrank(landlord);
        usdc.approve(address(propDep), claimAmount);
        propDep.postBond(id);
        vm.stopPrank();

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(landlord);
        propDep.withdrawClaim(id);

        // Bond returned to landlord, deposit returned to tenant
        assertEq(usdc.balanceOf(landlord), lBefore + claimAmount);
        assertEq(usdc.balanceOf(tenant), tBefore + PROP_DEP_AMT);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  CANCEL DISPUTE (by bond poster)
    // ═════════════════════════════════════════════════════════════════════════

    function test_cancelDispute_bondReturned_depositToTenant() public {
        uint256 id = _createAndActivateWithPropDep();
        uint256 claimAmount = 1000e6;

        _fileAndDisputeClaim(id, claimAmount);

        vm.startPrank(landlord);
        usdc.approve(address(propDep), claimAmount);
        propDep.postBond(id);
        vm.stopPrank();

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(landlord);
        propDep.cancelDispute(id);

        assertEq(usdc.balanceOf(landlord), lBefore + claimAmount);
        assertEq(usdc.balanceOf(tenant), tBefore + PROP_DEP_AMT);
    }

    function test_cancelDispute_revertsIfNotBondPoster() public {
        uint256 id = _createAndActivateWithPropDep();

        _fileAndDisputeClaim(id, 1000e6);

        vm.startPrank(landlord);
        usdc.approve(address(propDep), 1000e6);
        propDep.postBond(id);
        vm.stopPrank();

        vm.prank(tenant);
        vm.expectRevert("Only bond poster can cancel");
        propDep.cancelDispute(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  MUTUAL SETTLEMENT
    // ═════════════════════════════════════════════════════════════════════════

    function test_mutualSettlement_success() public {
        uint256 id = _createAndActivateWithPropDep();
        uint256 claimAmount = 1000e6;

        _fileAndDisputeClaim(id, claimAmount);

        vm.startPrank(landlord);
        usdc.approve(address(propDep), claimAmount);
        propDep.postBond(id);
        vm.stopPrank();

        uint256 toLandlord = 1200e6;
        uint256 toTenant = PROP_DEP_AMT - toLandlord;

        vm.prank(tenant);
        propDep.proposeMutualSettlement(id, toLandlord, toTenant);

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(landlord);
        propDep.confirmMutualSettlement(id, toLandlord, toTenant);

        // Bond returned + settlement amounts
        assertEq(usdc.balanceOf(landlord), lBefore + claimAmount + toLandlord);
        assertEq(usdc.balanceOf(tenant), tBefore + toTenant);
    }

    /// @notice FIXED: settlement proposal front-run now blocked by expected amounts check
    function test_FIXED_settlementFrontrun_blocked() public {
        uint256 id = _createAndActivateWithPropDep();

        _fileAndDisputeClaim(id, 1000e6);

        vm.startPrank(landlord);
        usdc.approve(address(propDep), 1000e6);
        propDep.postBond(id);
        vm.stopPrank();

        // Tenant proposes fair split
        vm.prank(tenant);
        propDep.proposeMutualSettlement(id, 1500e6, 1500e6);

        // Before landlord confirms, tenant overwrites with unfair split
        vm.prank(tenant);
        propDep.proposeMutualSettlement(id, 0, PROP_DEP_AMT);

        // Landlord confirms with original expected amounts — reverts because proposal changed
        vm.prank(landlord);
        vm.expectRevert("Proposal changed");
        propDep.confirmMutualSettlement(id, 1500e6, 1500e6);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  POST BOND — NO DEADLINE CHECK (BUG)
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice FIXED: landlord cannot post bond after bond posting period expired.
    function test_FIXED_postBond_afterDeadline_reverts() public {
        uint256 id = _createAndActivateWithPropDep();

        _fileAndDisputeClaim(id, 1000e6);

        // Wait past bond posting period
        PropDepEscrow.PropDep memory p = propDep.getPropDep(id);
        vm.warp(p.claimDeadline + 3 days + 1);

        // Landlord cannot post bond after deadline — correctly reverts
        vm.startPrank(landlord);
        usdc.approve(address(propDep), 1000e6);
        vm.expectRevert("Bond posting period expired");
        propDep.postBond(id);
        vm.stopPrank();
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  WINDOW EXPIRY
    // ═════════════════════════════════════════════════════════════════════════

    function test_expirePropDepWindow_noClaim() public {
        uint256 id = _createAndActivateWithPropDep();

        PropDepEscrow.PropDep memory p = propDep.getPropDep(id);
        vm.warp(p.windowEnd + 1);

        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(stranger);
        propDep.expirePropDepWindow(id);

        assertEq(usdc.balanceOf(tenant), tBefore + PROP_DEP_AMT);
    }

    function test_expirePropDepWindow_revertsBeforeWindowEnd() public {
        uint256 id = _createAndActivateWithPropDep();

        PropDepEscrow.PropDep memory p = propDep.getPropDep(id);
        vm.warp(p.windowEnd - 1);

        vm.expectRevert("Window still open");
        propDep.expirePropDepWindow(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  RELEASE DEPOSIT EARLY (landlord voluntary)
    // ═════════════════════════════════════════════════════════════════════════

    function test_releaseDepositEarly() public {
        uint256 id = _createAndActivateWithPropDep();

        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(landlord);
        propDep.releaseDepositEarly(id);

        assertEq(usdc.balanceOf(tenant), tBefore + PROP_DEP_AMT);
        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Settled));
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  ACCESS CONTROL
    // ═════════════════════════════════════════════════════════════════════════

    function test_fileDamageClaim_revertsIfNotLandlord() public {
        uint256 id = _createAndActivateWithPropDep();
        _moveIntoWindow(id);

        vm.prank(tenant);
        vm.expectRevert("Not landlord");
        propDep.fileDamageClaim(id, 1000e6);
    }

    function test_disputeClaim_revertsIfNotTenant() public {
        uint256 id = _createAndActivateWithPropDep();
        _moveIntoWindow(id);

        vm.prank(landlord);
        propDep.fileDamageClaim(id, 1000e6);

        vm.prank(landlord);
        vm.expectRevert("Not tenant");
        propDep.disputeClaim(id);
    }

    function test_createPropDep_revertsIfNotMainContract() public {
        vm.prank(stranger);
        vm.expectRevert("Not main contract");
        propDep.createPropDep(999, tenant, landlord, 1000e6, block.timestamp + 30 days);
    }

    function test_syncLeaseEndTime_revertsIfNotMainContract() public {
        uint256 id = _createAndActivateWithPropDep();

        vm.prank(stranger);
        vm.expectRevert("Not main contract");
        propDep.syncLeaseEndTime(id, block.timestamp + 60 days);
    }

    function test_devFunctions_revertIfNotOwner() public {
        uint256 id = _createAndActivateWithPropDep();

        vm.prank(stranger);
        vm.expectRevert("Not owner");
        propDep._devSetLeaseEndTime(id, block.timestamp + 1);

        // Put into Frozen for _devForceFreezeExpired
        _fileAndDisputeClaim(id, 1000e6);
        vm.startPrank(landlord);
        usdc.approve(address(propDep), 1000e6);
        propDep.postBond(id);
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert("Not owner");
        propDep._devForceFreezeExpired(id);
    }
}
