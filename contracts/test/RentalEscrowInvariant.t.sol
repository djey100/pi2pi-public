// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {ILendingAdapter} from "../src/interfaces/ILendingAdapter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Mock token ───────────────────────────────────────────────────────────────

contract MockUSDCI is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ─── ChaoticAdapter ───────────────────────────────────────────────────────────

/// @dev Each withdraw() call cycles through four behaviors in round-robin order:
///      Normal → Revert → ZeroReturn → Partial(50%) → Normal → …
///      supply() always succeeds so that positions are actually created.
///      This ensures the fuzzer exercises all four escrow recovery paths
///      and that the lending code is live (not bypassed by NoOpAdapter).
contract ChaoticAdapter is ILendingAdapter {
    MockUSDCI public usdc;
    address public escrow;
    uint256 public stored;
    uint256 private _nonce;

    /// @dev Mode 4: getIndex() reverts (simulates fully paused adapter).
    ///      Settable by handler so the fuzzer can toggle it as an action.
    bool public indexReverts;
    function setIndexReverts(bool v) external { indexReverts = v; }

    constructor(address _usdc, address _escrow) {
        usdc = MockUSDCI(_usdc);
        escrow = _escrow;
    }

    // supply always works — we want positions to be created
    function supply(uint256 amount) external returns (uint256) {
        if (amount == 0) return 0;
        usdc.transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount; // scaledBalance == principal (index = 1e27)
    }

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 mode = _nonce % 4;
        _nonce++;

        if (mode == 1) revert("ChaoticAdapter: reverted");          // hard revert
        if (mode == 2) return 0;                                    // zero return (no transfer)
        if (mode == 3) {
            // Partial: return 50%, leave rest in adapter
            uint256 half = amount / 2;
            if (half > stored) half = stored;
            if (half > 0) {
                usdc.transfer(escrow, half);
                stored = stored >= half ? stored - half : 0;
            }
            return half;
        }
        // mode == 0: Normal — return full amount
        uint256 toReturn = amount > stored ? stored : amount;
        if (toReturn > 0) {
            usdc.transfer(escrow, toReturn);
            stored = stored >= toReturn ? stored - toReturn : 0;
        }
        return toReturn;
    }

    /// @dev Mode 4: reverts when indexReverts flag is set.
    ///      Exercises the C-1 fix: escrow must survive getIndex() failure.
    function getIndex() external view returns (uint256) {
        if (indexReverts) revert("ChaoticAdapter: getIndex reverted");
        return 1e27;
    }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/// @dev Drives the invariant fuzzer. Each public function is a valid action.
