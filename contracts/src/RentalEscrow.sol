// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILendingAdapter} from "./interfaces/ILendingAdapter.sol";
import {LendingLogic} from "./libraries/LendingLogic.sol";

interface IPropDepEscrow {
    function createPropDep(uint256 leaseId, address tenant, address landlord, uint256 amount, uint256 leaseEndTime) external;
    function syncLeaseEndTime(uint256 leaseId, uint256 newLeaseEndTime) external;
    function getState(uint256 leaseId) external view returns (uint8);
    function isResolved(uint256 leaseId) external view returns (bool);
}

/// @title RentalEscrow — Equal Stakes Protocol
/// @notice Peer-to-peer rental agreements with symmetric deposits staked in Aave v2.
///         Tenant posts Commitment Deposit (1× MR), Landlord posts Hosting Deposit (1× MR).
///         Optional Property Security Deposit (up to 3× MR) posted by tenant.
///         Yield split: 70% to parties, 30% to protocol.
contract RentalEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Enums ───────────────────────────────────────────────────────────────────

    /// @notice Main contract lifecycle states
    enum State {
        Created,              // Agreement terms set, awaiting deposits
        AwaitingLandlordDep,  // Tenant deposited, waiting for landlord
        AwaitingTenantDep,    // Landlord deposited, waiting for tenant
        Active,               // Both deposits placed, rent cycle running
        EarlyTermProposed,    // One party requested early termination
        CheckoutProposed,     // [UNREACHABLE] Kept for ABI layout stability — renewal removed
        DamageClaimed,        // [DEPRECATED] PropDep moved to PropDepEscrow
        DisputeOpen,          // Bond posted (early term only now), funds frozen
        Settled,              // All funds distributed, contract closed
        LeaseEnded            // Lease finished, equal stakes returned, PropDep handled by PropDepEscrow
    }

    /// @notice Early termination sub-modes
    enum TermType {
        None,
        Mutual,           // Both agree → deposits returned to owners
        InitiatorAccepts,  // Initiator forfeits their deposit to counterparty
        Disputed           // Initiator posts Bond → freeze → court
    }

    // ─── Structs ─────────────────────────────────────────────────────────────────

    struct Agreement {
        // Parties
        address tenant;
        address landlord;

        // Financial terms
        uint256 monthlyRent;           // MR in USDC (6 decimals)
        uint256 commitmentDeposit;     // Tenant's deposit = 1× MR
        uint256 hostingDeposit;        // Landlord's deposit = 1× MR
        uint256 propSecurityDeposit;   // Optional, 0..3× MR, posted by tenant
        uint256 leaseDurationMonths;

        // Timing
        uint256 createdAt;
        uint256 activatedAt;           // When both deposits confirmed
        uint256 leaseEndTime;          // activatedAt + duration

        // State machine
        State state;

        // Deposit tracking
        bool tenantDeposited;
        bool landlordDeposited;
        bool firstRentPaid;

        // Rent tracking
        uint256 lastRentTimestamp;     // Last rent payment time
        uint256 rentPaymentsMade;

        // Checkout / damage claim (legacy fields kept for ABI layout stability)
        uint256 damageClaim;           // Amount LL claims (0 = no damage)
        uint256 damageClaimDeadline;   // Tenant must respond by this time
        bool tenantAcceptedClaim;
        bool tenantDisputedClaim;

        // Dispute (checkout or early-term)
        uint256 disputeBond;           // Bond posted by claimant
        address disputeBondPoster;     // Who posted the bond
        uint256 freezeStart;
        uint256 freezeDuration;        // Default 60 days

        // Early termination
        TermType earlyTermType;
        address earlyTermInitiator;
        uint256 earlyTermProposedAt;    // timestamp of early term proposal

        // Mutual settlement tracking (requires both parties)
        address mutualSettlementProposer;
        uint256 mutualSettlementToLandlord;
        uint256 mutualSettlementToTenant;

        // Settlement mode flag
        bool earlySettlementMode;     // true = split all funds, false = split prop deposit only

        // Content hash (IPFS CID of agreement + docs)
        bytes32 contentHash;

        // ─── Appended fields (must stay at end to keep ABI-getter layout stable) ─
        bool hasPropDep;               // True if propSecurityDeposit > 0 and handed off
        uint256 rentGraceExtension;    // Extra seconds landlord granted this cycle
        uint256 vacateDeadline;        // Sprint 4: when initiator must vacate (0 = not set)
    }

    // ─── Constants ───────────────────────────────────────────────────────────────

    uint256 public constant MAX_PROP_DEPOSIT_MULTIPLIER = 3;
    uint256 public constant CLAIM_RESPONSE_PERIOD = 3 days;
    uint256 public constant BOND_POSTING_PERIOD = 3 days;
    uint256 public constant DEFAULT_FREEZE_DURATION = 60 days;
    uint256 public constant RENT_GRACE_PERIOD = 3 days;
    uint256 public constant EARLY_TERM_RESPONSE_PERIOD = 7 days;   // counterparty must respond to early term

    uint256 public constant DEPOSIT_DEADLINE = 24 hours;  // Counterparty must deposit within 24h

    uint256 public constant YIELD_PARTY_BPS = 7000;    // 70% to parties
    uint256 public constant YIELD_PROTOCOL_BPS = 3000;  // 30% to protocol
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ─── State ───────────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    IPropDepEscrow public propDepEscrow; // Set once after deployment via setPropDepEscrow
    address public protocolTreasury;
    address public owner;

    /// @notice Dev mode flag — once disabled, cannot be re-enabled. Guards all _dev* functions.
    bool public devMode = true;

    /// @notice Global time offset for testing. Only works when devMode=true.
    ///         Positive = future, negative = past. Applied via _now().
    int256 public timeOffset;

    /// @notice Chain IDs for devMode whitelist (test nets) and mainnet block-list (defense-in-depth).
    uint256 private constant ARBITRUM_ONE = 42161;
    uint256 private constant ETHEREUM_MAINNET = 1;
    uint256 private constant ARC_TESTNET = 5042002;     // 5042002 IS the testnet; Arc mainnet chainId is 5042 (see ARC_MAINNET below)
    uint256 private constant ARC_MAINNET = 5042;        // NOT in the devMode whitelist below — must stay excluded
    uint256 private constant ANVIL_LOCAL = 31337;
    uint256 private constant ARBITRUM_SEPOLIA = 421614;
    uint256 private constant ETHEREUM_SEPOLIA = 11155111;

    uint256 public nextAgreementId;
    uint256 public activeAgreementCount;
    mapping(uint256 => Agreement) public agreements;

    /// @notice Pull-payment balances — users withdraw themselves to avoid revert-locking
    mapping(address => uint256) public pendingWithdrawals;

    /// @notice C-3: Total USDC owed via pendingWithdrawals. rescueTokens must not touch this.
    uint256 public totalPendingWithdrawals;

    // ─── Lending integration (Sprint 3 — INACTIVE in Level 0/3a) ────────────────
    // These state vars exist from 3a but lending logic is gated by `lendingEnabled`.
    // In Sprint 3a (this commit) lendingEnabled is false by default — supply/withdraw
    // logic is added in Sprint 3b. Per LOCKED architecture, only RentalEscrow gets
    // lending in Sprint 3; PropDepEscrow stays 100% liquid USDC until Sprint 5+.

    /// @notice Lending adapter (e.g. AaveAdapter). Set via setLendingAdapter().
    ILendingAdapter public lendingAdapter;

    /// @notice Master switch — owner can flip false to immediately stop new supplies
    ///         and force any existing positions to be returned via buffer only.
    ///         Default false in 3a (no supply path active yet).
    bool public lendingEnabled;

    /// @notice Liquid buffer percentage in basis points (0 = 100% to Aave by default).
    ///         Ceiling 100%. Mutable by owner — can raise if risk concerns emerge.
    ///         Default 0 per product decision 2026-04-09: half-measures give us neither
    ///         real safety (if Aave breaks we're dead either way) nor real yield. Binary
    ///         choice — either trust Aave fully (0% buffer) or don't use it (100% buffer).
    uint256 public bufferBps = 0;

    /// @notice Protocol fee percentage of yield, in basis points (3000 = 30%).
    ///         Ceiling 50%. Mutable by owner.
    uint256 public protocolFeeBps = 3000;

    /// @notice Per-agreement lending position used in yield accounting.
    /// @dev Uses scaledBalance (ground truth per Aave's internal math) instead of
    ///      principal+entryIndex to avoid rounding drift between our calculation and
    ///      Aave's actual stored amount. Principal is kept separately to compute yield
    ///      and to distribute principal back to owners unchanged.
    struct LendingPosition {
        uint256 principal;      // USDC supplied to lending protocol for this agreement
        uint256 scaledBalance;  // Aave-internal scaled delta for this supply (ground truth)
    }

    /// @notice agreementId => LendingPosition
    mapping(uint256 => LendingPosition) public lendingPositions;

    /// @dev Aave's RAY base for index math.
    uint256 private constant RAY = 1e27;

    /// @notice H-5: Total USDC currently lent across all positions. Blocks adapter swap when > 0.
    uint256 public totalLentPrincipal;

    /// @notice C-2 recovery: intended landlord BPS when Aave hard-fails during settlement.
    ///         Encoding: 0 = not set (use deposit-ratio default); N>0 = override, landlordBps = N-1.
    ///         Range: 1 (0 bps, all to tenant) … 10001 (10000 bps, all to landlord).
    mapping(uint256 => uint256) private _recoveryBps;

    // ─── Events ──────────────────────────────────────────────────────────────────

    event AgreementCreated(
        uint256 indexed id,
        address indexed tenant,
        address indexed landlord,
        uint256 monthlyRent,
        uint256 propSecurityDeposit,
        uint256 leaseDurationMonths
    );

    event DepositPlaced(uint256 indexed id, address indexed party, uint256 amount, string depositType);
    event AgreementActivated(uint256 indexed id, uint256 activatedAt, uint256 leaseEndTime);
    event RentPaid(uint256 indexed id, uint256 month, uint256 amount);

    event DamageClaimFiled(uint256 indexed id, uint256 amount, uint256 deadline);
    event DamageClaimAccepted(uint256 indexed id, uint256 amount);
    event DamageClaimDisputed(uint256 indexed id);
    event DamageClaimDropped(uint256 indexed id);

    event BondPosted(uint256 indexed id, address indexed poster, uint256 amount);
    event DisputeFreezeStarted(uint256 indexed id, uint256 freezeEnd);
    event DisputeSettled(uint256 indexed id, uint256 toLandlord, uint256 toTenant);
    event FreezeExpiredAllReturned(uint256 indexed id);

    event EarlyTermProposed(uint256 indexed id, address indexed initiator, TermType termType);
    event EarlyTermMutualSigned(uint256 indexed id, address indexed party);
    event EarlyTermExecuted(uint256 indexed id, TermType termType);

    event AgreementSettled(uint256 indexed id, string reason);
    event AgreementCancelledUnfunded(uint256 indexed id, address indexed cancelledBy, uint256 refundAmount);
    event EarlyTermExpired(uint256 indexed id);
    event CheckoutExpired(uint256 indexed id);
    event MutualSettlementProposed(uint256 indexed id, address indexed proposer, uint256 toLandlord, uint256 toTenant);
    event MutualSettlementConfirmed(uint256 indexed id, address indexed confirmer);
    event Withdrawal(address indexed to, uint256 amount);

    // ─── Modifiers ───────────────────────────────────────────────────────────────

    modifier onlyParty(uint256 id) {
        Agreement storage a = agreements[id];
        if (msg.sender != a.tenant && msg.sender != a.landlord) revert NotAParty();
        _;
    }

    modifier onlyTenant(uint256 id) {
        require(msg.sender == agreements[id].tenant);
        _;
    }

    modifier onlyLandlord(uint256 id) {
        require(msg.sender == agreements[id].landlord);
        _;
    }

    modifier inState(uint256 id, State expected) {
        require(agreements[id].state == expected);
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────────

    constructor(address _usdc, address _protocolTreasury) {
        require(_usdc != address(0));
        require(_protocolTreasury != address(0));
        usdc = IERC20(_usdc);
        protocolTreasury = _protocolTreasury;
        owner = msg.sender;
        // C-1: devMode allowed ONLY on known test chain IDs (whitelist, not blacklist).
        // Whitelist correctly handles Arc mainnet (chainId 5042, see ARC_MAINNET) by
        // simply never listing it here — it falls through to devMode = false.
        if (block.chainid != ARC_TESTNET &&
            block.chainid != ANVIL_LOCAL &&
            block.chainid != ARBITRUM_SEPOLIA &&
            block.chainid != ETHEREUM_SEPOLIA) {
            devMode = false;
        }
    }

    /// @notice Set the PropDepEscrow contract address. Can only be set once.
    function setPropDepEscrow(address _propDepEscrow) external onlyOwner {
        require(address(propDepEscrow) == address(0));
        require(_propDepEscrow != address(0));
        propDepEscrow = IPropDepEscrow(_propDepEscrow);
    }

    // ─── Lending admin (Sprint 3a — config only, logic comes in 3b/3c) ──────────

    error BufferOutOfRange();
    error ProtocolFeeTooHigh();
    error ZeroAddress();
    error LendingUnavailable();
    error AlreadySettled();
    error PropDepEscrowNotSet();
    error PropDepTooLarge();
    error NotOverdueYet();
    error NotAParty();
    /// @notice F-13: Adapter accepted USDC but returned scaledBalance == 0. Reverts atomically.
    error ZeroScaledSupply();

    event LendingAdapterSet(address indexed adapter);
    event LendingEnabled(bool enabled);
    event BufferUpdated(uint256 bps);
    /// @notice F-13: Emitted when owner writes off an unrecoverable lending position (total vault loss).
    event LendingPositionWrittenOff(uint256 indexed id, uint256 principal, uint256 scaledBalance);
    /// @notice C-2: Emitted when lending withdrawal returned less than principal (vault loss / liquidity cap).
    event LendingShortfall(uint256 indexed agreementId, uint256 expected, uint256 actual);
    /// @notice C-2: Emitted when lending is completely unavailable at settlement time. Position kept for recovery.
    event LendingRecoveryPending(uint256 indexed agreementId, uint256 lockedPrincipal);
    event ProtocolFeeUpdated(uint256 bps);
    event TreasuryUpdated(address indexed treasury);

    /// @notice Wire the lending adapter. Owner-only. Disabling lending afterwards
    ///         is done via emergencyDisableLending() — adapter address remains as
    ///         a record of which protocol the existing positions live in.
    function setLendingAdapter(address adapter) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        // H-5: Block adapter change while any positions are outstanding (funds in old adapter)
        require(totalLentPrincipal == 0);
        lendingAdapter = ILendingAdapter(adapter);
        emit LendingAdapterSet(adapter);
    }

    /// @notice Update buffer percentage. Ceiling 100%. No floor — 0% is valid
    ///         (and is the default: 100% of deposits to Aave for maximum yield).
    function setBufferBps(uint256 bps) external onlyOwner {
        if (bps > 10000) revert BufferOutOfRange();
        bufferBps = bps;
        emit BufferUpdated(bps);
    }

    /// @notice Update protocol fee on yield. Ceiling 50%.
    function setProtocolFeeBps(uint256 bps) external onlyOwner {
        if (bps > 5000) revert ProtocolFeeTooHigh();
        protocolFeeBps = bps;
        emit ProtocolFeeUpdated(bps);
    }

    /// @notice Emergency safety valve — owner can disable new supplies to lending.
    ///         Existing positions are NOT auto-withdrawn (would risk reverts);
    ///         they unwind naturally as agreements settle. After this call, all
    ///         new deposits stay 100% in the buffer regardless of bufferBps.
    function emergencyDisableLending() external onlyOwner {
        lendingEnabled = false;
        emit LendingEnabled(false);
    }

    /// @notice Re-enable lending after emergency stop.
    function emergencyEnableLending() external onlyOwner {
        require(address(lendingAdapter) != address(0));
        lendingEnabled = true;
        emit LendingEnabled(true);
    }

    // ─── Lending helpers (Sprint 3c — Level 2) ──────────────────────────────────

    event LendingSupplied(uint256 indexed agreementId, uint256 principal, uint256 scaledBalance);
    event LendingWithdrawn(uint256 indexed agreementId, uint256 principal, uint256 yield, uint256 protocolCut);
    event LendingSupplyFailed(uint256 indexed agreementId, uint256 amount);
    event YieldDistributed(uint256 indexed agreementId, uint256 toTenant, uint256 toLandlord, uint256 toProtocol);
    event DepositToppedUp(uint256 indexed agreementId, uint256 addedAmount, uint256 newScaledBalance);

    /// @notice Supply the lendable portion of an agreement's funds to Aave.
    /// @dev    Called internally from _activate after monthlyRent and propSecurityDeposit
    ///         have been paid out, leaving commitmentDeposit + hostingDeposit in the contract.
    ///         Default bufferBps=0 supplies 100% to Aave for maximum yield.
    ///         Stores scaledBalance (returned by adapter.supply) — the Aave-internal ground
    ///         truth that avoids rounding drift on withdraw.
    ///         Wrapped in try/catch — Aave supply-cap reverts don't break the flow.
    function _maybeLendForAgreement(uint256 agreementId, uint256 amount) internal {
        if (!lendingEnabled || address(lendingAdapter) == address(0) || amount == 0) return;
        uint256 bufferKeep = LendingLogic.calculateBufferTarget(amount, bufferBps);
        uint256 toSupply = amount - bufferKeep;
        if (toSupply == 0) return;
        usdc.forceApprove(address(lendingAdapter), toSupply);
        try lendingAdapter.supply(toSupply) returns (uint256 scaledDelta) {
            // F-13 (C-3 strict): adapter accepted USDC but returned scaledBalance == 0.
            //      Revert atomically — propagates out of the try-success block, NOT caught
            //      by the catch clause, so the USDC transferFrom is also unwound.
            if (scaledDelta == 0) revert ZeroScaledSupply();
            lendingPositions[agreementId] = LendingPosition({
                principal: toSupply,
                scaledBalance: scaledDelta
            });
            totalLentPrincipal += toSupply;
            emit LendingSupplied(agreementId, toSupply, scaledDelta);
        } catch {
            usdc.forceApprove(address(lendingAdapter), 0);
            emit LendingSupplyFailed(agreementId, toSupply);
        }
    }

    /// @notice Top up an existing agreement's deposit mid-lease.
    /// @dev    Adds more USDC to the commitment deposit (tenant only). The new amount
    ///         is supplied to Aave and the lending position's scaledBalance is updated
    ///         by simple addition — since Aave already tracks per-scaled-unit correctly,
    ///         no weighted index math is needed for the scaledBalance itself. The
    ///         effective "principal" for yield accounting grows by the topped-up amount.
    function topUpDeposit(uint256 agreementId, uint256 addedAmount) external onlyTenant(agreementId) nonReentrant {
        require(addedAmount > 0);
        Agreement storage a = agreements[agreementId];
        require(a.state == State.Active);

        usdc.safeTransferFrom(msg.sender, address(this), addedAmount);
        a.commitmentDeposit += addedAmount;

        if (lendingEnabled && address(lendingAdapter) != address(0)) {
            uint256 bufferKeep = LendingLogic.calculateBufferTarget(addedAmount, bufferBps);
            uint256 toSupply = addedAmount - bufferKeep;
            if (toSupply > 0) {
                usdc.forceApprove(address(lendingAdapter), toSupply);
                try lendingAdapter.supply(toSupply) returns (uint256 scaledDelta) {
                    // F-13 (C-3 strict): revert propagates out of try-success, NOT caught.
                    if (scaledDelta == 0) revert ZeroScaledSupply();
                    LendingPosition storage pos = lendingPositions[agreementId];
                    pos.principal += toSupply;
                    pos.scaledBalance += scaledDelta;
                    totalLentPrincipal += toSupply;
                    emit DepositToppedUp(agreementId, toSupply, pos.scaledBalance);
                } catch {
                    usdc.forceApprove(address(lendingAdapter), 0);
                }
            }
        }
    }

    /// @notice C-2: Ensure commitment+hosting are liquid before transfers.
    /// @dev    Returns how much principal is ACTUALLY available (may be less than
    ///         a.commitmentDeposit + a.hostingDeposit on lending shortfall/failure).
    ///         Callers MUST use availablePrincipal for transfers, not the struct fields.
    /// @return userYield     The 70% of yield for distribution to parties.
    /// @return availablePrincipal Actual principal that can be distributed (incl. buffer in escrow).
    function _ensureLiquidAndPayProtocolFee(uint256 id) internal returns (uint256 userYield, uint256 availablePrincipal) {
        Agreement storage a = agreements[id];
        LendingPosition memory pos = lendingPositions[id];
        uint256 totalDeposits = a.commitmentDeposit + a.hostingDeposit;

        if (pos.principal == 0) {
            // Nothing was lent — all deposits are in escrow
            return (0, totalDeposits);
        }

        (uint256 recovered, uint256 yield) = _reclaimFromLending(id);

        // Buffer = portion of deposits that was never lent (kept in escrow)
        uint256 bufferInEscrow = totalDeposits > pos.principal ? totalDeposits - pos.principal : 0;
        availablePrincipal = bufferInEscrow + recovered;

        if (yield == 0) return (0, availablePrincipal);
        (uint256 _userYield, uint256 protocolYield) = LendingLogic.splitYield(yield, protocolFeeBps);
        if (protocolYield > 0) {
            usdc.safeTransfer(protocolTreasury, protocolYield);
        }
        return (_userYield, availablePrincipal);
    }

    /// @notice C-2: Reclaim from lending. Graceful — never reverts.
    /// @dev    Two failure modes handled differently:
    ///         1. Hard revert (Aave paused, etc.): returns (0, 0) WITHOUT deleting position.
    ///            Caller proceeds with buffer only; position stays for recovery later.
    ///         2. Partial return (Morpho liquidity cap, vault loss): returns (received, 0)
    ///            WITH deleting position. Pro-rata distribution by caller.
    ///         Normal case: returns (principal, yield) — full recovery.
    function _reclaimFromLending(uint256 agreementId) internal returns (uint256 principal, uint256 yield) {
        LendingPosition memory pos = lendingPositions[agreementId];
        if (pos.principal == 0 || pos.scaledBalance == 0) return (0, 0);

        // C-1: getIndex() wrapped in try/catch — a paused adapter reverts ALL calls,
        //      including reads.  Treat a getIndex() revert as the same hard-failure as a
        //      withdraw() revert: leave position intact for reclaimLentFundsAfterSettlement().
        uint256 currentIndex;
        try lendingAdapter.getIndex() returns (uint256 _index) {
            currentIndex = _index;
        } catch {
            emit LendingRecoveryPending(agreementId, pos.principal);
            return (0, 0);
        }
        uint256 realValue = (pos.scaledBalance * currentIndex) / RAY;

        // C-2: measure actual USDC inflow via balance delta — not the adapter's reported value.
        //      A lying or buggy adapter cannot inflate received beyond what it really transferred.
        uint256 balBefore = usdc.balanceOf(address(this));
        try lendingAdapter.withdraw(realValue) returns (uint256 /* _reported */) {
            // intentionally ignore reported value; use ground-truth balance delta below
        } catch {
            // Hard failure — leave position intact for reclaimLentFundsAfterSettlement()
            emit LendingRecoveryPending(agreementId, pos.principal);
            return (0, 0);
        }
        uint256 received = usdc.balanceOf(address(this)) - balBefore;

        // Zero inflow = treat as hard failure (ERC-4626 vaults may return 0 without reverting)
        if (received == 0) {
            emit LendingRecoveryPending(agreementId, pos.principal);
            return (0, 0); // position intentionally NOT deleted
        }

        // Clear position (we got something back)
        delete lendingPositions[agreementId];
        if (totalLentPrincipal >= pos.principal) {
            totalLentPrincipal -= pos.principal;
        } else {
            totalLentPrincipal = 0;
        }

        if (received < pos.principal) {
            // Partial recovery (vault loss or liquidity cap)
            emit LendingShortfall(agreementId, pos.principal, received);
            return (received, 0);
        }

        principal = pos.principal;
        yield = received - pos.principal;
    }

    /// @notice C-2: Clean settlement — commitment → tenant, hosting → landlord, yield split evenly.
    ///         On lending shortfall, distributes pro-rata from what was actually recovered.
    function _distributeWithYield(uint256 id) internal {
        Agreement storage a = agreements[id];
        (uint256 userYield, uint256 available) = _ensureLiquidAndPayProtocolFee(id);

        uint256 landlordYield = userYield / 2;
        uint256 tenantYield = userYield - landlordYield; // tenant gets rounding dust

        uint256 totalDeposits = a.commitmentDeposit + a.hostingDeposit;
        uint256 tenantPrincipal;
        uint256 landlordPrincipal;

        if (available >= totalDeposits) {
            // Normal case: full principal available
            tenantPrincipal = a.commitmentDeposit;
            landlordPrincipal = a.hostingDeposit;
        } else {
            // Shortfall: distribute pro-rata from what was recovered
            tenantPrincipal = totalDeposits > 0 ? (available * a.commitmentDeposit) / totalDeposits : 0;
            landlordPrincipal = available - tenantPrincipal;
        }

        if (tenantPrincipal + tenantYield > 0) usdc.safeTransfer(a.tenant, tenantPrincipal + tenantYield);
        if (landlordPrincipal + landlordYield > 0) usdc.safeTransfer(a.landlord, landlordPrincipal + landlordYield);
        emit YieldDistributed(id, tenantYield, landlordYield, 0);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  1. AGREEMENT CREATION
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Create a new rental agreement. Either party can initiate.
    /// @param tenant Address of tenant
    /// @param landlord Address of landlord
    /// @param monthlyRent Monthly rent in USDC (6 decimals)
    /// @param propSecurityDeposit Optional property deposit (0 to 3× MR)
    /// @param leaseDurationMonths Lease length in months
    /// @param contentHash IPFS hash of signed agreement documents
    function createAgreement(
        address tenant,
        address landlord,
        uint256 monthlyRent,
        uint256 propSecurityDeposit,
        uint256 leaseDurationMonths,
        bytes32 contentHash
    ) external returns (uint256 id) {
        require(tenant != address(0) && landlord != address(0));
        require(tenant != landlord);
        if (msg.sender != tenant && msg.sender != landlord) revert NotAParty();
        require(monthlyRent > 0);
        require(leaseDurationMonths > 0);
        if (propSecurityDeposit > monthlyRent * MAX_PROP_DEPOSIT_MULTIPLIER) revert PropDepTooLarge();

        id = nextAgreementId++;
        activeAgreementCount++;

        Agreement storage a = agreements[id];
        a.tenant = tenant;
        a.landlord = landlord;
        a.monthlyRent = monthlyRent;
        a.commitmentDeposit = monthlyRent;   // Equal stakes: 1× MR
        a.hostingDeposit = monthlyRent;      // Equal stakes: 1× MR
        a.propSecurityDeposit = propSecurityDeposit;
        a.leaseDurationMonths = leaseDurationMonths;
        a.createdAt = _now();
        a.state = State.Created;
        a.freezeDuration = DEFAULT_FREEZE_DURATION;
        a.contentHash = contentHash;

        emit AgreementCreated(id, tenant, landlord, monthlyRent, propSecurityDeposit, leaseDurationMonths);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  2. DEPOSIT PLACEMENT
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Tenant deposits: first month rent + commitment deposit + optional prop deposit
    function tenantDeposit(uint256 id)
        external
        onlyTenant(id)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(
            a.state == State.Created || a.state == State.AwaitingTenantDep,
            "Wrong state for tenant deposit"
        );
        require(!a.tenantDeposited);

        uint256 total = a.monthlyRent + a.commitmentDeposit + a.propSecurityDeposit;
        usdc.safeTransferFrom(msg.sender, address(this), total);

        a.tenantDeposited = true;
        a.firstRentPaid = true;

        emit DepositPlaced(id, msg.sender, a.commitmentDeposit, "commitment");
        if (a.propSecurityDeposit > 0) {
            emit DepositPlaced(id, msg.sender, a.propSecurityDeposit, "property_security");
        }
        emit RentPaid(id, 1, a.monthlyRent);

        if (a.landlordDeposited) {
            _activate(id);
        } else {
            a.state = State.AwaitingLandlordDep;
        }
    }

    /// @notice Landlord deposits: hosting deposit (1× MR)
    function landlordDeposit(uint256 id)
        external
        onlyLandlord(id)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(
            a.state == State.Created || a.state == State.AwaitingLandlordDep,
            "Wrong state for landlord deposit"
        );
        require(!a.landlordDeposited);

        usdc.safeTransferFrom(msg.sender, address(this), a.hostingDeposit);

        a.landlordDeposited = true;

        emit DepositPlaced(id, msg.sender, a.hostingDeposit, "hosting");

        if (a.tenantDeposited) {
            _activate(id);
        } else {
            a.state = State.AwaitingTenantDep;
        }
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  2a. CANCEL CREATED AGREEMENT (no deposits placed yet)
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Cancel agreement that is still in Created state (no deposits from either side).
    ///         Either party can call. No transfers needed — nothing was deposited.
    function cancelCreated(uint256 id)
        external
        onlyParty(id)
        inState(id, State.Created)
    {
        Agreement storage a = agreements[id];
        require(!a.tenantDeposited && !a.landlordDeposited);

        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);
        emit AgreementSettled(id, "cancelled_created");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  2b. CANCEL UNFUNDED AGREEMENT (deposit deadline expired)
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Cancel agreement if counterparty hasn't deposited within DEPOSIT_DEADLINE.
    ///         The party who already deposited gets a full refund.
    ///         Can also be called by keeper bot (permissionless after deadline).
    function cancelUnfunded(uint256 id)
        external
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(
            a.state == State.AwaitingLandlordDep || a.state == State.AwaitingTenantDep,
            "Not awaiting deposit"
        );
        require(
            _now() > a.createdAt + DEPOSIT_DEADLINE,
            "Deposit deadline not expired"
        );

        uint256 refund = 0;
        address refundTo;

        if (a.state == State.AwaitingLandlordDep) {
            // Tenant deposited, landlord didn't → refund tenant
            refund = a.monthlyRent + a.commitmentDeposit + a.propSecurityDeposit;
            refundTo = a.tenant;
        } else {
            // Landlord deposited, tenant didn't → refund landlord
            refund = a.hostingDeposit;
            refundTo = a.landlord;
        }

        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);

        if (refund > 0) {
            usdc.safeTransfer(refundTo, refund);
        }

        emit AgreementCancelledUnfunded(id, msg.sender, refund);
        emit AgreementSettled(id, "cancelled_unfunded");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  3. ACTIVE STATE — RENT PAYMENTS
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Tenant pays monthly rent. Goes directly to landlord. Resets grace extension.
    ///         Schedule is anchored to activatedAt — late payment does NOT shift next due date.
    function payRent(uint256 id)
        external
        onlyTenant(id)
        inState(id, State.Active)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(_now() < a.leaseEndTime);

        usdc.safeTransferFrom(msg.sender, a.landlord, a.monthlyRent);

        a.lastRentTimestamp = _now(); // tracking only, schedule is anchored
        a.rentPaymentsMade++;
        a.rentGraceExtension = 0; // Reset grace for next cycle

        emit RentPaid(id, a.rentPaymentsMade + 1, a.monthlyRent);
    }

    /// @notice Returns the next anchored rent due date for an agreement.
    ///         = activatedAt + (rentPaymentsMade + 1) * 30 days
    ///         (+1 because first rent was paid at activation)
    function nextRentDue(uint256 id) public view returns (uint256) {
        Agreement storage a = agreements[id];
        if (a.activatedAt == 0) return 0;
        return a.activatedAt + ((a.rentPaymentsMade + 1) * 30 days);
    }

    /// @notice Landlord grants tenant additional grace days for current rent cycle.
    ///         Can only extend once per cycle, max 14 days total.
    function extendRentGrace(uint256 id, uint256 extraDays)
        external
        onlyLandlord(id)
        inState(id, State.Active)
    {
        Agreement storage a = agreements[id];
        require(extraDays > 0 && extraDays <= 14);
        require(a.rentGraceExtension == 0);
        a.rentGraceExtension = extraDays * 1 days;
    }

    /// @notice Keeper calls this when rent is overdue. Forfeits tenant's commitment deposit to landlord.
    ///         Uses anchored schedule: nextRentDue + grace + extension.
    function flagRentMissed(uint256 id)
        external
        inState(id, State.Active)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(_now() < a.leaseEndTime);
        if (_now() <= nextRentDue(id) + RENT_GRACE_PERIOD + a.rentGraceExtension) revert NotOverdueYet();

        // Reclaim from Aave first (if lent), pay protocol fee, get user yield.
        // Rent missed = total forfeit to landlord → full 70% yield also to landlord.
        // C-2: use availablePrincipal in case of lending shortfall.
        (uint256 userYield, uint256 available) = _ensureLiquidAndPayProtocolFee(id);
        if (lendingPositions[id].principal > 0) _markRecovery(id, 10000); // hard failure — all to landlord
        usdc.safeTransfer(a.landlord, available + userYield);
        // Open PropDep inspection window: landlord retains right to file damage claim
        // within the 7-day window despite rent default.
        _openPropDepWindowEarly(id);

        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);
        emit AgreementSettled(id, "rent_missed");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  4. END-OF-TERM
    //  Renewal removed by design. Lease ends at leaseEndTime; parties create a new
    //  agreement if they wish to continue. Use endLease() to return deposits.
    // ═════════════════════════════════════════════════════════════════════════════

    // ─── PropDep functions removed — handled by PropDepEscrow contract ──────────
    // fileDamageClaim, fileDamageClaimAfterSettled, confirmNoDamage,
    // acceptDamageClaim, disputeDamageClaim, postDisputeBond,
    // withdrawDamageClaim, expireDamageClaim, executeExpiredClaim,
    // acceptDamageClaimAfterBond — all moved to PropDepEscrow.sol

    // ═════════════════════════════════════════════════════════════════════════════
    //  5. DISPUTE RESOLUTION (60-day freeze)
    // ═════════════════════════════════════════════════════════════════════════════

    // submitMutualSettlement REMOVED — was vulnerable (single-party could set any split).
    // Replaced by proposeMutualSettlement + confirmMutualSettlement (requires both parties).

    /// @notice After 60-day freeze expires with no settlement, all funds return to owners.
    /// @notice Release frozen funds after 60-day freeze expires.
    ///         WASH: commitment → tenant, hosting → landlord. No penalty.
    ///         Sprint 4: no bond to return (deposits are the stakes).
    function releaseFrozenFunds(uint256 id)
        external
        inState(id, State.DisputeOpen)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(_now() >= a.freezeStart + a.freezeDuration);

        // No bond to return — Sprint 4 removed bond posting.
        // Commitment deposits → each party (wash settlement)
        _returnCommitmentDeposits(id);
        _openPropDepWindowEarly(id);

        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);
        emit FreezeExpiredAllReturned(id);
        emit AgreementSettled(id, "freeze_expired");
    }

    /// @notice Dispute initiator cancels their own dispute.
    ///         Initiator's deposit → counterparty as penalty. No bond to return.
    ///         Sprint 4: disputeBondPoster = whoever initiated the dispute (not who posted bond).
    function cancelDisputeExit(uint256 id)
        external
        inState(id, State.DisputeOpen)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(msg.sender == a.disputeBondPoster);

        // Penalty: initiator's deposit → counterparty
        // C-2: use availablePrincipal in case of lending shortfall
        (uint256 userYield, uint256 available) = _ensureLiquidAndPayProtocolFee(id);
        address counterparty = (msg.sender == a.tenant) ? a.landlord : a.tenant;
        if (lendingPositions[id].principal > 0) _markRecovery(id, counterparty == a.landlord ? 10000 : 0);
        usdc.safeTransfer(counterparty, available + userYield);

        _openPropDepWindowEarly(id);
        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);
        emit AgreementSettled(id, "dispute_cancelled");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  6a. SPRINT 4: EARLY TERMINATION — simplified flows
    //
    //  exitWithLoss(id)          — atomic: initiator's deposit → counterparty. No 2-step.
    //  proposeEarlyTermination   — Mutual or Disputed only (InitiatorAccepts removed).
    //    Mutual:   → EarlyTermProposed → signMutualExit / counterpartyContest
    //    Disputed: → DisputeOpen directly (no bond posting, deposits are the stakes)
    //  signMutualExit(id)        — counterparty agrees to mutual exit
    //  counterpartyContest(id)   — counterparty contests mutual → DisputeOpen (no bond)
    //  concedeDispute(id)        — initiator concedes in DisputeOpen
    //  acceptDisputeExit(id)     — counterparty accepts claim in DisputeOpen
    //
    //  REMOVED in Sprint 4:
    //  - executeInitiatorAcceptsLoss (replaced by exitWithLoss)
    //  - acceptInitiatorLoss (exitWithLoss is unilateral, no counterparty action needed)
    //  - waiveInitiatorLoss (same)
    //  - postEarlyTermBond (Disputed goes directly to DisputeOpen, deposits are stakes)
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Atomic exit with loss: initiator's deposit → counterparty immediately.
    ///         Single transaction from Active state. No propose step. Unilateral.
    function exitWithLoss(uint256 id)
        external
        onlyParty(id)
        inState(id, State.Active)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        a.earlyTermType = TermType.InitiatorAccepts;
        a.earlyTermInitiator = msg.sender;
        a.earlyTermProposedAt = _now();

        // Vacate deadline: tenant initiator = 3 days, landlord initiator = 7 days
        a.vacateDeadline = msg.sender == a.tenant
            ? _now() + 3 days
            : _now() + 7 days;

        // C-2: use availablePrincipal in case of lending shortfall
        (uint256 userYield, uint256 available) = _ensureLiquidAndPayProtocolFee(id);
        address counterparty = msg.sender == a.tenant ? a.landlord : a.tenant;
        if (lendingPositions[id].principal > 0) _markRecovery(id, counterparty == a.landlord ? 10000 : 0);
        usdc.safeTransfer(counterparty, available + userYield);

        // PropDep window opens for landlord inspection
        _openPropDepWindowEarly(id);

        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);
        emit EarlyTermProposed(id, msg.sender, TermType.InitiatorAccepts);
        emit EarlyTermExecuted(id, TermType.InitiatorAccepts);
        emit AgreementSettled(id, "exit_with_loss");
    }

    /// @notice Propose early termination: Mutual or Disputed only.
    ///         For Disputed: goes DIRECTLY to DisputeOpen (no bond, deposits are the stakes).
    function proposeEarlyTermination(uint256 id, TermType termType)
        external
        onlyParty(id)
        inState(id, State.Active)
    {
        require(termType == TermType.Mutual || termType == TermType.Disputed);

        Agreement storage a = agreements[id];
        a.earlyTermType = termType;
        a.earlyTermInitiator = msg.sender;
        a.earlyTermProposedAt = _now();

        if (termType == TermType.Disputed) {
            // Disputed goes directly to DisputeOpen — open PropDep window now
            _openPropDepWindowEarly(id);
            // Sprint 4: Disputed goes DIRECTLY to DisputeOpen — no bond posting needed.
            // Existing deposits (commitment + hosting) are the stakes.
            a.disputeBondPoster = msg.sender; // tracks who initiated the dispute
            a.freezeStart = _now();
            a.vacateDeadline = msg.sender == a.tenant
                ? _now() + 3 days
                : _now() + 7 days;
            a.state = State.DisputeOpen;
            emit EarlyTermProposed(id, msg.sender, termType);
            emit DisputeFreezeStarted(id, _now() + a.freezeDuration);
        } else {
            a.state = State.EarlyTermProposed;
            emit EarlyTermProposed(id, msg.sender, termType);
        }
    }

    /// @notice For mutual exit: counterparty signs to agree.
    function signMutualExit(uint256 id)
        external
        onlyParty(id)
        inState(id, State.EarlyTermProposed)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(a.earlyTermType == TermType.Mutual);
        require(msg.sender != a.earlyTermInitiator);

        emit EarlyTermMutualSigned(id, msg.sender);

        // Both agreed: return deposits to owners
        _returnCommitmentDeposits(id);
        _openPropDepWindowEarly(id);

        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);
        emit EarlyTermExecuted(id, TermType.Mutual);
        emit AgreementSettled(id, "early_term_mutual");
    }

    /// @notice Counterparty contests a Mutual early termination.
    ///         Converts Mutual → DisputeOpen. NO bond posting — existing deposits frozen.
    ///         Only counterparty (not initiator) can call.
    function counterpartyContest(uint256 id)
        external
        onlyParty(id)
        inState(id, State.EarlyTermProposed)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(a.earlyTermType == TermType.Mutual);
        require(msg.sender != a.earlyTermInitiator);

        // No bond posting — existing deposits (commitment + hosting) are the stakes
        a.disputeBondPoster = msg.sender; // tracks who contested
        a.freezeStart = _now();
        a.vacateDeadline = msg.sender == a.tenant
            ? _now() + 3 days
            : _now() + 7 days;
        a.state = State.DisputeOpen;

        // Open PropDep inspection window — lease effectively ended
        _openPropDepWindowEarly(id);

        emit DisputeFreezeStarted(id, _now() + a.freezeDuration);
    }

    /// @notice Initiator concedes during DisputeOpen — accepts counterparty's claim.
    ///         Initiator's deposit → counterparty. No bond to return.
    function concedeDispute(uint256 id)
        external
        inState(id, State.DisputeOpen)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(msg.sender == a.earlyTermInitiator);

        // C-2: use availablePrincipal in case of lending shortfall
        (uint256 userYield, uint256 available) = _ensureLiquidAndPayProtocolFee(id);
        address counterparty = msg.sender == a.tenant ? a.landlord : a.tenant;
        if (lendingPositions[id].principal > 0) _markRecovery(id, counterparty == a.landlord ? 10000 : 0);
        usdc.safeTransfer(counterparty, available + userYield);

        _openPropDepWindowEarly(id);

        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);
        emit AgreementSettled(id, "initiator_conceded");
    }

    /// @notice Counterparty accepts the dispute claim in DisputeOpen.
    ///         Counterparty's deposit → claimant (dispute initiator). No bond to return.
    function acceptDisputeExit(uint256 id)
        external
        inState(id, State.DisputeOpen)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        if (msg.sender != a.tenant && msg.sender != a.landlord) revert NotAParty();
        // The non-initiator accepts the initiator's claim (surrenders their deposit).
        // In direct Disputed: initiator = disputeBondPoster, counterparty accepts.
        // In contested-mutual: initiator = original proposer, contester (disputeBondPoster) accepts.
        require(msg.sender != a.earlyTermInitiator);

        // C-2: use availablePrincipal in case of lending shortfall
        (uint256 userYield, uint256 available) = _ensureLiquidAndPayProtocolFee(id);
        if (lendingPositions[id].principal > 0) _markRecovery(id, a.earlyTermInitiator == a.landlord ? 10000 : 0);
        usdc.safeTransfer(a.earlyTermInitiator, available + userYield);

        _openPropDepWindowEarly(id);

        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);
        emit AgreementSettled(id, "dispute_exit_accepted");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  6b. EARLY TERM TIMEOUT — counterparty didn't respond within 7 days
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice If counterparty doesn't respond to early termination within EARLY_TERM_RESPONSE_PERIOD,
    ///         deposits return to each owner. Permissionless (keeper can call).
    function expireEarlyTermProposal(uint256 id)
        external
        inState(id, State.EarlyTermProposed)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(
            _now() > a.earlyTermProposedAt + EARLY_TERM_RESPONSE_PERIOD,
            "Response period not expired"
        );

        // Return all deposits to owners — no penalty for either side
        _returnCommitmentDeposits(id);
        _openPropDepWindowEarly(id);

        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);
        emit EarlyTermExpired(id);
        emit AgreementSettled(id, "early_term_expired");
    }

    // proposeMutualSettlement / confirmMutualSettlement removed — moved to PropDepEscrow
    // Early term mutual settlement uses proposeEarlySettlement / confirmEarlySettlement below.

    // ═════════════════════════════════════════════════════════════════════════════
    //  5c. EARLY SETTLEMENT — split frozen funds before 60-day expiry
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Propose early settlement of frozen funds during DisputeOpen (early term only).
    ///         Total pool = commitmentDeposit + hostingDeposit + disputeBond.
    ///         Both parties must agree on the split. Settles immediately without waiting 60 days.
    ///         PropDep is independent (handled by PropDepEscrow).
    function proposeEarlySettlement(
        uint256 id,
        uint256 toLandlord,
        uint256 toTenant
    )
        external
        onlyParty(id)
        inState(id, State.DisputeOpen)
    {
        Agreement storage a = agreements[id];
        uint256 totalPool = a.commitmentDeposit + a.hostingDeposit + a.disputeBond;
        require(toLandlord + toTenant == totalPool);

        a.mutualSettlementProposer = msg.sender;
        a.mutualSettlementToLandlord = toLandlord;
        a.mutualSettlementToTenant = toTenant;
        a.earlySettlementMode = true;

        emit MutualSettlementProposed(id, msg.sender, toLandlord, toTenant);
    }

    /// @notice Counterparty confirms early settlement. Distributes ALL frozen funds immediately.
    ///         H-4: expectedToLandlord/expectedToTenant prevent front-running proposal swap.
    function confirmEarlySettlement(uint256 id, uint256 expectedToLandlord, uint256 expectedToTenant)
        external
        onlyParty(id)
        inState(id, State.DisputeOpen)
        nonReentrant
    {
        Agreement storage a = agreements[id];
        require(a.mutualSettlementProposer != address(0));
        require(msg.sender != a.mutualSettlementProposer); // keep: unique string
        require(a.earlySettlementMode);
        require(
            a.mutualSettlementToLandlord == expectedToLandlord &&
            a.mutualSettlementToTenant == expectedToTenant,
            "Proposal changed"
        );

        uint256 totalPool = a.commitmentDeposit + a.hostingDeposit + a.disputeBond;
        require(
            a.mutualSettlementToLandlord + a.mutualSettlementToTenant == totalPool,
            "Settlement amounts don't match total pool"
        );

        // C-2: use availablePrincipal in case of lending shortfall
        (uint256 userYield, uint256 available) = _ensureLiquidAndPayProtocolFee(id);
        if (lendingPositions[id].principal > 0) { // hard failure — record agreed split for recovery
            uint256 bps = totalPool > 0 ? (a.mutualSettlementToLandlord * 10000) / totalPool : 5000;
            _markRecovery(id, bps);
        }

        // On shortfall, scale agreed amounts pro-rata to available principal
        uint256 landlordShare;
        uint256 tenantShare;
        if (available >= totalPool) {
            landlordShare = a.mutualSettlementToLandlord;
            tenantShare = a.mutualSettlementToTenant;
        } else {
            landlordShare = totalPool > 0 ? (available * a.mutualSettlementToLandlord) / totalPool : 0;
            tenantShare = available - landlordShare;
        }
        if (userYield > 0 && available > 0) {
            uint256 landlordYield = (userYield * landlordShare) / available;
            uint256 tenantYield = userYield - landlordYield;
            landlordShare += landlordYield;
            tenantShare += tenantYield;
        }

        if (landlordShare > 0) usdc.safeTransfer(a.landlord, landlordShare);
        if (tenantShare > 0) usdc.safeTransfer(a.tenant, tenantShare);

        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);
        emit MutualSettlementConfirmed(id, msg.sender);
        emit DisputeSettled(id, a.mutualSettlementToLandlord, a.mutualSettlementToTenant);
        emit AgreementSettled(id, "early_settlement_all_funds");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  7. VIEW HELPERS
    // ═════════════════════════════════════════════════════════════════════════════

    function getAgreement(uint256 id) external view returns (Agreement memory) {
        return agreements[id];
    }

    function getState(uint256 id) external view returns (State) {
        return agreements[id].state;
    }

    function isLeaseExpired(uint256 id) external view returns (bool) {
        Agreement storage a = agreements[id];
        return a.activatedAt > 0 && _now() >= a.leaseEndTime;
    }

    function isFreezeExpired(uint256 id) external view returns (bool) {
        Agreement storage a = agreements[id];
        return a.freezeStart > 0 && _now() >= a.freezeStart + a.freezeDuration;
    }

    function isRentOverdue(uint256 id) external view returns (bool) {
        Agreement storage a = agreements[id];
        if (a.state != State.Active || _now() >= a.leaseEndTime) return false;
        return _now() > nextRentDue(id) + RENT_GRACE_PERIOD + a.rentGraceExtension;
    }

    function isDepositDeadlineExpired(uint256 id) external view returns (bool) {
        Agreement storage a = agreements[id];
        if (a.state != State.AwaitingLandlordDep && a.state != State.AwaitingTenantDep) return false;
        return _now() > a.createdAt + DEPOSIT_DEADLINE;
    }

    function isEarlyTermExpired(uint256 id) external view returns (bool) {
        Agreement storage a = agreements[id];
        if (a.state != State.EarlyTermProposed) return false;
        return _now() > a.earlyTermProposedAt + EARLY_TERM_RESPONSE_PERIOD;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  8. ADMIN
    // ═════════════════════════════════════════════════════════════════════════════

    function setProtocolTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0));
        protocolTreasury = _treasury;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0));
        owner = newOwner;
    }

    /// @notice Rescue tokens sent directly to contract by mistake.
    ///         For USDC: only allowed if no non-settled agreements exist (safety check).
    ///         For other tokens: always allowed.
    function rescueTokens(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(usdc)) {
            require(activeAgreementCount == 0);
            // C-3: Don't touch funds owed to users via pendingWithdrawals
            require(
                usdc.balanceOf(address(this)) >= totalPendingWithdrawals + amount,
                "Insufficient free balance"
            );
        }
        IERC20(token).safeTransfer(owner, amount);
    }

    /// @notice Emergency settle for agreements stuck longer than 180 days.
    ///         Returns deposits to their original owners proportionally.
    ///         Only owner can call. Only works if agreement is NOT Settled and older than 180 days.
    function emergencySettleExpired(uint256 id) external onlyOwner nonReentrant {
        Agreement storage a = agreements[id];
        if (a.state == State.Settled || a.state == State.LeaseEnded) revert AlreadySettled();
        require(a.createdAt > 0);
        require(_now() > a.createdAt + 180 days);

        // C-2: Reclaim from lending — graceful on shortfall
        (uint256 userYield, uint256 available) = _ensureLiquidAndPayProtocolFee(id);
        uint256 tenantYieldShare = userYield - userYield / 2;
        uint256 landlordYieldShare = userYield / 2;

        uint256 totalDeposits = a.commitmentDeposit + a.hostingDeposit;
        uint256 tenantPrincipal;
        uint256 landlordPrincipal;
        if (available >= totalDeposits) {
            tenantPrincipal = a.commitmentDeposit;
            landlordPrincipal = a.hostingDeposit;
        } else {
            tenantPrincipal = totalDeposits > 0 ? (available * a.commitmentDeposit) / totalDeposits : 0;
            landlordPrincipal = available - tenantPrincipal;
        }

        // Note: propSecurityDeposit excluded if hasPropDep — those funds are in PropDepEscrow
        if (a.tenantDeposited) {
            // If never activated, first-month rent was deposited but never forwarded to landlord
            uint256 unactivatedRent = (a.activatedAt == 0) ? a.monthlyRent : 0;
            uint256 tenantRefund = tenantPrincipal + (a.hasPropDep ? 0 : a.propSecurityDeposit) + tenantYieldShare + unactivatedRent;
            if (tenantRefund > 0) usdc.safeTransfer(a.tenant, tenantRefund);
        }
        if (a.landlordDeposited) {
            uint256 landlordRefund = landlordPrincipal + landlordYieldShare;
            if (landlordRefund > 0) usdc.safeTransfer(a.landlord, landlordRefund);
        }
        // Return any dispute bond
        if (a.disputeBond > 0 && a.disputeBondPoster != address(0)) {
            usdc.safeTransfer(a.disputeBondPoster, a.disputeBond);
        }

        // Open PropDep inspection window so landlord can still file damage claim.
        // Without this, propDep would remain locked until the original leaseEndTime window.
        _openPropDepWindowEarly(id);

        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);
        emit AgreementSettled(id, "emergency_settled_expired");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  8b. UNIVERSAL SAFETY NET — expire by lease end + buffer
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Universal permissionless safety net. If agreement is stuck in any non-Settled state
    ///         past max(leaseEndTime, freezeStart + freezeDuration) + 60 days, anyone can trigger
    ///         a full refund of deposits to their original owners.
    ///         Uses pull-payment pattern: funds go to pendingWithdrawals, not direct transfer.
    ///         This prevents revert-locking — state changes BEFORE any external interaction.
    function expireByLeaseEnd(uint256 id)
        external
        nonReentrant
    {
        Agreement storage a = agreements[id];
        if (a.state == State.Settled || a.state == State.LeaseEnded) revert AlreadySettled();
        require(a.createdAt > 0);

        // Take the latest relevant date: lease end or freeze end
        uint256 freezeEnd = a.freezeStart + a.freezeDuration;
        uint256 latestDate = a.leaseEndTime > freezeEnd ? a.leaseEndTime : freezeEnd;
        // If agreement never activated (no leaseEndTime), fall back to createdAt + 180 days
        if (latestDate == 0) latestDate = a.createdAt + 180 days;
        require(_now() > latestDate + 60 days);

        // C-2: Reclaim from Aave/Morpho gracefully.
        // _reclaimFromLending never reverts — returns (0,0) and emits LendingRecoveryPending on hard failure.
        // availablePrincipal = buffer_in_escrow + recovered (may be < commitmentDeposit + hostingDeposit).
        uint256 userYield;
        uint256 availablePrincipal = a.commitmentDeposit + a.hostingDeposit; // default: all liquid
        LendingPosition memory pos = lendingPositions[id];
        if (pos.principal > 0) {
            try this._reclaimForSafetyNet(id) returns (uint256 _yield, uint256 _available) {
                userYield = _yield;
                availablePrincipal = _available;
            } catch {
                // Should not happen since _reclaimFromLending is graceful, but keep as safety net.
                // Buffer = what wasn't lent (stays in escrow)
                uint256 _totalDep = a.commitmentDeposit + a.hostingDeposit;
                availablePrincipal = _totalDep > pos.principal ? _totalDep - pos.principal : 0;
                userYield = 0;
            }
        }

        // Save disputeBond before zeroing
        uint256 savedBond = a.disputeBond;
        address savedBondPoster = a.disputeBondPoster;

        // STATE CHANGE FIRST — cannot revert after this
        a.disputeBond = 0;
        _setTerminalState(id, State.Settled);

        // C-2: Pro-rata distribution from availablePrincipal.
        // If lending position was unavailable (LendingRecoveryPending emitted), availablePrincipal = buffer only.
        // Users can recover the lent portion later via reclaimLentFundsAfterSettlement().
        uint256 totalDeposits = a.commitmentDeposit + a.hostingDeposit;
        uint256 tenantPrincipal;
        uint256 landlordPrincipal;
        if (availablePrincipal >= totalDeposits) {
            tenantPrincipal = a.commitmentDeposit;
            landlordPrincipal = a.hostingDeposit;
        } else {
            tenantPrincipal = totalDeposits > 0 ? (availablePrincipal * a.commitmentDeposit) / totalDeposits : 0;
            landlordPrincipal = availablePrincipal - tenantPrincipal;
        }
        uint256 yieldPerParty = userYield / 2;
        if (a.tenantDeposited) {
            // If never activated, first-month rent was deposited but never forwarded to landlord
            uint256 unactivatedRent = (a.activatedAt == 0) ? a.monthlyRent : 0;
            uint256 tenantRefund = tenantPrincipal + (a.hasPropDep ? 0 : a.propSecurityDeposit) + yieldPerParty + unactivatedRent;
            if (tenantRefund > 0) {
                pendingWithdrawals[a.tenant] += tenantRefund;
                totalPendingWithdrawals += tenantRefund;
            }
        }
        if (a.landlordDeposited) {
            uint256 landlordRefund = landlordPrincipal + (userYield - yieldPerParty);
            if (landlordRefund > 0) {
                pendingWithdrawals[a.landlord] += landlordRefund;
                totalPendingWithdrawals += landlordRefund;
            }
        }
        // Return dispute bond to poster (saved before zeroing)
        if (savedBond > 0 && savedBondPoster != address(0)) {
            pendingWithdrawals[savedBondPoster] += savedBond;
            totalPendingWithdrawals += savedBond;
        }

        emit AgreementSettled(id, "expired_by_lease_end");
    }

    /// @notice Withdraw pending funds (pull-payment pattern).
    ///         Anyone with a positive balance can call this to receive their USDC.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0);

        pendingWithdrawals[msg.sender] = 0;
        totalPendingWithdrawals -= amount;
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawal(msg.sender, amount);
    }

    /// @notice C-2: Recovery path for agreements settled while lending was unavailable.
    ///         After Aave/Morpho resumes, anyone can call this to withdraw the stuck
    ///         principal and credit it to the original parties via pendingWithdrawals.
    ///         Only works for Settled/LeaseEnded agreements with a remaining lending position.
    function reclaimLentFundsAfterSettlement(uint256 id) external nonReentrant {
        Agreement storage a = agreements[id];
        require(
            a.state == State.Settled || a.state == State.LeaseEnded,
            "Not settled"
        );
        LendingPosition memory pos = lendingPositions[id];
        require(pos.principal > 0);

        // C-1: getIndex() in try/catch — adapter may revert all calls while paused.
        uint256 currentIndex;
        try lendingAdapter.getIndex() returns (uint256 _index) {
            currentIndex = _index;
        } catch {
            revert LendingUnavailable(); // Still unavailable — try again later
        }
        uint256 realValue = (pos.scaledBalance * currentIndex) / RAY;

        // C-2: measure actual USDC inflow via balance delta.
        uint256 balBefore = usdc.balanceOf(address(this));
        try lendingAdapter.withdraw(realValue) returns (uint256 /* _reported */) {
            // intentionally ignore reported value; use ground-truth balance delta below
        } catch {
            revert LendingUnavailable(); // Still unavailable — try again later
        }
        uint256 received = usdc.balanceOf(address(this)) - balBefore;

        // Zero inflow without revert = vault still unavailable; keep position alive
        if (received == 0) revert LendingUnavailable();

        delete lendingPositions[id];
        if (totalLentPrincipal >= pos.principal) {
            totalLentPrincipal -= pos.principal;
        } else {
            totalLentPrincipal = 0;
        }

        // Distribute recovered funds according to original settlement outcome.
        // _recoveryBps[id] > 0 → override set; landlordBps = stored value - 1.
        // _recoveryBps[id] == 0 → no override: deposit-ratio split (50/50 for Equal Stakes).
        uint256 landlordShare;
        uint256 tenantShare;
        if (_recoveryBps[id] != 0) {
            landlordShare = (received * (_recoveryBps[id] - 1)) / 10000;
            tenantShare = received - landlordShare;
        } else {
            uint256 totalDeposits = a.commitmentDeposit + a.hostingDeposit;
            landlordShare = totalDeposits > 0
                ? (received * a.hostingDeposit) / totalDeposits
                : received / 2;
            tenantShare = received - landlordShare;
        }

        if (a.tenantDeposited && tenantShare > 0) {
            pendingWithdrawals[a.tenant] += tenantShare;
            totalPendingWithdrawals += tenantShare;
        }
        if (a.landlordDeposited && landlordShare > 0) {
            pendingWithdrawals[a.landlord] += landlordShare;
            totalPendingWithdrawals += landlordShare;
        }

        emit LendingWithdrawn(id, pos.principal, received > pos.principal ? received - pos.principal : 0, 0);
    }

    /// @notice Emergency write-off of an unrecoverable lending position.
    ///         USE WITH EXTREME CAUTION: permanently erases the position record WITHOUT
    ///         distributing funds. Apply only when vault recovery is impossible
    ///         (total protocol hack, insolvency). Does NOT credit pendingWithdrawals —
    ///         use reclaimLentFundsAfterSettlement if any recovery is still possible.
    ///         After write-off, totalLentPrincipal is decremented so setLendingAdapter
    ///         is no longer blocked by this position.
    /// @param id The agreement whose lending position to erase.
    function writeOffLendingPosition(uint256 id) external onlyOwner {
        Agreement storage a = agreements[id];
        require(
            a.state == State.Settled || a.state == State.LeaseEnded,
            "Not terminal"
        );
        LendingPosition memory pos = lendingPositions[id];
        require(pos.principal > 0);

        delete lendingPositions[id];
        if (totalLentPrincipal >= pos.principal) {
            totalLentPrincipal -= pos.principal;
        } else {
            totalLentPrincipal = 0;
        }

        emit LendingPositionWrittenOff(id, pos.principal, pos.scaledBalance);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  INTERNAL
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice C-2: External wrapper for _ensureLiquidAndPayProtocolFee, used by expireByLeaseEnd
    ///         via try/catch (Solidity requires external calls for try/catch).
    ///         Only callable by this contract itself.
    function _reclaimForSafetyNet(uint256 id) external returns (uint256 userYield, uint256 availablePrincipal) {
        require(msg.sender == address(this));
        return _ensureLiquidAndPayProtocolFee(id);
    }

    /// @notice Returns current time, adjusted by timeOffset in dev mode.
    ///         When devMode=false, returns block.timestamp directly (zero overhead).
    function _now() internal view returns (uint256) {
        if (devMode && timeOffset != 0) {
            return uint256(int256(block.timestamp) + timeOffset);
        }
        return block.timestamp;
    }

    /// @dev Mark agreement as terminal state and decrement active counter.
    function _setTerminalState(uint256 id, State terminal) internal {
        agreements[id].state = terminal;
        if (activeAgreementCount > 0) activeAgreementCount--;
    }

    function _activate(uint256 id) internal {
        Agreement storage a = agreements[id];
        // Block activation with propDep if PropDepEscrow not configured
        if (a.propSecurityDeposit > 0 && address(propDepEscrow) == address(0)) revert PropDepEscrowNotSet();

        a.activatedAt = _now();
        a.lastRentTimestamp = _now();
        a.leaseEndTime = _now() + (a.leaseDurationMonths * 30 days);
        a.state = State.Active;

        // First month rent → landlord immediately
        usdc.safeTransfer(a.landlord, a.monthlyRent);

        // Hand off PropDep to PropDepEscrow if set
        if (a.propSecurityDeposit > 0 && address(propDepEscrow) != address(0)) {
            a.hasPropDep = true; // CEI: set state before external call
            usdc.forceApprove(address(propDepEscrow), a.propSecurityDeposit);
            propDepEscrow.createPropDep(id, a.tenant, a.landlord, a.propSecurityDeposit, a.leaseEndTime);
        }

        // Sprint 3b: supply the now-locked commitment+hosting to Aave above buffer.
        // After the rent and PropDep payouts above, these are the only funds this
        // agreement contributes to the escrow for the next ~6 months — perfect for
        // earning yield. Wrapped in try/catch inside the helper; safe to fail.
        uint256 lendable = a.commitmentDeposit + a.hostingDeposit;
        _maybeLendForAgreement(id, lendable);

        emit AgreementActivated(id, a.activatedAt, a.leaseEndTime);
    }

    function _returnCommitmentDeposits(uint256 id) internal {
        // Sprint 3c: unified path — reclaim from lending (if any) and distribute
        // principal + yield in one shot. If lending was not used for this
        // agreement (position empty), falls back to direct principal transfer.
        LendingPosition memory pos = lendingPositions[id];
        if (pos.principal > 0) {
            _distributeWithYield(id);
        } else {
            Agreement storage a = agreements[id];
            usdc.safeTransfer(a.tenant, a.commitmentDeposit);
            usdc.safeTransfer(a.landlord, a.hostingDeposit);
        }
    }

    /// @notice C-2: Record intended recovery split when Aave hard-fails during settlement.
    ///         landlordBps 0–10000. Stored as bps+1 so 0 means "not set".
    function _markRecovery(uint256 id, uint256 landlordBps) internal {
        _recoveryBps[id] = landlordBps + 1;
    }

    /// @notice Open the PropDep inspection window immediately (used on early termination).
    ///         No-op if no propDep set or PropDepEscrow not deployed.
    function _openPropDepWindowEarly(uint256 id) internal {
        Agreement storage a = agreements[id];
        if (a.hasPropDep && address(propDepEscrow) != address(0)) {
            // try/catch: syncLeaseEndTime reverts if PropDep already moved past Active
            // (e.g. claim filed during parallel deposit dispute). Safe to ignore.
            try propDepEscrow.syncLeaseEndTime(id, _now()) {} catch {}
        }
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  9. NEW: LEASE END + DEV CONFIG
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Anyone callable after leaseEndTime. Returns commitment+hosting to owners.
    ///         PropDep is independent (handled by PropDepEscrow window).
    function endLease(uint256 id) external nonReentrant {
        Agreement storage a = agreements[id];
        require(a.state == State.Active);
        require(_now() >= a.leaseEndTime);

        _returnCommitmentDeposits(id);
        _setTerminalState(id, State.LeaseEnded);
        emit AgreementSettled(id, "lease_ended");
    }

    /// @notice Permanently disable dev mode. One-way — cannot be re-enabled.
    function disableDevMode() external onlyOwner {
        devMode = false;
        timeOffset = 0; // reset offset when disabling
    }

    /// @notice Advance or rewind virtual time by `seconds`. Cumulative.
    ///         warp(86400) = +1 day. warp(-86400) = -1 day.
    ///         Blocked on mainnet chain IDs even if devMode is somehow true.
    event TimeWarped(int256 delta, int256 newOffset);

    function warp(int256 delta) external onlyOwner {
        require(devMode);
        // Defense-in-depth: block known mainnet chain IDs even if devMode is somehow true
        require(
            block.chainid != ARBITRUM_ONE &&
            block.chainid != ETHEREUM_MAINNET &&
            block.chainid != ARC_MAINNET,
            "No dev on mainnet"
        );
        require(delta > -365 days && delta < 365 days);
        timeOffset += delta;
        emit TimeWarped(delta, timeOffset);
    }

    /// @notice Reset time offset to zero.
    function resetTime() external onlyOwner {
        require(devMode);
        timeOffset = 0;
    }

    /// @notice View the current virtual time (for admin panel).
    function currentTime() external view returns (uint256) {
        return _now();
    }

    /// @notice DEV-only: manually set leaseEndTime for testing accelerated flows.
    ///         Also syncs PropDepEscrow if propDep exists.
    function _devSetLeaseEndTime(uint256 id, uint256 newLeaseEndTime) external onlyOwner {
        require(devMode);
        Agreement storage a = agreements[id];
        a.leaseEndTime = newLeaseEndTime;
        if (a.hasPropDep && address(propDepEscrow) != address(0)) {
            propDepEscrow.syncLeaseEndTime(id, newLeaseEndTime);
        }
    }

    /// @notice DEV-only: time travel — set activatedAt, leaseEndTime, and lastRentTimestamp.
    ///         Also resets rentGraceExtension to avoid stale state confusion.
    ///         Pass 0 to skip a value. Used by UI Time Travel panel.
    ///         activatedAt is critical because rent schedule is anchored to it
    ///         (nextRentDue = activatedAt + (rentPaymentsMade+1) * 30 days).
    function _devSetTimes(
        uint256 id,
        uint256 newActivatedAt,
        uint256 newLeaseEndTime,
        uint256 newLastRentTimestamp,
        uint256 newRentPaymentsMade
    ) external onlyOwner {
        require(devMode);
        Agreement storage a = agreements[id];
        if (newActivatedAt > 0) {
            a.activatedAt = newActivatedAt;
        }
        if (newLeaseEndTime > 0) {
            a.leaseEndTime = newLeaseEndTime;
            if (a.hasPropDep && address(propDepEscrow) != address(0)) {
                propDepEscrow.syncLeaseEndTime(id, newLeaseEndTime);
            }
        }
        if (newLastRentTimestamp > 0) {
            a.lastRentTimestamp = newLastRentTimestamp;
        }
        // Pass type(uint256).max as a sentinel meaning "leave unchanged".
        // 0 is a valid value (fresh contract), so we can't use 0 as sentinel here.
        if (newRentPaymentsMade != type(uint256).max) {
            a.rentPaymentsMade = newRentPaymentsMade;
        }
        a.rentGraceExtension = 0;
    }

    /// @notice DEV ONLY — force the dispute freeze to be expired so releaseFrozenFunds can be called.
    ///         Sets freezeStart to (block.timestamp - freezeDuration - 1).
    function _devForceFreezeExpired(uint256 id) external onlyOwner {
        require(devMode);
        Agreement storage a = agreements[id];
        require(a.state == State.DisputeOpen);
        // Set freezeStart so that _now() >= freezeStart + freezeDuration
        a.freezeStart = _now() > a.freezeDuration + 1
            ? _now() - a.freezeDuration - 1
            : 1;
    }

}
