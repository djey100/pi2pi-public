// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ILendingAdapter
/// @notice Minimal interface escrow contracts use to interact with a lending protocol.
/// @dev Intentionally has only 3 functions. We do NOT expose `getLiquidity()` because
///      Aave (and most lending protocols) do not provide a reliable view function for
///      "withdrawable amount" — the only ground truth is the actual `withdraw()` return
///      value. Pretending otherwise would be self-deception.
///      Each escrow deploys its OWN adapter instance with `escrow` set immutable in the
///      adapter constructor; the adapter rejects calls from any other address.
interface ILendingAdapter {
    /// @notice Supply USDC from the escrow into the lending protocol.
    /// @dev The adapter pulls USDC from the escrow via safeTransferFrom (escrow grants
    ///      approval before calling). Returns the SCALED amount of aTokens allocated
    ///      for this specific supply — the escrow MUST store this per agreement to
    ///      correctly compute withdrawable amounts and yield later.
    /// @param amount Amount of USDC (6 decimals) to supply.
    /// @return scaledSupplied The scaled aToken balance delta attributable to this call.
    ///         Equal to `amount * RAY / currentLiquidityIndex` truncated, matching Aave's
    ///         internal bookkeeping. Using this avoids rounding mismatches on withdraw.
    function supply(uint256 amount) external returns (uint256 scaledSupplied);

    /// @notice Withdraw USDC from the lending protocol back to the escrow.
    /// @dev MUST be called only by the escrow that owns this adapter. The actual amount
    ///      withdrawn may be less than requested if the lending pool has insufficient
    ///      liquidity — the caller MUST check the return value and react accordingly.
    /// @param amount Amount of USDC (6 decimals) to withdraw.
    /// @return actualWithdrawn Amount actually received by the escrow.
    function withdraw(uint256 amount) external returns (uint256 actualWithdrawn);

    /// @notice Read the current normalized income index for USDC from the lending protocol.
    /// @dev Used by escrow contracts to compute yield via principal+index accounting.
    ///      For Aave V3 this maps to `IPool.getReserveNormalizedIncome(usdc)`.
    /// @return index Current normalized income index, scaled by RAY (1e27).
    function getIndex() external view returns (uint256 index);
}
