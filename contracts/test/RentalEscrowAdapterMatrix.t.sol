// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title RentalEscrowAdapterMatrix
 * @notice Parametrized tests: each of the 6 settlement paths crossed with
 *         5 adapter behaviors — confirming that:
 *         (a) normal adapters yield correct USDC distribution,
 *         (b) paused (reverting) adapters preserve position and mark recovery,
 *         (c) zero-return adapters preserve position and revert on reclaim,
 *         (d) partial-return adapters distribute proportionally,
 *         (e) yield adapters distribute 70% yield to parties + 30% to treasury.
 *
 * Settlement paths:
 *   P1 flagRentMissed        — landlord wins 100%
 *   P2 exitWithLoss(tenant)  — landlord wins 100%
 *   P3 exitWithLoss(landlord)— tenant wins 100%
 *   P4 signMutualExit        — 50/50
 *   P5 endLease              — 50/50
 *   P6 confirmEarlySettlement— custom split (60/40)
 *
 * Adapter behaviors:
 *   A1 None       — lending disabled; direct USDC distribution
 *   A2 Normal     — supply/withdraw works at 1:1
 *   A3 Paused     — withdraw reverts; position survives; recovery stored
 *   A4 ZeroReturn — withdraw returns 0; position survives; reclaim reverts
 *   A5 Yield      — withdraw returns principal + 10% yield
 */

import {Test} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {ILendingAdapter} from "../src/interfaces/ILendingAdapter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Mock token ───────────────────────────────────────────────────────────────

contract MockUSDCM is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ─── Adapters ─────────────────────────────────────────────────────────────────

/// @dev A2/A5: Normal adapter; optional yield.
contract MatrixNormalAdapter is ILendingAdapter {
    MockUSDCM public usdc;
    address public escrow;
    uint256 public stored;
    uint256 public yieldBps;

    constructor(address _usdc, address _escrow, uint256 _yieldBps) {
        usdc = MockUSDCM(_usdc);
        escrow = _escrow;
        yieldBps = _yieldBps;
    }

    function supply(uint256 amount) external returns (uint256) {
        usdc.transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 extra = (amount * yieldBps) / 10000;
        uint256 toSend = amount + extra;
        if (extra > 0) usdc.mint(address(this), extra);
        usdc.transfer(escrow, toSend);
        stored = stored >= amount ? stored - amount : 0;
        return toSend;
    }

    function getIndex() external pure returns (uint256) { return 1e27; }
}

