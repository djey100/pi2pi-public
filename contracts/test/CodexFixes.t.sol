// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CodexFixes.t.sol - regression tests for Codex round-2 findings
 *
 * C-1 (HIGH): getIndex() not wrapped in try/catch - a paused adapter reverts ALL calls,
 *             bypassing the C-2 settlement safety net.
 *   OLD (384b3dfc): flagRentMissed reverts when getIndex() reverts → settlement impossible.
 *   NEW:            getIndex() in try/catch → hard-failure path → position survives,
 *                   buffer distributed, state = Settled.
 *
 * C-2 (MEDIUM): escrow trusts adapter's return value instead of actual USDC inflow.
 *   OLD (384b3dfc): received = adapter.withdraw() return → LyingAdapter reports 2×RENT
 *                   but transfers RENT → safeTransfer(landlord, 2×RENT) reverts because
 *                   escrow only has RENT.
 *   NEW:            received = balanceAfter - balanceBefore → RENT → distributes RENT,
 *                   settlement succeeds, solvency holds.
 *
 * C-3 (MEDIUM): AaveAdapter.supply allows scaledDelta == 0, RentalEscrow records ghost
 *               position (principal > 0 / scaledBalance == 0) that can never be cleared.
 *   OLD (384b3dfc): ghost position created - totalLentPrincipal permanently inflated,
 *                   setLendingAdapter blocked.
 *   NEW:            AaveAdapter.supply requires scaledSupplied > 0 (reverts on 0).
 *                   _maybeLendForAgreement also guards defensively against scaledDelta == 0.
 */

import {Test} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {ILendingAdapter} from "../src/interfaces/ILendingAdapter.sol";
import {AaveAdapter, IAaveV3Pool, ReserveData, ReserveConfigurationMap} from "../src/AaveAdapter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Shared token mock ────────────────────────────────────────────────────────

