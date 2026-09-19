// Circle Modular Wallets SDK — lazy-loaded by Vite as separate chunk.
// Only imported when user clicks Circle wallet button.

export { toModularTransport, toPasskeyTransport, toWebAuthnCredential, toCircleSmartAccount, toCircleModularWalletClient, modularWalletActions, WebAuthnMode } from '@circle-fin/modular-wallets-core';
export { createPublicClient, defineChain, parseEther } from 'viem';
export { createBundlerClient, toWebAuthnAccount } from 'viem/account-abstraction';
