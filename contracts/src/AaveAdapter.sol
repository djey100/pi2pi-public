// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILendingAdapter} from "./interfaces/ILendingAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal Aave V3 IPool interface used by the adapter.
interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function getReserveNormalizedIncome(address asset) external view returns (uint256);
    function getReserveData(address asset) external view returns (ReserveData memory);
}

/// @notice Aave V3 ReserveData — we only care about the aTokenAddress field at index 8.
///         The struct layout must match Aave's exactly because we decode on-chain.
struct ReserveData {
    ReserveConfigurationMap configuration;
    uint128 liquidityIndex;
    uint128 currentLiquidityRate;
    uint128 variableBorrowIndex;
    uint128 currentVariableBorrowRate;
    uint128 currentStableBorrowRate;
    uint40 lastUpdateTimestamp;
    uint16 id;
    address aTokenAddress;
    address stableDebtTokenAddress;
    address variableDebtTokenAddress;
    address interestRateStrategyAddress;
    uint128 accruedToTreasury;
    uint128 unbacked;
    uint128 isolationModeTotalDebt;
}
struct ReserveConfigurationMap { uint256 data; }

/// @notice aToken scaledBalanceOf — used to track our exact scaled position.
interface IAToken {
    function scaledBalanceOf(address user) external view returns (uint256);
}

/// @title AaveAdapter
/// @notice Wraps Aave V3 IPool behind the ILendingAdapter interface.
/// @dev    Each escrow contract deploys its OWN AaveAdapter with `escrow` set immutable
///         in the constructor. The adapter rejects calls from any address other than
///         that escrow. This is the primary security boundary — without onlyEscrow,
///         anyone could drain liquidity by calling adapter functions directly.
///
///         The adapter is intentionally minimal:
///         - 3 functions only (no getLiquidity self-deception)
///         - Pulls USDC from escrow via SafeERC20.safeTransferFrom in supply()
///         - Withdraws directly to escrow address (not to adapter)
///         - Uses Aave's normalized income index for yield computation
contract AaveAdapter is ILendingAdapter {
    using SafeERC20 for IERC20;

    address public immutable escrow;
    IAaveV3Pool public immutable aavePool;
    IERC20 public immutable usdc;
    IAToken public immutable aToken;

    error OnlyEscrow();

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert OnlyEscrow();
        _;
    }

    /// @param _escrow The RentalEscrow that owns this adapter. CANNOT be changed.
    /// @param _aavePool Aave V3 IPool address (per chain).
    /// @param _usdc USDC token address (per chain).
    constructor(address _escrow, address _aavePool, address _usdc) {
        require(_escrow != address(0), "AaveAdapter: zero escrow");
        require(_aavePool != address(0), "AaveAdapter: zero pool");
        require(_usdc != address(0), "AaveAdapter: zero usdc");
        escrow = _escrow;
        aavePool = IAaveV3Pool(_aavePool);
        usdc = IERC20(_usdc);
        // Fetch aToken address from Aave reserve data (set once, immutable)
        ReserveData memory rd = IAaveV3Pool(_aavePool).getReserveData(_usdc);
        require(rd.aTokenAddress != address(0), "AaveAdapter: no aToken");
        aToken = IAToken(rd.aTokenAddress);
    }

    /// @inheritdoc ILendingAdapter
    /// @dev Pulls USDC from escrow (escrow must approve adapter first), then supplies
    ///      to Aave with `onBehalfOf=address(this)` so the adapter holds the aTokens.
    ///      Measures the scaledBalance delta before and after the supply, returning
    ///      the exact scaled amount that belongs to this specific supply call. The
    ///      escrow stores this per-agreement so withdraw can use ground-truth math.
    function supply(uint256 amount) external onlyEscrow returns (uint256 scaledSupplied) {
        if (amount == 0) return 0;
        uint256 scaledBefore = aToken.scaledBalanceOf(address(this));
        usdc.safeTransferFrom(escrow, address(this), amount);
        // forceApprove handles non-standard USDC implementations safely
        usdc.forceApprove(address(aavePool), amount);
        aavePool.supply(address(usdc), amount, address(this), 0);
        uint256 scaledAfter = aToken.scaledBalanceOf(address(this));
        scaledSupplied = scaledAfter - scaledBefore;
        // C-3: symmetric with MorphoAdapter — revert rather than let escrow create a
        //      ghost position (principal > 0, scaledBalance == 0) that can never be cleared.
        require(scaledSupplied > 0, "Zero scaled received");
    }

    /// @inheritdoc ILendingAdapter
    /// @dev Adapter holds the aTokens (set in supply via onBehalfOf=this), so this
    ///      contract is the legitimate caller of `pool.withdraw`. Withdraws USDC
    ///      directly to the escrow — adapter never holds USDC after the call returns.
    ///      The actual on-chain Aave call may revert if USDC market is paused — that
    ///      revert bubbles up; the escrow wraps this in try/catch and translates to
    ///      `LendingUnavailable` error for the user.
    function withdraw(uint256 amount) external onlyEscrow returns (uint256 actualWithdrawn) {
        if (amount == 0) return 0;
        actualWithdrawn = aavePool.withdraw(address(usdc), amount, escrow);
    }

    /// @inheritdoc ILendingAdapter
    function getIndex() external view returns (uint256) {
        return aavePool.getReserveNormalizedIncome(address(usdc));
    }
}