contract CxUSDC is ERC20 {
    constructor() ERC20("CxUSDC", "cxUSDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ─── C-1: IndexRevertingAdapter ───────────────────────────────────────────────

/// @dev supply() works (positions are created), getIndex() always reverts.
///      Models a fully paused Aave / Morpho market that rejects even view calls.
contract IndexRevertingAdapter is ILendingAdapter {
    CxUSDC public usdc;
    address public escrow;
    uint256 public stored;

    constructor(address _usdc, address _escrow) {
        usdc = CxUSDC(_usdc);
        escrow = _escrow;
    }

    function supply(uint256 amount) external returns (uint256) {
        if (amount == 0) return 0;
        usdc.transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 toReturn = amount > stored ? stored : amount;
        if (toReturn > 0) {
            usdc.transfer(escrow, toReturn);
            stored -= toReturn;
        }
        return toReturn;
    }

    function getIndex() external pure returns (uint256) {
        revert("IndexRevertingAdapter: paused");
    }
}

// ─── C-2: LyingAdapter ────────────────────────────────────────────────────────

/// @dev supply() works. withdraw() transfers amount/2 but returns (reports) amount.
///      Models a malicious or buggy adapter that over-reports its return value.
contract LyingAdapter is ILendingAdapter {
    CxUSDC public usdc;
    address public escrow;
    uint256 public stored;

    constructor(address _usdc, address _escrow) {
        usdc = CxUSDC(_usdc);
        escrow = _escrow;
    }

    function supply(uint256 amount) external returns (uint256) {
        if (amount == 0) return 0;
        usdc.transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        // Transfer only half but report the full amount - the lie.
        uint256 actual = amount / 2;
        if (actual > stored) actual = stored;
        if (actual > 0) {
            usdc.transfer(escrow, actual);
            stored -= actual;
        }
        return amount; // lie: report full requested amount
    }

    function getIndex() external pure returns (uint256) { return 1e27; }
}

// ─── C-2 hybrid: IndexReverts + LyingWithdraw ────────────────────────────────

/// @dev Combines both C-1 and C-2 failure modes in one adapter:
///      - getIndex() reverts when indexReverts flag is set (fully paused market).
///      - withdraw() transfers amount/2 but reports amount (lying return value).
///      Used in test_C2_reclaim_usesBalanceDelta to isolate the recovery path:
///      settlement survives getIndex revert (C-1 fix), position stays alive,
///      then reclaim distributes only actual USDC received (C-2 fix).
contract HybridAdapter is ILendingAdapter {
    CxUSDC public usdc;
    address public escrow;
    uint256 public stored;
    bool public indexReverts;

    constructor(address _usdc, address _escrow) {
        usdc = CxUSDC(_usdc);
        escrow = _escrow;
    }

    function setIndexReverts(bool v) external { indexReverts = v; }

    function supply(uint256 amount) external returns (uint256) {
        if (amount == 0) return 0;
        usdc.transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 actual = amount / 2;
        if (actual > stored) actual = stored;
        if (actual > 0) {
            usdc.transfer(escrow, actual);
            stored -= actual;
        }
        return amount; // lie: report full requested amount
    }

    function getIndex() external view returns (uint256) {
        if (indexReverts) revert("HybridAdapter: index paused");
        return 1e27;
    }
}

// ─── C-3: ZeroScaledAdapter ───────────────────────────────────────────────────

/// @dev supply() silently returns 0 scaledBalance (no revert).
///      Models a buggy adapter or extreme rounding edge case.
///      OLD escrow: creates ghost position (principal>0, scaledBalance==0).
///      NEW escrow: defensive check fires, position NOT created.
contract ZeroScaledAdapter is ILendingAdapter {
    constructor(address, address) {}

    function supply(uint256) external pure returns (uint256) {
        // Does NOT pull USDC - just returns 0 without reverting.
        // Models a buggy adapter where the protocol rounds down to zero scaled units
        // and returns 0 without the transaction reverting.
        // The escrow-side defensive check must prevent creating a ghost position
        // (principal > 0, scaledBalance == 0) in this scenario.
        return 0;
    }

    function withdraw(uint256) external pure returns (uint256) { return 0; }
    function getIndex() external pure returns (uint256) { return 1e27; }
}

// ─── Mock Aave pool for C-3 AaveAdapter unit test ────────────────────────────

/// @dev aToken that returns constant scaledBalance so delta is always 0.
contract ConstantAToken {
    function scaledBalanceOf(address) external pure returns (uint256) { return 1000e6; }
}

/// @dev Minimal Aave pool mock: supply() is a no-op, withdraw() returns 0,
///      getReserveNormalizedIncome returns 1e27, getReserveData returns our aToken.
contract ZeroScaledAavePool {
    ConstantAToken public aToken;
    constructor() { aToken = new ConstantAToken(); }

    function supply(address, uint256, address, uint16) external {}
    function withdraw(address, uint256, address) external pure returns (uint256) { return 0; }
    function getReserveNormalizedIncome(address) external pure returns (uint256) { return 1e27; }

    function getReserveData(address) external view returns (ReserveData memory rd) {
        rd.aTokenAddress = address(aToken);
    }
}

// ─── Shared test setup ────────────────────────────────────────────────────────

abstract contract CodexBase is Test {
    CxUSDC   usdc;
    RentalEscrow escrow;

    address tenant   = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address treasury = makeAddr("treasury");

    uint256 constant RENT = 1_000e6;

    function _setUp() internal {
        usdc   = new CxUSDC();
        escrow = new RentalEscrow(address(usdc), treasury);

        usdc.mint(tenant,   500_000e6);
        usdc.mint(landlord, 500_000e6);

        vm.prank(tenant);   usdc.approve(address(escrow), type(uint256).max);
        vm.prank(landlord); usdc.approve(address(escrow), type(uint256).max);
    }

    function _activateLease(address adapter) internal returns (uint256 id) {
        escrow.setLendingAdapter(adapter);
        escrow.emergencyEnableLending();

        vm.prank(landlord);
        id = escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));
        vm.prank(tenant);   escrow.tenantDeposit(id);
        vm.prank(landlord); escrow.landlordDeposit(id);

        (uint256 lentPrincipal,) = escrow.lendingPositions(id);
        assertGt(lentPrincipal, 0, "pre: lending must be active");
    }
}

