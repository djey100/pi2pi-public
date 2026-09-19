// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {RentalEscrow} from "../src/RentalEscrow.sol";
import {PropDepEscrow} from "../src/PropDepEscrow.sol";
import {AaveAdapter} from "../src/AaveAdapter.sol";

contract Deploy is Script {
    // ─── Explicit chain IDs — no implicit/default network is ever assumed ──────
    uint256 constant CHAIN_ARC_TESTNET = 5042002;
    uint256 constant CHAIN_ARC_MAINNET = 5042;
    uint256 constant CHAIN_ARBITRUM_SEPOLIA = 421614;

    // USDC addresses — only defined for chains with a verified address in this repo.
    address constant USDC_ARC_TESTNET = 0x3600000000000000000000000000000000000000;
    address constant USDC_ARBITRUM_SEPOLIA = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    // Arc Mainnet USDC is intentionally NOT defined here — no address has been
    // verified in this repository. See _networkConfig().

    // Aave V3 Pool — verified only for Arbitrum Sepolia (legacy dev/test path).
    address constant AAVE_V3_POOL_ARBITRUM_SEPOLIA = 0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff;

    /// @notice Thrown for any chain ID this script does not explicitly recognize.
    ///         Fail-closed: an unrecognized chain must never silently inherit
    ///         another network's USDC/Aave configuration.
    error UnsupportedChain(uint256 chainId);

    /// @notice Resolves per-network deploy config. Pure and side-effect free so
    ///         it can be unit tested in isolation (see DeployScript.t.sol).
    /// @dev    No `else` branch reuses another chain's values — each supported
    ///         chain is listed explicitly, and anything else reverts.
    /// @return defaultUsdc      Default USDC address to use if USDC_ADDRESS env is unset.
    ///                          Only meaningful when usdcRequiresEnv is false.
    /// @return aaveSupported    Whether to deploy + wire an AaveAdapter.
    /// @return aavePool         Aave V3 Pool address to use when aaveSupported is true.
    /// @return usdcRequiresEnv  When true, there is no safe default — USDC_ADDRESS
    ///                          MUST be supplied by the caller (out-of-band verified)
    ///                          or the run reverts. Used for Arc Mainnet, where no
    ///                          USDC address has been verified in this repository.
    function _networkConfig(uint256 chainId)
        public
        pure
        returns (address defaultUsdc, bool aaveSupported, address aavePool, bool usdcRequiresEnv)
    {
        if (chainId == CHAIN_ARC_TESTNET) {
            return (USDC_ARC_TESTNET, false, address(0), false);
        }
        if (chainId == CHAIN_ARBITRUM_SEPOLIA) {
            return (USDC_ARBITRUM_SEPOLIA, true, AAVE_V3_POOL_ARBITRUM_SEPOLIA, false);
        }
        if (chainId == CHAIN_ARC_MAINNET) {
            // No verified USDC or Aave pool address for Arc Mainnet exists in this
            // repository yet. Refuse to guess — caller must supply a pre-verified
            // USDC_ADDRESS. Aave adapter deployment is unsupported here until an
            // Arc Mainnet Aave pool address is explicitly verified and added.
            return (address(0), false, address(0), true);
        }
        revert UnsupportedChain(chainId);
    }

    /// @notice Thrown when a post-deployment sanity check fails. Read-only —
    ///         this function never broadcasts or signs anything; it only
    ///         re-reads already-deployed contract state and reverts if
    ///         something looks wrong, so a bad link or config mistake is
    ///         caught immediately after deploy instead of silently shipping.
    error DeploymentVerificationFailed(string reason);

    /// @notice Read-only post-deployment verification. Pure view over
    ///         already-deployed contracts — takes chainId as an explicit
    ///         parameter (rather than reading block.chainid itself) so it can
    ///         be exercised directly from tests against any constructed pair,
    ///         not only via a full run() broadcast.
    /// @dev    Does NOT attempt to derive or verify the broadcaster/owner
    ///         address — that requires no private-key introspection per the
    ///         audit's explicit instruction, and escrow.owner() is already
    ///         directly readable by the deployer off-chain if desired.
    function _verifyPostDeployment(RentalEscrow escrow, PropDepEscrow propDep, uint256 chainId) public view {
        if (address(escrow.propDepEscrow()) != address(propDep)) {
            revert DeploymentVerificationFailed("RentalEscrow.propDepEscrow() does not match the deployed PropDepEscrow");
        }
        if (propDep.mainContract() != address(escrow)) {
            revert DeploymentVerificationFailed("PropDepEscrow.mainContract() does not match the deployed RentalEscrow");
        }
        if (chainId == CHAIN_ARC_MAINNET) {
            if (escrow.devMode()) {
                revert DeploymentVerificationFailed("RentalEscrow.devMode() is true on Arc Mainnet");
            }
            if (propDep.devMode()) {
                revert DeploymentVerificationFailed("PropDepEscrow.devMode() is true on Arc Mainnet");
            }
            if (address(escrow.lendingAdapter()) != address(0)) {
                revert DeploymentVerificationFailed("lendingAdapter is not zero on Arc Mainnet");
            }
        }
        if (escrow.lendingEnabled()) {
            revert DeploymentVerificationFailed("lendingEnabled is true immediately after deployment");
        }
    }

    function run() external {
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint256 chainId = block.chainid;

        (address defaultUsdc, bool aaveSupported, address aavePool, bool usdcRequiresEnv) =
            _networkConfig(chainId);

        // Fail closed: on chains with no verified default (Arc Mainnet today),
        // vm.envAddress reverts if USDC_ADDRESS is not explicitly supplied.
        address usdc = usdcRequiresEnv ? vm.envAddress("USDC_ADDRESS") : vm.envOr("USDC_ADDRESS", defaultUsdc);

        console.log("Chain ID:", chainId);
        console.log("Deployer:", msg.sender);
        console.log("USDC:", usdc);
        console.log("Treasury:", treasury);

        vm.startBroadcast();

        // 1. Deploy main RentalEscrow
        RentalEscrow escrow = new RentalEscrow(usdc, treasury);
        console.log("RentalEscrow deployed at:", address(escrow));

        // 2. Deploy PropDepEscrow with main address
        PropDepEscrow propDep = new PropDepEscrow(usdc, address(escrow));
        console.log("PropDepEscrow deployed at:", address(propDep));

        // 3. Wire main to PropDepEscrow
        escrow.setPropDepEscrow(address(propDep));
        console.log("Main wired to PropDepEscrow");

        // 3b. Read-only post-link verification — catches a bad link or an
        //     unexpected devMode/lending state immediately, before anyone
        //     uses the contracts. Issues no transactions.
        _verifyPostDeployment(escrow, propDep, chainId);
        console.log("Post-deployment verification passed");

        // 4. (Sprint 3a) Deploy AaveAdapter only on chains with a verified Aave pool.
        //    Adapter is set but lendingEnabled stays false until Sprint 3b is implemented.
        if (aaveSupported) {
            AaveAdapter adapter = new AaveAdapter(address(escrow), aavePool, usdc);
            console.log("AaveAdapter deployed at:", address(adapter));
            escrow.setLendingAdapter(address(adapter));
            console.log("RentalEscrow wired to AaveAdapter (lendingEnabled=false until 3b)");
        } else {
            console.log("Skipping Aave adapter deployment - not supported on this chain");
        }

        vm.stopBroadcast();

        console.log("---");
        console.log("RentalEscrow:  ", address(escrow));
        console.log("PropDepEscrow: ", address(propDep));
        console.log("Owner:         ", escrow.owner());
    }
}
