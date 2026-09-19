// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DeployMockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
}

/// @title Deploy script network-selection tests
/// @notice Covers the fail-closed chain resolver added to eliminate the old
///         "unknown chain silently falls back to Arbitrum Sepolia" behavior.
///         Arc Mainnet in particular must never receive Arbitrum Sepolia's
///         USDC/Aave configuration, and must never receive any *guessed*
///         default of its own — it has no verified address yet, so it is
///         routed through the env-required path instead of a constant.
///         Also covers TASK 3B's post-deployment verification (_verifyPostDeployment).
contract DeployScriptTest is Test {
    Deploy deploy;

    address constant USDC_ARC_TESTNET = 0x3600000000000000000000000000000000000000;
    address constant USDC_ARBITRUM_SEPOLIA = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    address constant AAVE_V3_POOL_ARBITRUM_SEPOLIA = 0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff;

    uint256 constant CHAIN_ARC_TESTNET = 5042002;
    uint256 constant CHAIN_ARC_MAINNET = 5042;
    uint256 constant CHAIN_ARBITRUM_SEPOLIA = 421614;

    address treasury = makeAddr("deployTreasury");

    function setUp() public {
        deploy = new Deploy();
    }

    function test_ArcTestnetRecognized() public view {
        (address defaultUsdc, bool aaveSupported, address aavePool, bool usdcRequiresEnv) =
            deploy._networkConfig(CHAIN_ARC_TESTNET);

        assertEq(defaultUsdc, USDC_ARC_TESTNET, "wrong default USDC for Arc Testnet");
        assertFalse(aaveSupported, "Aave must stay disabled on Arc Testnet (no Aave deployment there)");
        assertEq(aavePool, address(0));
        assertFalse(usdcRequiresEnv, "Arc Testnet has a verified default, should not require env");
    }

    function test_ArcMainnetRecognized_NoGuessedDefault() public view {
        (address defaultUsdc, bool aaveSupported, address aavePool, bool usdcRequiresEnv) =
            deploy._networkConfig(CHAIN_ARC_MAINNET);

        assertEq(defaultUsdc, address(0), "must NOT provide any default/guessed USDC for Arc Mainnet");
        assertFalse(aaveSupported, "Aave must stay disabled on Arc Mainnet until a verified pool exists");
        assertEq(aavePool, address(0));
        assertTrue(usdcRequiresEnv, "Arc Mainnet must require an explicit, pre-verified USDC_ADDRESS");
    }

    function test_ArbitrumSepoliaRecognized() public view {
        (address defaultUsdc, bool aaveSupported, address aavePool, bool usdcRequiresEnv) =
            deploy._networkConfig(CHAIN_ARBITRUM_SEPOLIA);

        assertEq(defaultUsdc, USDC_ARBITRUM_SEPOLIA);
        assertTrue(aaveSupported, "Arbitrum Sepolia legacy path must keep deploying AaveAdapter");
        assertEq(aavePool, AAVE_V3_POOL_ARBITRUM_SEPOLIA);
        assertFalse(usdcRequiresEnv);
    }

    function test_UnsupportedChain_FailsClosed() public {
        // Ethereum mainnet — never explicitly supported by this script.
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, uint256(1)));
        deploy._networkConfig(1);
    }

    function test_UnsupportedChain_ArbitraryUnknownId_FailsClosed() public {
        uint256 randomUnknownChainId = 999999;
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, randomUnknownChainId));
        deploy._networkConfig(randomUnknownChainId);
    }

    /// @notice Regression guard: Arc Mainnet's resolved config must never equal
    ///         Arbitrum Sepolia's — this is the exact bug the old ternary had.
    function test_ArcMainnetNeverEqualsArbitrumSepoliaConfig() public view {
        (address mainnetUsdc,,, bool mainnetRequiresEnv) = deploy._networkConfig(CHAIN_ARC_MAINNET);
        (address sepoliaUsdc,,,) = deploy._networkConfig(CHAIN_ARBITRUM_SEPOLIA);

        assertTrue(
            mainnetRequiresEnv || mainnetUsdc != sepoliaUsdc,
            "Arc Mainnet must not silently inherit Arbitrum Sepolia's USDC address"
        );
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  TASK 3B — _verifyPostDeployment (post-link, read-only, no broadcast)
    // ═════════════════════════════════════════════════════════════════════════

    function _deployPair() internal returns (RentalEscrow escrow, PropDepEscrow propDep) {
        DeployMockUSDC usdc = new DeployMockUSDC();
        escrow = new RentalEscrow(address(usdc), treasury);
        propDep = new PropDepEscrow(address(usdc), address(escrow));
        escrow.setPropDepEscrow(address(propDep));
    }

    function test_verifyPostDeployment_passesForCorrectlyLinkedArcMainnetPair() public {
        vm.chainId(CHAIN_ARC_MAINNET);
        (RentalEscrow escrow, PropDepEscrow propDep) = _deployPair();
        // Must not revert.
        deploy._verifyPostDeployment(escrow, propDep, CHAIN_ARC_MAINNET);
    }

    function test_verifyPostDeployment_passesForCorrectlyLinkedArcTestnetPair() public {
        vm.chainId(CHAIN_ARC_TESTNET);
        (RentalEscrow escrow, PropDepEscrow propDep) = _deployPair();
        // Must not revert — devMode/lendingAdapter checks are Arc-Mainnet-only.
        deploy._verifyPostDeployment(escrow, propDep, CHAIN_ARC_TESTNET);
    }

    function test_verifyPostDeployment_revertsOnWrongPropDepLink() public {
        vm.chainId(CHAIN_ARC_MAINNET);
        (RentalEscrow escrow,) = _deployPair();
        // A second, unlinked PropDepEscrow — escrow.propDepEscrow() still points at the first one.
        DeployMockUSDC usdc2 = new DeployMockUSDC();
        PropDepEscrow wrongPropDep = new PropDepEscrow(address(usdc2), address(escrow));

        vm.expectRevert(abi.encodeWithSelector(
            Deploy.DeploymentVerificationFailed.selector,
            "RentalEscrow.propDepEscrow() does not match the deployed PropDepEscrow"
        ));
        deploy._verifyPostDeployment(escrow, wrongPropDep, CHAIN_ARC_MAINNET);
    }

    function test_verifyPostDeployment_revertsOnWrongMainContractLink() public {
        vm.chainId(CHAIN_ARC_MAINNET);
        DeployMockUSDC usdc = new DeployMockUSDC();
        RentalEscrow escrow = new RentalEscrow(address(usdc), treasury);
        RentalEscrow otherEscrow = new RentalEscrow(address(usdc), treasury);

        // Constructed against a DIFFERENT RentalEscrow, then (mistakenly)
        // linked to `escrow` anyway. setPropDepEscrow itself never validates
        // the target's own mainContract, so this is a realistic operator/
        // deploy-script error the audit's linkage check exists to catch —
        // the first check (escrow.propDepEscrow() == propDep) passes here,
        // isolating the second check (propDep.mainContract() == escrow).
        PropDepEscrow mismatchedPropDep = new PropDepEscrow(address(usdc), address(otherEscrow));
        escrow.setPropDepEscrow(address(mismatchedPropDep));

        vm.expectRevert(abi.encodeWithSelector(
            Deploy.DeploymentVerificationFailed.selector,
            "PropDepEscrow.mainContract() does not match the deployed RentalEscrow"
        ));
        deploy._verifyPostDeployment(escrow, mismatchedPropDep, CHAIN_ARC_MAINNET);
    }

    function test_verifyPostDeployment_revertsIfDevModeTrueOnArcMainnet() public {
        // Deploy on a whitelisted test chain (devMode == true there), then verify
        // AS IF chainId were Arc Mainnet — exercises the devMode-mismatch branch
        // without needing to fabricate an actually-broken mainnet deployment
        // (which the contracts' own chain-derived devMode logic prevents).
        vm.chainId(CHAIN_ARC_TESTNET);
        (RentalEscrow escrow, PropDepEscrow propDep) = _deployPair();
        assertTrue(escrow.devMode(), "sanity: devMode should be true on the whitelisted test chain");

        vm.expectRevert(abi.encodeWithSelector(
            Deploy.DeploymentVerificationFailed.selector,
            "RentalEscrow.devMode() is true on Arc Mainnet"
        ));
        deploy._verifyPostDeployment(escrow, propDep, CHAIN_ARC_MAINNET);
    }

    function test_verifyPostDeployment_revertsIfLendingAdapterSetOnArcMainnet() public {
        vm.chainId(CHAIN_ARC_MAINNET);
        (RentalEscrow escrow, PropDepEscrow propDep) = _deployPair();

        // Wire a real (if arbitrary) adapter address — no lending is enabled,
        // just an adapter being set is enough to fail this check.
        escrow.setLendingAdapter(makeAddr("someAdapter"));

        vm.expectRevert(abi.encodeWithSelector(
            Deploy.DeploymentVerificationFailed.selector,
            "lendingAdapter is not zero on Arc Mainnet"
        ));
        deploy._verifyPostDeployment(escrow, propDep, CHAIN_ARC_MAINNET);
    }

    function test_verifyPostDeployment_revertsIfLendingEnabled() public {
        vm.chainId(CHAIN_ARC_TESTNET);
        (RentalEscrow escrow, PropDepEscrow propDep) = _deployPair();
        escrow.setLendingAdapter(makeAddr("someAdapter"));
        escrow.emergencyEnableLending();

        vm.expectRevert(abi.encodeWithSelector(
            Deploy.DeploymentVerificationFailed.selector,
            "lendingEnabled is true immediately after deployment"
        ));
        deploy._verifyPostDeployment(escrow, propDep, CHAIN_ARC_TESTNET);
    }

    /// @notice Full integration: run() itself, on Arc Mainnet, must deploy, link,
    ///         and pass its own internal post-deployment verification without
    ///         reverting. No real broadcast occurs — forge test never sends
    ///         anything to a live network regardless of vm.startBroadcast().
    function test_run_ArcMainnet_deploysAndVerifiesSuccessfully() public {
        vm.chainId(CHAIN_ARC_MAINNET);
        DeployMockUSDC usdc = new DeployMockUSDC();
        vm.setEnv("USDC_ADDRESS", vm.toString(address(usdc)));
        vm.setEnv("TREASURY_ADDRESS", vm.toString(treasury));

        deploy.run();
    }
}