// ─── C-1 Tests ────────────────────────────────────────────────────────────────

contract C1IndexRevertTest is CodexBase {
    IndexRevertingAdapter adapter;

    function setUp() public {
        _setUp();
        adapter = new IndexRevertingAdapter(address(usdc), address(escrow));
    }

    // =========================================================================
    //  C-1-A: flagRentMissed must complete when getIndex() reverts
    //
    //  FAILS ON OLD (384b3dfc): _reclaimFromLending calls getIndex() bare →
    //    revert propagates → flagRentMissed reverts → settlement impossible.
    //  PASSES ON NEW: getIndex() in try/catch → hard-failure path →
    //    buffer (0) distributed to landlord, state = Settled, position alive.
    // =========================================================================
    function test_C1_flagRentMissed_survivesIndexRevert() public {
        uint256 id = _activateLease(address(adapter));

        // Sanity: adapter really has the funds, index really reverts
        uint256 lentPrincipal = adapter.stored();
        assertGt(lentPrincipal, 0, "pre: funds in adapter");
        vm.expectRevert();
        adapter.getIndex();

        vm.warp(block.timestamp + 64 days);

        // NEW: settlement must PASS (not revert) even with broken getIndex
        escrow.flagRentMissed(id);

        // State must be terminal
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled),
            "C-1: state must be Settled after flagRentMissed");

        // Position must survive (hard failure → keeper can retry later)
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0,
            "C-1: lending position must survive when getIndex reverts - retry via reclaimLentFundsAfterSettlement");
    }

    // =========================================================================
    //  C-1-B: reclaimLentFundsAfterSettlement must revert LendingUnavailable
    //         (not bubble a raw revert) when getIndex() reverts.
    //
    //  FAILS ON OLD: raw revert propagates from getIndex(); error type unpredictable.
    //  PASSES ON NEW: try/catch converts to LendingUnavailable() - clean API.
    // =========================================================================
    function test_C1_reclaim_revertLendingUnavailable_onIndexRevert() public {
        uint256 id = _activateLease(address(adapter));
        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id); // settle (position survives per C-1-A)

        // Reclaim must revert LendingUnavailable (not a raw revert from getIndex)
        vm.expectRevert(RentalEscrow.LendingUnavailable.selector);
        escrow.reclaimLentFundsAfterSettlement(id);
    }

    // =========================================================================
    //  C-1-C: expireByLeaseEnd also survives getIndex() revert
    //         (exercises the _reclaimForSafetyNet → _reclaimFromLending path)
    // =========================================================================
    function test_C1_expireByLeaseEnd_survivesIndexRevert() public {
        uint256 id = _activateLease(address(adapter));
        vm.warp(block.timestamp + 365 days); // past lease + 60d buffer

        // Must not revert
        escrow.expireByLeaseEnd(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled),
            "C-1: expireByLeaseEnd must settle even when getIndex reverts");
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0, "C-1: position survives for later recovery");
    }
}

// ─── C-2 Tests ────────────────────────────────────────────────────────────────

