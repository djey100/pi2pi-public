// Tests for TASK 10Y's fix: WalletModal.jsx hides the Circle Smart Wallet
// option entirely when isCircleSupported(ACTIVE_NETWORK_NAME) is false
// (currently arc-mainnet), closing the UX gap found in TASK 10V — wallet.js
// already fail-closed blocks the connection attempt itself (TASK 9A), but
// the button was still shown, letting a Mainnet user click it and hit a
// thrown error instead of never seeing the option at all.
//
// isCircleSupported itself is mocked here (network-name → boolean is
// already covered by network-config.test.js / helpers.js's own tests) —
// this file only verifies WalletModal reads the real, shared
// isCircleSupported/ACTIVE_NETWORK_NAME from helpers.js and renders
// accordingly, not a second/duplicate network check.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import WalletModal from '../components/WalletModal.jsx';
import { isCircleSupported, ACTIVE_NETWORK_NAME } from '../helpers.js';

vi.mock('../helpers.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isCircleSupported: vi.fn() };
});

describe('WalletModal — Circle Smart Wallet visibility gated by isCircleSupported (TASK 10Y)', () => {
  beforeEach(() => {
    isCircleSupported.mockReset();
  });

  it('arc-testnet (isCircleSupported → true): Circle option is visible', () => {
    isCircleSupported.mockReturnValue(true);
    render(<WalletModal onClose={() => {}} onConnected={() => {}} />);
    expect(screen.getByAltText('Circle')).toBeInTheDocument();
    // Called with the real, shared ACTIVE_NETWORK_NAME — not a separately
    // re-derived value inside the component.
    expect(isCircleSupported).toHaveBeenCalledWith(ACTIVE_NETWORK_NAME);
  });

  it('arc-mainnet (isCircleSupported → false): Circle option is absent entirely (not just disabled)', () => {
    isCircleSupported.mockReturnValue(false);
    render(<WalletModal onClose={() => {}} onConnected={() => {}} />);
    expect(screen.queryByAltText('Circle')).not.toBeInTheDocument();
  });

  it('MetaMask and WalletConnect options are unaffected when Circle is hidden', () => {
    isCircleSupported.mockReturnValue(false);
    render(<WalletModal onClose={() => {}} onConnected={() => {}} />);
    expect(screen.getByAltText('MetaMask')).toBeInTheDocument();
    expect(screen.getByAltText('WalletConnect')).toBeInTheDocument();
  });

  it('MetaMask and WalletConnect options are also present when Circle is visible (no regression to the other two)', () => {
    isCircleSupported.mockReturnValue(true);
    render(<WalletModal onClose={() => {}} onConnected={() => {}} />);
    expect(screen.getByAltText('MetaMask')).toBeInTheDocument();
    expect(screen.getByAltText('WalletConnect')).toBeInTheDocument();
  });
});
