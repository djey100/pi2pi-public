// domain-config.js — pure functions for TASK 10P's network-aware hostname
// behavior: APP_BASE_URL resolution, CORS allowed origins, the WebAuthn
// related-origins manifest, and the fly.dev → branded-domain redirect.
//
// Kept as its own file (mirrors network-config.js / static-serve.js) so it
// can be unit tested without booting server-arc.js, which requires Supabase
// credentials and a live NETWORK/RPC_URL at import time.
//
// Root cause this closes (TASK 10O audit): all of this used to be
// hardcoded to "https://my.pi2pi.io" / "pi2pi-project.fly.dev" directly in
// server-arc.js, correct only by coincidence because my.pi2pi.io happened
// to already point at that exact app. Once my.pi2pi.io/testnet.pi2pi.io
// are split across two different Fly apps, every one of these would have
// silently served the wrong network's identity.

/**
 * Resolves this runtime's own branded app URL. Production (running under
 * Fly, detected via FLY_APP_NAME, which Fly always injects) must set
 * envAppBaseUrl explicitly — throws otherwise, never silently assumes
 * either network's domain. Local dev (no flyAppName) gets a safe,
 * non-branded fallback that can never be mistaken for a real domain.
 */
export function resolveAppBaseUrl({ envAppBaseUrl, flyAppName, port }) {
  if (envAppBaseUrl) return envAppBaseUrl;
  if (flyAppName) {
    throw new Error(`APP_BASE_URL must be set explicitly when running under Fly (FLY_APP_NAME=${flyAppName}) — no default is assumed, to avoid ever serving the wrong network's branded domain.`);
  }
  return `http://localhost:${port}`;
}

/** This runtime's own raw Fly hostname, derived from Fly's own injected FLY_APP_NAME — never hardcoded to either app's name. null in local dev. */
export function resolveFlyHostnameUrl(flyAppName) {
  return flyAppName ? `https://${flyAppName}.fly.dev` : null;
}

/**
 * CORS allowed origins: this runtime's own branded domain + its own Fly
 * hostname + local dev origins — never the other network's branded domain
 * (least privilege).
 */
export function resolveAllowedOrigins({ appBaseUrl, flyHostnameUrl, devOrigins = ["http://localhost:5173", "http://localhost:3001"] }) {
  return [appBaseUrl, flyHostnameUrl, ...devOrigins].filter(Boolean);
}

/** WebAuthn related-origins manifest: this runtime's two real domains only — never localhost, never the other network's domain. */
export function resolveWebauthnOrigins({ appBaseUrl, flyHostnameUrl }) {
  return [appBaseUrl, flyHostnameUrl].filter(Boolean);
}

/**
 * Returns the redirect Location for a request to this runtime's own raw
 * Fly hostname, or null if no redirect applies (wrong host, or no
 * flyHostnameUrl at all — i.e. local dev). Preserves path + query via
 * `requestUrl` (the raw req.url, which already includes both). Can never
 * loop: flyHostnameUrl's host and appBaseUrl's host are different by
 * construction in every real deployment (a branded domain is never the
 * app's own *.fly.dev hostname).
 */
export function resolveFlyRedirectTarget({ host, flyHostnameUrl, appBaseUrl, requestUrl }) {
  if (!flyHostnameUrl) return null;
  const flyHost = new URL(flyHostnameUrl).host;
  if ((host || "").toLowerCase() !== flyHost) return null;
  return appBaseUrl + (requestUrl || "/");
}