contract C2LyingAdapterTest is CodexBase {
    LyingAdapter adapter;

    function setUp() public {
        _setUp();
        adapter = new LyingAdapter(address(usdc), address(escrow));
    }

    // =========================================================================
    //  C-2-A: flagRentMissed distributes only actual USDC received, not reported
    //
    //  LyingAdapter: withdraw(2000e6) transfers 1000e6, reports 2000e6.
    //  FAILS ON OLD (384b3dfc): received = 2000e6 → safeTransfer(landlord, 2000e6)
    //    reverts (escrow only has 1000e6) → flagRentMissed reverts.
    //  PASSES ON NEW: received = balanceDelta = 1000e6 → distributes 1000e6 → OK.
    // =========================================================================
    function test_C2_flagRentMissed_usesBalanceDelta() public {
        uint256 id = _activateLease(address(adapter));

        uint256 lentPrincipal = adapter.stored(); // 2*RENT lent
        assertEq(lentPrincipal, RENT * 2, "pre: 2*RENT lent");

        uint256 landlordBefore = usdc.balanceOf(landlord);

        vm.warp(block.timestamp + 64 days);

        // NEW: must NOT revert - escrow uses balance delta (1*RENT), not lying report (2*RENT)
        escrow.flagRentMissed(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled),
            "C-2: state must be Settled");

        // Landlord received exactly what the adapter actually transferred (1*RENT),
        // NOT the lying reported amount (2*RENT).
        uint256 landlordReceived = usdc.balanceOf(landlord) - landlordBefore;
        assertEq(landlordReceived, RENT,
            "C-2: landlord must receive actual USDC transferred (1*RENT), not lying report (2*RENT)");

        // Escrow balance must be 0 - no funds drained from non-existent buffers
        assertEq(usdc.balanceOf(address(escrow)), 0,
            "C-2: escrow balance must be 0 after distribution");
    }

    // =========================================================================
    //  C-2-B: reclaimLentFundsAfterSettlement uses balance delta, not reported value
    //
    //  Uses HybridAdapter: getIndex reverts by flag (C-1) + withdraw lies (C-2).
    //  Step 1 -- settlement with index paused: flagRentMissed passes (C-1 fix),
    //           position stays alive (hard failure path).
    //  Step 2 -- recovery: index restored, reclaimLentFundsAfterSettlement called.
    //           HybridAdapter.withdraw transfers lentPrincipal/2 but reports lentPrincipal.
    //  NEW: pendingWithdrawals[landlord] == lentPrincipal/2 (actual inflow).
    //  OLD: pendingWithdrawals[landlord] == lentPrincipal   (lying report) →
    //       escrow would credit more than it received, breaking solvency.
    // =========================================================================
    function test_C2_reclaim_usesBalanceDelta() public {
        HybridAdapter hybrid = new HybridAdapter(address(usdc), address(escrow));
        uint256 id = _activateLease(address(hybrid));

        uint256 lentPrincipal = hybrid.stored();
        assertGt(lentPrincipal, 0, "pre: funds in adapter");

        // Step 1: pause index → flagRentMissed must still settle (C-1 fix),
        //         but adapter.withdraw is not attempted (getIndex failed first).
        //         Position survives.
        hybrid.setIndexReverts(true);
        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id);

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled),
            "C-2B pre: state must be Settled");
        (uint256 posAfter,) = escrow.lendingPositions(id);
        assertGt(posAfter, 0, "C-2B pre: position must survive index-revert settlement");

        // Step 2: restore index, reclaim. HybridAdapter transfers lentPrincipal/2
        //         but reports lentPrincipal. flagRentMissed used _markRecovery(id, 10000)
        //         so 100% goes to landlord.
        hybrid.setIndexReverts(false);
        uint256 landlordBefore = escrow.pendingWithdrawals(landlord);
        escrow.reclaimLentFundsAfterSettlement(id);

        uint256 landlordCredited = escrow.pendingWithdrawals(landlord) - landlordBefore;
        assertEq(landlordCredited, lentPrincipal / 2,
            "C-2B: pendingWithdrawals must reflect actual USDC received (half), not lying report (full)");

        // Position cleared after successful reclaim
        (uint256 posFinal,) = escrow.lendingPositions(id);
        assertEq(posFinal, 0, "C-2B: position must be cleared after reclaim");

        // Solvency: escrow balance covers what it owes
        assertGe(usdc.balanceOf(address(escrow)), escrow.totalPendingWithdrawals(),
            "C-2B: solvency invariant must hold");
    }
}

// ─── C-3 Tests ────────────────────────────────────────────────────────────────

