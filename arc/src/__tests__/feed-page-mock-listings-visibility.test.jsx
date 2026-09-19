// Tests for TASK 10AJ's fix: FeedPage.jsx only renders the static demo/mock
// listings from mocks.js when ACTIVE_NETWORK_NAME === 'arc-testnet'. On
// arc-mainnet, with zero real listings (TASK 10AI's investigation), the
// marketplace previously looked populated with fictional Tbilisi/Da Nang/
// Buenos Aires properties because LISTINGS was rendered unconditionally
// alongside realListings. Real, API-backed listings are unaffected on both
// networks — this only gates the static mocks.js import.
//
// Distinguishing marker used throughout: mock listings' image paths
// (/images/tbilisi-sunset.jpg etc., from mocks.js) are unique literals no
// real listing could ever have (real listings use Supabase/IPFS photo
// URLs) — a more reliable signal than location/price text, which can
// coincidentally overlap between real and mock data (both default to
// "Tbilisi, Georgia" in some code paths).
//
// ACTIVE_NETWORK_NAME is mocked via a getter so its value can change
// per-test without needing vi.resetModules()/dynamic re-import — FeedPage.jsx
// reads it fresh on every render (it's referenced directly in JSX, not
// captured into a computed module-level constant), so a mutable getter is
// sufficient and simpler than the wallet.js-style dynamic-import pattern
// used elsewhere in this suite.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FeedPage from '../components/FeedPage.jsx';

let mockActiveNetworkName = 'arc-testnet';

vi.mock('../helpers.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    get ACTIVE_NETWORK_NAME() { return mockActiveNetworkName; },
  };
});

vi.mock('../api/client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getListings: vi.fn(),
    getActiveContracts: vi.fn(),
    getTenantRequests: vi.fn(),
  };
});

import { getListings, getActiveContracts, getTenantRequests } from '../api/client.js';

const MOCK_LISTING_IMAGE = '/images/tbilisi-sunset.jpg'; // mocks.js LISTINGS[0].image
const mockImgSelector = () => document.querySelector(`img[src="${MOCK_LISTING_IMAGE}"]`);

const baseProps = {
  role: 'tenant',
  user: null,
  activeContract: null,
  onNeedAuth: () => {},
  onSelect: () => {},
  onCreate: () => {},
  bookmarks: [],
  toggleBookmark: () => {},
  isBookmarked: () => false,
  getIdentityBadges: () => Promise.resolve([]),
};

describe('FeedPage — mock listings visibility gated by ACTIVE_NETWORK_NAME (TASK 10AJ)', () => {
  beforeEach(() => {
    getListings.mockReset();
    getActiveContracts.mockReset();
    getTenantRequests.mockReset();
    getActiveContracts.mockResolvedValue([]);
    getTenantRequests.mockResolvedValue([]);
  });

  it('arc-testnet + API [] → demo/mock cards are present', async () => {
    mockActiveNetworkName = 'arc-testnet';
    getListings.mockResolvedValue([]);
    render(<FeedPage {...baseProps} />);
    await waitFor(() => expect(getListings).toHaveBeenCalled());
    expect(mockImgSelector()).not.toBeNull();
  });

  it('arc-mainnet + API [] → demo/mock cards are absent', async () => {
    mockActiveNetworkName = 'arc-mainnet';
    getListings.mockResolvedValue([]);
    render(<FeedPage {...baseProps} />);
    await waitFor(() => expect(getListings).toHaveBeenCalled());
    expect(mockImgSelector()).toBeNull();
  });

  it('arc-mainnet + real API listings → real listings are displayed', async () => {
    mockActiveNetworkName = 'arc-mainnet';
    getListings.mockResolvedValue([{
      id: 'uuid-real-1',
      ownerAddr: '0xowner000000000000000000000000000000001',
      propertyType: 'Studio',
      city: 'Real City, Testland',
      monthlyRent: 777,
      photos: [],
    }]);
    render(<FeedPage {...baseProps} />);
    await waitFor(() => expect(screen.getByText(/777/)).toBeInTheDocument());
    // Real listing renders, mock listings stay absent on arc-mainnet
    expect(mockImgSelector()).toBeNull();
  });

  it('Testnet behavior is not broken: real listings and mock listings coexist on arc-testnet', async () => {
    mockActiveNetworkName = 'arc-testnet';
    getListings.mockResolvedValue([{
      id: 'uuid-real-2',
      ownerAddr: '0xowner000000000000000000000000000000002',
      propertyType: 'Studio',
      city: 'Real City, Testland',
      monthlyRent: 888,
      photos: [],
    }]);
    render(<FeedPage {...baseProps} />);
    await waitFor(() => expect(screen.getByText(/888/)).toBeInTheDocument());
    expect(mockImgSelector()).not.toBeNull();
  });
});

// mocks.js TENANTS[0].name — a hardcoded literal no real tenant request could
// ever coincidentally match, same reasoning as MOCK_LISTING_IMAGE above.
const MOCK_TENANT_NAME = 'Yuki Tanaka';
const goToTenantsTab = (container) => {
  const tabs = container.querySelectorAll('.feed-tab');
  fireEvent.click(tabs[1]); // [0]=props, [1]=tenants
};

describe('FeedPage — mock TENANTS visibility gated by ACTIVE_NETWORK_NAME (TASK 10AK)', () => {
  beforeEach(() => {
    getListings.mockReset();
    getActiveContracts.mockReset();
    getTenantRequests.mockReset();
    getListings.mockResolvedValue([]);
    getActiveContracts.mockResolvedValue([]);
  });

  it('arc-testnet → mock TENANTS are visible', async () => {
    mockActiveNetworkName = 'arc-testnet';
    getTenantRequests.mockResolvedValue([]);
    const { container } = render(<FeedPage {...baseProps} />);
    await waitFor(() => expect(getTenantRequests).toHaveBeenCalled());
    goToTenantsTab(container);
    expect(screen.getByText(MOCK_TENANT_NAME)).toBeInTheDocument();
  });

  it('arc-mainnet → mock TENANTS are absent', async () => {
    mockActiveNetworkName = 'arc-mainnet';
    getTenantRequests.mockResolvedValue([]);
    const { container } = render(<FeedPage {...baseProps} />);
    await waitFor(() => expect(getTenantRequests).toHaveBeenCalled());
    goToTenantsTab(container);
    expect(screen.queryByText(MOCK_TENANT_NAME)).not.toBeInTheDocument();
  });

  it('arc-mainnet real tenant/API data is not broken', async () => {
    mockActiveNetworkName = 'arc-mainnet';
    getTenantRequests.mockResolvedValue([{
      addr: '0xtenant00000000000000000000000000000001',
      name: 'Real Tenant Name',
      city: 'Real City, Testland',
      budget: 999,
      propertyType: 'Studio',
      duration: '12',
      verified: true,
    }]);
    const { container } = render(<FeedPage {...baseProps} />);
    await waitFor(() => expect(getTenantRequests).toHaveBeenCalled());
    goToTenantsTab(container);
    expect(await screen.findByText('Real Tenant Name')).toBeInTheDocument();
    expect(screen.queryByText(MOCK_TENANT_NAME)).not.toBeInTheDocument();
  });
});
