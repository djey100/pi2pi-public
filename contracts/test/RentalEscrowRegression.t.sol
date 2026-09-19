// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {ILendingAdapter} from "../src/interfaces/ILendingAdapter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Mock tokens ─────────────────────────────────────────────────────────────

contract MockUSDCR is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ─── Mock adapters ────────────────────────────────────────────────────────────

/// @dev Normal adapter: supply holds funds, withdraw returns principal + optional yield.
contract NormalAdapter is ILendingAdapter {
    MockUSDCR public usdc;
    address public escrow;
    uint256 public stored;
    uint256 public yieldBps;

    constructor(address _usdc, address _escrow, uint256 _yieldBps) {
        usdc = MockUSDCR(_usdc);
        escrow = _escrow;
        yieldBps = _yieldBps;
    }

    function supply(uint256 amount) external returns (uint256) {
        usdc.transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount; // scaled = amount when index = RAY
    }

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 extra = amount * yieldBps / 10000;
        uint256 toSend = amount + extra;
        if (extra > 0) usdc.mint(address(this), extra);
        usdc.transfer(escrow, toSend);
        stored = stored >= amount ? stored - amount : 0;
        return toSend;
    }

    function getIndex() external pure returns (uint256) { return 1e27; }
}

/// @dev Adapter that starts paused (hard failure) and can be unpaused later.
///      Avoids the need for storage-slot manipulation to swap adapters.
contract PausableAdapter is ILendingAdapter {
    MockUSDCR public usdc;
    address public escrow;
    uint256 public stored;
    bool public paused = true; // starts paused — withdraw() reverts until unpause()

    constructor(address _usdc, address _escrow) {
        usdc = MockUSDCR(_usdc);
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

/// @dev Returns 0 without reverting (ERC-4626 vault frozen / empty).
contract ZeroReturnAdapter is ILendingAdapter {
    MockUSDCR public usdc;
    address public escrow;
    uint256 public stored;

    constructor(address _usdc, address _escrow) {
        usdc = MockUSDCR(_usdc);
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

/// @title Regression tests for security fixes
/// @notice Every test targets a specific fix; passing on post-fix code, failing on pre-fix.
///         Six findings: C-1 devMode whitelist, C-2 recovery, received==0, unactivated rent,
///         emergencySettleExpired PropDep window, _devForceFreezeExpired.
contract RentalEscrowRegressionTest is Test {
    MockUSDCR usdc;
    RentalEscrow escrow;
    PropDepEscrow propDep;

    address tenant   = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address treasury = makeAddr("treasury");

    uint256 constant RENT     = 1_500e6;
    uint256 constant PROP_DEP = 3_000e6;

    function setUp() public {
        usdc    = new MockUSDCR();
        escrow  = new RentalEscrow(address(usdc), treasury);
        propDep = new PropDepEscrow(address(usdc), address(escrow));
        escrow.setPropDepEscrow(address(propDep));

        usdc.mint(tenant,   100_000e6);
        usdc.mint(landlord, 100_000e6);

        vm.startPrank(tenant);
        usdc.approve(address(escrow), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(landlord);
        usdc.approve(address(escrow), type(uint256).max);
        usdc.approve(address(propDep), type(uint256).max);
        vm.stopPrank();
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /// @dev Create active agreement with optional lending adapter wired BEFORE activation.
    ///      Adapter must be wired before deposits so lending triggers at _activate time.
    function _createActiveWithAdapter(uint256 propAmt, address adapter) internal returns (uint256 id) {
        vm.prank(landlord);
        id = escrow.createAgreement(tenant, landlord, RENT, propAmt, 6, bytes32(0));

        if (adapter != address(0)) {
            // Called as test contract (= escrow owner)
            escrow.setLendingAdapter(adapter);
            escrow.emergencyEnableLending();
        }

        vm.prank(tenant);   escrow.tenantDeposit(id);
        vm.prank(landlord); escrow.landlordDeposit(id);
    }

    function _createActive(uint256 propAmt) internal returns (uint256 id) {
        return _createActiveWithAdapter(propAmt, address(0));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  C-1: devMode whitelist
    // ═══════════════════════════════════════════════════════════════════════════

    function test_C1_devMode_true_on_anvil() public view {
        assertEq(block.chainid, 31337);
        assertTrue(escrow.devMode());
        assertTrue(propDep.devMode());
    }

    function test_C1_devMode_false_on_unknown_chain() public {
        vm.chainId(9999999);
        RentalEscrow e2 = new RentalEscrow(address(usdc), treasury);
        PropDepEscrow p2 = new PropDepEscrow(address(usdc), address(e2));
        assertFalse(e2.devMode(), "devMode must be false on unknown chain");
        assertFalse(p2.devMode(), "PropDep devMode must be false on unknown chain");
    }

    function test_C1_devMode_false_on_eth_mainnet() public {
        vm.chainId(1);
        RentalEscrow e3 = new RentalEscrow(address(usdc), treasury);
        assertFalse(e3.devMode());
    }

    function test_C1_devMode_true_on_arc_testnet() public {
        vm.chainId(5042002);
        RentalEscrow eArc = new RentalEscrow(address(usdc), treasury);
        assertTrue(eArc.devMode(), "devMode must be true on Arc Testnet");
    }

    function test_C1_warp_blocked_when_devMode_false() public {
        vm.chainId(1);
        RentalEscrow mainnet = new RentalEscrow(address(usdc), treasury);
        assertFalse(mainnet.devMode());
        vm.expectRevert();
        mainnet.warp(1 days);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  received==0 treated as hard failure
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev When adapter returns 0 without reverting, position must NOT be deleted.
    ///      Pre-fix: position deleted on zero return -> recovery impossible.
    function test_receivedZero_positionSurvives_afterFlagRentMissed() public {
        ZeroReturnAdapter za = new ZeroReturnAdapter(address(usdc), address(escrow));
        uint256 id = _createActiveWithAdapter(0, address(za));

        (uint256 lentPrincipal,) = escrow.lendingPositions(id);
        assertGt(lentPrincipal, 0, "Funds must be lent at activation");

        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0, "BUG: position deleted on zero return - recovery impossible");
    }

    /// @dev reclaimLentFundsAfterSettlement must revert (not silently no-op) when vault still returns 0.
    ///      Pre-fix: silent `return` after deleting position -> funds lost.
    function test_receivedZero_reclaimReverts_notSilent() public {
        ZeroReturnAdapter za = new ZeroReturnAdapter(address(usdc), address(escrow));
        uint256 id = _createActiveWithAdapter(0, address(za));

        (uint256 lentPrincipal,) = escrow.lendingPositions(id);
        assertGt(lentPrincipal, 0);

        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        vm.expectRevert(RentalEscrow.LendingUnavailable.selector);
        escrow.reclaimLentFundsAfterSettlement(id);

        (uint256 pos,) = escrow.lendingPositions(id);
        assertGt(pos, 0, "Position must survive failed reclaim");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  C-2: recovery distribution — PausableAdapter
    //
    //  PausableAdapter starts paused (withdraw reverts) to simulate hard Aave failure,
    //  then can be unpaused so reclaimLentFundsAfterSettlement succeeds.
    //  This avoids storage-slot manipulation for adapter swaps.
    //
    //  reclaimLentFundsAfterSettlement distributes via pendingWithdrawals (pull pattern).
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev flagRentMissed + hard Aave failure + adapter recovers -> 100% to landlord.
    ///      Pre-fix: reclaimLentFundsAfterSettlement would split 50/50 (no override stored).
    function test_C2_recovery_flagRentMissed_landlordGetsAll() public {
        PausableAdapter pa = new PausableAdapter(address(usdc), address(escrow));
        uint256 id = _createActiveWithAdapter(0, address(pa));

        (uint256 lentPrincipal,) = escrow.lendingPositions(id);
        assertGt(lentPrincipal, 0, "Funds must be lent");

        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0, "Position must survive hard Aave failure");

        // Unpause adapter — simulates Aave resuming; funds are still in adapter
        pa.unpause();
        escrow.reclaimLentFundsAfterSettlement(id);

        // reclaimLentFundsAfterSettlement uses pendingWithdrawals (pull pattern)
        assertEq(escrow.pendingWithdrawals(tenant),   0,             "Tenant must receive 0");
        assertEq(escrow.pendingWithdrawals(landlord), lentPrincipal, "Landlord gets 100%");
    }

    /// @dev exitWithLoss (tenant initiator) + hard failure -> landlord (counterparty) gets 100%.
    function test_C2_recovery_exitWithLoss_tenantInitiator_landlordGetsAll() public {
        PausableAdapter pa = new PausableAdapter(address(usdc), address(escrow));
        uint256 id = _createActiveWithAdapter(0, address(pa));

        (uint256 lentPrincipal,) = escrow.lendingPositions(id);
        assertGt(lentPrincipal, 0);

        vm.prank(tenant);
        escrow.exitWithLoss(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0, "Position must survive");

        pa.unpause();
        escrow.reclaimLentFundsAfterSettlement(id);

        assertEq(escrow.pendingWithdrawals(tenant),   0,             "Tenant gets 0");
        assertEq(escrow.pendingWithdrawals(landlord), lentPrincipal, "Landlord gets all");
    }

    /// @dev exitWithLoss (landlord initiator) + hard failure -> tenant (counterparty) gets 100%.
    function test_C2_recovery_exitWithLoss_landlordInitiator_tenantGetsAll() public {
        PausableAdapter pa = new PausableAdapter(address(usdc), address(escrow));
        uint256 id = _createActiveWithAdapter(0, address(pa));

        (uint256 lentPrincipal,) = escrow.lendingPositions(id);
        assertGt(lentPrincipal, 0);

        vm.prank(landlord);
        escrow.exitWithLoss(id);

        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0);

        pa.unpause();
        escrow.reclaimLentFundsAfterSettlement(id);

        assertEq(escrow.pendingWithdrawals(tenant),   lentPrincipal, "Tenant gets all");
        assertEq(escrow.pendingWithdrawals(landlord), 0,             "Landlord gets 0");
    }

    /// @dev Dispute -> proposeEarlySettlement 6000/4000 + hard failure -> recovery splits 60/40.
    ///      Path: proposeEarlyTermination(Disputed) -> DisputeOpen ->
    ///            proposeEarlySettlement -> confirmEarlySettlement (Aave reverts) ->
    ///            adapter.unpause() -> reclaimLentFundsAfterSettlement.
    function test_C2_recovery_mutualSettlement_splitPreserved() public {
        PausableAdapter pa = new PausableAdapter(address(usdc), address(escrow));
        uint256 id = _createActiveWithAdapter(0, address(pa));

        (uint256 lentPrincipal,) = escrow.lendingPositions(id);
        assertGt(lentPrincipal, 0);

        // TermType.Disputed goes directly to DisputeOpen without bond posting
        vm.prank(landlord);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.DisputeOpen));

        // totalPool = commitmentDeposit + hostingDeposit + disputeBond (=0 in Disputed path)
        uint256 totalPool = RENT * 2;
        uint256 toLL = totalPool * 6000 / 10000; // 6000 bps
        uint256 toTN = totalPool - toLL;

        vm.prank(landlord);
        escrow.proposeEarlySettlement(id, toLL, toTN);
        vm.prank(tenant);
        escrow.confirmEarlySettlement(id, toLL, toTN);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0, "Position must survive hard failure in confirmEarlySettlement");

        pa.unpause();
        escrow.reclaimLentFundsAfterSettlement(id);

        uint256 expectedLL = lentPrincipal * 6000 / 10000;
        uint256 expectedTN = lentPrincipal - expectedLL;

        assertEq(escrow.pendingWithdrawals(landlord), expectedLL, "Landlord recovery must match agreed 60%");
        assertEq(escrow.pendingWithdrawals(tenant),   expectedTN, "Tenant recovery must match agreed 40%");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Unactivated rent returned to tenant
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Tenant deposited but landlord never did -> expireByLeaseEnd must return
    ///      commitmentDeposit + unactivated first-month rent to tenant.
    ///      Pre-fix: monthlyRent was not included in refund.
    ///      Note: expireByLeaseEnd uses pull-payment (pendingWithdrawals).
    function test_unactivatedRent_expireByLeaseEnd_tenantGetsBothBack() public {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 1, bytes32(0));

        vm.prank(tenant);
        escrow.tenantDeposit(id); // deposits commitmentDeposit + monthlyRent

        RentalEscrow.Agreement memory a = escrow.getAgreement(id);
        assertEq(a.activatedAt, 0, "Should not be activated");

        // expireByLeaseEnd requires now > max(leaseEndTime, createdAt+180days) + 60 days
        // leaseEndTime = 0 (never activated), so latestDate = createdAt + 180 days
        // Need: now > createdAt + 180 days + 60 days = 240 days
        vm.warp(block.timestamp + 241 days);

        escrow.expireByLeaseEnd(id);

        uint256 pending = escrow.pendingWithdrawals(tenant);
        assertEq(pending, RENT * 2, "Tenant pending must be commitment + unactivated rent");

        uint256 tBefore = usdc.balanceOf(tenant);
        vm.prank(tenant);
        escrow.withdraw();
        assertEq(usdc.balanceOf(tenant) - tBefore, RENT * 2);
    }

    /// @dev emergencySettleExpired: same check but uses direct safeTransfer (no pull).
    function test_unactivatedRent_emergencySettle_tenantGetsRentBack() public {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 1, bytes32(0));

        vm.prank(tenant);
        escrow.tenantDeposit(id);

        uint256 tBefore = usdc.balanceOf(tenant);

        vm.warp(block.timestamp + 200 days); // 180+ days sufficient for emergency path
        escrow.emergencySettleExpired(id);

        assertEq(usdc.balanceOf(tenant) - tBefore, RENT * 2,
            "emergencySettleExpired: tenant must get commitment + unactivated rent");
    }

    /// @dev Activated agreements must NOT get extra unactivatedRent.
    function test_unactivatedRent_notAppliedWhenActivated() public {
        uint256 id = _createActive(0);

        RentalEscrow.Agreement memory a = escrow.getAgreement(id);
        vm.warp(a.leaseEndTime + 1);

        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        escrow.endLease(id);

        assertEq(usdc.balanceOf(tenant)   - tBefore, RENT, "Tenant gets exactly RENT back");
        assertEq(usdc.balanceOf(landlord) - lBefore, RENT, "Landlord gets exactly RENT back");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  emergencySettleExpired opens PropDep window
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev emergencySettleExpired must call _openPropDepWindowEarly so landlord can
    ///      still file a damage claim after emergency resolution.
    ///      Pre-fix: window was not opened -> landlord locked out of PropDep.
    function test_emergencySettle_opensPropDepWindow() public {
        uint256 id = _createActive(PROP_DEP);

        propDep.setPropDepWindowDuration(7 days);
        escrow._devSetLeaseEndTime(id, block.timestamp + 10 days);

        vm.warp(block.timestamp + 200 days);
        escrow.emergencySettleExpired(id);

        assertTrue(propDep.isWindowOpen(id),
            "PropDep inspection window must be open after emergencySettleExpired");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  PropDepEscrow: _devForceFreezeExpired
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev _devForceFreezeExpired must set freezeEnd (not freezeStart) so that
    ///      releaseFrozenFunds can be called immediately.
    ///      Pre-fix: was setting freezeStart -> releaseFrozenFunds still blocked.
    ///
    ///      releaseFrozenFunds behaviour on freeze expiry (no settlement):
    ///        bond  -> bondPoster (landlord) = claimAmount
    ///        deposit -> tenant in full (claim not executed, dispute expired)
    function test_devForceFreezeExpired_allowsRelease() public {
        uint256 id = _createActive(PROP_DEP);

        propDep.setPropDepWindowDuration(7 days);
        escrow._devSetLeaseEndTime(id, block.timestamp + 10 days);
        vm.warp(block.timestamp + 4 days); // inside window

        uint256 claim = 1_000e6;
        vm.prank(landlord);
        propDep.fileDamageClaim(id, claim);

        vm.prank(tenant);
        propDep.disputeClaim(id);

        vm.prank(landlord);
        propDep.postBond(id);

        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Frozen));

        vm.expectRevert();
        propDep.releaseFrozenFunds(id);

        propDep._devForceFreezeExpired(id);

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        propDep.releaseFrozenFunds(id);

        assertEq(usdc.balanceOf(landlord) - lBefore, claim,    "Landlord gets bond back (= claimAmount)");
        assertEq(usdc.balanceOf(tenant)   - tBefore, PROP_DEP, "Tenant gets full deposit back on freeze expiry");
        assertEq(uint(propDep.getState(id)), uint(PropDepEscrow.PropDepState.Settled));
    }
}
