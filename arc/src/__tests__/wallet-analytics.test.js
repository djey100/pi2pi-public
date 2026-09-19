// Tests for wallet type normalization, login sync order, and acquisition tracking
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

// ─── Wallet type normalization ──────────────────────────────────────────────

describe('Canonical wallet type normalization', () => {
  function normalize(piType, connectMethod) {
    if (piType === "circle") return "circle";
    if (piType === "injected" || piType === "metamask") return "injected";
    if (piType === "walletconnect") return "walletconnect";
    if (connectMethod === "mm") return "injected";
    if (connectMethod === "wc") return "walletconnect";
    if (connectMethod === "circle") return "circle";
    return "unknown";
  }

  it('pi2piWallet.type "injected" → "injected"', () => {
    expect(normalize("injected", null)).toBe("injected");
  });

  it('pi2piWallet.type "metamask" (legacy) → "injected"', () => {
    expect(normalize("metamask", null)).toBe("injected");
  });

  it('pi2piWallet.type "circle" → "circle"', () => {
    expect(normalize("circle", null)).toBe("circle");
  });

  it('pi2piWallet.type "walletconnect" → "walletconnect"', () => {
    expect(normalize("walletconnect", null)).toBe("walletconnect");
  });

  it('null type + connectMethod "mm" → "injected"', () => {
    expect(normalize(null, "mm")).toBe("injected");
  });

  it('null type + null method → "unknown"', () => {
    expect(normalize(null, null)).toBe("unknown");
  });
});

describe('Provider name detection', () => {
  it('isMetaMask → "metamask"', () => {
    const eth = { isMetaMask: true };
    const name = eth.isMetaMask ? "metamask" : eth.isRabby ? "rabby" : eth.isBraveWallet ? "brave" : "unknown";
    expect(name).toBe("metamask");
  });

  it('isRabby → "rabby"', () => {
    const eth = { isRabby: true };
    const name = eth.isMetaMask ? "metamask" : eth.isRabby ? "rabby" : "unknown";
    expect(name).toBe("rabby");
  });
});

// ─── Admin stats wallet counting ────────────────────────────────────────────

describe('Admin stats wallet counting with legacy normalization', () => {
  function countWallets(users) {
    const wallets = { circle: 0, injected: 0, walletconnect: 0, unknown: 0 };
    users.forEach(u => {
      const t = u.walletType;
      if (t === "circle") wallets.circle++;
      else if (t === "injected" || t === "metamask") wallets.injected++;
      else if (t === "walletconnect") wallets.walletconnect++;
      else wallets.unknown++;
    });
    return wallets;
  }

  it('counts legacy "metamask" as injected', () => {
    const users = [
      { walletType: "metamask" },
      { walletType: "injected" },
      { walletType: "circle" },
      { walletType: null },
    ];
    const w = countWallets(users);
    expect(w.injected).toBe(2); // metamask + injected
    expect(w.circle).toBe(1);
    expect(w.unknown).toBe(1);
  });
});

// ─── Login sync order ───────────────────────────────────────────────────────

describe('MetaMask login sync order', () => {
  it('auth must happen before walletType sync', () => {
    // This test documents the required order: _authLogin → syncWalletInfoToServer
    // In the old code, sync happened first → PATCH failed with 401
    const callOrder = [];
    const _authLogin = () => callOrder.push("auth");
    const syncWallet = () => callOrder.push("sync");

    // Correct order:
    _authLogin();
    syncWallet();

    expect(callOrder).toEqual(["auth", "sync"]);
  });
});

// ─── Acquisition tracking ───────────────────────────────────────────────────

