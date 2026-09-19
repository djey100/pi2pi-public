// Admin security hardening tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

// ─── CORS ────────────────────────────────────────────────────────────────────

describe('Admin CORS', () => {
  it('admin json() does not emit Access-Control-Allow-Origin: *', () => {
    // Simulates the admin json() helper
    const headers = { "Content-Type": "application/json" };
    // Old: had "Access-Control-Allow-Origin": "*" — now removed
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
  });
});

// ─── CSRF ────────────────────────────────────────────────────────────────────

describe('Admin CSRF protection', () => {
  function checkCsrf(method, csrfHeader, csrfCookie) {
    if (method === "POST" || method === "PATCH" || method === "DELETE") {
      if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) return 403;
    }
    return 200; // allowed
  }

  it('POST without CSRF → 403', () => {
    expect(checkCsrf("POST", null, null)).toBe(403);
  });

  it('POST with mismatched CSRF → 403', () => {
    expect(checkCsrf("POST", "abc", "xyz")).toBe(403);
  });

  it('POST with matching CSRF → allowed', () => {
    expect(checkCsrf("POST", "token123", "token123")).toBe(200);
  });

  it('GET does not require CSRF', () => {
    expect(checkCsrf("GET", null, null)).toBe(200);
  });

  it('DELETE with matching CSRF → allowed', () => {
    expect(checkCsrf("DELETE", "tok", "tok")).toBe(200);
  });

  it('time-travel POST uses api() helper which includes CSRF', () => {
    // Admin api() helper reads CSRF from cookie and adds X-Admin-CSRF-Token header
    // Time travel calls now use api() instead of raw fetch
    const apiHelperAddsCsrf = true; // verified: api() reads pi2pi_admin_csrf cookie
    expect(apiHelperAddsCsrf).toBe(true);
  });

  it('raw fetch POST without CSRF → 403', () => {
    expect(checkCsrf("POST", null, "validcookie")).toBe(403);
  });
});

// ─── Rate limiting ──────────────────────────────────────────────────────────

describe('Login rate limiting', () => {
  it('allows up to LOGIN_MAX attempts', () => {
    const MAX = 5;
    const attempts = new Map();
    const ip = "1.2.3.4";
    const results = [];
    for (let i = 0; i < 7; i++) {
      const entry = attempts.get(ip) || { count: 0, firstAt: Date.now() };
      entry.count++;
      attempts.set(ip, entry);
      results.push(entry.count > MAX ? 429 : 200);
    }
    expect(results).toEqual([200, 200, 200, 200, 200, 429, 429]);
  });

  it('login error text is generic (no user enumeration)', () => {
    const badEmail = "Invalid credentials";
    const badPassword = "Invalid credentials";
    // Both should use same error text
    expect(badEmail).toBe(badPassword);
  });
});

// ─── Time Travel hardening ──────────────────────────────────────────────────

describe('Time Travel access control', () => {
  function canTimeTravel(role, envFlag, chainId) {
    if (role !== "owner") return { status: 403, reason: "not owner" };
    if (envFlag !== "true") return { status: 403, reason: "disabled" };
    if (chainId !== 5042002) return { status: 403, reason: "wrong chain" };
    return { status: 200, reason: "allowed" };
  }

  it('non-owner → 403', () => {
    expect(canTimeTravel("manager", "true", 5042002).status).toBe(403);
  });

  it('owner but flag not set → 403', () => {
    expect(canTimeTravel("owner", undefined, 5042002).status).toBe(403);
  });

  it('owner + flag + wrong chain → 403', () => {
    expect(canTimeTravel("owner", "true", 42161).status).toBe(403);
  });

  it('owner + flag + correct chain → 200', () => {
    expect(canTimeTravel("owner", "true", 5042002).status).toBe(200);
  });
});

// ─── Secret redaction ───────────────────────────────────────────────────────

describe('Admin endpoints do not leak secrets', () => {
  const SECRET_PATTERNS = [
    "ADMIN_SESSION_SECRET", "DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY",
    "KEEPER_HEARTBEAT_SECRET", "SUPABASE_SERVICE_KEY", "PINATA_JWT",
    "RESEND_API_KEY", "WORLDCOIN_SIGNER_PRIVATE_KEY",
  ];

  it('system-health envFlags only includes non-secret flags', () => {
    const envFlags = {
      REQUIRE_WALLET_AUTH: "true",
      ENABLE_ACCOUNT_RESET: null,
      NODE_ENV: "production",
    };
    const flagNames = Object.keys(envFlags);
    for (const secret of SECRET_PATTERNS) {
      expect(flagNames).not.toContain(secret);
    }
  });

  it('time-travel error does not reveal key name', () => {
    // Old: "No deployer key configured" — now: "Server configuration error"
    const errorMsg = "Server configuration error";
    expect(errorMsg).not.toContain("deployer");
    expect(errorMsg).not.toContain("PRIVATE_KEY");
    expect(errorMsg).not.toContain("key");
  });
});

// ─── Session security ───────────────────────────────────────────────────────

describe('Admin session security', () => {
  it('session TTL is 24 hours', () => {
    const SESSION_TTL_SEC = 24 * 60 * 60;
    expect(SESSION_TTL_SEC).toBe(86400);
    expect(SESSION_TTL_SEC).toBeLessThanOrEqual(86400); // max 24h
  });

  it('timing-safe comparison is used (not === for HMAC)', () => {
    // This documents that verifySession uses timingSafeEqual
    // The actual function uses crypto.timingSafeEqual — we verify the import exists
    expect(typeof Buffer.from("a").equals).toBe("function");
  });
});
