-- Keeper heartbeat table for observability (v2)
-- Run in Supabase SQL Editor (one-time migration)
--
-- Supersedes migrations/2026-04-29-keeper-heartbeats.sql, which was written but
-- never applied — public.keeper_heartbeats does not exist in production, so
-- server-arc.js's insert into it has been failing on every keeper scan since
-- the heartbeat write path was added.
--
-- Design change vs. the v1 draft: v1 was append-only (new row every heartbeat,
-- ~every 15s per keeper LOOP_INTERVAL) with only a commented-out manual cleanup
-- query — unbounded growth. v2 keeps one row per keeper instance and upserts on
-- conflict, so the table stays at "number of live keeper instances" rows.
--
-- RLS: explicitly locked down. Every other table in this project (archived_
-- contracts, active_contracts, contract_forms, etc.) has no RLS and relies
-- implicitly on "no anon/client code path happens to query it". This table
-- deliberately does not follow that pattern — it gets RLS enabled with zero
-- policies (default-deny for anon/authenticated) plus an explicit REVOKE, so
-- access is denied at two independent layers instead of by omission.
--
-- No sequence involved: instance_id (text) is the primary key, there is no
-- bigint GENERATED ... AS IDENTITY column here, so there is no sequence to
-- separately REVOKE access on.

CREATE TABLE IF NOT EXISTS public.keeper_heartbeats (
  instance_id       text PRIMARY KEY DEFAULT 'default',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  keeper_version    text,
  chain_id          integer,
  rpc_url_host      text,
  escrow_address    text,
  propdep_address   text,
  next_agreement_id integer,
  scanned_count     integer,
  actions_needed    integer DEFAULT 0,
  actions_executed  integer DEFAULT 0,
  last_action       text,
  last_tx_hash      text,
  last_error        text,
  fly_region        text
);

-- Query pattern is "most recent heartbeat across all instances" (admin status
-- endpoint), so index on updated_at, not instance_id lookups.
CREATE INDEX IF NOT EXISTS keeper_heartbeats_updated_at ON public.keeper_heartbeats (updated_at DESC);

-- ── Lock down access ─────────────────────────────────────────────────
-- RLS on, no policies defined → default-deny for every role except one with
-- BYPASSRLS. Idempotent: ENABLE ROW LEVEL SECURITY is safe to re-run.
ALTER TABLE public.keeper_heartbeats ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders alongside RLS: anon/authenticated get zero table
-- privileges outright. Idempotent: REVOKE on privileges already absent is a
-- no-op, not an error.
REVOKE ALL ON TABLE public.keeper_heartbeats FROM anon, authenticated;

-- service_role is the only writer/reader (server-arc.js uses SUPABASE_SERVICE_KEY).
-- It bypasses RLS by default in Supabase (BYPASSRLS role attribute), but we
-- still grant table privileges explicitly rather than depend on inherited
-- default privileges — this migration is self-contained and does not assume
-- what schema-level ALTER DEFAULT PRIVILEGES exist on this project.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.keeper_heartbeats TO service_role;
