// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC2 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @title RentalEscrow Security Tests
/// @notice Covers: payRent, exitWithLoss, early termination (mutual + disputed),
///         counterpartyContest, signMutualExit, concedeDispute, acceptDisputeExit,
///         releaseFrozenFunds, cancelDisputeExit, confirmEarlySettlement,
///         expireByLeaseEnd, emergencySettleExpired, endLease double-spend,
///         access control, and edge cases.
contract RentalEscrowSecurityTest is Test {
    RentalEscrow public escrow;
    PropDepEscrow public propDep;
    MockUSDC2 public usdc;

    address tenant = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address treasury = makeAddr("treasury");
    address stranger = makeAddr("stranger");
    address deployer;

    uint256 constant RENT = 1500e6;
    uint256 constant PROP_DEP = 3000e6;

    function setUp() public {
        deployer = address(this);
        usdc = new MockUSDC2();
        escrow = new RentalEscrow(address(usdc), treasury);
        propDep = new PropDepEscrow(address(usdc), address(escrow));
        escrow.setPropDepEscrow(address(propDep));

        usdc.mint(tenant, 10_000_000e6);
        usdc.mint(landlord, 10_000_000e6);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _createAndFund(uint256 propAmount) internal returns (uint256 id) {
        vm.prank(landlord);
        id = escrow.createAgreement(tenant, landlord, RENT, propAmount, 6, bytes32(0));

        vm.startPrank(tenant);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        vm.startPrank(landlord);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.landlordDeposit(id);
        vm.stopPrank();
    }

    function _createAndFundNoPropDep() internal returns (uint256 id) {
        return _createAndFund(0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PAY RENT
    // ═════════════════════════════════════════════════════════════════════════

    function test_payRent_success() public {
        uint256 id = _createAndFundNoPropDep();
        uint256 lBefore = usdc.balanceOf(landlord);

        // Warp to just before first rent due (30 days from activation)
        vm.warp(block.timestamp + 25 days);

        vm.prank(tenant);
        escrow.payRent(id);

        assertEq(usdc.balanceOf(landlord), lBefore + RENT);
        assertEq(escrow.getAgreement(id).rentPaymentsMade, 1);
    }

    function test_payRent_revertsIfNotTenant() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(landlord);
        vm.expectRevert();
        escrow.payRent(id);
    }

    function test_payRent_revertsAfterLeaseEnd() public {
        uint256 id = _createAndFundNoPropDep();
        vm.warp(block.timestamp + 181 days);

        vm.prank(tenant);
        vm.expectRevert();
        escrow.payRent(id);
    }

    function test_payRent_resetsGraceExtension() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(landlord);
        escrow.extendRentGrace(id, 7);
        assertEq(escrow.getAgreement(id).rentGraceExtension, 7 days);

        vm.warp(block.timestamp + 25 days);
        vm.prank(tenant);
        escrow.payRent(id);

        assertEq(escrow.getAgreement(id).rentGraceExtension, 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  FLAG RENT MISSED
    // ═════════════════════════════════════════════════════════════════════════

    function test_flagRentMissed_success() public {
        uint256 id = _createAndFundNoPropDep();

        // Warp past first rent due + grace (30 + 3 = 33 days)
        vm.warp(block.timestamp + 34 days);

        uint256 lBefore = usdc.balanceOf(landlord);

        vm.prank(stranger);
        escrow.flagRentMissed(id);

        // Landlord gets commitment + hosting (both deposits)
        assertEq(usdc.balanceOf(landlord), lBefore + RENT + RENT);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
    }

    function test_flagRentMissed_revertsIfNotOverdue() public {
        uint256 id = _createAndFundNoPropDep();
        vm.warp(block.timestamp + 32 days);

        vm.expectRevert(RentalEscrow.NotOverdueYet.selector);
        escrow.flagRentMissed(id);
    }

    function test_flagRentMissed_respectsGraceExtension() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(landlord);
        escrow.extendRentGrace(id, 7);

        // 30 + 3 + 7 = 40 days needed. At 39 days should still revert.
        vm.warp(block.timestamp + 39 days);
        vm.expectRevert(RentalEscrow.NotOverdueYet.selector);
        escrow.flagRentMissed(id);

        // At 41 days should work
        vm.warp(block.timestamp + 2 days);
        escrow.flagRentMissed(id);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  EXIT WITH LOSS
    // ═════════════════════════════════════════════════════════════════════════

    function test_exitWithLoss_tenantInitiator() public {
        uint256 id = _createAndFundNoPropDep();
        uint256 lBefore = usdc.balanceOf(landlord);

        vm.prank(tenant);
        escrow.exitWithLoss(id);

        // Landlord gets both deposits
        assertEq(usdc.balanceOf(landlord), lBefore + RENT + RENT);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));

        // Vacate deadline = 3 days for tenant
        assertEq(escrow.getAgreement(id).vacateDeadline, block.timestamp + 3 days);
    }

    function test_exitWithLoss_landlordInitiator() public {
        uint256 id = _createAndFundNoPropDep();
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(landlord);
        escrow.exitWithLoss(id);

        // Tenant gets both deposits
        assertEq(usdc.balanceOf(tenant), tBefore + RENT + RENT);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));

        // Vacate deadline = 7 days for landlord
        assertEq(escrow.getAgreement(id).vacateDeadline, block.timestamp + 7 days);
    }

    function test_exitWithLoss_revertsIfStranger() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(stranger);
        vm.expectRevert(RentalEscrow.NotAParty.selector);
        escrow.exitWithLoss(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  MUTUAL EARLY TERMINATION
    // ═════════════════════════════════════════════════════════════════════════

    function test_mutualExit_bothSign() public {
        uint256 id = _createAndFundNoPropDep();
        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Mutual);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.EarlyTermProposed));

        vm.prank(landlord);
        escrow.signMutualExit(id);

        // Each gets own deposit back
        assertEq(usdc.balanceOf(tenant), tBefore + RENT);
        assertEq(usdc.balanceOf(landlord), lBefore + RENT);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
    }

    function test_mutualExit_initiatorCannotSignOwn() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Mutual);

        vm.prank(tenant);
        vm.expectRevert();
        escrow.signMutualExit(id);
    }

    function test_mutualExit_expireIfNoResponse() public {
        uint256 id = _createAndFundNoPropDep();
        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Mutual);

        // Wait 8 days (response period = 7 days)
        vm.warp(block.timestamp + 8 days);

        vm.prank(stranger);
        escrow.expireEarlyTermProposal(id);

        // Both get deposits back
        assertEq(usdc.balanceOf(tenant), tBefore + RENT);
        assertEq(usdc.balanceOf(landlord), lBefore + RENT);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  COUNTERPARTY CONTEST (mutual → dispute)
    // ═════════════════════════════════════════════════════════════════════════

    function test_counterpartyContest_mutualToDispute() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Mutual);

        vm.prank(landlord);
        escrow.counterpartyContest(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.DisputeOpen));
        // disputeBondPoster = landlord (contester)
        assertEq(escrow.getAgreement(id).disputeBondPoster, landlord);
        // earlyTermInitiator = tenant (original proposer)
        assertEq(escrow.getAgreement(id).earlyTermInitiator, tenant);
    }

    function test_counterpartyContest_initiatorCannotContest() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Mutual);

        vm.prank(tenant);
        vm.expectRevert();
        escrow.counterpartyContest(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  DISPUTED EARLY TERMINATION (direct to DisputeOpen)
    // ═════════════════════════════════════════════════════════════════════════

    function test_disputedET_directToDisputeOpen() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.DisputeOpen));
        assertEq(escrow.getAgreement(id).disputeBondPoster, tenant);
        assertEq(escrow.getAgreement(id).earlyTermInitiator, tenant);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  DISPUTE RESOLUTION
    // ═════════════════════════════════════════════════════════════════════════

    function test_concedeDispute_initiatorLosesAll() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        uint256 lBefore = usdc.balanceOf(landlord);

        vm.prank(tenant);
        escrow.concedeDispute(id);

        // Landlord gets everything
        assertEq(usdc.balanceOf(landlord), lBefore + RENT + RENT);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
    }

    function test_concedeDispute_revertsIfNotInitiator() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        vm.prank(landlord);
        vm.expectRevert();
        escrow.concedeDispute(id);
    }

    function test_acceptDisputeExit_counterpartyAccepts() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        uint256 tBefore = usdc.balanceOf(tenant);

        // Landlord (counterparty) accepts = initiator (tenant) wins
        vm.prank(landlord);
        escrow.acceptDisputeExit(id);

        // earlyTermInitiator (tenant) gets everything
        assertEq(usdc.balanceOf(tenant), tBefore + RENT + RENT);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
    }

    function test_acceptDisputeExit_revertsIfInitiator() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        vm.prank(tenant);
        vm.expectRevert();
        escrow.acceptDisputeExit(id);
    }

    function test_releaseFrozenFunds_afterFreezeExpiry() public {
        uint256 id = _createAndFundNoPropDep();
        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        // Wait 61 days (freeze = 60 days)
        vm.warp(block.timestamp + 61 days);

        vm.prank(stranger);
        escrow.releaseFrozenFunds(id);

        // Wash: each gets own deposit back
        assertEq(usdc.balanceOf(tenant), tBefore + RENT);
        assertEq(usdc.balanceOf(landlord), lBefore + RENT);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
    }

    function test_releaseFrozenFunds_revertsBeforeExpiry() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        vm.warp(block.timestamp + 59 days);

        vm.expectRevert();
        escrow.releaseFrozenFunds(id);
    }

    function test_cancelDisputeExit_initiatorPenalized() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        uint256 lBefore = usdc.balanceOf(landlord);

        // Tenant (dispute initiator = disputeBondPoster) cancels
        vm.prank(tenant);
        escrow.cancelDisputeExit(id);

        // Landlord gets everything as penalty
        assertEq(usdc.balanceOf(landlord), lBefore + RENT + RENT);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
    }

    function test_cancelDisputeExit_revertsIfNotInitiator() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        vm.prank(landlord);
        vm.expectRevert();
        escrow.cancelDisputeExit(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  EARLY SETTLEMENT (split frozen funds)
    // ═════════════════════════════════════════════════════════════════════════

    function test_earlySettlement_proposeThenConfirm() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        // Tenant proposes 50/50 split
        vm.prank(tenant);
        escrow.proposeEarlySettlement(id, RENT, RENT);

        // Landlord confirms (H-4: must pass expected amounts)
        vm.prank(landlord);
        escrow.confirmEarlySettlement(id, RENT, RENT);

        assertEq(usdc.balanceOf(tenant), tBefore + RENT);
        assertEq(usdc.balanceOf(landlord), lBefore + RENT);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
    }

    function test_earlySettlement_proposerCannotConfirm() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        vm.prank(tenant);
        escrow.proposeEarlySettlement(id, RENT, RENT);

        vm.prank(tenant);
        vm.expectRevert();
        escrow.confirmEarlySettlement(id, RENT, RENT);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  CHECKOUT FLOW
    // ═════════════════════════════════════════════════════════════════════════

    // test_expireCheckout_landlordSilent removed — renewal/checkout flow removed by design.
    // Lease-end flow is: leaseEndTime passes → anyone calls endLease() → deposits returned.

    // ═════════════════════════════════════════════════════════════════════════
    //  BUG REPRODUCTIONS
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice FIXED: endLease sets LeaseEnded, expireByLeaseEnd now rejects LeaseEnded.
    function test_FIXED_doublespend_endLease_then_expireByLeaseEnd() public {
        uint256 id = _createAndFundNoPropDep();

        // Move past lease end
        vm.warp(block.timestamp + 181 days);

        // Step 1: endLease — deposits transferred directly
        escrow.endLease(id);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.LeaseEnded));

        // Step 2: expireByLeaseEnd — now correctly reverts
        vm.warp(block.timestamp + 61 days);

        vm.expectRevert(RentalEscrow.AlreadySettled.selector);
        escrow.expireByLeaseEnd(id);
    }

    /// @notice FIXED: expireByLeaseEnd no longer includes propSecurityDeposit when hasPropDep.
    function test_FIXED_propSecDeposit_excluded_expireByLeaseEnd() public {
        uint256 id = _createAndFund(PROP_DEP);

        assertEq(usdc.balanceOf(address(propDep)), PROP_DEP);

        vm.warp(block.timestamp + 300 days);

        escrow.expireByLeaseEnd(id);

        uint256 pending = escrow.pendingWithdrawals(tenant);
        // FIXED: only commitmentDeposit, not propSecurityDeposit
        assertEq(pending, RENT, "propDep correctly excluded from safety net refund");
    }

    /// @notice FIXED: emergencySettleExpired no longer includes propSecurityDeposit when hasPropDep.
    function test_FIXED_propSecDeposit_excluded_emergencySettle() public {
        uint256 id = _createAndFund(PROP_DEP);

        assertEq(usdc.balanceOf(address(propDep)), PROP_DEP);

        vm.warp(block.timestamp + 181 days);

        uint256 tBefore = usdc.balanceOf(tenant);
        escrow.emergencySettleExpired(id);

        // FIXED: tenant only gets commitmentDeposit, not propSecurityDeposit
        uint256 tReceived = usdc.balanceOf(tenant) - tBefore;
        assertEq(tReceived, RENT, "propDep correctly excluded from emergency settle");
    }

    /// @notice BUG: expireByLeaseEnd zeroes disputeBond before reading it.
    ///         In Sprint 4 bonds are zero in most flows, so we verify the code path works
    ///         but note the logic bug: a.disputeBond = 0 at line 1244, then checked at 1255.
    function test_BUG_disputeBond_zeroed_before_read() public {
        uint256 id = _createAndFundNoPropDep();

        // Get into DisputeOpen state
        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        // Need: max(leaseEndTime, freezeStart + freezeDuration) + 60 days
        // leaseEndTime = activatedAt + 180 days
        // freezeStart = now, freezeDuration = 60 days → freezeEnd = now + 60 days
        // latestDate = leaseEndTime (180 days > 60 days)
        // Need to warp past latestDate + 60 days = 240+ days from activation
        vm.warp(block.timestamp + 250 days);

        escrow.expireByLeaseEnd(id);

        // disputeBond was zeroed at line 1244, then checked at line 1255
        // so even if there was a bond, it would never be credited
        // In Sprint 4 bonds are zero, so this is dormant but still a code bug
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
    }

    /// @notice FIXED: isRentOverdue now uses same formula as flagRentMissed
    function test_FIXED_isRentOverdue_matchesFlagRentMissed() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(landlord);
        escrow.extendRentGrace(id, 7);

        // At 36 days: neither view nor flag should say overdue (grace extended to 42 days)
        vm.warp(block.timestamp + 36 days);

        bool viewSaysOverdue = escrow.isRentOverdue(id);
        assertFalse(viewSaysOverdue, "View correctly says not overdue with grace extension");

        vm.expectRevert(RentalEscrow.NotOverdueYet.selector);
        escrow.flagRentMissed(id);

        // At 43 days: both should agree it's overdue
        vm.warp(block.timestamp + 7 days);
        assertTrue(escrow.isRentOverdue(id), "Both agree: overdue");
    }

    /// @notice FIXED: stranger cannot create agreement for arbitrary parties
    function test_FIXED_createAgreement_strangerCannotCreate() public {
        vm.prank(stranger);
        vm.expectRevert(RentalEscrow.NotAParty.selector);
        escrow.createAgreement(tenant, landlord, RENT, 0, 1, bytes32(0));
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  CONTESTED MUTUAL — ROLE SEMANTICS
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice FIXED: In contested-mutual, earlyTermInitiator = tenant, disputeBondPoster = landlord.
    ///         Now acceptDisputeExit checks msg.sender != earlyTermInitiator (not disputeBondPoster).
    ///         So tenant (initiator) cannot call it. Landlord (contester) CAN call it = accepts
    ///         tenant's original mutual proposal, giving all to tenant.
    function test_FIXED_contestedMutual_acceptDisputeExit_semantics() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Mutual);

        vm.prank(landlord);
        escrow.counterpartyContest(id);

        // Tenant (earlyTermInitiator) cannot call acceptDisputeExit
        vm.prank(tenant);
        vm.expectRevert();
        escrow.acceptDisputeExit(id);

        // Landlord (contester) CAN call it → funds go to earlyTermInitiator (tenant)
        uint256 tBefore = usdc.balanceOf(tenant);
        vm.prank(landlord);
        escrow.acceptDisputeExit(id);

        assertEq(usdc.balanceOf(tenant), tBefore + RENT + RENT,
            "Landlord accepted, tenant (initiator) got funds");
    }

    /// @notice In contested-mutual: concedeDispute requires earlyTermInitiator
    ///         This means the original MUTUAL PROPOSER can concede, not the contester.
    function test_contestedMutual_concedeDispute_initiatorConcedes() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Mutual);

        vm.prank(landlord);
        escrow.counterpartyContest(id);

        uint256 lBefore = usdc.balanceOf(landlord);

        // Tenant (earlyTermInitiator) concedes → landlord gets everything
        vm.prank(tenant);
        escrow.concedeDispute(id);

        assertEq(usdc.balanceOf(landlord), lBefore + RENT + RENT);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  CANCEL UNFUNDED
    // ═════════════════════════════════════════════════════════════════════════

    function test_cancelUnfunded_tenantDeposited_landlordDidnt() public {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, PROP_DEP, 6, bytes32(0));

        vm.startPrank(tenant);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        // Wait past deposit deadline (24h)
        vm.warp(block.timestamp + 25 hours);

        uint256 tBefore = usdc.balanceOf(tenant);
        vm.prank(stranger);
        escrow.cancelUnfunded(id);

        // Tenant gets full refund: rent + commitment + propDep
        assertEq(usdc.balanceOf(tenant), tBefore + RENT + RENT + PROP_DEP);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  ACCESS CONTROL
    // ═════════════════════════════════════════════════════════════════════════

    function test_tenantDeposit_revertsIfNotTenant() public {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 1, bytes32(0));

        vm.prank(stranger);
        vm.expectRevert();
        escrow.tenantDeposit(id);
    }

    function test_landlordDeposit_revertsIfNotLandlord() public {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 1, bytes32(0));

        vm.prank(stranger);
        vm.expectRevert();
        escrow.landlordDeposit(id);
    }

    function test_devFunctions_revertIfNotOwner() public {
        uint256 id = _createAndFundNoPropDep();

        vm.prank(stranger);
        vm.expectRevert();
        escrow._devSetLeaseEndTime(id, block.timestamp + 1);

        vm.prank(stranger);
        vm.expectRevert();
        escrow._devSetTimes(id, 0, 0, 0, type(uint256).max);

        // Put into DisputeOpen first for _devForceFreezeExpired
        vm.prank(tenant);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);

        vm.prank(stranger);
        vm.expectRevert();
        escrow._devForceFreezeExpired(id);
    }

    function test_emergencySettleExpired_revertsIfNotOwner() public {
        uint256 id = _createAndFundNoPropDep();
        vm.warp(block.timestamp + 181 days);

        vm.prank(stranger);
        vm.expectRevert();
        escrow.emergencySettleExpired(id);
    }
}
