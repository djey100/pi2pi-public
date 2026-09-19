// Level 5: Interaction tests — component render + user actions with mocked API/blockchain
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock wallet.js
vi.mock('../wallet.js', () => ({
  withWalletLock: vi.fn((fn) => fn()),
  encBytes32: vi.fn(() => '0x' + '0'.repeat(64)),
  sysMsg: vi.fn(),
  rpcCall: vi.fn(() => Promise.resolve('0x')),
  ethCallRpc: vi.fn(() => Promise.resolve('0x' + '0'.repeat(64))),
  getGasPrice: vi.fn(() => Promise.resolve('0x3B9ACA00')),
  getProvider: vi.fn(() => null),
  readUsdcBalance: vi.fn(() => Promise.resolve(100)),
  getMyUsdcBalance: vi.fn(() => Promise.resolve(100)),
  checkUsdcBalance: vi.fn(() => Promise.resolve({ enough: true, balance: 100 })),
  sendTxRaw: vi.fn(() => Promise.resolve('0x' + 'a'.repeat(64))),
  waitReceipt: vi.fn(() => Promise.resolve({ status: '0x1' })),
}));

// Mock fetch
beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn((url) => {
    if (typeof url !== 'string') url = String(url);
    if (url.includes('/api/listings')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/users')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
    if (url.includes('/api/city-settings')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/active-contract')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    if (url.includes('/api/inbox')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/messages')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/user-status')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    if (url.includes('/api/contract')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    if (url.includes('/api/viewing')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/tenant')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('/api/archived')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    if (url.includes('rpc.testnet.arc')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x0' }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
  });
});

// ─── UI Component Tests ──────────────────────────────────────────────────────

describe('Dropdown interaction', () => {
  it('opens on click and selects option', async () => {
    const { default: Dropdown } = await import('../components/ui/Dropdown.jsx');
    const onChange = vi.fn();
    const { container } = render(
      <Dropdown
        value=""
        options={[{value:"a", label:"Alpha"}, {value:"b", label:"Beta"}]}
        onChange={onChange}
        placeholder="Pick one"
      />
    );
    // Should show placeholder
    expect(container.textContent).toContain('Pick one');
    // Click to open
    const button = container.querySelector('button');
    fireEvent.click(button);
    // Options should appear
    expect(container.textContent).toContain('Alpha');
    expect(container.textContent).toContain('Beta');
    // Click option
    const options = container.querySelectorAll('div[style]');
    const alphaOpt = Array.from(options).find(el => el.textContent === 'Alpha');
    if (alphaOpt) fireEvent.click(alphaOpt);
    expect(onChange).toHaveBeenCalledWith('a');
  });
});

describe('WarningModal interaction', () => {
  it('renders title and calls onConfirm/onCancel', async () => {
    const { default: WarningModal } = await import('../components/ui/WarningModal.jsx');
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <WarningModal
        title="Delete?"
        message="This is permanent"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    expect(container.textContent).toContain('Delete?');
    expect(container.textContent).toContain('This is permanent');
    // Find buttons
    const buttons = container.querySelectorAll('button');
    // Cancel button (first)
    fireEvent.click(buttons[0]);
    expect(onCancel).toHaveBeenCalled();
    // Confirm button (second)
    fireEvent.click(buttons[1]);
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('InfoTip', () => {
  it('renders ? button', async () => {
    const { default: InfoTip } = await import('../components/ui/InfoTip.jsx');
    const { container } = render(<InfoTip text="Helpful info here" />);
    expect(container.textContent).toContain('?');
  });
});

describe('Toast component', () => {
  it('renders message and is clickable', async () => {
    const { Toast } = await import('../components/ui/Toast.jsx');
    const onClose = vi.fn();
    const { container } = render(<Toast msg="Saved!" kind="success" onClose={onClose} />);
    expect(container.textContent).toContain('Saved!');
    // Click to dismiss
    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('DealStateBanner', () => {
  it('renders state label and detail', async () => {
    const { default: DealStateBanner } = await import('../components/ui/DealStateBanner.jsx');
    const { container } = render(
      <DealStateBanner
        view={{ label: "ACTIVE", detail: "Month 3 of 6", tone: "success" }}
        nextStep={null}
      />
    );
    expect(container.textContent).toContain('ACTIVE');
    expect(container.textContent).toContain('Month 3 of 6');
  });

  it('renders next step when provided', async () => {
    const { default: DealStateBanner } = await import('../components/ui/DealStateBanner.jsx');
    const { container } = render(
      <DealStateBanner
        view={{ label: "ENDING", detail: "5 days left", tone: "warning" }}
        nextStep={{ text: "Vote on renewal", who: "both" }}
      />
    );
    expect(container.textContent).toContain('Vote on renewal');
  });
});

describe('RepScore', () => {
  it('renders viewings/contracts/disputes counts', async () => {
    const { default: RepScore } = await import('../components/ui/RepScore.jsx');
    const { container } = render(
      <RepScore viewings={12} rentals={5} disputes={1} />
    );
    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('5');
    expect(container.textContent).toContain('1');
  });
});

describe('StepHeader', () => {
  it('renders correct number of step indicators', async () => {
    const { default: StepHeader } = await import('../components/ui/StepHeader.jsx');
    const { container } = render(<StepHeader step={2} total={5} />);
    // StepHeader renders a flex container with N children
    const wrapper = container.firstChild;
    expect(wrapper.children.length).toBe(5);
  });
});

// ─── API Client Tests ────────────────────────────────────────────────────────

describe('API Client', () => {
  it('getListings calls correct endpoint', async () => {
    const { getListings } = await import('../api/client.js');
    await getListings({ status: 'active' });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/listings?status=active'), expect.anything());
  });

  it('createListing sends POST', async () => {
    const { createListing } = await import('../api/client.js');
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ id: '123' }) }));
    const result = await createListing({ owner_addr: '0xabc', monthly_rent: 500 });
    expect(result.id).toBe('123');
    expect(global.fetch).toHaveBeenCalledWith('/api/listings', expect.objectContaining({ method: 'POST' }));
  });

  it('saveContractForm sends POST with correct body', async () => {
    const { saveContractForm } = await import('../api/client.js');
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    await saveContractForm({ addr: '0xabc', peerAddr: '0xdef', field: 'terms', value: { rent: 500 } });
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[0]).toBe('/api/contract-form');
    const body = JSON.parse(callArgs[1].body);
    expect(body.addr).toBe('0xabc');
    expect(body.field).toBe('terms');
  });

  it('archiveContract calls correct endpoint', async () => {
    const { archiveContract } = await import('../api/client.js');
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    await archiveContract('0xABC123');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/active-contract/0xabc123/archive',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('respondViewingRequest sends PATCH', async () => {
    const { respondViewingRequest } = await import('../api/client.js');
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    await respondViewingRequest('vr123', { status: 'confirmed' });
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[0]).toBe('/api/viewing-request/vr123');
    expect(callArgs[1].method).toBe('PATCH');
  });
});
