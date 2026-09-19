// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILendingAdapter} from "./interfaces/ILendingAdapter.sol";

/// @notice Minimal ERC-4626 interface
interface IERC4626 {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function convertToShares(uint256 assets) external view returns (uint256 shares);
    function balanceOf(address owner) external view returns (uint256);
    function asset() external view returns (address);
    function maxDeposit(address receiver) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256);
}

/// @notice Minimal interface to read escrow owner for rescue() gating.
interface IOwnable {
    function owner() external view returns (address);
}

/// @title MorphoAdapter — ERC-4626 vault adapter for pi2pi RentalEscrow
/// @notice Wraps any ERC-4626 vault (Morpho, Yearn, etc.) behind ILendingAdapter.
///         Bound 1:1 to a single RentalEscrow. Only that escrow can call supply/withdraw.
contract MorphoAdapter is ILendingAdapter {
    using SafeERC20 for IERC20;

    address public immutable escrow;
    IERC4626 public immutable vault;
    IERC20 public immutable usdc;

    error OnlyEscrow();
    /// @notice Reverted when the vault currently cannot service the full withdrawal due
    ///         to temporary market illiquidity (maxWithdraw < owed).
    ///         RentalEscrow catches this as a hard failure and preserves the lending
    ///         position for a retry via reclaimLentFundsAfterSettlement().
    error IlliquidVault();

    event Supplied(uint256 assets, uint256 shares);
    event Withdrawn(uint256 requested, uint256 actualWithdrawn);
    event Rescued(address token, uint256 amount);

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert OnlyEscrow();
        _;
    }

    constructor(address _escrow, address _vault, address _usdc) {
        require(_escrow != address(0), "Escrow zero");
        require(_vault != address(0), "Vault zero");
        require(_usdc != address(0), "USDC zero");
        require(IERC4626(_vault).asset() == _usdc, "Vault asset mismatch");

        escrow = _escrow;
        vault = IERC4626(_vault);
        usdc = IERC20(_usdc);

        // Max approve vault — safe because vault is immutable and trusted (Morpho)
        usdc.forceApprove(_vault, type(uint256).max);
    }

    /// @notice Supply USDC to the vault. Returns shares received (used as scaledBalance).
    function supply(uint256 amount) external onlyEscrow returns (uint256 scaledSupplied) {
        if (amount == 0) return 0;
        require(vault.maxDeposit(address(this)) >= amount, "Deposit disabled or capped");

        usdc.safeTransferFrom(escrow, address(this), amount);

        uint256 sharesBefore = vault.balanceOf(address(this));
        vault.deposit(amount, address(this));
        uint256 sharesAfter = vault.balanceOf(address(this));

        scaledSupplied = sharesAfter - sharesBefore;
        require(scaledSupplied > 0, "Zero shares received");

        // Slippage check: received shares should be within 1% of expected
        uint256 expectedShares = vault.convertToShares(amount);
        require(expectedShares == 0 || scaledSupplied >= expectedShares * 99 / 100, "Slippage too high");

        emit Supplied(amount, scaledSupplied);
    }

    /// @notice Withdraw USDC from the vault. Returns actual amount withdrawn.
    ///
    /// @dev    Distinguishes two failure modes:
    ///
    ///         1. **Temporary illiquidity** (`maxWithdraw < owed`): the shares are still
    ///            worth their full value inside the vault — no assets have been lost, the
    ///            Morpho market just lacks liquidity right now.  We revert with
    ///            `IlliquidVault()` so RentalEscrow treats this as a hard failure and
    ///            keeps the lending position alive for a later retry via
    ///            `reclaimLentFundsAfterSettlement()`.
    ///
    ///         2. **Real vault loss** (`convertToAssets(totalShares) < amount`): share
    ///            value has genuinely decreased (bad debt, fees, etc.).  In this case
    ///            `owed < amount`; if the vault is liquid enough to redeem `owed` we
    ///            proceed and return `owed`.  RentalEscrow distributes the shortfall
    ///            pro-rata as a partial settlement.
    ///
    ///         NOTE: Unlike `AaveAdapter`, this function NEVER silently clamps the
    ///         withdrawal to `maxWithdraw` — doing so would cause RentalEscrow to
    ///         permanently lose track of the un-withdrawn remainder.
    function withdraw(uint256 amount) external onlyEscrow returns (uint256 actualWithdrawn) {
        if (amount == 0) return 0;

        // Total fair value of all shares this adapter holds (may span multiple agreements).
        uint256 totalValue = vault.convertToAssets(vault.balanceOf(address(this)));

        // Owed: amount requested, capped only if vault has genuinely suffered a loss.
        // If totalValue >= amount the shares cover the full withdrawal — any shortfall
        // in maxWithdraw is purely a liquidity issue, not a value issue.
        uint256 owed = amount > totalValue ? totalValue : amount;

        // If the vault cannot service even the (possibly loss-reduced) withdrawal right
        // now, revert so the escrow keeps the position alive for retry.
        if (vault.maxWithdraw(address(this)) < owed) revert IlliquidVault();

        if (owed == 0) return 0;

        uint256 balBefore = usdc.balanceOf(address(this));
        uint256 sharesBefore = vault.balanceOf(address(this));
        vault.withdraw(owed, address(this), address(this));
        uint256 balAfter = usdc.balanceOf(address(this));
        uint256 sharesAfter = vault.balanceOf(address(this));

        require(sharesBefore > sharesAfter, "Zero shares burned");
        actualWithdrawn = balAfter - balBefore;

        if (actualWithdrawn > 0) {
            usdc.safeTransfer(escrow, actualWithdrawn);
        }

        emit Withdrawn(amount, actualWithdrawn);
    }

    /// @notice Get the current "index" for yield calculation.
    /// @dev    index = assets per share, scaled to RAY (1e27).
    ///         RentalEscrow: realValue = scaledBalance * getIndex() / RAY
    ///         With shares as scaledBalance: realValue ≈ convertToAssets(shares)
    ///         NOTE: unlike Aave, this index CAN decrease (vault loss, fees).
    function getIndex() external view returns (uint256) {
        return vault.convertToAssets(1e27);
    }

    /// @notice Rescue tokens accidentally sent to this adapter.
    ///         Cannot rescue vault shares (they back user deposits).
    /// @dev    Callable by the owner of the bound escrow contract — not by the
    ///         escrow contract itself, which has no passthrough for this call.
    ///         Using `IOwnable(escrow).owner()` avoids adding a new function to
    ///         RentalEscrow while still restricting access to a trusted party.
    function rescue(address token, uint256 amount) external {
        require(msg.sender == IOwnable(escrow).owner(), "Not escrow owner");
        require(token != address(vault), "Cannot rescue vault shares");
        IERC20(token).safeTransfer(escrow, amount);
        emit Rescued(token, amount);
    }

    /// @notice View: total assets this adapter controls in the vault.
    function totalAssets() external view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(address(this)));
    }
}