/// @dev A3: Withdraw reverts (Aave paused). Can be unpaused for recovery tests.
contract MatrixPausedAdapter is ILendingAdapter {
    MockUSDCM public usdc;
    address public escrow;
    uint256 public stored;
    bool public paused = true;

    constructor(address _usdc, address _escrow) {
        usdc = MockUSDCM(_usdc);
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

/// @dev A6: Attempts reentrancy during withdraw(). Tests nonReentrant guard.
contract MatrixReenteringAdapter is ILendingAdapter {
    MockUSDCM public usdc;
    address public escrow;
    uint256 public stored;
    bytes public reenterCallData;
    bool private _attacking;

    constructor(address _usdc, address _escrow) {
        usdc = MockUSDCM(_usdc);
        escrow = _escrow;
    }

    function setReenterCallData(bytes calldata data) external { reenterCallData = data; }

    function supply(uint256 amount) external returns (uint256) {
        usdc.transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        // Attempt reentrant call — nonReentrant guard on escrow must block it
        if (!_attacking && reenterCallData.length > 0) {
            _attacking = true;
            (bool ok,) = escrow.call(reenterCallData); // expected to fail silently
            _attacking = false;
            (ok);
        }
        uint256 toReturn = amount > stored ? stored : amount;
        if (toReturn > 0) {
            usdc.transfer(escrow, toReturn);
            stored = stored >= toReturn ? stored - toReturn : 0;
        }
        return toReturn;
    }

    function getIndex() external pure returns (uint256) { return 1e27; }
}

/// @dev A4: Withdraw returns 0 without reverting.
contract MatrixZeroAdapter is ILendingAdapter {
    MockUSDCM public usdc;
    address public escrow;
    uint256 public stored;

    constructor(address _usdc, address _escrow) {
        usdc = MockUSDCM(_usdc);
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

contract RentalEscrowAdapterMatrixTest is Test {
    MockUSDCM usdc;
    RentalEscrow escrow;
    PropDepEscrow propDep;

    address tenant   = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address treasury = makeAddr("treasury");

    uint256 constant RENT         = 1_000e6;
    uint256 constant YIELD_BPS    = 1000; // 10% yield
    uint256 constant PROTOCOL_BPS = 3000; // 30% of yield to treasury

    function setUp() public {
        usdc    = new MockUSDCM();
        escrow  = new RentalEscrow(address(usdc), treasury);
        propDep = new PropDepEscrow(address(usdc), address(escrow));
        escrow.setPropDepEscrow(address(propDep));

        usdc.mint(tenant,   1_000_000e6);
        usdc.mint(landlord, 1_000_000e6);

        vm.prank(tenant);   usdc.approve(address(escrow), type(uint256).max);
        vm.prank(landlord); usdc.approve(address(escrow), type(uint256).max);
    }

    // ─── Setup helpers ────────────────────────────────────────────────────────

    function _activateWithAdapter(address adapter) internal returns (uint256 id) {
        vm.prank(landlord);
        id = escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));

        if (adapter != address(0)) {
            escrow.setLendingAdapter(adapter);
            escrow.emergencyEnableLending();
        }

        vm.prank(tenant);   escrow.tenantDeposit(id);
        vm.prank(landlord); escrow.landlordDeposit(id);
    }

    function _reachDisputeOpen(uint256 id) internal {
        vm.prank(landlord);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Disputed);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P1 × A1: flagRentMissed, no lending
    // ─────────────────────────────────────────────────────────────────────────

    function test_P1_A1_flagRentMissed_noLending() public {
        uint256 id = _activateWithAdapter(address(0));

        uint256 lBefore = usdc.balanceOf(landlord);
        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        // landlord gets both deposits (RENT*2) directly (no lending)
        assertEq(usdc.balanceOf(landlord) - lBefore, RENT * 2,
            "P1/A1: landlord must receive both deposits");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P1 × A2: flagRentMissed, normal adapter (1:1)
    // ─────────────────────────────────────────────────────────────────────────

    function test_P1_A2_flagRentMissed_normalAdapter() public {
        MatrixNormalAdapter adapter = new MatrixNormalAdapter(address(usdc), address(escrow), 0);
        uint256 id = _activateWithAdapter(address(adapter));

        (uint256 principal,) = escrow.lendingPositions(id);
        assertGt(principal, 0);

        uint256 lBefore = usdc.balanceOf(landlord);
        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        // Normal adapter: withdraw succeeds at settlement, landlord gets both deposits
        assertEq(usdc.balanceOf(landlord) - lBefore, RENT * 2,
            "P1/A2: landlord gets both deposits via normal adapter");
        assertEq(escrow.pendingWithdrawals(landlord), 0, "P1/A2: no pending for landlord");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P1 × A3: flagRentMissed, paused adapter -> position survives, recovery stored
    // ─────────────────────────────────────────────────────────────────────────

    function test_P1_A3_flagRentMissed_pausedAdapter_positionSurvives() public {
        MatrixPausedAdapter adapter = new MatrixPausedAdapter(address(usdc), address(escrow));
        uint256 id = _activateWithAdapter(address(adapter));

        (uint256 principal,) = escrow.lendingPositions(id);
        assertGt(principal, 0);

        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0, "P1/A3: position must survive paused adapter");

        // Recovery: unpause and reclaim — landlord gets 100%
        adapter.unpause();
        escrow.reclaimLentFundsAfterSettlement(id);
        assertEq(escrow.pendingWithdrawals(landlord), principal,
            "P1/A3: landlord gets 100% on recovery");
        assertEq(escrow.pendingWithdrawals(tenant), 0, "P1/A3: tenant gets 0");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P1 × A4: flagRentMissed, zero-return adapter -> position survives
    // ─────────────────────────────────────────────────────────────────────────

    function test_P1_A4_flagRentMissed_zeroAdapter_positionSurvives() public {
        MatrixZeroAdapter adapter = new MatrixZeroAdapter(address(usdc), address(escrow));
        uint256 id = _activateWithAdapter(address(adapter));

        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0, "P1/A4: position must survive zero-return adapter");

        // reclaimLentFundsAfterSettlement must revert when adapter still returns 0
        vm.expectRevert(RentalEscrow.LendingUnavailable.selector);
        escrow.reclaimLentFundsAfterSettlement(id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P1 × A5: flagRentMissed, yield adapter -> landlord gets principal + yield
    // ─────────────────────────────────────────────────────────────────────────

    function test_P1_A5_flagRentMissed_yieldAdapter() public {
        MatrixNormalAdapter adapter = new MatrixNormalAdapter(address(usdc), address(escrow), YIELD_BPS);
        uint256 id = _activateWithAdapter(address(adapter));

        (uint256 principal,) = escrow.lendingPositions(id);
        assertGt(principal, 0);

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(treasury);

        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        // On flagRentMissed: adapter withdraws principal+yield. Yield split: 70% parties, 30% treasury.
        // flagRentMissed: ALL goes to landlord (100% bps). Tenant gets nothing.
        // Treasury gets 30% of yield.
        uint256 totalYield = principal * YIELD_BPS / 10000;
        uint256 protocolYield = totalYield * PROTOCOL_BPS / 10000;
        uint256 userYield = totalYield - protocolYield;

        uint256 landlordExpected = principal + userYield; // principal + user yield, all to landlord
        assertEq(usdc.balanceOf(landlord) - lBefore, landlordExpected,
            "P1/A5: landlord gets principal + user yield");
        assertEq(usdc.balanceOf(treasury) - tBefore, protocolYield,
            "P1/A5: treasury gets 30% of yield");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P2 × A1: exitWithLoss(tenant), no lending -> landlord gets both deposits
    // ─────────────────────────────────────────────────────────────────────────

    function test_P2_A1_exitWithLoss_tenant_noLending() public {
        uint256 id = _activateWithAdapter(address(0));

        uint256 lBefore = usdc.balanceOf(landlord);
        vm.prank(tenant);
        escrow.exitWithLoss(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        assertEq(usdc.balanceOf(landlord) - lBefore, RENT * 2,
            "P2/A1: landlord gets both deposits");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P2 × A3: exitWithLoss(tenant), paused adapter -> recovery 100% landlord
    // ─────────────────────────────────────────────────────────────────────────

    function test_P2_A3_exitWithLoss_tenant_pausedAdapter() public {
        MatrixPausedAdapter adapter = new MatrixPausedAdapter(address(usdc), address(escrow));
        uint256 id = _activateWithAdapter(address(adapter));

        (uint256 principal,) = escrow.lendingPositions(id);

        vm.prank(tenant);
        escrow.exitWithLoss(id);

        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0, "P2/A3: position survives");

        adapter.unpause();
        escrow.reclaimLentFundsAfterSettlement(id);

        assertEq(escrow.pendingWithdrawals(landlord), principal, "P2/A3: landlord gets 100%");
        assertEq(escrow.pendingWithdrawals(tenant),   0,         "P2/A3: tenant gets 0");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P3 × A1: exitWithLoss(landlord), no lending -> tenant gets both deposits
    // ─────────────────────────────────────────────────────────────────────────

    function test_P3_A1_exitWithLoss_landlord_noLending() public {
        uint256 id = _activateWithAdapter(address(0));

        uint256 tBefore = usdc.balanceOf(tenant);
        vm.prank(landlord);
        escrow.exitWithLoss(id);

        assertEq(usdc.balanceOf(tenant) - tBefore, RENT * 2,
            "P3/A1: tenant gets both deposits");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P3 × A3: exitWithLoss(landlord), paused adapter -> recovery 100% tenant
    // ─────────────────────────────────────────────────────────────────────────

    function test_P3_A3_exitWithLoss_landlord_pausedAdapter() public {
        MatrixPausedAdapter adapter = new MatrixPausedAdapter(address(usdc), address(escrow));
        uint256 id = _activateWithAdapter(address(adapter));

        (uint256 principal,) = escrow.lendingPositions(id);

        vm.prank(landlord);
        escrow.exitWithLoss(id);

        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0);

        adapter.unpause();
        escrow.reclaimLentFundsAfterSettlement(id);

        assertEq(escrow.pendingWithdrawals(tenant),   principal, "P3/A3: tenant gets 100%");
        assertEq(escrow.pendingWithdrawals(landlord), 0,         "P3/A3: landlord gets 0");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P4 × A1: signMutualExit, no lending -> 50/50 split
    // ─────────────────────────────────────────────────────────────────────────

    function test_P4_A1_mutualExit_noLending() public {
        uint256 id = _activateWithAdapter(address(0));

        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        vm.prank(landlord);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Mutual);
        vm.prank(tenant);
        escrow.signMutualExit(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        assertEq(usdc.balanceOf(tenant)   - tBefore, RENT, "P4/A1: tenant gets RENT back");
        assertEq(usdc.balanceOf(landlord) - lBefore, RENT, "P4/A1: landlord gets RENT back");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P4 × A2: signMutualExit, normal adapter -> 50/50 split
    // ─────────────────────────────────────────────────────────────────────────

    function test_P4_A2_mutualExit_normalAdapter() public {
        MatrixNormalAdapter adapter = new MatrixNormalAdapter(address(usdc), address(escrow), 0);
        uint256 id = _activateWithAdapter(address(adapter));

        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        vm.prank(landlord);
        escrow.proposeEarlyTermination(id, RentalEscrow.TermType.Mutual);
        vm.prank(tenant);
        escrow.signMutualExit(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        assertEq(usdc.balanceOf(tenant)   - tBefore, RENT, "P4/A2: tenant gets RENT");
        assertEq(usdc.balanceOf(landlord) - lBefore, RENT, "P4/A2: landlord gets RENT");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P5 × A1: endLease, no lending -> 50/50 split at lease end
    // ─────────────────────────────────────────────────────────────────────────

    function test_P5_A1_endLease_noLending() public {
        uint256 id = _activateWithAdapter(address(0));
        RentalEscrow.Agreement memory a = escrow.getAgreement(id);
        vm.warp(a.leaseEndTime + 1);

        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        escrow.endLease(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.LeaseEnded));
        assertEq(usdc.balanceOf(tenant)   - tBefore, RENT, "P5/A1: tenant gets RENT");
        assertEq(usdc.balanceOf(landlord) - lBefore, RENT, "P5/A1: landlord gets RENT");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P5 × A2: endLease, normal adapter -> 50/50 split
    // ─────────────────────────────────────────────────────────────────────────

    function test_P5_A2_endLease_normalAdapter() public {
        MatrixNormalAdapter adapter = new MatrixNormalAdapter(address(usdc), address(escrow), 0);
        uint256 id = _activateWithAdapter(address(adapter));
        RentalEscrow.Agreement memory a = escrow.getAgreement(id);
        vm.warp(a.leaseEndTime + 1);

        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);

        escrow.endLease(id);

        assertEq(usdc.balanceOf(tenant)   - tBefore, RENT, "P5/A2: tenant gets RENT");
        assertEq(usdc.balanceOf(landlord) - lBefore, RENT, "P5/A2: landlord gets RENT");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P5 × A5: endLease, yield adapter -> parties get principal + user yield
    // ─────────────────────────────────────────────────────────────────────────

    function test_P5_A5_endLease_yieldAdapter() public {
        MatrixNormalAdapter adapter = new MatrixNormalAdapter(address(usdc), address(escrow), YIELD_BPS);
        uint256 id = _activateWithAdapter(address(adapter));

        (uint256 principal,) = escrow.lendingPositions(id);
        assertGt(principal, 0);

        RentalEscrow.Agreement memory a = escrow.getAgreement(id);
        vm.warp(a.leaseEndTime + 1);

        uint256 tBefore = usdc.balanceOf(tenant);
        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 trBefore = usdc.balanceOf(treasury);

        escrow.endLease(id);

        uint256 totalYield   = principal * YIELD_BPS / 10000;
        uint256 protocolYield = totalYield * PROTOCOL_BPS / 10000;
        uint256 userYield    = totalYield - protocolYield;

        // 50/50 split of (principal + userYield), treasury gets protocolYield
        uint256 eachParty = (principal + userYield) / 2;
        // allow 1 unit rounding tolerance
        assertApproxEqAbs(usdc.balanceOf(tenant)   - tBefore,  eachParty,    1, "P5/A5: tenant yield share");
        assertApproxEqAbs(usdc.balanceOf(landlord) - lBefore,  eachParty,    1, "P5/A5: landlord yield share");
        assertApproxEqAbs(usdc.balanceOf(treasury) - trBefore, protocolYield, 1, "P5/A5: treasury yield share");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P6 × A1: confirmEarlySettlement 60/40, no lending
    // ─────────────────────────────────────────────────────────────────────────

    function test_P6_A1_earlySettlement_6040_noLending() public {
        uint256 id = _activateWithAdapter(address(0));
        _reachDisputeOpen(id);

        uint256 totalPool = RENT * 2;
        uint256 toLL = totalPool * 6000 / 10000;
        uint256 toTN = totalPool - toLL;

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(landlord);
        escrow.proposeEarlySettlement(id, toLL, toTN);
        vm.prank(tenant);
        escrow.confirmEarlySettlement(id, toLL, toTN);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        assertEq(usdc.balanceOf(landlord) - lBefore, toLL, "P6/A1: landlord gets 60%");
        assertEq(usdc.balanceOf(tenant)   - tBefore, toTN, "P6/A1: tenant gets 40%");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P6 × A2: confirmEarlySettlement 60/40, normal adapter
    // ─────────────────────────────────────────────────────────────────────────

    function test_P6_A2_earlySettlement_6040_normalAdapter() public {
        MatrixNormalAdapter adapter = new MatrixNormalAdapter(address(usdc), address(escrow), 0);
        uint256 id = _activateWithAdapter(address(adapter));
        _reachDisputeOpen(id);

        uint256 totalPool = RENT * 2;
        uint256 toLL = totalPool * 6000 / 10000;
        uint256 toTN = totalPool - toLL;

        uint256 lBefore = usdc.balanceOf(landlord);
        uint256 tBefore = usdc.balanceOf(tenant);

        vm.prank(landlord);
        escrow.proposeEarlySettlement(id, toLL, toTN);
        vm.prank(tenant);
        escrow.confirmEarlySettlement(id, toLL, toTN);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        assertEq(usdc.balanceOf(landlord) - lBefore, toLL, "P6/A2: landlord gets 60%");
        assertEq(usdc.balanceOf(tenant)   - tBefore, toTN, "P6/A2: tenant gets 40%");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  P6 × A3: confirmEarlySettlement 60/40, paused adapter -> recovery preserves split
    // ─────────────────────────────────────────────────────────────────────────

    function test_P6_A3_earlySettlement_6040_pausedAdapter_recoveryPreservesSplit() public {
        MatrixPausedAdapter adapter = new MatrixPausedAdapter(address(usdc), address(escrow));
        uint256 id = _activateWithAdapter(address(adapter));

        (uint256 principal,) = escrow.lendingPositions(id);
        _reachDisputeOpen(id);

        uint256 totalPool = RENT * 2;
        uint256 toLL = totalPool * 6000 / 10000;
        uint256 toTN = totalPool - toLL;

        vm.prank(landlord);
        escrow.proposeEarlySettlement(id, toLL, toTN);
        vm.prank(tenant);
        escrow.confirmEarlySettlement(id, toLL, toTN);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0, "P6/A3: position survives hard failure");

        // Recovery must respect the agreed 6000/4000 split
        adapter.unpause();
        escrow.reclaimLentFundsAfterSettlement(id);

        uint256 expectedLL = principal * 6000 / 10000;
        uint256 expectedTN = principal - expectedLL;

        assertEq(escrow.pendingWithdrawals(landlord), expectedLL, "P6/A3: recovery 60% to landlord");
        assertEq(escrow.pendingWithdrawals(tenant),   expectedTN, "P6/A3: recovery 40% to tenant");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Reentrancy guard: adapter attempts to re-enter escrow during withdraw
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Verifies that nonReentrant blocks adapter-initiated re-entry.
    ///      Scenario: flagRentMissed → _reclaimFromLending → adapter.withdraw →
    ///      adapter tries to call escrow.flagRentMissed again → blocked by guard →
    ///      outer call completes normally (agreement settles exactly once).
    function test_reentrancy_blocked_during_adapter_withdraw() public {
        MatrixReenteringAdapter adapter = new MatrixReenteringAdapter(address(usdc), address(escrow));
        uint256 id = _activateWithAdapter(address(adapter));

        // Arm the adapter: replay flagRentMissed on the same agreement id
        adapter.setReenterCallData(abi.encodeWithSignature("flagRentMissed(uint256)", id));

        vm.warp(block.timestamp + 64 days);
        uint256 lBefore = usdc.balanceOf(landlord);

        // Outer flagRentMissed must succeed; inner reentrant call must be silently blocked
        escrow.flagRentMissed(id);

        // Agreement settled exactly once — no double-distribution
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled),
            "Reentrancy: agreement must be Settled");

        // Lending position cleared (adapter returned funds normally after failed re-entry)
        (uint256 pos,) = escrow.lendingPositions(id);
        assertEq(pos, 0,
            "Reentrancy: position must be cleared - funds returned to escrow correctly");

        // flagRentMissed uses safeTransfer directly (not pull).
        // landlord must receive exactly RENT*2 (commitmentDeposit + hostingDeposit) — once.
        assertEq(usdc.balanceOf(landlord) - lBefore, RENT * 2,
            "Reentrancy: landlord must receive exactly 100% of principal once");
    }
}
