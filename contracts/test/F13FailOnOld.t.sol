// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title F13FailOnOld.t.sol
 * @notice Behavioral fail-on-old proof for F-13-strict.
 *         Compiled against de6feba9 (skip behavior), proves that
 *         DrainAndZeroAdapter silently drains escrow on old code.
 *
 *  OLD (de6feba9): scaledDelta==0 branch skips silently (revoke approval, emit, return).
 *    DrainAndZeroAdapter.supply() takes USDC AND returns 0 => landlordDeposit succeeds,
 *    adapter holds the USDC, escrow has 0 balance => funds drained silently.
 *  NEW: revert ZeroScaledSupply() propagates atomically, entire tx rolls back.
 */

import {Test} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {ILendingAdapter} from "../src/interfaces/ILendingAdapter.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ProofUSDC is ERC20 {
    constructor() ERC20("ProofUSDC", "pUSDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev Takes USDC from escrow AND returns 0 -- silent drain.
contract DrainAndZeroAdapterProof is ILendingAdapter {
    ProofUSDC public usdc;
    address public escrow;
    uint256 public drained;

    constructor(address _usdc, address _escrow) {
        usdc = ProofUSDC(_usdc);
        escrow = _escrow;
    }

    function supply(uint256 amount) external returns (uint256) {
        if (amount > 0) {
            usdc.transferFrom(escrow, address(this), amount);
            drained += amount;
        }
        return 0; // accepts USDC but reports zero scaled
    }

    function withdraw(uint256) external pure returns (uint256) { return 0; }
    function getIndex() external pure returns (uint256) { return 1e27; }
}

contract F13FailOnOld is Test {
    ProofUSDC usdc;
    RentalEscrow escrow;
    DrainAndZeroAdapterProof adapter;

    address tenant   = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address treasury = makeAddr("treasury");
    uint256 constant RENT = 1_000e6;

    function setUp() public {
        usdc    = new ProofUSDC();
        escrow  = new RentalEscrow(address(usdc), treasury);
        adapter = new DrainAndZeroAdapterProof(address(usdc), address(escrow));

        usdc.mint(tenant,   500_000e6);
        usdc.mint(landlord, 500_000e6);
        vm.prank(tenant);   usdc.approve(address(escrow), type(uint256).max);
        vm.prank(landlord); usdc.approve(address(escrow), type(uint256).max);

        escrow.setLendingAdapter(address(adapter));
        escrow.emergencyEnableLending();
    }

    // =========================================================================
    //  FAILS ON OLD (de6feba9): landlordDeposit succeeds even though adapter
    //    silently drained all USDC. Adapter holds RENT*2, escrow has 0.
    //  PASSES ON NEW: landlordDeposit reverts atomically, adapter holds 0.
    //
    //  This test ASSERTS that adapter.drained == 0 after landlordDeposit
    //  (new behavior). On old code the assertion fails because adapter drained
    //  the funds without reverting the tx.
    // =========================================================================
    function test_F13_fail_on_old_drainIsAtomic() public {
        vm.prank(landlord);
        uint256 id = escrow.createAgreement(tenant, landlord, RENT, 0, 6, bytes32(0));
        vm.prank(tenant);
        escrow.tenantDeposit(id);

        // Attempt landlordDeposit -- on OLD code this SUCCEEDS (no revert),
        // adapter drains funds, assertion below fails proving old code was broken.
        // On NEW code landlordDeposit reverts ZeroScaledSupply, tx rolls back.
        vm.prank(landlord);
        try escrow.landlordDeposit{ gas: 2_000_000 }(id) {} catch {}

        // NEW: adapter must hold nothing (tx was reverted atomically)
        assertEq(adapter.drained(), 0,
            "F-13 FAIL ON OLD: adapter drained USDC without revert -- funds stolen silently");
        assertEq(usdc.balanceOf(address(adapter)), 0,
            "F-13 FAIL ON OLD: adapter balance must be 0 after atomic revert");
    }
}