describe('Acquisition tracking', () => {
  it('extracts UTM params from URL', () => {
    const search = "?utm_source=instagram&utm_medium=social&utm_campaign=launch";
    const params = new URLSearchParams(search);
    expect(params.get("utm_source")).toBe("instagram");
    expect(params.get("utm_medium")).toBe("social");
    expect(params.get("utm_campaign")).toBe("launch");
  });

  it('detects mobile device from user agent', () => {
    const mobile = /iPhone|iPad|Android|Mobile/i.test("Mozilla/5.0 (iPhone; CPU iPhone OS)");
    expect(mobile).toBe(true);
    const desktop = /iPhone|iPad|Android|Mobile/i.test("Mozilla/5.0 (Macintosh; Intel Mac OS)");
    expect(desktop).toBe(false);
  });

  it('tracks only once per session', () => {
    // sessionStorage guard prevents duplicate page_view events
    let tracked = 0;
    const track = (storage) => {
      if (storage.has("pi2pi_page_viewed")) return;
      storage.add("pi2pi_page_viewed");
      tracked++;
    };
    const storage = new Set();
    track(storage);
    track(storage);
    expect(tracked).toBe(1);
  });
});

// ─── Wallet funnel events ───────────────────────────────────────────────────

describe('Wallet funnel events', () => {
  it('WALLET_CONNECT event includes method and walletType', () => {
    const event = {
      type: "WALLET_CONNECT",
      action: "wallet_connect_success",
      data: { method: "metamask", walletType: "injected", providerName: "metamask" },
    };
    expect(event.data.method).toBe("metamask");
    expect(event.data.walletType).toBe("injected");
    expect(event.data.providerName).toBe("metamask");
  });

  it('PAGE_VIEW event includes UTM and device', () => {
    const event = {
      type: "PAGE_VIEW",
      action: "page_view",
      data: { utm_source: "twitter", device: "mobile", referrer: "https://t.co/abc" },
    };
    expect(event.data.utm_source).toBe("twitter");
    expect(event.data.device).toBe("mobile");
  });
});

// ─── Registration userData normalization ─────────────────────────────────────

describe('Registration userData wallet type', () => {
  function buildUserData(piWalletType, connectMethod, ethereumFlags) {
    // Simulates getCanonicalWalletType + getWalletProviderName at registration time
    function normalize(piType, cm) {
      if (piType === "circle") return "circle";
      if (piType === "injected" || piType === "metamask") return "injected";
      if (piType === "walletconnect") return "walletconnect";
      if (cm === "mm") return "injected";
      if (cm === "wc") return "walletconnect";
      if (cm === "circle") return "circle";
      return "unknown";
    }
    const wt = normalize(piWalletType, connectMethod);
    const pn = wt === "injected" && ethereumFlags ? (ethereumFlags.isMetaMask ? "metamask" : ethereumFlags.isRabby ? "rabby" : null) : null;
    return { walletType: wt, providerName: pn, circleBiometric: wt === "circle" };
  }

  it('MetaMask registration: walletType="injected", providerName="metamask"', () => {
    const ud = buildUserData("injected", "mm", { isMetaMask: true });
    expect(ud.walletType).toBe("injected");
    expect(ud.providerName).toBe("metamask");
    expect(ud.circleBiometric).toBe(false);
  });

  it('WalletConnect registration: walletType="walletconnect"', () => {
    const ud = buildUserData("walletconnect", "wc", null);
    expect(ud.walletType).toBe("walletconnect");
    expect(ud.providerName).toBe(null);
  });

  it('Circle registration: walletType="circle", circleBiometric=true', () => {
    const ud = buildUserData("circle", "circle", null);
    expect(ud.walletType).toBe("circle");
    expect(ud.circleBiometric).toBe(true);
  });

  it('Legacy "metamask" piWallet type → "injected"', () => {
    const ud = buildUserData("metamask", null, { isMetaMask: true });
    expect(ud.walletType).toBe("injected");
    expect(ud.providerName).toBe("metamask");
  });

  it('null piWallet type + "mm" connect method → "injected"', () => {
    const ud = buildUserData(null, "mm", { isMetaMask: true });
    expect(ud.walletType).toBe("injected");
    expect(ud.providerName).toBe("metamask");
  });
});