contract C3ZeroScaledTest is CodexBase {
    ZeroScaledAdapter adapter;

    function setUp() public {
        _setUp();
        adapter = new ZeroScaledAdapter(address(usdc), address(escrow));
    }

    // =========================================================================
    //  C-3-A (upgraded to F-13-strict): landlordDeposit must revert ZeroScaledSupply
    //         when supply() returns 0 without reverting. The entire tx reverts
    //         atomically -- no ghost position, no silent fund drain.
    //
    //  FAILS ON OLD (384b3dfc): lendingPositions[id] = {principal=2*RENT, scaledBalance=0}
    //    ghost position created, totalLentPrincipal permanently inflated.
    //  PASSES ON NEW (C-3 skip, de6feba9): position not created, but tx succeeds.
    //  PASSES ON NEW (F-13 revert): entire landlordDeposit tx reverts ZeroScaledSupply.
    // =========================================================================
    function test_C3_noGhostPosition_onZeroScaledReturn() public {
        escrow.setLendingAdapter(address(adapter));
        escrow.emergencyEnableLending();

        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));
        vm.prank(tenant); escrow.tenantDeposit(id);

        // F-13: landlordDeposit must revert atomically -- no ghost position created.
        vm.prank(landlord);
        vm.expectRevert(RentalEscrow.ZeroScaledSupply.selector);
        escrow.landlordDeposit(id);

        // Confirm no position was recorded (state machine never reached Active)
        (uint256 principal, uint256 scaledBalance) = escrow.lendingPositions(id);
        assertEq(principal,     0, "C-3: principal must be 0 after revert");
        assertEq(scaledBalance, 0, "C-3: scaledBalance must be 0 after revert");
        assertEq(escrow.totalLentPrincipal(), 0,
            "C-3: totalLentPrincipal must not be inflated");
    }

    // =========================================================================
    //  C-3-B: setLendingAdapter not blocked -- ZeroScaledSupply revert means
    //         no position was ever written, so totalLentPrincipal stays 0.
    // =========================================================================
    function test_C3_setLendingAdapter_notBlockedAfterZeroScaled() public {
        escrow.setLendingAdapter(address(adapter));
        escrow.emergencyEnableLending();

        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));
        vm.prank(tenant); escrow.tenantDeposit(id);

        // landlordDeposit reverts -- no position ever created
        vm.prank(landlord);
        try escrow.landlordDeposit(id) {} catch {}

        // No outstanding positions -- setLendingAdapter must not revert
        assertEq(escrow.totalLentPrincipal(), 0, "C-3: no outstanding principal");
        escrow.setLendingAdapter(makeAddr("newAdapter")); // must not revert
    }
}

// ─── C-3-C: AaveAdapter unit test - supply reverts on zero scaledBalance ──────

contract C3AaveAdapterUnitTest is Test {
    CxUSDC usdc;
    ZeroScaledAavePool pool;
    AaveAdapter adapter;
    address escrowAddr = makeAddr("escrowAddr");

    function setUp() public {
        usdc = new CxUSDC();
        pool = new ZeroScaledAavePool();
        adapter = new AaveAdapter(escrowAddr, address(pool), address(usdc));
    }

    // =========================================================================
    //  C-3-C: AaveAdapter.supply reverts "Zero scaled received" when pool
    //         returns zero scaled balance (constant aToken mock).
    //
    //  FAILS ON OLD (384b3dfc): supply returns 0 silently.
    //  PASSES ON NEW: require(scaledSupplied > 0) reverts.
    // =========================================================================
    function test_C3_aaveAdapter_revertsOnZeroScaled() public {
        usdc.mint(escrowAddr, 1_000e6);

        vm.prank(escrowAddr);
        usdc.approve(address(adapter), type(uint256).max);

        vm.prank(escrowAddr);
        vm.expectRevert(bytes("Zero scaled received"));
        adapter.supply(100e6);
    }
}

// ─── F-13: DrainAndZeroAdapter ────────────────────────────────────────────────

