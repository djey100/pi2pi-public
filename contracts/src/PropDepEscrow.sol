// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PropDepEscrow — Property Security Deposit handler
/// @notice Independent escrow for tenant property security deposits.
///         Activated when landlord requires a propDep at lease creation.
///         Operates in a 14-day window: 7 days before lease end + 7 days after.
///         Landlord may file damage claims; tenant may accept or dispute.
///         Full PropDep lifecycle: claim → dispute → bond → freeze → settle.
contract PropDepEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Enums ───────────────────────────────────────────────────────────────────

    enum PropDepState {
        None,        // Not created
        Active,      // Funded, no claim filed yet
        Claimed,     // Landlord filed claim, awaiting tenant response
        Disputed,    // Tenant disputed, awaiting landlord bond
        Frozen,      // Bond posted, 60-day freeze
        Settled      // Final state
    }

    // ─── Structs ─────────────────────────────────────────────────────────────────

    struct PropDep {
        // Core
        uint256 leaseId;
        address tenant;
        address landlord;
        uint256 amount;             // Original deposit amount
        PropDepState state;

        // Window
        uint256 leaseEndTime;       // Synced from main contract
        uint256 windowStart;        // leaseEndTime - propDepWindowDuration
        uint256 windowEnd;          // leaseEndTime + propDepWindowDuration

        // Claim
        uint256 claimAmount;        // Amount landlord claims
        uint256 claimDeadline;      // Tenant must respond by this time
        bool tenantAccepted;
        bool tenantDisputed;

        // Bond / dispute
        uint256 disputeBond;
        address bondPoster;
        uint256 freezeStart;
        uint256 freezeEnd;          // Snapshot: freezeStart + freezeDuration at bond time

        // Mutual settlement
        address settlementProposer;
        uint256 settlementToLandlord;
        uint256 settlementToTenant;
    }

    // ─── Constants & Config ──────────────────────────────────────────────────────

    uint256 public constant CLAIM_RESPONSE_PERIOD = 3 days;
    uint256 public constant BOND_POSTING_PERIOD = 3 days;
    uint256 public constant MIN_DAMAGE_CLAIM_BPS = 3000; // 30% minimum claim

    // Configurable for testing: in production = 7 days, in test = ~30 seconds
    uint256 public propDepWindowDuration = 7 days;
    uint256 public freezeDuration = 60 days;

    /// @notice Dev mode flag — once disabled, cannot be re-enabled.
    bool public devMode = true;

    /// @notice Global time offset for testing. Only works when devMode=true.
    int256 public timeOffset;

    uint256 private constant ARBITRUM_ONE = 42161;
    uint256 private constant ETHEREUM_MAINNET = 1;
    uint256 private constant ARC_TESTNET = 5042002;     // 5042002 IS the testnet; Arc mainnet chainId is 5042 (see ARC_MAINNET below)
    uint256 private constant ARC_MAINNET = 5042;        // NOT in the devMode whitelist below — must stay excluded
    uint256 private constant ANVIL_LOCAL = 31337;
    uint256 private constant ARBITRUM_SEPOLIA = 421614;
    uint256 private constant ETHEREUM_SEPOLIA = 11155111;

    // ─── State ───────────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    address public immutable mainContract;
    address public owner;

    mapping(uint256 => PropDep) public propDeps; // leaseId => PropDep

    // ─── Events ──────────────────────────────────────────────────────────────────

    event PropDepCreated(uint256 indexed leaseId, address indexed tenant, address indexed landlord, uint256 amount, uint256 windowStart, uint256 windowEnd);
    event LeaseEndTimeSynced(uint256 indexed leaseId, uint256 newLeaseEndTime, uint256 newWindowStart, uint256 newWindowEnd);

    event DamageClaimFiled(uint256 indexed leaseId, uint256 amount, uint256 deadline);
    event DamageClaimAccepted(uint256 indexed leaseId, uint256 amount);
    event DamageClaimDisputed(uint256 indexed leaseId);
    event DamageClaimDropped(uint256 indexed leaseId);
    event DamageClaimWithdrawn(uint256 indexed leaseId);
    event DamageClaimAutoExecuted(uint256 indexed leaseId, uint256 amount);

    event BondPosted(uint256 indexed leaseId, address indexed poster, uint256 amount);
    event DisputeFreezeStarted(uint256 indexed leaseId, uint256 freezeEnd);
    event DisputeCancelled(uint256 indexed leaseId);
    event FreezeExpiredAllReturned(uint256 indexed leaseId);

    event MutualSettlementProposed(uint256 indexed leaseId, address indexed proposer, uint256 toLandlord, uint256 toTenant);
    event MutualSettlementConfirmed(uint256 indexed leaseId);

    event PropDepWindowExpired(uint256 indexed leaseId, uint256 returnedToTenant);
    event PropDepSettled(uint256 indexed leaseId, string reason);

    // ─── Modifiers ───────────────────────────────────────────────────────────────

    modifier onlyMain() {
        require(msg.sender == mainContract, "Not main contract");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier propDepExists(uint256 leaseId) {
        require(propDeps[leaseId].state != PropDepState.None, "PropDep does not exist");
        _;
    }

    modifier onlyTenant(uint256 leaseId) {
        require(msg.sender == propDeps[leaseId].tenant, "Not tenant");
        _;
    }

    modifier onlyLandlord(uint256 leaseId) {
        require(msg.sender == propDeps[leaseId].landlord, "Not landlord");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────────

    constructor(address _usdc, address _mainContract) {
        require(_usdc != address(0), "USDC zero");
        require(_mainContract != address(0), "Main zero");
        usdc = IERC20(_usdc);
        mainContract = _mainContract;
        owner = msg.sender;
        // C-1: devMode allowed ONLY on known test chain IDs (whitelist, not blacklist).
        if (block.chainid != ARC_TESTNET &&
            block.chainid != ANVIL_LOCAL &&
            block.chainid != ARBITRUM_SEPOLIA &&
            block.chainid != ETHEREUM_SEPOLIA) {
            devMode = false;
        }
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  1. CREATION & SYNC (called by main contract only)
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Called by main contract when tenant deposits propDep.
    ///         Main must approve PropDepEscrow for `amount` USDC before calling.
    function createPropDep(
        uint256 leaseId,
        address tenant,
        address landlord,
        uint256 amount,
        uint256 leaseEndTime
    )
        external
        onlyMain
        nonReentrant
    {
        require(propDeps[leaseId].state == PropDepState.None, "Already exists");
        require(amount > 0, "Amount zero");
        require(tenant != address(0) && landlord != address(0), "Zero address");
        require(leaseEndTime > _now(), "Lease end in past");

        // Pull funds from main contract
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        PropDep storage p = propDeps[leaseId];
        p.leaseId = leaseId;
        p.tenant = tenant;
        p.landlord = landlord;
        p.amount = amount;
        p.state = PropDepState.Active;
        p.leaseEndTime = leaseEndTime;
        p.windowStart = leaseEndTime - propDepWindowDuration;
        p.windowEnd = leaseEndTime + propDepWindowDuration;

        emit PropDepCreated(leaseId, tenant, landlord, amount, p.windowStart, p.windowEnd);
    }

    /// @notice Called by main when leaseEndTime changes (renewal or DEV adjustment).
    function syncLeaseEndTime(uint256 leaseId, uint256 newLeaseEndTime)
        external
        onlyMain
        propDepExists(leaseId)
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Active, "Cannot sync after claim");

        p.leaseEndTime = newLeaseEndTime;
        p.windowStart = newLeaseEndTime - propDepWindowDuration;
        p.windowEnd = newLeaseEndTime + propDepWindowDuration;

        emit LeaseEndTimeSynced(leaseId, newLeaseEndTime, p.windowStart, p.windowEnd);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  2. LANDLORD ACTIONS — file claim, withdraw, post bond
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Landlord files a damage claim. Allowed only inside the window.
    function fileDamageClaim(uint256 leaseId, uint256 amount)
        external
        propDepExists(leaseId)
        onlyLandlord(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Active, "Wrong state");
        require(_now() >= p.windowStart, "Window not open");
        require(_now() <= p.windowEnd, "Window closed");
        require(amount > 0 && amount <= p.amount, "Invalid claim amount");
        // Minimum claim threshold: ceil(deposit * 30% / 100%)
        // Prevents tiny claims that freeze the entire deposit for 60 days
        uint256 minClaim = (p.amount * MIN_DAMAGE_CLAIM_BPS + 9999) / 10000;
        require(amount >= minClaim, "Claim below minimum");

        p.claimAmount = amount;
        p.claimDeadline = _now() + CLAIM_RESPONSE_PERIOD;
        p.state = PropDepState.Claimed;

        emit DamageClaimFiled(leaseId, amount, p.claimDeadline);
    }

    /// @notice Landlord voluntarily releases the full security deposit to tenant
    ///         without filing any claim. Available any time the PropDep is Active
    ///         (no need to wait for the inspection window to expire).
    function releaseDepositEarly(uint256 leaseId)
        external
        propDepExists(leaseId)
        onlyLandlord(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Active, "Not Active");

        uint256 amt = p.amount;
        p.amount = 0;
        p.state = PropDepState.Settled;

        if (amt > 0) {
            usdc.safeTransfer(p.tenant, amt);
        }

        emit PropDepWindowExpired(leaseId, amt);
        emit PropDepSettled(leaseId, "released_early_no_claim");
    }

    /// @notice Landlord withdraws claim before tenant responds or before bond posted.
    ///         Full deposit returns to tenant.
    function withdrawClaim(uint256 leaseId)
        external
        propDepExists(leaseId)
        onlyLandlord(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(
            p.state == PropDepState.Claimed ||
            p.state == PropDepState.Disputed ||
            p.state == PropDepState.Frozen,
            "Not in Claimed, Disputed, or Frozen state"
        );

        // Return bond to landlord if posted
        uint256 bond = p.disputeBond;
        if (bond > 0) {
            p.disputeBond = 0;
            usdc.safeTransfer(p.landlord, bond);
        }

        // Return PropDep to tenant
        uint256 amt = p.amount;
        p.amount = 0;
        p.claimAmount = 0;
        p.state = PropDepState.Settled;

        if (amt > 0) {
            usdc.safeTransfer(p.tenant, amt);
        }

        emit DamageClaimWithdrawn(leaseId);
        emit PropDepSettled(leaseId, "claim_withdrawn");
    }

    /// @notice Landlord posts bond after tenant disputed claim.
    /// @dev Bond amount = claimAmount. Bond is ALWAYS returned to poster regardless of outcome
    ///      (see acceptClaimAfterBond, cancelDispute, releaseFrozenFunds, confirmMutualSettlement).
    ///      This is intentional Equal Stakes design: the bond is pure capital lockup —
    ///      posting it costs landlord the same freeze duration they impose on tenant's deposit.
    ///      Bond is not slashable; it is a credible-commitment mechanism, not a penalty stake.
    function postBond(uint256 leaseId)
        external
        propDepExists(leaseId)
        onlyLandlord(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Disputed, "Not disputed");
        require(p.disputeBond == 0, "Bond already posted");
        require(_now() <= p.claimDeadline + BOND_POSTING_PERIOD, "Bond posting period expired");

        usdc.safeTransferFrom(msg.sender, address(this), p.claimAmount);

        p.disputeBond = p.claimAmount;
        p.bondPoster = msg.sender;
        p.freezeStart = _now();
        p.freezeEnd = _now() + freezeDuration; // snapshot — immune to later config changes
        p.state = PropDepState.Frozen;

        emit BondPosted(leaseId, msg.sender, p.claimAmount);
        emit DisputeFreezeStarted(leaseId, _now() + freezeDuration);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  3. TENANT ACTIONS — accept, dispute, accept-after-bond
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Tenant accepts the damage claim.
    function acceptClaim(uint256 leaseId)
        external
        propDepExists(leaseId)
        onlyTenant(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        // Allow accept in both Claimed (initial) and Disputed (tenant changed mind) states
        require(p.state == PropDepState.Claimed || p.state == PropDepState.Disputed, "Wrong state");
        require(p.disputeBond == 0, "Bond posted: use acceptClaimAfterBond");

        p.tenantAccepted = true;
        _executeClaim(leaseId);

        emit DamageClaimAccepted(leaseId, p.claimAmount);
        emit PropDepSettled(leaseId, "claim_accepted");
    }

    /// @notice Tenant disputes the damage claim.
    function disputeClaim(uint256 leaseId)
        external
        propDepExists(leaseId)
        onlyTenant(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Claimed, "Wrong state");
        require(_now() <= p.claimDeadline, "Response period expired");

        p.tenantDisputed = true;
        p.state = PropDepState.Disputed;

        emit DamageClaimDisputed(leaseId);
    }

    /// @notice Tenant accepts the claim after landlord posted bond (in Frozen state).
    ///         Bond returns to landlord. Claim amount → landlord. Remainder → tenant.
    function acceptClaimAfterBond(uint256 leaseId)
        external
        propDepExists(leaseId)
        onlyTenant(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Frozen, "Not frozen");
        require(p.disputeBond > 0, "No bond posted");

        // CEI: state changes first, then transfers
        p.tenantAccepted = true;
        uint256 bond = p.disputeBond;
        uint256 claim = p.claimAmount;
        uint256 remainder = p.amount - claim;
        p.amount = 0;
        p.disputeBond = 0;
        p.state = PropDepState.Settled;

        // Bond → bond poster (landlord, returned)
        usdc.safeTransfer(p.bondPoster, bond);

        // Claim → landlord
        usdc.safeTransfer(p.landlord, claim);

        // Remainder → tenant
        if (remainder > 0) {
            usdc.safeTransfer(p.tenant, remainder);
        }

        emit DamageClaimAccepted(leaseId, p.claimAmount);
        emit PropDepSettled(leaseId, "claim_accepted_after_bond");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  4. PERMISSIONLESS EXPIRY FUNCTIONS (anyone / keeper can call)
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice After window closes with no claim → full deposit returns to tenant.
    ///         Called by anyone.
    function expirePropDepWindow(uint256 leaseId)
        external
        propDepExists(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Active, "Cannot expire - claim active");
        require(_now() > p.windowEnd, "Window still open");

        uint256 amt = p.amount;
        p.amount = 0;
        p.state = PropDepState.Settled;

        if (amt > 0) {
            usdc.safeTransfer(p.tenant, amt);
        }

        emit PropDepWindowExpired(leaseId, amt);
        emit PropDepSettled(leaseId, "window_expired_no_claim");
    }

    /// @notice After tenant disputed claim, if landlord doesn't post bond within 3 days → claim dropped.
    ///         Full deposit returns to tenant.
    function expireDamageClaim(uint256 leaseId)
        external
        propDepExists(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Disputed, "Not disputed");
        require(p.disputeBond == 0, "Bond was posted");
        require(_now() > p.claimDeadline + BOND_POSTING_PERIOD, "Bond period not expired");

        uint256 amt = p.amount;
        p.amount = 0;
        p.claimAmount = 0;
        p.state = PropDepState.Settled;

        if (amt > 0) {
            usdc.safeTransfer(p.tenant, amt);
        }

        emit DamageClaimDropped(leaseId);
        emit PropDepSettled(leaseId, "claim_dropped_no_bond");
    }

    /// @notice If tenant doesn't respond to claim within deadline → claim auto-executes (same as accept).
    function executeExpiredClaim(uint256 leaseId)
        external
        propDepExists(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Claimed, "Wrong state");
        require(!p.tenantAccepted && !p.tenantDisputed, "Tenant already responded");
        require(_now() > p.claimDeadline, "Deadline not passed");

        _executeClaim(leaseId);

        emit DamageClaimAutoExecuted(leaseId, p.claimAmount);
        emit PropDepSettled(leaseId, "claim_auto_executed");
    }

    /// @notice After 60-day freeze with no settlement → all funds return to owners.
    function releaseFrozenFunds(uint256 leaseId)
        external
        propDepExists(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Frozen, "Not frozen");
        require(_now() >= p.freezeEnd, "Freeze not expired");

        // Bond → poster (returned)
        if (p.disputeBond > 0) {
            usdc.safeTransfer(p.bondPoster, p.disputeBond);
        }

        // Deposit → tenant (no claim executed)
        uint256 amt = p.amount;
        p.amount = 0;
        p.disputeBond = 0;
        p.state = PropDepState.Settled;

        if (amt > 0) {
            usdc.safeTransfer(p.tenant, amt);
        }

        emit FreezeExpiredAllReturned(leaseId);
        emit PropDepSettled(leaseId, "freeze_expired");
    }

    /// @notice Bond poster cancels dispute (before freeze expires). Bond returned, full deposit → tenant.
    function cancelDispute(uint256 leaseId)
        external
        propDepExists(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Frozen, "Not frozen");
        require(msg.sender == p.bondPoster, "Only bond poster can cancel");

        // Bond → poster
        usdc.safeTransfer(p.bondPoster, p.disputeBond);

        // Deposit → tenant
        uint256 amt = p.amount;
        p.amount = 0;
        p.disputeBond = 0;
        p.claimAmount = 0;
        p.state = PropDepState.Settled;

        if (amt > 0) {
            usdc.safeTransfer(p.tenant, amt);
        }

        emit DisputeCancelled(leaseId);
        emit PropDepSettled(leaseId, "dispute_cancelled");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  5. MUTUAL SETTLEMENT (during Frozen state)
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Either party proposes a mutual settlement of the propDep.
    function proposeMutualSettlement(uint256 leaseId, uint256 toLandlord, uint256 toTenant)
        external
        propDepExists(leaseId)
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Frozen, "Not frozen");
        require(msg.sender == p.tenant || msg.sender == p.landlord, "Not a party");
        require(toLandlord + toTenant == p.amount, "Sum != deposit");

        p.settlementProposer = msg.sender;
        p.settlementToLandlord = toLandlord;
        p.settlementToTenant = toTenant;

        emit MutualSettlementProposed(leaseId, msg.sender, toLandlord, toTenant);
    }

    /// @notice Counterparty confirms — distribution executes.
    ///         Must pass expected amounts to prevent front-running proposal swap.
    function confirmMutualSettlement(uint256 leaseId, uint256 expectedToLandlord, uint256 expectedToTenant)
        external
        propDepExists(leaseId)
        nonReentrant
    {
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Frozen, "Not frozen");
        require(msg.sender == p.tenant || msg.sender == p.landlord, "Not a party");
        require(p.settlementProposer != address(0), "No proposal");
        require(msg.sender != p.settlementProposer, "Proposer cannot confirm");
        require(p.settlementToLandlord == expectedToLandlord && p.settlementToTenant == expectedToTenant, "Proposal changed");

        uint256 toL = p.settlementToLandlord;
        uint256 toT = p.settlementToTenant;

        // Bond → poster (returned)
        if (p.disputeBond > 0) {
            usdc.safeTransfer(p.bondPoster, p.disputeBond);
        }

        if (toL > 0) usdc.safeTransfer(p.landlord, toL);
        if (toT > 0) usdc.safeTransfer(p.tenant, toT);

        p.amount = 0;
        p.disputeBond = 0;
        p.state = PropDepState.Settled;

        emit MutualSettlementConfirmed(leaseId);
        emit PropDepSettled(leaseId, "mutual_settlement");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  6. INTERNAL HELPERS
    // ═════════════════════════════════════════════════════════════════════════════

    /// @notice Internal: distribute claim amount → landlord, remainder → tenant.
    function _executeClaim(uint256 leaseId) internal {
        PropDep storage p = propDeps[leaseId];
        uint256 claimAmt = p.claimAmount;
        uint256 remainder = p.amount - claimAmt;

        p.amount = 0;
        p.state = PropDepState.Settled;

        usdc.safeTransfer(p.landlord, claimAmt);
        if (remainder > 0) {
            usdc.safeTransfer(p.tenant, remainder);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  7. VIEW HELPERS
    // ═════════════════════════════════════════════════════════════════════════════

    function getPropDep(uint256 leaseId) external view returns (PropDep memory) {
        return propDeps[leaseId];
    }

    function getState(uint256 leaseId) external view returns (PropDepState) {
        return propDeps[leaseId].state;
    }

    function isResolved(uint256 leaseId) external view returns (bool) {
        PropDepState s = propDeps[leaseId].state;
        return s == PropDepState.Settled || s == PropDepState.None;
    }

    function isWindowOpen(uint256 leaseId) external view returns (bool) {
        PropDep storage p = propDeps[leaseId];
        return p.state == PropDepState.Active &&
               _now() >= p.windowStart &&
               _now() <= p.windowEnd;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    //  8. OWNER FUNCTIONS (config + dev)
    // ═════════════════════════════════════════════════════════════════════════════

    function setPropDepWindowDuration(uint256 newDuration) external onlyOwner {
        require(newDuration >= 1 days && newDuration <= 30 days, "Duration out of range");
        propDepWindowDuration = newDuration;
    }

    function setFreezeDuration(uint256 newDuration) external onlyOwner {
        require(newDuration >= 7 days && newDuration <= 180 days, "Duration out of range");
        freezeDuration = newDuration;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    /// @notice Returns current time, adjusted by timeOffset in dev mode.
    function _now() internal view returns (uint256) {
        if (devMode && timeOffset != 0) {
            return uint256(int256(block.timestamp) + timeOffset);
        }
        return block.timestamp;
    }

    /// @notice Permanently disable dev mode. One-way — cannot be re-enabled.
    function disableDevMode() external onlyOwner {
        devMode = false;
        timeOffset = 0;
    }

    /// @notice Advance or rewind virtual time.
    event TimeWarped(int256 delta, int256 newOffset);

    function warp(int256 delta) external onlyOwner {
        require(devMode, "Dev mode disabled");
        // Defense-in-depth: block known mainnet chain IDs even if devMode is somehow true
        require(
            block.chainid != ARBITRUM_ONE &&
            block.chainid != ETHEREUM_MAINNET &&
            block.chainid != ARC_MAINNET,
            "No dev on mainnet"
        );
        require(delta > -365 days && delta < 365 days, "Delta too large");
        timeOffset += delta;
        emit TimeWarped(delta, timeOffset);
    }

    function resetTime() external onlyOwner {
        require(devMode, "Dev mode disabled");
        timeOffset = 0;
    }

    function currentTime() external view returns (uint256) {
        return _now();
    }

    /// @notice DEV-only: manually set leaseEndTime for testing accelerated flows.
    function _devSetLeaseEndTime(uint256 leaseId, uint256 newLeaseEndTime)
        external
        onlyOwner
        propDepExists(leaseId)
    {
        require(devMode, "Dev mode disabled");
        PropDep storage p = propDeps[leaseId];
        p.leaseEndTime = newLeaseEndTime;
        p.windowStart = newLeaseEndTime - propDepWindowDuration;
        p.windowEnd = newLeaseEndTime + propDepWindowDuration;
        emit LeaseEndTimeSynced(leaseId, newLeaseEndTime, p.windowStart, p.windowEnd);
    }

    /// @notice DEV ONLY — force the propdep freeze to be expired so releaseFrozenFunds can be called.
    ///         Sets freezeStart to (block.timestamp - freezeDuration - 1).
    function _devForceFreezeExpired(uint256 leaseId)
        external
        onlyOwner
        propDepExists(leaseId)
    {
        require(devMode, "Dev mode disabled");
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Frozen, "Not in Frozen state");
        // releaseFrozenFunds checks p.freezeEnd (snapshot), not p.freezeStart.
        // Set freezeEnd to the past so releaseFrozenFunds can be called immediately.
        p.freezeEnd = _now() > 1 ? _now() - 1 : 0;
    }

    /// @notice DEV ONLY — force the propdep window to be expired (no claim) so expirePropDepWindow can be called.
    function _devForceWindowExpired(uint256 leaseId)
        external
        onlyOwner
        propDepExists(leaseId)
    {
        require(devMode, "Dev mode disabled");
        PropDep storage p = propDeps[leaseId];
        require(p.state == PropDepState.Active, "Not in Active state");
        // Set windowEnd to the past
        p.windowEnd = _now() - 1;
    }
}
