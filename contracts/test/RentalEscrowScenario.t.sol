// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC2 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @title Scenario tests: leaseEnd vs rent overdue priority
contract RentalEscrowScenarioTest is Test {
    RentalEscrow public escrow;
    PropDepEscrow public propDep;
    MockUSDC2 public usdc;

    address tenant = makeAddr("tenant");
    address landlord = makeAddr("landlord");
    address treasury = makeAddr("treasury");

    uint256 constant RENT = 1000e6; // 1000 USDC
    uint256 constant DURATION = 6; // 6 months

    function setUp() public {
        usdc = new MockUSDC2();
        escrow = new RentalEscrow(address(usdc), treasury);
        propDep = new PropDepEscrow(address(usdc), address(escrow));
        escrow.setPropDepEscrow(address(propDep));

        usdc.mint(tenant, 1_000_000e6);
        usdc.mint(landlord, 1_000_000e6);
    }

    function _createAndActivate() internal returns (uint256 id) {
        vm.prank(landlord);
        id = escrow.createAgreement(tenant, landlord, RENT, 0, DURATION, bytes32(0));

        vm.startPrank(tenant);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        vm.startPrank(landlord);
        usdc.approve(address(escrow), type(uint256).max);
        escrow.landlordDeposit(id);
        vm.stopPrank();
    }

    /// @notice When lease expired, isRentOverdue must return false
    function testLeaseExpiredTakesPriorityOverRentOverdue() public {
        uint256 id = _createAndActivate();

        // Warp past lease end (6 months = 180 days)
        vm.warp(block.timestamp + 181 days);

        // Lease should be expired
        assertTrue(escrow.isLeaseExpired(id), "lease should be expired");

        // Rent is technically overdue too (no payments made after month 1)
        // But isRentOverdue should return false because lease expired takes priority
        assertFalse(escrow.isRentOverdue(id), "isRentOverdue should be false when lease expired");
    }

    /// @notice flagRentMissed should revert after lease end
    function testCannotFlagRentMissedAfterLeaseEnd() public {
        uint256 id = _createAndActivate();

        // Warp past lease end
        vm.warp(block.timestamp + 181 days);

        // flagRentMissed should revert
        vm.expectRevert();
        escrow.flagRentMissed(id);
    }

    /// @notice endLease should succeed when both lease expired and rent would be overdue
    function testCanEndLeaseWhenBothConditionsTrue() public {
        uint256 id = _createAndActivate();

        // Warp past lease end — rent also overdue
        vm.warp(block.timestamp + 181 days);

        uint256 tenantBefore = usdc.balanceOf(tenant);
        uint256 landlordBefore = usdc.balanceOf(landlord);

        // endLease should succeed
        escrow.endLease(id);

        // Deposits should be returned to both parties (not seized)
        uint256 tenantAfter = usdc.balanceOf(tenant);
        uint256 landlordAfter = usdc.balanceOf(landlord);

        // Tenant gets commitment back, landlord gets hosting back
        assertGt(tenantAfter, tenantBefore, "tenant should get deposit back");
        assertGt(landlordAfter, landlordBefore, "landlord should get deposit back");
    }

    /// @notice Rent overdue mid-lease still works (flagRentMissed before lease end)
    function testFlagRentMissedStillWorksBeforeLeaseEnd() public {
        uint256 id = _createAndActivate();

        // Warp past rent due + grace (30 days + 3 days), but not past lease end
        vm.warp(block.timestamp + 34 days);

        // Should be overdue
        assertTrue(escrow.isRentOverdue(id), "should be overdue");
        assertFalse(escrow.isLeaseExpired(id), "lease should NOT be expired yet");

        // flagRentMissed should succeed
        escrow.flagRentMissed(id);
    }
}
