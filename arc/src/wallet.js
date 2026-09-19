// pi2pi wallet adapter + RPC utilities (ES module)
import { t } from './i18n/index.js';
import { ARC_TESTNET_CHAIN, USDC_ADDRESS, USDC_DECIMALS, ESCROW_ADDRESS, SEL, encAddr, mapRevertReason, ACTIVE_NETWORK_NAME, ACTIVE_CHAIN_ID_DEC, isCircleSupported, RPC_URL, EXPLORER_BASE_URL } from './helpers.js';
import { authGetNonce, authVerify, authCheckSession } from './api/client.js';

// pi2pi wallet adapter + RPC utilities (Phase C2)
// Loaded via <script> after helpers.js, before JSX.

// =============================================================================
// WALLET ADAPTER — supports injected (MetaMask/Rabby/Brave) + WalletConnect v2
// =============================================================================
// Strategy: monkey-patch window.ethereum to delegate to whichever provider is
// active. After wallet.connect('walletconnect') is called, all existing code
// using `window.ethereum.request(...)` automatically routes through WC.
// Zero changes needed in the 73 existing usage sites.
// =============================================================================
const REOWN_PROJECT_ID = "2b92286da8f5a8762ab267ad7cf41fe9";
// The old locally-hardcoded chain-id constant is gone — everything below
// uses the imported ACTIVE_CHAIN_ID_DEC (resolved from VITE_NETWORK in
// helpers.js), so there is a single source of truth for "what chain is this
// build configured for," instead of a second copy that could silently drift.

// Circle Modular Wallets — passkey-based SCA, third wallet provider in pi2pi.
// Client URL and Client Key are public (frontend-safe) — they are protected by
// each Client Key's own Circle Console "Allowed Domain" setting. The API Key
// is a secret and lives only in .env.local / server-side, never in JSX.
const CIRCLE_MODULAR_CLIENT_URL = "https://modular-sdk.circle.com/v1/rpc/w3s/buidl";

// TASK 10U: the Client Key is selected per-hostname. Live A/B testing
// (TASK 10S/10T) proved Circle enforces a per-Client-Key "Allowed Domain"
// restriction at the rp_getLoginOptions/rp_getRegistrationOptions RPC level
// — a request from an origin the key isn't allowlisted for is rejected with
// "Invalid credentials" before navigator.credentials is ever reached.
// my.pi2pi.io and testnet.pi2pi.io are two different Fly apps' branded
// domains sharing this one frontend bundle, so each needs its own Client
// Key. This does NOT touch the Passkey Domain Name (WebAuthn RP ID), which
// is a separate, independently-configured Circle setting per network (see
// helpers.js's ACTIVE_NETWORK_NAME-driven circleSupported flag) —
// RP ID and Client-Key-domain-allowlisting are separate Circle concepts.
//
// TASK 10AS: my.pi2pi.io now has its own explicit Mainnet LIVE Client Key
// (Circle Mainnet project, provisioned TASK 10AR), no longer falls back to
// the default Testnet key. The fallback for any hostname NOT explicitly
// listed (pi2pi-project.fly.dev — 301-redirected away before this code can
// run there in production, pi2pi-mainnet.fly.dev, and any local/dev
// hostname) intentionally stays a TEST key, never LIVE — defaulting an
// unrecognized/dev origin to production Circle credentials would be a real
// safety regression now that a Live key exists at all. Exported for direct
// unit testing.
const CIRCLE_MODULAR_CLIENT_KEY_DEFAULT_TEST = "TEST_CLIENT_KEY:70e98ff99fa1fdcc25182ef1a6b1102a:4b296b98841c4eb6b7d8c6031287a850";
const CIRCLE_MODULAR_CLIENT_KEY_TESTNET_PI2PI_IO = "TEST_CLIENT_KEY:bd5f5588aa05ee12b37f3dcf3b371177:0f0af89f6699aaf3f746d48580e20c58";
const CIRCLE_MODULAR_CLIENT_KEY_LIVE_MY_PI2PI_IO = "LIVE_CLIENT_KEY:0f426f32a225a46afe562b74c783578e:7ec7cf07f7582f3f46b4346df6fd708f";

export const CIRCLE_CLIENT_KEY_BY_HOSTNAME = Object.freeze({
  "testnet.pi2pi.io": CIRCLE_MODULAR_CLIENT_KEY_TESTNET_PI2PI_IO,
  "my.pi2pi.io": CIRCLE_MODULAR_CLIENT_KEY_LIVE_MY_PI2PI_IO,
});

export function resolveCircleClientKey(hostname) {
  return CIRCLE_CLIENT_KEY_BY_HOSTNAME[hostname] || CIRCLE_MODULAR_CLIENT_KEY_DEFAULT_TEST;
}

const CIRCLE_MODULAR_CLIENT_KEY = resolveCircleClientKey(typeof window !== "undefined" ? window.location?.hostname : undefined);

