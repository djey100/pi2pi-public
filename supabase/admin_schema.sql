-- ═══════════════════════════════════════════════════════════════════
-- pi2pi Admin Panel — Database Schema
-- ═══════════════════════════════════════════════════════════════════
-- Run this SQL in Supabase Dashboard → SQL Editor
-- after creating the first run, use create_admin.js to bootstrap Owner

-- ── Admin users (multi-user with roles) ─────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,    -- bcrypt
  role TEXT NOT NULL CHECK (role IN ('owner','manager','support')),
  display_name TEXT,
  created_by BIGINT REFERENCES admin_users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP,
  active BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS admin_users_email_idx ON admin_users(email);
CREATE INDEX IF NOT EXISTS admin_users_active_idx ON admin_users(active);

-- ── Admin audit log (every meaningful action) ───────────────────────
CREATE TABLE IF NOT EXISTS admin_audit (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT REFERENCES admin_users(id),
  admin_email TEXT,
  action TEXT NOT NULL,          -- 'login', 'issue_promo', 'revoke_promo', 'ban_user', 'delete_listing', 'change_role', etc.
  target TEXT,                    -- what was acted upon (user addr, promo code, etc.)
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_audit_admin_idx ON admin_audit(admin_id);
CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON admin_audit(action, created_at DESC);

-- ── User events (engagement tracking + funnel) ──────────────────────
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  addr TEXT,                      -- wallet address of actor
  event TEXT NOT NULL,            -- 'register','post_listing','view_listing','request_viewing','open_chat','send_message','start_contract','sign_contract', etc.
  target_addr TEXT,               -- who/what was targeted (e.g. landlord whose listing was viewed)
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS events_addr_idx ON events(addr);
CREATE INDEX IF NOT EXISTS events_event_idx ON events(event, created_at DESC);
CREATE INDEX IF NOT EXISTS events_target_idx ON events(target_addr);

-- ── Promocodes (1 per wallet, expires, perks) ───────────────────────
CREATE TABLE IF NOT EXISTS promocodes (
  code TEXT PRIMARY KEY,
  created_by BIGINT REFERENCES admin_users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  used_by_addr TEXT,             -- wallet that activated, NULL = unused
  used_at TIMESTAMP,
  expires_at TIMESTAMP,
  perks JSONB DEFAULT '{"bypass_funds_check": true}',  -- e.g. {bypass_funds_check, no_deposit_mode}
  notes TEXT                     -- free-text who it was given to
);
CREATE INDEX IF NOT EXISTS promocodes_used_idx ON promocodes(used_by_addr);
CREATE INDEX IF NOT EXISTS promocodes_unused_idx ON promocodes(used_by_addr) WHERE used_by_addr IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- Done. Next: run `node create_admin.js` to bootstrap first Owner.
-- ═══════════════════════════════════════════════════════════════════
