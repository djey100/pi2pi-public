// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LendingLogic
/// @notice Pure functions for yield calculation, buffer math, and weighted index updates.
/// @dev Pulled into a library so RentalEscrow stays under the EIP-170 24,576 byte limit.
///      All functions are `internal pure` — they get inlined at compile time but contribute
///      less bytecode growth than equivalent contract-level methods.
library LendingLogic {
    /// @dev Aave's normalized income index uses RAY = 1e27 as base.
    uint256 internal constant RAY = 1e27;
    /// @dev Basis points denominator: 10000 = 100%.
    uint256 internal constant BPS = 10000;

    /// @notice Compute yield earned on a principal between two index snapshots.
    /// @dev    yield = principal * (currentIndex / entryIndex) - principal
    ///         Rounding always favors the protocol (truncating division). Returns 0 if
    ///         currentIndex <= entryIndex (shouldn't happen with Aave but defensive).
    /// @param principal The amount originally supplied.
    /// @param entryIndex The Aave normalized income index at supply time.
    /// @param currentIndex The Aave normalized income index now.
    /// @return yield Earned yield amount (same decimals as principal).
    function calculateYield(
        uint256 principal,
        uint256 entryIndex,
        uint256 currentIndex
    ) internal pure returns (uint256 yield) {
        if (principal == 0 || entryIndex == 0) return 0;
        if (currentIndex <= entryIndex) return 0;
        // currentValue = principal * currentIndex / entryIndex
        // Truncating division — leftover wei stays in protocol favor
        uint256 currentValue = (principal * currentIndex) / entryIndex;
        if (currentValue <= principal) return 0;
        return currentValue - principal;
    }

    /// @notice Compute the weighted average index after adding new principal.
    /// @dev    Critical for top-up deposits. Without this, simply replacing entryIndex
    ///         with currentIndex would erase yield accrued on the previous principal.
    ///         Formula:
    ///             newIndex = (oldPrincipal * oldIndex + newAmount * currentIndex) / (oldPrincipal + newAmount)
    /// @param oldPrincipal Existing principal before top-up.
    /// @param oldIndex Existing entry index.
    /// @param newAmount Amount being added now.
    /// @param currentIndex Current Aave normalized income index.
    /// @return weightedIndex The new weighted entry index for the combined position.
    function calculateWeightedIndex(
        uint256 oldPrincipal,
        uint256 oldIndex,
        uint256 newAmount,
        uint256 currentIndex
    ) internal pure returns (uint256 weightedIndex) {
        if (oldPrincipal == 0) return currentIndex;
        if (newAmount == 0) return oldIndex;
        uint256 totalPrincipal = oldPrincipal + newAmount;
        return (oldPrincipal * oldIndex + newAmount * currentIndex) / totalPrincipal;
    }

    /// @notice Compute target buffer amount given total deposits and bufferBps.
    /// @dev    bufferBps in basis points (5000 = 50%).
    /// @param totalDeposits Sum of all USDC value managed by the contract (liquid + supplied).
    /// @param bufferBps Buffer percentage in basis points.
    /// @return target Buffer target in same decimals as totalDeposits.
    function calculateBufferTarget(
        uint256 totalDeposits,
        uint256 bufferBps
    ) internal pure returns (uint256 target) {
        return (totalDeposits * bufferBps) / BPS;
    }

    /// @notice Split yield between user and protocol per protocolFeeBps.
    /// @param yield Total yield to split.
    /// @param protocolFeeBps Protocol fee in basis points (3000 = 30%).
    /// @return userAmount Amount going to the user.
    /// @return protocolAmount Amount going to protocol treasury.
    function splitYield(
        uint256 yield,
        uint256 protocolFeeBps
    ) internal pure returns (uint256 userAmount, uint256 protocolAmount) {
        if (yield == 0) return (0, 0);
        protocolAmount = (yield * protocolFeeBps) / BPS;
        userAmount = yield - protocolAmount;
    }
}