(function installWalletAdapter() {
  if (typeof window === "undefined") return;
  if (window.pi2piWallet) return; // idempotent — survives hot reloads

  // Capture the original injected provider (MetaMask / Rabby / Brave) BEFORE
  // we override window.ethereum. May be undefined on iPhone Safari.
  const _injected = window.ethereum;

  const wallet = {
    type: null,        // 'injected' | 'walletconnect' | null
    provider: null,    // active EIP-1193 provider, or null

    isInjectedAvailable() {
      return !!_injected;
    },

    _authenticated: false,
    _authInFlight: null, // in-flight lock — only one _authLogin runs at a time

    // Auth: sign SIWE message after wallet connect to establish server session
    // In-flight lock: if _authLogin is already running, concurrent callers
    // await the same promise instead of spawning additional signature prompts.
    async _authLogin(addr, provider) {
      if (this._authInFlight) return this._authInFlight;
      this._authInFlight = this._doAuthLogin(addr, provider);
      try { return await this._authInFlight; }
      finally { this._authInFlight = null; }
    },

    // Inner auth logic — called only once per in-flight window
    async _doAuthLogin(addr, provider) {
      try {
        // Check if already authenticated — do NOT reset _authenticated before this check
        const existing = await authCheckSession();
        if (existing.authenticated && existing.addr === addr.toLowerCase()) {
          console.log("[auth] already authenticated as", addr.slice(0,8));
          this._authenticated = true;
          return true;
        }
        // Session invalid or for different address — now safe to mark unauthenticated
        this._authenticated = false;
        // Get nonce + message from server
        const { nonce, message } = await authGetNonce(addr);
        if (!nonce || !message) { console.warn("[auth] failed to get nonce"); return false; }
        // Sign with wallet
        let signature;
        try {
          if (this._circleSCA && this._circleSCA.signMessage) {
            // Circle SCA: call signMessage directly (bypasses EIP-1193 wrapper
            // which crashes in Safari/Android with "Can't find variable: circle")
            console.log("[auth] Circle SCA signMessage direct");
            signature = await this._circleSCA.signMessage({ message });
          } else {
            // MetaMask / WalletConnect: standard EIP-1193
            signature = await provider.request({ method: "personal_sign", params: [message, addr] });
          }
        } catch (signErr) {
          console.error("[auth] wallet signature failed:", signErr.message, signErr.stack || signErr);
          return false;
        }
        try { window.focus(); } catch {}
        // Verify on server → get session cookie
        const result = await authVerify(addr, message, signature);
        if (result.ok) {
          console.log("[auth] session established for", addr.slice(0,8));
          this._authenticated = true;
          return true;
        } else {
          console.warn("[auth] verify failed:", result.error);
          return false;
        }
      } catch (e) {
        console.warn("[auth] login error:", e.message);
        return false;
      }
    },

    async connectInjected() {
      if (!_injected) throw new Error("No injected wallet (MetaMask/Rabby/Brave). Use WalletConnect for mobile.");
      this.provider = _injected;
      this.type = "injected";
      try { await _injected.request({ method: "eth_requestAccounts" }); } catch (e) { this.provider = null; this.type = null; throw e; }
      // Establish server auth session
      try { const accs = await _injected.request({ method: "eth_accounts" }); if (accs?.[0]) await this._authLogin(accs[0], _injected); } catch {}
      return _injected;
    },

    // ----- Reown AppKit integration -----
    // We use Reown AppKit (the modern, recommended SDK) instead of the
    // lower-level @walletconnect/ethereum-provider. AppKit handles:
    //   - Mobile deeplinks and reconnection on iOS Safari background tabs
    //   - Session restoration from localStorage on page reload
    //   - Wallet selection modal with installed-wallet detection
    //   - Custom chains via defineChain
    //   - Multi-wallet support (300+ wallets out of the box)
    //
    // AppKit is loaded lazily on first WC button click via inline ESM script.

    _appKit: null,           // AppKit modal instance, created once
    _appKitWalletProvider: null, // EIP-1193 provider from AppKit's ethers adapter

    async _loadAppKit() {
      console.log("[pi2pi/appkit] _loadAppKit: starting");
      if (typeof window.__pi2piAppKitMods !== "undefined") {
        console.log("[pi2pi/appkit] modules already loaded");
        return window.__pi2piAppKitMods;
      }

      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.type = "module";
        script.textContent =
          "console.log('[pi2pi/appkit] inline module script started');\n" +
          "(async () => {\n" +
          "  try {\n" +
          "    const appKitMod = await import('https://esm.sh/@reown/appkit@1.6.8?bundle-deps');\n" +
          "    console.log('[pi2pi/appkit] @reown/appkit loaded', Object.keys(appKitMod));\n" +
          "    const ethersAdapterMod = await import('https://esm.sh/@reown/appkit-adapter-ethers@1.6.8?bundle-deps');\n" +
          "    console.log('[pi2pi/appkit] @reown/appkit-adapter-ethers loaded', Object.keys(ethersAdapterMod));\n" +
          "    const networksMod = await import('https://esm.sh/@reown/appkit@1.6.8/networks?bundle-deps');\n" +
          "    console.log('[pi2pi/appkit] @reown/appkit/networks loaded', Object.keys(networksMod));\n" +
          "    window.__pi2piAppKitMods = {\n" +
          "      createAppKit: appKitMod.createAppKit,\n" +
          "      EthersAdapter: ethersAdapterMod.EthersAdapter,\n" +
          "      defineChain: networksMod.defineChain,\n" +
          "      mainnet: networksMod.mainnet,\n" +
          "    };\n" +
          "    window.dispatchEvent(new CustomEvent('pi2pi-appkit-loaded'));\n" +
          "  } catch (e) {\n" +
          "    console.error('[pi2pi/appkit] load failed:', e && e.message ? e.message : e);\n" +
          "    window.__pi2piAppKitError = (e && e.message) ? e.message : String(e);\n" +
          "    window.dispatchEvent(new CustomEvent('pi2pi-appkit-load-failed'));\n" +
          "  }\n" +
          "})();";

        const cleanup = () => {
          window.removeEventListener("pi2pi-appkit-loaded", onSuccess);
          window.removeEventListener("pi2pi-appkit-load-failed", onFail);
        };
        const onSuccess = () => {
          console.log("[pi2pi/appkit] success event received");
          cleanup();
          resolve(window.__pi2piAppKitMods);
        };
        const onFail = () => {
          console.error("[pi2pi/appkit] failure event received");
          cleanup();
          reject(new Error("Reown AppKit could not be loaded: " + (window.__pi2piAppKitError || "unknown")));
        };
        window.addEventListener("pi2pi-appkit-loaded", onSuccess, { once: true });
        window.addEventListener("pi2pi-appkit-load-failed", onFail, { once: true });
        setTimeout(() => {
          if (typeof window.__pi2piAppKitMods === "undefined") {
            console.error("[pi2pi/appkit] timeout 30s — modules never loaded");
            onFail();
          }
        }, 30000);

        console.log("[pi2pi/appkit] appending script element to body");
        document.body.appendChild(script);
      });
    },

    async _ensureAppKitInitialized() {
      if (this._appKit) return this._appKit;
      const mods = await this._loadAppKit();
      const { createAppKit, EthersAdapter, defineChain, mainnet } = mods;

      // Define the active Arc network as a custom CAIP-compliant network
      const arcTestnet = defineChain({
        id: ACTIVE_CHAIN_ID_DEC,
        caipNetworkId: "eip155:" + ACTIVE_CHAIN_ID_DEC,
        chainNamespace: "eip155",
        name: ARC_TESTNET_CHAIN.chainName,
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: {
          default: { http: [RPC_URL] },
        },
        blockExplorers: {
          default: { name: "ArcScan", url: EXPLORER_BASE_URL },
        },
        testnet: ACTIVE_NETWORK_NAME !== "arc-mainnet",
      });

      const ethersAdapter = new EthersAdapter();

      const dappUrl = typeof location !== "undefined" ? location.origin : "https://pi2pi.io";
      const meta = {
        name: "pi2pi",
        description: "Peer-to-peer rental protocol on Arc",
        url: dappUrl,
        icons: ["https://pi2pi.io/icon.png"],
        // redirect tells the wallet where to send the user BACK after they
        // approve a request. For a web dApp this is a universal HTTPS link.
        // Without this, MetaMask Mobile / Trust just leave the user inside
        // the wallet app and they have to manually switch back to Safari.
        redirect: {
          native: dappUrl,
          universal: dappUrl,
        },
      };

      const currentTheme = (function(){ try { return localStorage.getItem("pi2pi-theme") || "dark"; } catch(e){ return "dark"; } })();
      this._appKit = createAppKit({
        adapters: [ethersAdapter],
        networks: [arcTestnet, mainnet],
        defaultNetwork: arcTestnet,
        metadata: meta,
        projectId: REOWN_PROJECT_ID,
        themeMode: currentTheme,
        features: {
          analytics: false,
          email: false,
          socials: false,
        },
      });
      this._ethersAdapter = ethersAdapter;

      console.log("[pi2pi/appkit] AppKit initialized with Arc Testnet as default network");
      return this._appKit;
    },

    async connectWalletConnect() {
      console.log("[pi2pi/appkit] connectWalletConnect called");
      const appKit = await this._ensureAppKitInitialized();
      const ethersAdapter = this._ethersAdapter;

      // Open the modal — AppKit handles QR/deeplinks/wallet selection
      appKit.open();

      // Wait for an account to be connected. AppKit fires events on its
      // internal store; we subscribe and resolve when an address arrives.
      // This survives iOS Safari background tab cycles because AppKit stores
      // the session in localStorage and restores it on visibility change.
      const addr = await new Promise((resolve, reject) => {
        let settled = false;
        let sawOpen = false;
        const finish = (val, err) => {
          if (settled) return;
          settled = true;
          try { unsub && unsub(); } catch {}
          try { unsubState && unsubState(); } catch {}
          clearInterval(poll);
          if (err) reject(err); else resolve(val);
        };

        // Subscribe to AppKit account events
        let unsub = null;
        try {
          unsub = appKit.subscribeAccount((acc) => {
            if (acc && acc.address) {
              console.log("[pi2pi/appkit] account event:", acc.address);
              finish(acc.address);
            }
          });
        } catch (e) {
          console.warn("[pi2pi/appkit] subscribeAccount not available:", e);
        }

        // Subscribe to modal open/close — if user closes modal without
        // connecting, reject so the pi2pi UI can return to the choose stage
        // and the user can click "Move in" → WalletConnect again cleanly.
        let unsubState = null;
        try {
          unsubState = appKit.subscribeState((s) => {
            if (s && s.open) sawOpen = true;
            if (s && sawOpen && !s.open) {
              // Modal closed; check if we already have an account
              try {
                const acc = appKit.getAccount && appKit.getAccount();
                if (acc && acc.address) { finish(acc.address); return; }
              } catch (e) {}
              finish(null, new Error("WalletConnect modal closed"));
            }
          });
        } catch (e) {
          console.warn("[pi2pi/appkit] subscribeState not available:", e);
        }

        // Polling fallback in case subscribe doesn't fire (older AppKit versions)
        const poll = setInterval(() => {
          try {
            const acc = appKit.getAccount && appKit.getAccount();
            if (acc && acc.address) {
              finish(acc.address);
            }
          } catch (e) {}
        }, 500);

        // Hard timeout 3 min
        setTimeout(() => finish(null, new Error("WalletConnect session timed out (3 min)")), 180000);
      });

      // Get the underlying EIP-1193 provider from the ethers adapter
      // AppKit's ethers adapter exposes getWalletProvider() / walletProvider
      let walletProvider = null;
      try {
        if (ethersAdapter.getWalletProvider) walletProvider = ethersAdapter.getWalletProvider();
        else if (ethersAdapter.walletProvider) walletProvider = ethersAdapter.walletProvider;
      } catch (e) {}
      // Fallback: AppKit also exposes provider via universal namespace
      if (!walletProvider) {
        try {
          walletProvider = appKit.getWalletProvider && appKit.getWalletProvider();
        } catch (e) {}
      }
      if (!walletProvider) {
        console.warn("[pi2pi/appkit] could not get walletProvider from adapter — falling back to appKit.subscribeProvider");
        // Try one more API path
        await new Promise((res) => {
          try {
            const u = appKit.subscribeProvider && appKit.subscribeProvider((p) => {
              if (p && p.provider) { walletProvider = p.provider; res(); }
            });
            setTimeout(res, 2000);
          } catch (e) { res(); }
        });
      }

      if (!walletProvider) {
        throw new Error("AppKit connected but no EIP-1193 walletProvider was returned. SDK API mismatch.");
      }

      const isMobile = false;
      if (isMobile && walletProvider && typeof walletProvider.request === "function") {
        const _origRequest = walletProvider.request.bind(walletProvider);
        const getRedirect = () => null;
        walletProvider.request = function(args) {
          const method = args && args.method;
          const needsApproval = false;
          const promise = _origRequest(args);
          // Only deeplink if the page is currently visible (user is in Safari).
          // If document is hidden, user is already inside the wallet — firing
          // location.href would bounce them back and forth.
          if (needsApproval && document.visibilityState === "visible") {
            const link = getRedirect();
            if (link) {
              setTimeout(() => {
                try { window.location.href = link; } catch (e) {}
              }, 50);
            }
          }
          return promise;
        };
      }

      this.provider = walletProvider;
      this.type = "walletconnect";
      this._appKitAddress = addr;

      // Establish server auth session
      try { if (addr) await this._authLogin(addr, walletProvider); } catch {}

      // Listen for disconnect from AppKit side
      try {
        appKit.subscribeAccount((acc) => {
          if (!acc || !acc.address) {
            if (wallet.type === "walletconnect") {
              wallet.provider = null;
              wallet.type = null;
            }
          }
        });
      } catch {}

      console.log("[pi2pi/appkit] connected as", addr);
      return walletProvider;
    },

    // ----- Circle Modular Wallets integration -----
    // Passkey-based SCA (smart contract account). Third wallet provider in
    // pi2pi, alongside MetaMask injected and Reown AppKit. Uses ERC-4337
    // account abstraction under the hood — every transaction is a userOp
    // bundled and relayed by Circle's bundler. Key benefits:
    //   - Single FaceID/passkey prompt instead of seed phrase / wallet app
    //   - Multiple contract calls batched into ONE userOp = 1 user signature
    //   - Session keys (later) for auto-rent payments
    //   - Sponsored gas (paymaster) — user doesn't need ETH/USDC for gas
    //
    // Arc Testnet (chainId 5042002) is officially supported by Circle Modular
    // Wallets Web SDK as of 2026.
    //
    // SDK loaded lazily on first Circle button click via inline ESM script,
    // same pattern as Reown AppKit.

    _circleMods: null,           // loaded SDK module exports
    _circleViemMods: null,       // loaded viem helpers (defineChain, etc)
    _circleSCA: null,            // smart contract account instance
    _circleBundlerClient: null,  // bundler client for sendUserOperation
    _circlePublicClient: null,   // public client for eth_call / read
    _circleCredential: null,     // webauthn credential
    _circleAddress: null,        // SCA address (string)

    async _loadCircleSDK() {
      console.log("[pi2pi/circle] _loadCircleSDK: starting");
      if (this._circleMods) {
        console.log("[pi2pi/circle] modules already loaded");
        return this._circleMods;
      }
      // Vite bundles circle-sdk.js as a separate chunk — loaded on first use only
      const mods = await import('./circle-sdk.js');
      console.log("[pi2pi/circle] SDK loaded via Vite bundle");
      return mods;
    },

    async _ensureCircleClientsInitialized() {
      if (this._circleBundlerClient && this._circlePublicClient) return;

      // Circle's bundler/public clients don't expose a live "what chain are
      // you actually on" RPC call we can independently verify against — their
      // chain identity is entirely constructed by the defineChain() call
      // below, from values WE supply. There is nothing external to check.
      // The real safety guarantee is therefore: (a) those values come from
      // the SAME resolved network config as every other wallet path (no
      // second, independently-hardcoded copy that could drift), and (b) we
      // refuse to initialize Circle at all for any network without verified
      // Circle configuration (client URL/key, transport path) — see
      // isCircleSupported() in helpers.js. Today that's Arc Testnet only.
      if (!isCircleSupported(ACTIVE_NETWORK_NAME)) {
        throw new Error(`Circle Wallets are not configured for network "${ACTIVE_NETWORK_NAME}" — no verified Circle client configuration exists for it yet.`);
      }

      const mods = await this._loadCircleSDK();
      this._circleMods = mods;

      const { toModularTransport, createBundlerClient, createPublicClient, defineChain, modularWalletActions, toCircleModularWalletClient } = mods;

      // Define the active Arc network via viem's defineChain, sourced from
      // ARC_TESTNET_CHAIN (helpers.js) rather than a separate hardcoded copy.
      // TASK 10AS: testnet flag now network-aware, same idiom already used
      // for the WalletConnect/Reown chain definition elsewhere in this file.
      const arcTestnet = defineChain({
        id: ACTIVE_CHAIN_ID_DEC,
        name: ARC_TESTNET_CHAIN.chainName,
        nativeCurrency: ARC_TESTNET_CHAIN.nativeCurrency,
        rpcUrls: {
          default: { http: ARC_TESTNET_CHAIN.rpcUrls },
        },
        blockExplorers: {
          default: { name: "ArcScan", url: ARC_TESTNET_CHAIN.blockExplorerUrls[0] },
        },
        testnet: ACTIVE_NETWORK_NAME !== "arc-mainnet",
      });

      // Per Circle docs example: const modularTransport = toModularTransport(`${clientUrl}/polygonAmoy`, clientKey)
      // The chain name is appended to the base URL. TASK 10AS: network-aware
      // — /arc is the official Circle Mainnet path, /arcTestnet the Testnet
      // one (developers.circle.com/wallets/supported-blockchains +
      // circlefin/skills transport-path table, verified TASK 10AO).
      // Without this, RPC backend returns "circle_getAddress method not found".
      const chainPathSegment = ACTIVE_NETWORK_NAME === "arc-mainnet" ? "/arc" : "/arcTestnet";
      const chainScopedUrl = CIRCLE_MODULAR_CLIENT_URL.replace(/\/$/, "") + chainPathSegment;
      console.log("[pi2pi/circle] modular transport URL:", chainScopedUrl);
      const modularTransport = toModularTransport(chainScopedUrl, CIRCLE_MODULAR_CLIENT_KEY);
      this._circleModularTransport = modularTransport;

      // Create base public client and IMMEDIATELY extend it with Circle's
      // modularWalletActions, otherwise toCircleSmartAccount fails internally
      // with "circle_getAddress method not found" because the SDK calls
      // Circle-specific RPC methods during account derivation.
      const basePublicClient = createPublicClient({
        transport: modularTransport,
        chain: arcTestnet,
      });
      this._circlePublicClient = modularWalletActions
        ? basePublicClient.extend(modularWalletActions)
        : (toCircleModularWalletClient ? toCircleModularWalletClient(basePublicClient) : basePublicClient);

      // Initial bundler client without smart account — will be recreated in
      // connectCircleWallet once we have the SCA, with smartAccount bound.
      this._circleBundlerClient = createBundlerClient({
        transport: modularTransport,
        chain: arcTestnet,
      });

      this._circleChain = arcTestnet;
      console.log("[pi2pi/circle] clients initialized for " + ACTIVE_NETWORK_NAME);
    },

    async connectCircleWallet({ username, mode } = {}) {
      console.log("[pi2pi/circle] connectCircleWallet called", { username, mode });
      // Idempotent: if already connected, return existing SCA without re-prompting FaceID
      if (this.type === "circle" && this._circleSCA && this._circleAddress) {
        console.log("[pi2pi/circle] already connected, returning existing SCA:", this._circleAddress);
        return { address: this._circleAddress, provider: this.provider };
      }
      await this._ensureCircleClientsInitialized();

      const { toPasskeyTransport, toWebAuthnCredential, toCircleSmartAccount, toWebAuthnAccount, WebAuthnMode, createBundlerClient } = this._circleMods;

      // Build a passkey transport (positional args: clientUrl, clientKey)
      const passkeyTransport = toPasskeyTransport(CIRCLE_MODULAR_CLIENT_URL, CIRCLE_MODULAR_CLIENT_KEY);

      // Strategy: ALWAYS try Login first (iOS shows existing passkeys from iCloud Keychain
      // — same passkey across all user's devices = same SCA). Only Register if Login fails.
      // Username is OPTIONAL for Login (iOS shows all available passkeys for this domain).
      let savedUsername = null;
      try { savedUsername = localStorage.getItem("pi2pi_circle_username"); } catch(e){}

      let webAuthnMode;
      if (mode === "register") webAuthnMode = WebAuthnMode.Register;
      else if (mode === "login") webAuthnMode = WebAuthnMode.Login;
      else webAuthnMode = WebAuthnMode.Login; // Default: try Login first
      console.log("[pi2pi/circle] WebAuthn mode (initial):", webAuthnMode === WebAuthnMode.Register ? "Register" : "Login");

      let credential;
      let effectiveUsername = username || savedUsername;
      try {
        // Login: don't force username — let iOS show all passkeys for this site
        const loginParams = { mode: webAuthnMode, transport: passkeyTransport };
        if (effectiveUsername) loginParams.username = effectiveUsername;
        else if (webAuthnMode === WebAuthnMode.Register) loginParams.username = "pi2pi-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
        credential = await toWebAuthnCredential(loginParams);
        if (loginParams.username) effectiveUsername = loginParams.username;
      } catch (firstErr) {
        // Fallback: Login failed (no passkey on this device, no iCloud sync) → Register fresh
        if (webAuthnMode === WebAuthnMode.Login) {
          const freshUsername = "pi2pi-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
          console.log("[pi2pi/circle] Login failed, trying Register with fresh username:", freshUsername, firstErr && firstErr.message);
          credential = await toWebAuthnCredential({
            mode: WebAuthnMode.Register,
            transport: passkeyTransport,
            username: freshUsername,
          });
          effectiveUsername = freshUsername;
        } else {
          throw firstErr;
        }
      }
      // Save the username we ended up using
      try { if (effectiveUsername) localStorage.setItem("pi2pi_circle_username", effectiveUsername); } catch(e){}
      try { localStorage.setItem("pi2pi_circle_registered", "1"); } catch(e){}

      this._circleCredential = credential;
      console.log("[pi2pi/circle] webauthn credential ready");

      // Wrap raw credential into a viem-compatible owner account.
      // Without this wrap, toCircleSmartAccount fails with "n.extend is undefined"
      // because Circle expects a WebAuthnAccount with signMessage/signTypedData,
      // not the raw credential object.
      const owner = toWebAuthnAccount({ credential });

      // Create the Circle Smart Account
      const sca = await toCircleSmartAccount({
        client: this._circlePublicClient,
        owner,
        name: "pi2pi-wallet",
      });

      // Recreate bundlerClient with smartAccount bound (Circle pattern).
      // The earlier _ensureCircleClientsInitialized created a bundlerClient
      // without the smart account; here we bind it for sendUserOperation.
      this._circleBundlerClient = createBundlerClient({
        smartAccount: sca,
        chain: this._circleChain,
        transport: this._circleModularTransport,
      });

      this._circleSCA = sca;
      this._circleAddress = sca.address;
      console.log("[pi2pi/circle] SCA created:", sca.address);

      // Wrap the SCA as an EIP-1193 provider so existing code that calls
      // window.ethereum.request(...) routes through Circle bundler.
      const eip1193 = this._buildCircleEip1193Provider();
      this.provider = eip1193;
      this.type = "circle";

      // Establish server auth session
      if (sca.address) {
        try {
          const authOk = await this._authLogin(sca.address, eip1193);
          console.log("[circle-login] auth result:", authOk, "_authenticated:", this._authenticated);
        } catch (authErr) {
          console.error("[circle-login] auth crashed:", authErr?.message || authErr);
        }
      }

      // Persist session so we can auto-restore on page reload (pull-to-refresh,
      // hard refresh, etc.). The passkey itself stays in iOS Keychain — we just
      // need to remember the username + address so we know to call Login mode.
      try {
        localStorage.setItem("pi2pi_circle_session", JSON.stringify({
          address: sca.address,
          username: effectiveUsername,
        }));
      } catch (e) {}

      return { address: sca.address, provider: eip1193 };
    },

    // EIP-1193 wrapper around the Circle SCA + bundler. Translates standard
    // RPC methods into Circle Modular Wallets equivalents so the rest of pi2pi
    // (which uses window.ethereum.request) works unchanged.
    _buildCircleEip1193Provider() {
      const self = this;
      return {
        request: async ({ method, params }) => {
          console.log("[pi2pi/circle/eip1193]", method, params);
          switch (method) {
            case "eth_accounts":
            case "eth_requestAccounts":
              return [self._circleAddress];

            case "eth_chainId":
              return "0x" + ACTIVE_CHAIN_ID_DEC.toString(16);

            case "wallet_switchEthereumChain":
            case "wallet_addEthereumChain":
              // We're always on Arc Testnet — no-op
              return null;

            case "eth_sendTransaction": {
              const tx = (params && params[0]) || {};
              const calls = [{
                to: tx.to,
                data: tx.data || "0x",
                value: tx.value ? BigInt(tx.value) : 0n,
              }];
              const userOpHash = await self._circleBundlerClient.sendUserOperation({
                account: self._circleSCA,
                calls,
              });
              console.log("[pi2pi/circle/eip1193] userOp hash:", userOpHash);

              // Wait for the userOp to be included; return the on-chain tx hash
              const receipt = await self._circleBundlerClient.waitForUserOperationReceipt({
                hash: userOpHash,
              });
              console.log("[pi2pi/circle/eip1193] userOp receipt:", receipt && receipt.receipt && receipt.receipt.transactionHash);
              return (receipt && receipt.receipt && receipt.receipt.transactionHash) || userOpHash;
            }

            case "personal_sign": {
              // params: [message, address] (MetaMask order) OR [address, message]
              let msg = params[0];
              if (typeof msg === "string" && msg.startsWith("0x")) {
                // hex-encoded message
                const bytes = new Uint8Array((msg.length - 2) / 2);
                for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(msg.substr(2 + i * 2, 2), 16);
                msg = new TextDecoder().decode(bytes);
              }
              return await self._circleSCA.signMessage({ message: msg });
            }

            case "eth_call":
            case "eth_estimateGas":
            case "eth_gasPrice":
            case "eth_blockNumber":
            case "eth_getBlockByNumber":
            case "eth_getTransactionReceipt":
            case "eth_getTransactionByHash":
            case "eth_getLogs":
            case "eth_getBalance":
            case "eth_getCode":
              // Forward read methods to Circle's public client
              if (self._circlePublicClient && self._circlePublicClient.request) {
                return await self._circlePublicClient.request({ method, params });
              }
              throw new Error("Circle public client not available for " + method);

            default:
              throw new Error("Method not supported by Circle EIP-1193 wrapper: " + method);
          }
        },
      };
    },

    // Direct executeBatch API — bypasses EIP-1193 wrapper, lets caller send
    // multiple contract calls in ONE user operation = ONE passkey prompt.
    // Use this for the rental deposit flow (approve + tenantDeposit + propDeposit + activate).
    async executeBatch(calls) {
      // If lazy-reconnect is pending, trigger passkey reconnect now (this is a user gesture)
      if (this._circlePendingReconnect) {
        console.log("[pi2pi/circle] executeBatch: triggering lazy reconnect");
        this._circlePendingReconnect = false;
        await this.connectCircleWallet(this._circleSessionUsername ? { username: this._circleSessionUsername } : {});
      }
      if (this.type !== "circle" || !this._circleSCA) {
        throw new Error("Circle wallet not connected. Please reconnect.");
      }
      console.log("[pi2pi/circle] executeBatch with", calls.length, "calls");
      const userOpHash = await this._circleBundlerClient.sendUserOperation({
        account: this._circleSCA,
        calls: calls.map(c => ({
          to: c.to,
          data: c.data || "0x",
          value: c.value ? BigInt(c.value) : 0n,
        })),
      });
      const receipt = await this._circleBundlerClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });
      return (receipt && receipt.receipt && receipt.receipt.transactionHash) || userOpHash;
    },

    async disconnect() {
      if (this.type === "walletconnect" && this._appKit) {
        try {
          if (this._appKit.disconnect) await this._appKit.disconnect();
          else if (this._appKit.close) this._appKit.close();
        } catch {}
      }
      if (this.type === "circle") {
        // No explicit disconnect for Circle SCA — just clear local state.
        // The passkey itself persists in OS keychain for next login.
        this._circleSCA = null;
        this._circleCredential = null;
        this._circleAddress = null;
        try { localStorage.removeItem("pi2pi_circle_session"); } catch (e) {}
      }
      this.provider = null;
      this.type = null;
      this._appKitAddress = null;
    },
  };

  // Monkey-patch window.ethereum so all existing `window.ethereum.request(...)`
  // calls in the JSX automatically route to whatever provider is active.
  // - If WalletConnect is connected → returns WC provider
  // - Else → returns the original injected provider (or undefined)
  try {
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      get() { return wallet.provider || _injected; },
      set(v) { /* ignore late injections */ },
    });
  } catch (e) {
    // Some browsers may throw if MetaMask already locked the property.
    // In that case, fall back to a non-proxied flow — wallet works in
    // injected-only mode and WalletConnect wiring is degraded.
    console.warn("[pi2pi] Could not install window.ethereum proxy:", e);
  }

  window.pi2piWallet = wallet;
})();