/// @dev supply() pulls USDC from escrow via transferFrom AND returns 0.
///      Models a malicious or severely broken adapter that steals the deposit
///      but reports no scaled position -- creating a silent fund drain in old code.
///      F-13 fix: revert ZeroScaledSupply() inside try-success is NOT caught by
///      catch -- the entire transaction reverts atomically, returning USDC to escrow.
contract DrainAndZeroAdapter is ILendingAdapter {
    CxUSDC public usdc;
    address public escrow;
    uint256 public drained;

    constructor(address _usdc, address _escrow) {
        usdc = CxUSDC(_usdc);
        escrow = _escrow;
    }

    /// @dev Takes USDC from escrow and returns 0 -- no revert, no scaled position.
    function supply(uint256 amount) external returns (uint256) {
        if (amount > 0) {
            usdc.transferFrom(escrow, address(this), amount);
            drained += amount;
        }
        return 0; // lie: accept funds but report zero scaled balance
    }

    function withdraw(uint256) external pure returns (uint256) { return 0; }
    function getIndex() external pure returns (uint256) { return 1e27; }
}

// ─── F-13 Tests ───────────────────────────────────────────────────────────────

contract F13StrictTest is CodexBase {
    DrainAndZeroAdapter adapter;

    function setUp() public {
        _setUp();
        adapter = new DrainAndZeroAdapter(address(usdc), address(escrow));
        escrow.setLendingAdapter(address(adapter));
        escrow.emergencyEnableLending();
    }

    // =========================================================================
    //  F-13-A: landlordDeposit must revert ZeroScaledSupply when adapter
    //          accepts USDC but returns scaledBalance == 0.
    //
    //  FAILS ON OLD (de6feba9): _maybeLendForAgreement skips silently -- adapter
    //    has drained USDC from escrow, landlordDeposit succeeds, funds gone.
    //  PASSES ON NEW: revert ZeroScaledSupply() propagates atomically, entire
    //    landlordDeposit tx reverts, escrow balance preserved.
    // =========================================================================
    function test_F13_strict_revertsZeroScaledSupply() public {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));

        // tenantDeposit succeeds (no lending on tenant side)
        vm.prank(tenant);
        escrow.tenantDeposit(id);

        // landlordDeposit triggers _maybeLendForAgreement → DrainAndZeroAdapter.supply
        // NEW: must revert ZeroScaledSupply atomically
        vm.prank(landlord);
        vm.expectRevert(RentalEscrow.ZeroScaledSupply.selector);
        escrow.landlordDeposit(id);
    }

    // =========================================================================
    //  F-13-B: After the revert, tenant's USDC is preserved in escrow.
    //          Adapter's drained balance must be 0 (tx was rolled back).
    //
    //  FAILS ON OLD (de6feba9): landlordDeposit does NOT revert, adapter has
    //    drained funds, escrow balance < expected.
    //  PASSES ON NEW: entire tx reverted, no USDC left in adapter.
    // =========================================================================
    function test_F13_strict_tenantFundsPreserved_after_drainAttempt() public {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));

        vm.prank(tenant);
        escrow.tenantDeposit(id);

        // Capture balance before attempted landlordDeposit
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        uint256 adapterBefore = usdc.balanceOf(address(adapter));

        // landlordDeposit reverts -- escrow balance must remain RENT (tenant's deposit)
        vm.prank(landlord);
        try escrow.landlordDeposit(id) {} catch {}

        // F-13: entire tx reverted, adapter holds nothing
        assertEq(usdc.balanceOf(address(escrow)),   escrowBefore,
            "F-13: escrow balance must be unchanged after atomic revert");
        assertEq(usdc.balanceOf(address(adapter)),  adapterBefore,
            "F-13: adapter must hold 0 after atomic revert - drain undone");
        assertEq(adapter.drained(), 0,
            "F-13: drained counter must be 0 -- state change rolled back");
    }
}

// ─── writeOffLendingPosition Tests ───────────────────────────────────────────

