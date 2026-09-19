// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILendingAdapter} from "../../src/interfaces/ILendingAdapter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Shared mock token ────────────────────────────────────────────────────────

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ─── RevertingAdapter ─────────────────────────────────────────────────────────
/// @dev Always reverts on withdraw(). Models Aave hard pause.
contract RevertingAdapter is ILendingAdapter {
    address public usdc;
    address public escrow;
    uint256 public stored;

    constructor(address _usdc, address _escrow) {
        usdc = _usdc;
        escrow = _escrow;
    }

    function supply(uint256 amount) external returns (uint256) {
        MockUSDC(usdc).transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256) external pure returns (uint256) {
        revert("Aave paused");
    }

    function getIndex() external pure returns (uint256) { return 1e27; }
}

// ─── PausableAdapter ─────────────────────────────────────────────────────────
/// @dev Reverts on withdraw until unpause(). Lets us simulate Aave recovering.
contract PausableAdapter is ILendingAdapter {
    address public usdc;
    address public escrow;
    uint256 public stored;
    bool public paused = true;

    constructor(address _usdc, address _escrow) {
        usdc = _usdc;
        escrow = _escrow;
    }

    function supply(uint256 amount) external returns (uint256) {
        MockUSDC(usdc).transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        require(!paused, "Aave paused");
        MockUSDC(usdc).transfer(escrow, amount);
        stored = stored >= amount ? stored - amount : 0;
        return amount;
    }

    function getIndex() external pure returns (uint256) { return 1e27; }

    function unpause() external { paused = false; }
}

// ─── ZeroReturnAdapter ───────────────────────────────────────────────────────
/// @dev withdraw() returns 0 without reverting. Models frozen ERC-4626 vault.
contract ZeroReturnAdapter is ILendingAdapter {
    address public usdc;
    address public escrow;
    uint256 public stored;

    constructor(address _usdc, address _escrow) {
        usdc = _usdc;
        escrow = _escrow;
    }

    function supply(uint256 amount) external returns (uint256) {
        MockUSDC(usdc).transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256) external pure returns (uint256) { return 0; }

    function getIndex() external pure returns (uint256) { return 1e27; }
}

// ─── PartialReturnAdapter ────────────────────────────────────────────────────
/// @dev withdraw() returns only 50% of requested amount (partial vault loss).
contract PartialReturnAdapter is ILendingAdapter {
    address public usdc;
    address public escrow;
    uint256 public stored;

    constructor(address _usdc, address _escrow) {
        usdc = _usdc;
        escrow = _escrow;
    }

    function supply(uint256 amount) external returns (uint256) {
        MockUSDC(usdc).transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        uint256 toReturn = amount / 2;
        MockUSDC(usdc).transfer(escrow, toReturn);
        stored = stored >= amount ? stored - amount : 0;
        return toReturn;
    }

    function getIndex() external pure returns (uint256) { return 1e27; }
}

// ─── ReenteringAdapter ───────────────────────────────────────────────────────
/// @dev Attempts reentrancy on withdraw(). Used to verify nonReentrant guards.
contract ReenteringAdapter is ILendingAdapter {
    address public usdc;
    address public escrow;
    uint256 public stored;
    bytes public callData; // calldata to replay on reenter
    bool private _attacking;

    constructor(address _usdc, address _escrow) {
        usdc = _usdc;
        escrow = _escrow;
    }

    function setCallData(bytes calldata data) external { callData = data; }

    function supply(uint256 amount) external returns (uint256) {
        MockUSDC(usdc).transferFrom(escrow, address(this), amount);
        stored += amount;
        return amount;
    }

    function withdraw(uint256 amount) external returns (uint256) {
        if (!_attacking && callData.length > 0) {
            _attacking = true;
            // Attempt reentrant call — should be blocked by nonReentrant
            (bool ok,) = escrow.call(callData);
            // We don't care if it succeeded — the guard should block it
            _attacking = false;
            (ok); // suppress unused warning
        }
        MockUSDC(usdc).transfer(escrow, amount);
        stored = stored >= amount ? stored - amount : 0;
        return amount;
    }

    function getIndex() external pure returns (uint256) { return 1e27; }
}
