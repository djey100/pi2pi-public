-- Network scoping for listings — PHASE A: EXPAND + backfill (TASK 10F)
-- Run in Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- Root cause (TASK 10D/10E): checkListingsTablePoF/checkTenantIntentPoF
-- (server-arc.js) read `listings`/`users` rows with no network filter at
-- all, so the newly-started Arc Mainnet runtime read pre-existing Arc
-- Testnet rows and checked their balances via the Mainnet RPC, incorrectly
-- suspending 3 listings and blocking 6 accounts. server-arc.js has already
-- been fixed (TASK 10F) to scope every PoF SELECT/UPDATE by a `network`
-- column/field, transitionally treating untagged legacy rows as Testnet's
-- own and NEVER letting Mainnet touch an untagged/ambiguous/explicitly-
-- Testnet row. This migration adds the column those SELECT/UPDATE calls
-- filter on, and backfills EVERY existing row to 'arc-testnet'.
--
-- The backfill is NOT a guess: as of this migration's authoring, the
-- `listings` table's newest row was created 2026-06-25 and pi2pi-mainnet
-- (the only Arc Mainnet web runtime that has ever existed) was first
-- created 2026-09-17 and ran for under 3 minutes with zero
-- `POST /api/listings` calls (verified via Fly + PostgREST — see TASK 10E's
-- forensic report). Every row in this table today unambiguously predates
-- Arc Mainnet's existence.
--
-- `users.data.intent.network` needs NO schema migration — `data` is already
-- jsonb, and server-arc.js's POST /api/tenant-requests now stamps it going
-- forward. Existing rows' `data.intent.network` is simply absent (nullish),
-- which checkTenantIntentPoF's transitional Testnet scoping already treats
-- as "Testnet's own" — no backfill needed or proposed for `users`.
--
-- No CONTRACT/removal phase follows this one (unlike
-- 2026-09-17-network-scope-contracts-*.sql): this is a purely additive,
-- nullable column with no old-backend PK/upsert dependency to break — there
-- is nothing to later drop.
--
-- Additive / data-preserving: one nullable column, one index, an UPDATE that
-- only ever sets network = 'arc-testnet' WHERE network IS NULL (idempotent,
-- safe to re-run, cannot touch a row a later run has already tagged
-- differently) — no DELETE, no TRUNCATE, no DROP TABLE, no DROP COLUMN.

-- ── Column ───────────────────────────────────────────────────────────
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS network text;

-- ── Backfill (Arc Testnet only — see justification above) ─────────────
UPDATE public.listings
SET network = 'arc-testnet'
WHERE network IS NULL;

-- ── Index ────────────────────────────────────────────────────────────
-- Mirrors the existing listings_owner_status index shape; supports both
-- checkListingsTablePoF's `network = X` (mainnet) and
-- `network = X OR network IS NULL` (testnet, transitional) filters.
CREATE INDEX IF NOT EXISTS listings_network_status ON public.listings(network, status);

-- ── Verify ───────────────────────────────────────────────────────────
SELECT network, status, count(*) FROM public.listings GROUP BY network, status ORDER BY network, status;