contract WriteOffTest is CodexBase {
    IndexRevertingAdapter adapter;

    function setUp() public {
        _setUp();
        adapter = new IndexRevertingAdapter(address(usdc), address(escrow));
    }

    /// @dev Creates a settled agreement with a surviving lending position
    ///      by using IndexRevertingAdapter: supply works, getIndex reverts,
    ///      so flagRentMissed → Settled but position is not cleared.
    function _settledWithSurvivingPosition() internal returns (uint256 id) {
        id = _activateLease(address(adapter));
        (uint256 p,) = escrow.lendingPositions(id);
        assertGt(p, 0, "pre: position must exist");

        vm.warp(block.timestamp + 64 days);
        escrow.flagRentMissed(id); // C-1 fix: state=Settled, position survives

        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Settled));
        (p,) = escrow.lendingPositions(id);
        assertGt(p, 0, "pre: position must survive after flagRentMissed with broken index");
    }

    // =========================================================================
    //  WO-A: Happy path -- write off unrecoverable position, then setLendingAdapter
    //         is unblocked.
    // =========================================================================
    function test_writeOff_happyPath_unblocksSetLendingAdapter() public {
        uint256 id = _settledWithSurvivingPosition();

        (uint256 principalBefore,) = escrow.lendingPositions(id);
        uint256 totalBefore = escrow.totalLentPrincipal();
        assertGt(principalBefore, 0, "pre: position must have principal");

        escrow.writeOffLendingPosition(id);

        // Position cleared
        (uint256 principalAfter, uint256 scaledAfter) = escrow.lendingPositions(id);
        assertEq(principalAfter, 0, "WO: principal must be 0 after write-off");
        assertEq(scaledAfter,    0, "WO: scaledBalance must be 0 after write-off");

        // totalLentPrincipal decremented correctly
        assertEq(escrow.totalLentPrincipal(), totalBefore - principalBefore,
            "WO: totalLentPrincipal must be decremented by written-off principal");

        // setLendingAdapter is now unblocked (no outstanding positions)
        escrow.setLendingAdapter(makeAddr("newAdapter")); // must not revert
    }

    // =========================================================================
    //  WO-B: Reverts "Not terminal" when agreement is still Active.
    // =========================================================================
    function test_writeOff_reverts_notTerminal() public {
        uint256 id = _activateLease(address(adapter));
        assertEq(uint(escrow.getState(id)), uint(RentalEscrow.State.Active));

        vm.expectRevert(bytes("Not terminal"));
        escrow.writeOffLendingPosition(id);
    }

    // =========================================================================
    //  WO-C: Reverts OwnableUnauthorizedAccount when called by non-owner.
    // =========================================================================
    function test_writeOff_reverts_nonOwner() public {
        uint256 id = _settledWithSurvivingPosition();

        vm.prank(tenant);
        vm.expectRevert();
        escrow.writeOffLendingPosition(id);
    }

    // =========================================================================
    //  WO-D: Reverts "No position" when there is no lending position for id.
    //        Uses a fresh escrow with lending disabled (no adapter set) so
    //        activation succeeds and produces a Settled agreement with no position.
    // =========================================================================
    function test_writeOff_reverts_emptyPosition() public {
        // Deploy a fresh escrow without any lending adapter.
        CxUSDC token2   = new CxUSDC();
        RentalEscrow e2 = new RentalEscrow(address(token2), treasury);
        token2.mint(tenant,   500_000e6);
        token2.mint(landlord, 500_000e6);
        vm.prank(tenant);   token2.approve(address(e2), type(uint256).max);
        vm.prank(landlord); token2.approve(address(e2), type(uint256).max);
        // Lending deliberately NOT enabled -- no adapter set.

        vm.prank(landlord);
        uint256 id = e2.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));
        vm.prank(tenant);   e2.tenantDeposit(id);
        vm.prank(landlord); e2.landlordDeposit(id); // activates, no lending position created

        vm.warp(block.timestamp + 64 days);
        e2.flagRentMissed(id); // Settled, no lending position

        (uint256 p,) = e2.lendingPositions(id);
        assertEq(p, 0, "pre: no lending position expected");

        vm.expectRevert();
        e2.writeOffLendingPosition(id);
    }
}
