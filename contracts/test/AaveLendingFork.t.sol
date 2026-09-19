// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {AaveAdapter} from "../src/AaveAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fork test against Arbitrum mainnet Aave V3 USDC market.
///         Run with: forge test --match-path test/AaveLendingFork.t.sol --fork-url $ARBITRUM_MAINNET_RPC -vv
///         Skipped in default `forge test` run because it needs a live RPC.
///
/// Why fork instead of local mock: Arbitrum Sepolia's Aave testnet has unpredictable
/// liquidity and sometimes zero supply APR. Mainnet fork gives realistic behavior.
contract AaveLendingForkTest is Test {
    // Arbitrum mainnet addresses (NOT Sepolia)
    address constant AAVE_V3_POOL_ARBITRUM = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address constant USDC_ARBITRUM = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831; // Native USDC
    address constant USDC_WHALE = 0x489ee077994B6658eAfA855C308275EAd8097C4A; // GMX vault, holds millions of USDC

    RentalEscrow escrow;
    PropDepEscrow propDep;
    AaveAdapter adapter;

    address tenant = address(0x1111);
    address landlord = address(0x2222);
    address treasury = address(0x3333);

    uint256 constant MONTHLY_RENT = 1000 * 1e6; // 1000 USDC
    uint256 constant COMMITMENT = 1000 * 1e6;   // 1x MR
    uint256 constant HOSTING = 1000 * 1e6;      // 1x MR

    function setUp() public {
        // Only run on Arbitrum mainnet fork — skip gracefully otherwise
        // Check: does USDC contract have code at the expected address?
        uint256 codeSize;
        assembly { codeSize := extcodesize(0xaf88d065e77c8cC2239327C5EDb3A432268e5831) }
        if (codeSize == 0) {
            // Not on fork — skip all tests
            vm.skip(true);
            return;
        }

        escrow = new RentalEscrow(USDC_ARBITRUM, treasury);
        propDep = new PropDepEscrow(USDC_ARBITRUM, address(escrow));
        escrow.setPropDepEscrow(address(propDep));

        adapter = new AaveAdapter(address(escrow), AAVE_V3_POOL_ARBITRUM, USDC_ARBITRUM);
        escrow.setLendingAdapter(address(adapter));
        escrow.emergencyEnableLending(); // turn on lendingEnabled

        // Fund tenant and landlord with USDC from the whale
        vm.startPrank(USDC_WHALE);
        IERC20(USDC_ARBITRUM).transfer(tenant, MONTHLY_RENT + COMMITMENT);
        IERC20(USDC_ARBITRUM).transfer(landlord, HOSTING);
        vm.stopPrank();
    }

    function _createAgreement() internal returns (uint256 id) {
        vm.prank(tenant);
        id = escrow.createAgreement(tenant, landlord, MONTHLY_RENT, 0, 6, bytes32(0));
    }

    function test_fork_tenantDepositAndActivation_suppliesToAave() public {
        uint256 id = _createAgreement();

        vm.startPrank(tenant);
        IERC20(USDC_ARBITRUM).approve(address(escrow), MONTHLY_RENT + COMMITMENT);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        vm.startPrank(landlord);
        IERC20(USDC_ARBITRUM).approve(address(escrow), HOSTING);
        escrow.landlordDeposit(id);
        vm.stopPrank();

        (uint256 principal, uint256 scaledBalance) = escrow.lendingPositions(id);
        assertGt(principal, 0, "principal should be > 0 after activation");
        assertGt(scaledBalance, 0, "scaledBalance should be set");

        // bufferBps=0 default → 100% of (commitment + hosting) in Aave
        uint256 lendable = COMMITMENT + HOSTING;
        assertEq(principal, lendable, "should supply 100% (bufferBps=0)");
    }

    function test_fork_endLease_distributesYieldWith70_30Split() public {
        uint256 id = _createAgreement();

        vm.startPrank(tenant);
        IERC20(USDC_ARBITRUM).approve(address(escrow), MONTHLY_RENT + COMMITMENT);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        vm.startPrank(landlord);
        IERC20(USDC_ARBITRUM).approve(address(escrow), HOSTING);
        escrow.landlordDeposit(id);
        vm.stopPrank();

        // Warp forward 6 months so yield accrues
        vm.warp(block.timestamp + 180 days);

        uint256 tenantBalBefore = IERC20(USDC_ARBITRUM).balanceOf(tenant);
        uint256 landlordBalBefore = IERC20(USDC_ARBITRUM).balanceOf(landlord);
        uint256 treasuryBalBefore = IERC20(USDC_ARBITRUM).balanceOf(treasury);

        escrow.endLease(id);

        uint256 tenantGot = IERC20(USDC_ARBITRUM).balanceOf(tenant) - tenantBalBefore;
        uint256 landlordGot = IERC20(USDC_ARBITRUM).balanceOf(landlord) - landlordBalBefore;
        uint256 treasuryGot = IERC20(USDC_ARBITRUM).balanceOf(treasury) - treasuryBalBefore;

        // Both parties get at least their principal back.
        assertGe(tenantGot, COMMITMENT, "tenant got at least commitment");
        assertGe(landlordGot, HOSTING, "landlord got at least hosting");

        // Total yield = tenantExtra + landlordExtra + treasury
        uint256 totalYield = (tenantGot - COMMITMENT) + (landlordGot - HOSTING) + treasuryGot;
        // If yield was accrued, protocol should get ~30% of it
        if (totalYield > 0) {
            // protocolFeeBps = 3000 → 30%
            uint256 expectedProtocol = (totalYield * 3000) / 10000;
            // Allow 1 wei tolerance for integer division
            assertApproxEqAbs(treasuryGot, expectedProtocol, 1, "protocol got ~30% of yield");
            // Tenant and landlord share the 70% userYield roughly evenly
            uint256 tenantExtra = tenantGot - COMMITMENT;
            uint256 landlordExtra = landlordGot - HOSTING;
            // tenant gets rounding dust, so tenantExtra >= landlordExtra
            assertGe(tenantExtra, landlordExtra, "tenant's yield share >= landlord's (dust)");
            assertApproxEqAbs(tenantExtra, landlordExtra, 1, "user yield split 50/50 within 1 wei");
        }

        // Position should be cleared
        (uint256 principalAfter, ) = escrow.lendingPositions(id);
        assertEq(principalAfter, 0, "lending position cleared on settle");
    }

    function test_fork_flagRentMissed_forfeitsEverythingToLandlord() public {
        uint256 id = _createAgreement();

        vm.startPrank(tenant);
        IERC20(USDC_ARBITRUM).approve(address(escrow), MONTHLY_RENT + COMMITMENT);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        vm.startPrank(landlord);
        IERC20(USDC_ARBITRUM).approve(address(escrow), HOSTING);
        escrow.landlordDeposit(id);
        vm.stopPrank();
        // Agreement active, funds in Aave

        // Warp past rent due + grace period (30 + 5 days)
        vm.warp(block.timestamp + 40 days);

        uint256 landlordBalBefore = IERC20(USDC_ARBITRUM).balanceOf(landlord);
        uint256 tenantBalBefore = IERC20(USDC_ARBITRUM).balanceOf(tenant);
        uint256 treasuryBalBefore = IERC20(USDC_ARBITRUM).balanceOf(treasury);

        escrow.flagRentMissed(id);

        uint256 landlordGot = IERC20(USDC_ARBITRUM).balanceOf(landlord) - landlordBalBefore;
        uint256 tenantGot = IERC20(USDC_ARBITRUM).balanceOf(tenant) - tenantBalBefore;
        uint256 treasuryGot = IERC20(USDC_ARBITRUM).balanceOf(treasury) - treasuryBalBefore;

        // Landlord gets ALL principal + all user yield (100% forfeit)
        assertGe(landlordGot, COMMITMENT + HOSTING, "landlord got at least both principals");
        // Tenant gets nothing
        assertEq(tenantGot, 0, "tenant lost everything on rent miss");
        // Protocol still gets 30% of any yield
        uint256 totalYield = (landlordGot - COMMITMENT - HOSTING) + treasuryGot;
        if (totalYield > 0) {
            uint256 expectedProtocol = (totalYield * 3000) / 10000;
            assertApproxEqAbs(treasuryGot, expectedProtocol, 1, "protocol got ~30% of yield");
        }

        (uint256 principalAfter, ) = escrow.lendingPositions(id);
        assertEq(principalAfter, 0, "lending position cleared after forfeit");
    }

    function test_fork_topUpDeposit_increasesPosition() public {
        uint256 id = _createAgreement();

        vm.startPrank(tenant);
        IERC20(USDC_ARBITRUM).approve(address(escrow), MONTHLY_RENT + COMMITMENT);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        vm.startPrank(landlord);
        IERC20(USDC_ARBITRUM).approve(address(escrow), HOSTING);
        escrow.landlordDeposit(id);
        vm.stopPrank();

        (uint256 principalBefore, uint256 scaledBefore) = escrow.lendingPositions(id);

        // Warp forward so some yield accrues — this changes the index
        vm.warp(block.timestamp + 30 days);

        // Tenant tops up 500 USDC
        uint256 topUpAmount = 500 * 1e6;
        vm.startPrank(USDC_WHALE);
        IERC20(USDC_ARBITRUM).transfer(tenant, topUpAmount);
        vm.stopPrank();
        vm.startPrank(tenant);
        IERC20(USDC_ARBITRUM).approve(address(escrow), topUpAmount);
        escrow.topUpDeposit(id, topUpAmount);
        vm.stopPrank();

        (uint256 principalAfter, uint256 scaledAfter) = escrow.lendingPositions(id);
        assertEq(principalAfter, principalBefore + topUpAmount, "principal increased by top-up amount");
        assertGt(scaledAfter, scaledBefore, "scaledBalance increased");
        // At a higher index, topUp adds LESS scaled than the initial supply would have
        // (same USDC → smaller scaled delta). Just verify it's positive and sensible.
        assertLt(scaledAfter - scaledBefore, topUpAmount, "scaled delta < raw USDC amount");
    }

    function test_fork_emergencyDisable_keepsExistingPositionsUntouched() public {
        uint256 id = _createAgreement();

        vm.startPrank(tenant);
        IERC20(USDC_ARBITRUM).approve(address(escrow), MONTHLY_RENT + COMMITMENT);
        escrow.tenantDeposit(id);
        vm.stopPrank();

        vm.startPrank(landlord);
        IERC20(USDC_ARBITRUM).approve(address(escrow), HOSTING);
        escrow.landlordDeposit(id);
        vm.stopPrank();

        (uint256 principalBefore, ) = escrow.lendingPositions(id);
        assertGt(principalBefore, 0);

        // Disable lending — existing position must stay
        escrow.emergencyDisableLending();
        assertEq(escrow.lendingEnabled(), false);

        (uint256 principalAfter, ) = escrow.lendingPositions(id);
        assertEq(principalAfter, principalBefore, "existing position untouched by disable");
    }
}