// ─── A2: Wallet concurrency guard — prevents double-tap race conditions ───────
export let _walletConnecting = false;
export const withWalletLock = async (fn) => {
  if (_walletConnecting) return null;
  _walletConnecting = true;
  try { return await fn(); }
  finally { _walletConnecting = false; }
};

// Selectors verified with `cast sig`
export const encBytes32 = (h) => h.replace("0x","").padStart(64,"0");

// System chat message helper — sends to both parties with actor info
export const sysMsg = async (fromAddr, toAddr, text, actorRole, eventType, params) => {
  try {
    const { sendMessage } = await import('./api/client.js');
    await sendMessage({fromAddr,toAddr,text,type:"system",actorAddress:fromAddr,actorRole:actorRole||null,eventType:eventType||null,params:params||null});
  } catch(e){}
};

// JSON-RPC helper (direct to public RPC, bypasses MetaMask for reads)
export const rpcCall = async (method, params) => {
  const r = await fetch(ARC_TESTNET_CHAIN.rpcUrls[0], {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({jsonrpc:"2.0", id:1, method, params})
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};
export const ethCallRpc = (to, data) => rpcCall("eth_call", [{to, data}, "latest"]);

// Gas price with 2x headroom (Arc Testnet fluctuates)
export const getGasPrice = async () => {
  const r = await rpcCall("eth_gasPrice", []);
  return "0x" + (BigInt(r || "0x1312D00") * 2n).toString(16);
};

// Unified provider getter — Circle stub/real provider first, then MetaMask/WC injected
export const getProvider = () => window.pi2piWallet?.provider || window.ethereum;

// Central wallet readiness guard. Returns { ready, address, error }.
// For Circle lazy-reconnect, triggers passkey reconnect (must be called from user gesture).
// For MetaMask/WC, checks provider + accounts.
export const ensureWalletReady = async () => {
  const wallet = window.pi2piWallet;
  // Circle lazy reconnect
  if (wallet?.type === "circle" && wallet._circlePendingReconnect) {
    try {
      wallet._circlePendingReconnect = false;
      await wallet.connectCircleWallet(wallet._circleSessionUsername ? { username: wallet._circleSessionUsername } : {});
    } catch (e) {
      return { ready: false, address: null, error: "Circle reconnect failed: " + (e.message || e) };
    }
  }
  const provider = getProvider();
  if (!provider) return { ready: false, address: null, error: "No wallet provider available" };
  try {
    const accs = await provider.request({ method: "eth_accounts" });
    if (!accs?.[0]) return { ready: false, address: null, error: "No accounts available. Please reconnect wallet." };
    return { ready: true, address: accs[0] };
  } catch (e) {
    return { ready: false, address: null, error: e.message || "Wallet error" };
  }
};

// Read USDC balance for address (returns human-readable number)
// Uses direct RPC fetch — works for ALL wallet types (MetaMask, WalletConnect, Circle SCA)
export const readUsdcBalance = async (addr) => {
  try {
    // Arc Testnet: USDC is native currency — eth_getBalance returns 18 decimals
    // On mainnet with ERC-20 USDC, switch to balanceOf with /1e6
    const hex = await rpcCall("eth_getBalance", [addr.toLowerCase(), "latest"]);
    return Number(BigInt(hex || "0x0")) / 1e18;
  } catch { return 0; }
};

// Get connected wallet's USDC balance — works for any wallet type
export const getMyUsdcBalance = async () => {
  try {
    if (!window.ethereum) return 0;
    const accs = await (getProvider()||window.ethereum)?.request({ method: "eth_accounts" });
    if (!accs || !accs[0]) return 0;
    return await readUsdcBalance(accs[0]);
  } catch { return 0; }
};

// Pre-flight balance check — shows user-friendly error if insufficient
// Returns true if balance OK, false (and alerts) if not enough
const _dispatchToast = (msg, kind = "error") => {
  window.dispatchEvent(new CustomEvent("app:toast", { detail: { msg, kind } }));
};

export const checkUsdcBalance = async (required, label = "this transaction") => {
  const myAddr = (await window.ethereum?.request({ method: "eth_accounts" }))?.[0];
  if (!myAddr) { _dispatchToast(t("err.no_wallet")); return false; }
  const bal = await readUsdcBalance(myAddr);
  if (bal < required) {
    _dispatchToast(
      "Insufficient USDC balance. You have: " + bal.toFixed(2) + " USDC. " +
      "Required for " + label + ": " + required.toFixed(2) + " USDC. " +
      "Top up your wallet and try again."
    );
    return false;
  }
  return true;
};

// ─── Tx helpers ─────────────────────────────────────────────────────────────

// Validate tx hash format
export const isTxHash = (h) => typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h);

// Minimum gasPrice floor: 10 gwei
const MIN_GAS_PRICE = 10000000000n; // 10 gwei

// Get legacy gasPrice for Arc Testnet — aggressive to avoid stuck pending
export const getArcGasPrice = async () => {
  try {
    const gasPriceHex = await rpcCall("eth_gasPrice", []);
    if (gasPriceHex) {
      const rpcGasPrice = BigInt(gasPriceHex);
      const aggressive = rpcGasPrice * 3n;
      const final = aggressive > MIN_GAS_PRICE ? aggressive : MIN_GAS_PRICE;
      return { gasPrice: "0x" + final.toString(16), _rpcRaw: gasPriceHex, _final: final };
    }
  } catch (e) { console.warn("[fee] gasPrice failed:", e.message); }
  return { gasPrice: "0x" + MIN_GAS_PRICE.toString(16), _final: MIN_GAS_PRICE };
};

// Build legacy tx request with gas + gasPrice only (no EIP-1559 fields)
export const prepareTxRequest = async (from, to, data) => {
  const tx = { from, to, data };
  try {
    const gasEstimate = await rpcCall("eth_estimateGas", [{ from, to, data }]);
    if (gasEstimate) {
      const gas = BigInt(gasEstimate) * 150n / 100n;
      tx.gas = "0x" + gas.toString(16);
    }
  } catch (e) { console.warn("[tx] gas estimate failed:", e.message); }
  const { gasPrice } = await getArcGasPrice();
  tx.gasPrice = gasPrice;
  return tx;
};

// For backward compat
export const getArcFeeParams = getArcGasPrice;

// Wait for tx hash to be visible on Arc RPC
export const waitTxVisible = async (hash, timeoutMs = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tx = await rpcCall("eth_getTransactionByHash", [hash]);
      if (tx) return tx;
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
};

// Check pending nonce — blocks if latest != pending (tx stuck)
export const checkPendingNonce = async (addr) => {
  const latest = await rpcCall("eth_getTransactionCount", [addr, "latest"]);
  const pending = await rpcCall("eth_getTransactionCount", [addr, "pending"]);
  if (latest !== pending) throw new Error("Transaction pending (nonce " + latest + " vs " + pending + "). Wait for it to confirm.");
};

// Send tx with legacy gasPrice (Arc Testnet — no EIP-1559)
export const sendTxRaw = async (from, to, data) => {
  const provider = window.pi2piWallet?.provider || window.ethereum;
  if (!provider) throw new Error("No wallet provider available");
  // For Circle SCA, use simple params (bundler handles gas)
  if (window.pi2piWallet?.type === "circle") {
    return provider.request({ method: "eth_sendTransaction", params: [{ from, to, data }] });
  }
  // MetaMask/WC: the app never controls what chain an external wallet is
  // actually on. Sending `to` (ESCROW_ADDRESS/USDC_ADDRESS, both Arc-Testnet-
  // specific) to a wallet connected to a different chain would target
  // whatever unrelated contract (or nothing) exists at that address there.
  // Detect and block before sending — never silently mix networks.
  let actualChainId;
  try {
    actualChainId = await provider.request({ method: "eth_chainId" });
  } catch (e) {
    throw new Error("Could not read wallet network — please check your wallet connection.");
  }
  if (String(actualChainId).toLowerCase() !== ARC_TESTNET_CHAIN.chainId.toLowerCase()) {
    throw new Error(
      `Wrong network: your wallet is on chain ${actualChainId}, but pi2pi requires ${ARC_TESTNET_CHAIN.chainName} (${ARC_TESTNET_CHAIN.chainId}). Switch networks in your wallet and try again.`
    );
  }
  // MetaMask/WC: legacy gasPrice tx
  const tx = await prepareTxRequest(from, to, data);
  const hash = await provider.request({ method: "eth_sendTransaction", params: [tx] });
  // Wait for tx to be visible on RPC before returning
  if (isTxHash(hash)) {
    await waitTxVisible(hash, 15000).catch(() => {});
  }
  return hash;
};

// Wait for tx receipt — 120s timeout, stuck-pending detection
export const waitReceipt = async (hash) => {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const rc = await rpcCall("eth_getTransactionReceipt", [hash]);
      if (rc) return rc;
      // Check if tx is still pending (not dropped)
      if (i > 10 && i % 5 === 0) {
        const tx = await rpcCall("eth_getTransactionByHash", [hash]);
        if (!tx) return null; // tx disappeared — likely dropped
      }
    } catch {}
  }
  throw new Error("Transaction timeout (120s). Hash: " + hash);
};