///      ChaoticAdapter is wired in from construction so lending is LIVE.
contract EscrowHandler is Test {
    MockUSDCI public usdc;
    RentalEscrow public escrow;
    ChaoticAdapter public adapter;

    // Actors
    address public tenant   = makeAddr("tenant");
    address public landlord = makeAddr("landlord");
    address public treasury = makeAddr("treasury");

    // Track agreement IDs created in this run
    uint256[] public agreementIds;

    function agreementCount() external view returns (uint256) { return agreementIds.length; }

    uint256 constant RENT     = 1_000e6;
    uint256 constant PROP_DEP = 0;
    uint256 constant MONTHS   = 6;

    constructor() {
        usdc    = new MockUSDCI();
        escrow  = new RentalEscrow(address(usdc), treasury);
        adapter = new ChaoticAdapter(address(usdc), address(escrow));

        // Wire lending: owner of escrow is this handler (deployed it)
        escrow.setLendingAdapter(address(adapter));
        escrow.emergencyEnableLending();

        usdc.mint(tenant,   10_000_000e6);
        usdc.mint(landlord, 10_000_000e6);

        vm.prank(tenant);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(landlord);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ─── Actions ─────────────────────────────────────────────────────────────

    /// @dev Create a new agreement and both parties deposit to activate it.
    function createAndActivate() external {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, PROP_DEP, MONTHS, bytes32(0));
        agreementIds.push(id);

        vm.prank(tenant);   escrow.tenantDeposit(id);
        vm.prank(landlord); escrow.landlordDeposit(id);
    }

    /// @dev Create an agreement where only tenant deposits (never activated).
    ///      Leaves nonActivatedFunds in escrow — exercises the I-1b strict path.
    function createTenantOnly() external {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, PROP_DEP, MONTHS, bytes32(0));
        agreementIds.push(id);

        vm.prank(tenant); escrow.tenantDeposit(id);
    }

    /// @dev End the lease for the first active agreement.
    function endLease(uint256 seed) external {
        if (agreementIds.length == 0) return;
        uint256 id = agreementIds[seed % agreementIds.length];
        try escrow.getAgreement(id) returns (RentalEscrow.Agreement memory a) {
            if (a.state != RentalEscrow.State.Active) return;
            vm.warp(a.leaseEndTime + 1);
            try escrow.endLease(id) {} catch {}
        } catch {}
    }

    /// @dev Expire a stale agreement via expireByLeaseEnd.
    function expireAgreement(uint256 seed) external {
        if (agreementIds.length == 0) return;
        uint256 id = agreementIds[seed % agreementIds.length];
        vm.warp(block.timestamp + 300 days);
        try escrow.expireByLeaseEnd(id) {} catch {}
    }

    /// @dev Call emergencySettleExpired.
    function emergencySettle(uint256 seed) external {
        if (agreementIds.length == 0) return;
        uint256 id = agreementIds[seed % agreementIds.length];
        vm.warp(block.timestamp + 200 days);
        try escrow.emergencySettleExpired(id) {} catch {}
    }

    /// @dev Flag rent missed on an overdue active agreement.
    function flagRentMissed(uint256 seed) external {
        if (agreementIds.length == 0) return;
        uint256 id = agreementIds[seed % agreementIds.length];
        vm.warp(block.timestamp + 64 days);
        try escrow.flagRentMissed(id) {} catch {}
    }

    /// @dev Tenant calls exitWithLoss.
    function tenantExitWithLoss(uint256 seed) external {
        if (agreementIds.length == 0) return;
        uint256 id = agreementIds[seed % agreementIds.length];
        vm.prank(tenant);
        try escrow.exitWithLoss(id) {} catch {}
    }

    /// @dev Landlord calls exitWithLoss.
    function landlordExitWithLoss(uint256 seed) external {
        if (agreementIds.length == 0) return;
        uint256 id = agreementIds[seed % agreementIds.length];
        vm.prank(landlord);
        try escrow.exitWithLoss(id) {} catch {}
    }

    /// @dev Attempt to recover lent funds for a settled agreement.
    ///      This exercises reclaimLentFundsAfterSettlement — the key path for
    ///      agreements where the adapter was unavailable at settlement time.
    function reclaimLentFunds(uint256 seed) external {
        if (agreementIds.length == 0) return;
        uint256 id = agreementIds[seed % agreementIds.length];
        try escrow.reclaimLentFundsAfterSettlement(id) {} catch {}
    }

    /// @dev Tenant tops up their deposit on an active agreement.
    ///      Exercises the supply path for an already-live position.
    function topUpDeposit(uint256 seed, uint256 amount) external {
        if (agreementIds.length == 0) return;
        uint256 id = agreementIds[seed % agreementIds.length];
        amount = bound(amount, 1e6, 100_000e6);
        vm.prank(tenant);
        try escrow.topUpDeposit(id, amount) {} catch {}
    }

    /// @dev Both parties call withdraw to drain pendingWithdrawals.
    function withdrawAll() external {
        vm.prank(tenant);   try escrow.withdraw() {} catch {}
        vm.prank(landlord); try escrow.withdraw() {} catch {}
        vm.prank(treasury); try escrow.withdraw() {} catch {}
    }

    /// @dev Toggle mode 4: getIndex() reverts / resumes.
    ///      Exercises the C-1 fix — escrow must settle gracefully when adapter is fully paused.
    function flipIndexReverts() external {
        adapter.setIndexReverts(!adapter.indexReverts());
    }
}

// ─── Invariant test ───────────────────────────────────────────────────────────

