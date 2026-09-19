// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract PropDepEscrowTest is Test {
    PropDepEscrow public propDep;
    MockUSDC public usdc;

    address main = makeAddr("main");      // Simulated main contract
    address tenant = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address stranger = makeAddr("stranger");

    uint256 constant DEPOSIT = 3000e6;    // 3000 USDC = 2x rent of 1500
    uint256 constant CLAIM = 1000e6;      // 1000 USDC partial claim
    uint256 constant LEASE_DURATION = 30 days;

    function setUp() public {
        usdc = new MockUSDC();
        propDep = new PropDepEscrow(address(usdc), main);

        // Fund main contract so it can transfer to PropDepEscrow
        usdc.mint(main, DEPOSIT * 10);

        // Fund landlord for bond posting
        usdc.mint(landlord, DEPOSIT * 10);

        // Main approves PropDepEscrow once for unlimited
        vm.prank(main);
        usdc.approve(address(propDep), type(uint256).max);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    function _createPropDep(uint256 leaseId) internal returns (uint256 leaseEndTime) {
        leaseEndTime = block.timestamp + LEASE_DURATION;
        vm.prank(main);
        propDep.createPropDep(leaseId, tenant, landlord, DEPOSIT, leaseEndTime);
    }

    function _moveIntoWindow(uint256 leaseId) internal {
        PropDepEscrow.PropDep memory p = propDep.getPropDep(leaseId);
        vm.warp(p.windowStart + 1);
    }

    function _moveAfterWindow(uint256 leaseId) internal {
        PropDepEscrow.PropDep memory p = propDep.getPropDep(leaseId);
        vm.warp(p.windowEnd + 1);
    }

    function _createPropDepWithAmount(uint256 leaseId, uint256 amount) internal returns (uint256 leaseEndTime) {
        leaseEndTime = block.timestamp + LEASE_DURATION;
        vm.prank(main);
        propDep.createPropDep(leaseId, tenant, landlord, amount, leaseEndTime);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  1. CREATION
    // ═════════════════════════════════════════════════════════════════════════════

    function test_createPropDep_success() public {
        uint256 endTime = _createPropDep(1);
        PropDepEscrow.PropDep memory p = propDep.getPropDep(1);

        assertEq(p.leaseId, 1);
        assertEq(p.tenant, tenant);
        assertEq(p.landlord, landlord);
        assertEq(p.amount, DEPOSIT);
        assertEq(uint(p.state), uint(PropDepEscrow.PropDepState.Active));
        assertEq(p.leaseEndTime, endTime);
        assertEq(p.windowStart, endTime - 7 days);
        assertEq(p.windowEnd, endTime + 7 days);
        assertEq(usdc.balanceOf(address(propDep)), DEPOSIT);
    }

    function test_createPropDep_revertsIfNotMain() public {
        vm.prank(stranger);
        vm.expectRevert("Not main contract");
        propDep.createPropDep(1, tenant, landlord, DEPOSIT, block.timestamp + LEASE_DURATION);
    }

    function test_createPropDep_revertsIfDuplicate() public {
        _createPropDep(1);
        vm.prank(main);
        vm.expectRevert("Already exists");
        propDep.createPropDep(1, tenant, landlord, DEPOSIT, block.timestamp + LEASE_DURATION);
    }

    function test_createPropDep_revertsIfZeroAmount() public {
        vm.prank(main);
        vm.expectRevert("Amount zero");
        propDep.createPropDep(1, tenant, landlord, 0, block.timestamp + LEASE_DURATION);
    }

    function test_createPropDep_revertsIfLeaseEndInPast() public {
        vm.warp(1000000);
        vm.prank(main);
        vm.expectRevert("Lease end in past");
        propDep.createPropDep(1, tenant, landlord, DEPOSIT, block.timestamp - 1);
    }

    function test_syncLeaseEndTime_updatesWindow() public {
        _createPropDep(1);
        uint256 newEnd = block.timestamp + 60 days;

        vm.prank(main);
        propDep.syncLeaseEndTime(1, newEnd);

        PropDepEscrow.PropDep memory p = propDep.getPropDep(1);
        assertEq(p.leaseEndTime, newEnd);
        assertEq(p.windowStart, newEnd - 7 days);
        assertEq(p.windowEnd, newEnd + 7 days);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  2. WINDOW EXPIRY (no claim filed)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_expirePropDepWindow_returnsToTenant() public {
        _createPropDep(1);
        _moveAfterWindow(1);

        uint256 tenantBalBefore = usdc.balanceOf(tenant);
        vm.prank(stranger); // anyone can call
        propDep.expirePropDepWindow(1);

        assertEq(usdc.balanceOf(tenant), tenantBalBefore + DEPOSIT);
        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Settled));
    }

    function test_expirePropDepWindow_revertsIfWindowOpen() public {
        _createPropDep(1);
        _moveIntoWindow(1);

        vm.expectRevert("Window still open");
        propDep.expirePropDepWindow(1);
    }

    function test_expirePropDepWindow_revertsIfClaimActive() public {
        _createPropDep(1);
        _moveIntoWindow(1);

        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);

        _moveAfterWindow(1);
        vm.expectRevert("Cannot expire - claim active");
        propDep.expirePropDepWindow(1);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  3. FILE DAMAGE CLAIM
    // ═════════════════════════════════════════════════════════════════════════════

    function test_fileDamageClaim_inWindow() public {
        _createPropDep(1);
        _moveIntoWindow(1);

        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);

        PropDepEscrow.PropDep memory p = propDep.getPropDep(1);
        assertEq(p.claimAmount, CLAIM);
        assertEq(uint(p.state), uint(PropDepEscrow.PropDepState.Claimed));
        assertEq(p.claimDeadline, block.timestamp + 3 days);
    }

    function test_fileDamageClaim_revertsIfBeforeWindow() public {
        _createPropDep(1);
        // Don't move time — still way before window
        vm.prank(landlord);
        vm.expectRevert("Window not open");
        propDep.fileDamageClaim(1, CLAIM);
    }

    function test_fileDamageClaim_revertsIfAfterWindow() public {
        _createPropDep(1);
        _moveAfterWindow(1);

        vm.prank(landlord);
        vm.expectRevert("Window closed");
        propDep.fileDamageClaim(1, CLAIM);
    }

    function test_fileDamageClaim_revertsIfNotLandlord() public {
        _createPropDep(1);
        _moveIntoWindow(1);

        vm.prank(tenant);
        vm.expectRevert("Not landlord");
        propDep.fileDamageClaim(1, CLAIM);
    }

    function test_fileDamageClaim_revertsIfExceedsDeposit() public {
        _createPropDep(1);
        _moveIntoWindow(1);

        vm.prank(landlord);
        vm.expectRevert("Invalid claim amount");
        propDep.fileDamageClaim(1, DEPOSIT + 1);
    }

    function test_fileDamageClaim_revertsIfBelowMinimum_tiny() public {
        // 8 USDC deposit, claim 1 USDC (12.5%) — below 30% minimum
        uint256 dep = 8e6;
        _createPropDepWithAmount(1, dep);
        _moveIntoWindow(1);

        vm.prank(landlord);
        vm.expectRevert("Claim below minimum");
        propDep.fileDamageClaim(1, 1e6);
    }

    function test_fileDamageClaim_revertsIfBelowMinimum_justBelow() public {
        // 8 USDC deposit, 30% = 2.4 USDC. Claim 2.39 USDC → below minimum
        uint256 dep = 8e6;
        _createPropDepWithAmount(1, dep);
        _moveIntoWindow(1);

        vm.prank(landlord);
        vm.expectRevert("Claim below minimum");
        propDep.fileDamageClaim(1, 2_390_000); // 2.39 USDC
    }

    function test_fileDamageClaim_succeedsAtMinimum() public {
        // 8 USDC deposit, 30% = ceil(8e6 * 3000 / 10000) = 2.4 USDC
        uint256 dep = 8e6;
        _createPropDepWithAmount(1, dep);
        _moveIntoWindow(1);

        vm.prank(landlord);
        propDep.fileDamageClaim(1, 2_400_000); // 2.4 USDC — exactly at minimum

        PropDepEscrow.PropDep memory p = propDep.getPropDep(1);
        assertEq(p.claimAmount, 2_400_000);
        assertEq(uint(p.state), uint(PropDepEscrow.PropDepState.Claimed));
    }

    function test_fileDamageClaim_fullAmountStillWorks() public {
        // Full deposit claim should still work
        _createPropDep(1);
        _moveIntoWindow(1);

        vm.prank(landlord);
        propDep.fileDamageClaim(1, DEPOSIT);

        PropDepEscrow.PropDep memory p = propDep.getPropDep(1);
        assertEq(p.claimAmount, DEPOSIT);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  4. ACCEPT CLAIM (before bond)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_acceptClaim_distributesCorrectly() public {
        _createPropDep(1);
        _moveIntoWindow(1);

        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(tenant);
        propDep.acceptClaim(1);

        assertEq(usdc.balanceOf(landlord), lBefore + CLAIM);
        assertEq(usdc.balanceOf(tenant), tBefore + (DEPOSIT - CLAIM));
        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Settled));
    }

    function test_acceptClaim_revertsIfNotTenant() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);

        vm.prank(landlord);
        vm.expectRevert("Not tenant");
        propDep.acceptClaim(1);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  5. WITHDRAW CLAIM (landlord changes mind)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_withdrawClaim_returnsToTenant() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);

        uint256 tBefore = usdc.balanceOf(tenant);
        vm.prank(landlord);
        propDep.withdrawClaim(1);

        assertEq(usdc.balanceOf(tenant), tBefore + DEPOSIT);
        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Settled));
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  6. EXECUTE EXPIRED CLAIM (tenant silent)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_executeExpiredClaim_afterDeadline() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);

        // Tenant is silent, deadline passes
        vm.warp(block.timestamp + 4 days);

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(stranger);
        propDep.executeExpiredClaim(1);

        assertEq(usdc.balanceOf(landlord), lBefore + CLAIM);
        assertEq(usdc.balanceOf(tenant), tBefore + (DEPOSIT - CLAIM));
        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Settled));
    }

    function test_executeExpiredClaim_revertsBeforeDeadline() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);

        vm.expectRevert("Deadline not passed");
        propDep.executeExpiredClaim(1);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  7. DISPUTE FLOW
    // ═════════════════════════════════════════════════════════════════════════════

    function test_disputeClaim_movesToDisputed() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);

        vm.prank(tenant);
        propDep.disputeClaim(1);

        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Disputed));
    }

    function test_expireDamageClaim_dropsClaimIfNoBond() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);
        vm.prank(tenant);
        propDep.disputeClaim(1);

        // Landlord doesn't post bond, 3 days pass
        vm.warp(block.timestamp + 7 days);

        uint256 tBefore = usdc.balanceOf(tenant);
        vm.prank(stranger);
        propDep.expireDamageClaim(1);

        assertEq(usdc.balanceOf(tenant), tBefore + DEPOSIT);
        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Settled));
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  8. POST BOND → FROZEN STATE
    // ═════════════════════════════════════════════════════════════════════════════

    function test_postBond_movesToFrozen() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);
        vm.prank(tenant);
        propDep.disputeClaim(1);

        vm.startPrank(landlord);
        usdc.approve(address(propDep), CLAIM);
        propDep.postBond(1);
        vm.stopPrank();

        PropDepEscrow.PropDep memory p = propDep.getPropDep(1);
        assertEq(p.disputeBond, CLAIM);
        assertEq(p.bondPoster, landlord);
        assertEq(uint(p.state), uint(PropDepEscrow.PropDepState.Frozen));
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  9. ACCEPT CLAIM AFTER BOND (tenant gives up wait)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_acceptClaimAfterBond_distributesCorrectly() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);
        vm.prank(tenant);
        propDep.disputeClaim(1);
        vm.startPrank(landlord);
        usdc.approve(address(propDep), CLAIM);
        propDep.postBond(1);
        vm.stopPrank();

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(tenant);
        propDep.acceptClaimAfterBond(1);

        // Landlord gets bond back + claim
        assertEq(usdc.balanceOf(landlord), lBefore + CLAIM + CLAIM);
        // Tenant gets remainder
        assertEq(usdc.balanceOf(tenant), tBefore + (DEPOSIT - CLAIM));
        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Settled));
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  10. CANCEL DISPUTE (landlord gives up)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_cancelDispute_returnsToTenant() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);
        vm.prank(tenant);
        propDep.disputeClaim(1);
        vm.startPrank(landlord);
        usdc.approve(address(propDep), CLAIM);
        propDep.postBond(1);
        vm.stopPrank();

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(landlord);
        propDep.cancelDispute(1);

        // Landlord gets bond back, nothing else
        assertEq(usdc.balanceOf(landlord), lBefore + CLAIM);
        // Tenant gets full deposit
        assertEq(usdc.balanceOf(tenant), tBefore + DEPOSIT);
        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Settled));
    }

    function test_cancelDispute_revertsIfNotBondPoster() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);
        vm.prank(tenant);
        propDep.disputeClaim(1);
        vm.startPrank(landlord);
        usdc.approve(address(propDep), CLAIM);
        propDep.postBond(1);
        vm.stopPrank();

        vm.prank(tenant);
        vm.expectRevert("Only bond poster can cancel");
        propDep.cancelDispute(1);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  11. RELEASE FROZEN FUNDS (60-day expiry)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_releaseFrozenFunds_after60Days() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);
        vm.prank(tenant);
        propDep.disputeClaim(1);
        vm.startPrank(landlord);
        usdc.approve(address(propDep), CLAIM);
        propDep.postBond(1);
        vm.stopPrank();

        vm.warp(block.timestamp + 61 days);

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(stranger);
        propDep.releaseFrozenFunds(1);

        // Bond → landlord, deposit → tenant
        assertEq(usdc.balanceOf(landlord), lBefore + CLAIM);
        assertEq(usdc.balanceOf(tenant), tBefore + DEPOSIT);
        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Settled));
    }

    function test_releaseFrozenFunds_revertsBefore60Days() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);
        vm.prank(tenant);
        propDep.disputeClaim(1);
        vm.startPrank(landlord);
        usdc.approve(address(propDep), CLAIM);
        propDep.postBond(1);
        vm.stopPrank();

        vm.warp(block.timestamp + 30 days);

        vm.expectRevert("Freeze not expired");
        propDep.releaseFrozenFunds(1);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  12. MUTUAL SETTLEMENT (in Frozen state)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_mutualSettlement_distributesPerAgreement() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);
        vm.prank(tenant);
        propDep.disputeClaim(1);
        vm.startPrank(landlord);
        usdc.approve(address(propDep), CLAIM);
        propDep.postBond(1);
        vm.stopPrank();

        // Propose 50/50 split of deposit
        uint256 toL = DEPOSIT / 2;
        uint256 toT = DEPOSIT - toL;

        vm.prank(landlord);
        propDep.proposeMutualSettlement(1, toL, toT);

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(tenant);
        propDep.confirmMutualSettlement(1, toL, toT);

        // Landlord: bond back + half deposit
        assertEq(usdc.balanceOf(landlord), lBefore + CLAIM + toL);
        // Tenant: half deposit
        assertEq(usdc.balanceOf(tenant), tBefore + toT);
        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Settled));
    }

    function test_mutualSettlement_revertsIfProposerConfirms() public {
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);
        vm.prank(tenant);
        propDep.disputeClaim(1);
        vm.startPrank(landlord);
        usdc.approve(address(propDep), CLAIM);
        propDep.postBond(1);
        vm.stopPrank();

        vm.prank(landlord);
        propDep.proposeMutualSettlement(1, DEPOSIT, 0);

        vm.prank(landlord);
        vm.expectRevert("Proposer cannot confirm");
        propDep.confirmMutualSettlement(1, DEPOSIT, 0);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  13. OWNER CONFIG (DEV mode)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_setPropDepWindowDuration_works() public {
        propDep.setPropDepWindowDuration(2 days);
        assertEq(propDep.propDepWindowDuration(), 2 days);
    }

    function test_setFreezeDuration_works() public {
        propDep.setFreezeDuration(14 days);
        assertEq(propDep.freezeDuration(), 14 days);
    }

    function test_devSetLeaseEndTime_updatesWindow() public {
        _createPropDep(1);
        uint256 newEnd = block.timestamp + 30 days;
        propDep.setPropDepWindowDuration(3 days);
        propDep.setFreezeDuration(14 days);
        propDep._devSetLeaseEndTime(1, newEnd);

        PropDepEscrow.PropDep memory p = propDep.getPropDep(1);
        assertEq(p.leaseEndTime, newEnd);
        assertEq(p.windowStart, newEnd - 3 days);
        assertEq(p.windowEnd, newEnd + 3 days);
    }

    // ─── _devForceFreezeExpired ───────────────────────────────────────────────────

    /// @notice _devForceFreezeExpired must allow releaseFrozenFunds to be called immediately.
    ///         Bug before fix: it moved freezeStart, but releaseFrozenFunds checks freezeEnd (snapshot).
    function test_devForceFreezeExpired_allowsRelease() public {
        // Setup: create → window → claim → dispute → bond → Frozen
        _createPropDep(1);
        _moveIntoWindow(1);
        vm.prank(landlord);
        propDep.fileDamageClaim(1, CLAIM);
        vm.prank(tenant);
        propDep.disputeClaim(1);
        vm.startPrank(landlord);
        usdc.approve(address(propDep), CLAIM);
        propDep.postBond(1);
        vm.stopPrank();

        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Frozen));

        // Without dev helper, releaseFrozenFunds should revert (freeze not expired)
        vm.expectRevert("Freeze not expired");
        propDep.releaseFrozenFunds(1);

        // After _devForceFreezeExpired, releaseFrozenFunds should succeed immediately
        propDep._devForceFreezeExpired(1);

        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);
        propDep.releaseFrozenFunds(1);

        // Bond returns to landlord, deposit returns to tenant
        assertEq(usdc.balanceOf(landlord), lBefore + CLAIM);
        assertEq(usdc.balanceOf(tenant), tBefore + DEPOSIT);
        assertEq(uint(propDep.getState(1)), uint(PropDepEscrow.PropDepState.Settled));
    }
}
