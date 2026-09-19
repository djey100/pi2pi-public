-- SUPERSEDED — never applied to production. Do not run.
-- Append-only design causes unbounded row growth (~every 15s). Replaced by
-- migrations/2026-08-15-keeper-heartbeats-v2.sql (upsert per instance_id).
--
-- Keeper heartbeat table for observability
-- Run in Supabase SQL Editor (one-time migration)

CREATE TABLE IF NOT EXISTS keeper_heartbeats (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  keeper_version text,
  chain_id      integer,
  rpc_url_host  text,
  escrow_address text,
  propdep_address text,
  next_agreement_id integer,
  scanned_count integer,
  actions_needed integer DEFAULT 0,
  actions_executed integer DEFAULT 0,
  last_action   text,
  last_tx_hash  text,
  last_error    text,
  fly_region    text,
  instance_id   text
);

-- Index for querying latest heartbeat quickly
CREATE INDEX IF NOT EXISTS keeper_heartbeats_created_at ON keeper_heartbeats (created_at DESC);

-- Auto-cleanup: keep only last 1000 rows (optional, run manually or via cron)
-- DELETE FROM keeper_heartbeats WHERE id NOT IN (SELECT id FROM keeper_heartbeats ORDER BY created_at DESC LIMIT 1000);