/// @title RentalEscrow invariant suite — strict equality edition
///
/// @notice Four structural invariants checked after every action sequence.
///         ChaoticAdapter is live — lending positions are created and all four
///         withdrawal modes (normal/revert/zero/partial) are exercised.
///
///   I-1a Solvency (unchanged):
///         balance >= totalPendingWithdrawals
///
///   I-1b Bilateral balance (NEW — strict equality):
///         balance == totalPendingWithdrawals + nonActivatedFunds
///
///         nonActivatedFunds = Σ deposited amounts for non-activated, non-terminal
///         agreements.  Exact formula and assumptions are documented in the invariant body.
///
///   I-2  Lent principal (STRENGTHENED to strict ==):
///         totalLentPrincipal == Σ lendingPositions[id].principal  (ALL ids, no cap)
///
///   I-3  Pending withdrawals (STRENGTHENED to strict ==):
///         totalPendingWithdrawals == Σ pendingWithdrawals[known actor]
///         (tenant + landlord + treasury; treasury always 0 in handler)
///
///   I-4  Terminal states are irreversible (unchanged).
///
/// Assumptions for I-1b strict equality:
///   - bufferBps = 0: no fraction of deposits kept as unlent buffer in escrow.
///     If bufferBps > 0 a buffer portion would sit in escrow untracked, breaking I-1b.
///   - ChaoticAdapter.supply() always succeeds: a failed topUpDeposit supply would leave
///     `addedAmount` in escrow untracked by either totalPendingWithdrawals or nonActivatedFunds.
///   - propSecurityDeposit = 0: no PropDep funds involved.
///   - No yield: ChaoticAdapter.getIndex() == 1e27 (index=1), so protocolYield = 0.
///     Protocol fee direct-transfers would also break the formula.
///   If any assumption is violated the invariant is expected to break loudly — do not weaken.
contract RentalEscrowInvariantTest is Test {
    EscrowHandler handler;
    RentalEscrow  escrow;
    MockUSDCI     usdc;

    // Snapshot last state of each agreement to verify I-4
    mapping(uint256 => RentalEscrow.State) private _lastState;

    function setUp() public {
        handler = new EscrowHandler();
        escrow  = handler.escrow();
        usdc    = handler.usdc();

        targetContract(address(handler));

        // Seed the handler with one active agreement so invariants fire from the start
        handler.createAndActivate();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /// @dev Compute nonActivatedFunds: sum of deposited USDC for all non-terminal,
    ///      non-activated agreements.  Assumes propSecurityDeposit = 0.
    ///      Formula:
    ///        tenantDeposited  && activatedAt == 0 → +monthlyRent + commitmentDeposit
    ///        landlordDeposited && activatedAt == 0 → +hostingDeposit
    ///      (These two are mutually exclusive: if both deposit, _activate fires immediately.)
    function _nonActivatedFunds() internal view returns (uint256 total) {
        uint256 count = handler.agreementCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 id = handler.agreementIds(i);
            RentalEscrow.Agreement memory a = escrow.getAgreement(id);
            bool terminal = (
                a.state == RentalEscrow.State.Settled ||
                a.state == RentalEscrow.State.LeaseEnded
            );
            if (terminal) continue;
            if (a.activatedAt != 0) continue; // active lease — in adapter, not escrow

            if (a.tenantDeposited) {
                // Tenant deposited monthlyRent + commitmentDeposit (propDep = 0 in handler)
                total += a.monthlyRent + a.commitmentDeposit;
            }
            if (a.landlordDeposited) {
                // Landlord deposited hostingDeposit only
                total += a.hostingDeposit;
            }
        }
    }

    // ─── Invariants ──────────────────────────────────────────────────────────

    /// @dev I-1a: Classic solvency — escrow USDC balance >= totalPendingWithdrawals.
    ///      If this breaks, the escrow cannot pay users what it owes them.
    ///      Holds even under partial adapter returns because the escrow only credits
    ///      pendingWithdrawals with what it actually received.
    function invariant_solvency() public view {
        uint256 balance = usdc.balanceOf(address(escrow));
        uint256 owed    = escrow.totalPendingWithdrawals();
        assertGe(balance, owed, "I-1a: escrow insolvent: balance < totalPendingWithdrawals");
    }

    /// @dev I-1b: Strict bilateral balance.
    ///      Every USDC in the escrow is accounted for: either it is owed to a party
    ///      via pendingWithdrawals, or it belongs to a non-activated deposit waiting
    ///      for the counterparty.  No stranded, untracked USDC should exist.
    ///
    ///      Holds because:
    ///        - activated agreements: all deposits sent to adapter at activation time
    ///          (monthlyRent → landlord directly, commitmentDeposit + hostingDeposit → adapter).
    ///          Nothing stays in escrow balance from those agreements.
    ///        - settlement paths that use pendingWithdrawals (expireByLeaseEnd,
    ///          reclaimLentFundsAfterSettlement): adapter funds return to escrow and are
    ///          immediately credited to pendingWithdrawals in the same transaction.
    ///        - direct-transfer paths (endLease, flagRentMissed, emergencySettleExpired):
    ///          funds return from adapter and leave escrow atomically — zero net change
    ///          to (balance - totalPendingWithdrawals).
    ///
    ///      See contract-level comment for explicit assumptions.
    function invariant_strictBalance() public view {
        uint256 balance         = usdc.balanceOf(address(escrow));
        uint256 owed            = escrow.totalPendingWithdrawals();
        uint256 nonActivated    = _nonActivatedFunds();

        assertEq(
            balance,
            owed + nonActivated,
            "I-1b: balance != totalPendingWithdrawals + nonActivatedFunds"
        );
    }

    /// @dev I-2: totalLentPrincipal == Σ lendingPositions[id].principal (ALL ids, strict ==).
    ///
    ///      Both counters are updated in lockstep:
    ///        _maybeLendForAgreement: positions[id].principal = toSupply, totalLentPrincipal += toSupply
    ///        topUpDeposit:           pos.principal += toSupply,          totalLentPrincipal += toSupply
    ///        _reclaimFromLending:    delete positions[id],               totalLentPrincipal -= pos.principal
    ///        reclaimLentFunds:       delete positions[id],               totalLentPrincipal -= pos.principal
    ///      If a revert/zero-return leaves a position alive, NEITHER counter changes — equality holds.
    ///
    ///      Uses ALL agreementIds (no 20-cap) so the fuzzer cannot hide divergence in later ids.
    ///
    ///      Emits console.log when lending is live to prove ChaoticAdapter is exercised.
    function invariant_lentPrincipalStrict() public view {
        uint256 total = escrow.totalLentPrincipal();
        if (total > 0) {
            console.log("[I-2 LIVE] ChaoticAdapter active: totalLentPrincipal =", total);
        }

        uint256 computed = 0;
        uint256 count    = handler.agreementCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 id = handler.agreementIds(i);
            (uint256 principal,) = escrow.lendingPositions(id);
            computed += principal;
        }

        assertEq(
            total,
            computed,
            "I-2: totalLentPrincipal != sum of all lendingPositions[id].principal"
        );
    }

    /// @dev I-3: totalPendingWithdrawals == Σ pendingWithdrawals[actor] (strict ==).
    ///
    ///      All crediting / debiting of pendingWithdrawals touches totalPendingWithdrawals
    ///      by the same amount in the same statement.  The only actors that ever receive
    ///      pendingWithdrawals credits in this handler are tenant and landlord.  Treasury
    ///      receives protocol fees via direct safeTransfer — never via pendingWithdrawals —
    ///      so pendingWithdrawals[treasury] is always 0, and including it is safe.
    ///
    ///      Note: savedBondPoster (dispute bond return) is always tenant or landlord; there
    ///      is no dispute bond in handler agreements (disputeBond = 0), so that path is
    ///      unreachable here.
    function invariant_pendingWithdrawalsStrict() public view {
        address ten = handler.tenant();
        address lan = handler.landlord();
        address tre = handler.treasury();

        uint256 sumKnown =
            escrow.pendingWithdrawals(ten) +
            escrow.pendingWithdrawals(lan) +
            escrow.pendingWithdrawals(tre);

        assertEq(
            escrow.totalPendingWithdrawals(),
            sumKnown,
            "I-3: totalPendingWithdrawals != sum of known actor pending amounts"
        );
    }

    /// @dev I-4: Terminal states (Settled, LeaseEnded) are final.
    ///      Checks that state only moves forward — never out of a terminal state.
    ///      Iterates ALL agreementIds (no cap); _lastState snapshot updated each check.
    function invariant_terminalStatesFinal() public {
        uint256 count = handler.agreementCount();
        for (uint256 i = 0; i < count; i++) {
            uint256 id = handler.agreementIds(i);
            RentalEscrow.State current = escrow.getState(id);
            RentalEscrow.State last    = _lastState[id];

            bool lastWasTerminal = (
                last == RentalEscrow.State.Settled ||
                last == RentalEscrow.State.LeaseEnded
            );
            if (lastWasTerminal) {
                assertEq(
                    uint(current),
                    uint(last),
                    "I-4: terminal state changed - agreement re-entered non-terminal state"
                );
            }
            _lastState[id] = current;
        }
    }
}
