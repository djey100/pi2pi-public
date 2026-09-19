-- Network scoping for active_contracts — PHASE B: CONTRACT
-- (TASK 9B / 9B-REVISION / 9D)
-- Run in Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  DO NOT APPLY THIS MIGRATION UNTIL ALL OF THE FOLLOWING ARE TRUE: ║
-- ║                                                                    ║
-- ║  1. migrations/2026-09-17-network-scope-contracts-expand.sql has  ║
-- ║     already been applied successfully.                            ║
-- ║  2. The new TASK 9B backend (the one whose active_contracts write ║
-- ║     path selects by (addr, chain_id, escrow_address) and then     ║
-- ║     branches to .update()/.insert() — NOT a bare .upsert() keyed  ║
-- ║     on addr) has been deployed to production and verified working ║
-- ║     (reads work, writes work, new rows carry chain_id/            ║
-- ║     escrow_address).                                              ║
-- ║  3. NO old Fly machine/release is still serving traffic. The OLD  ║
-- ║     backend's bare `.upsert({ addr, data, updated_at })` relies   ║
-- ║     entirely on active_contracts_pkey for its implicit            ║
-- ║     ON CONFLICT (addr) inference — if even one old-backend        ║
-- ║     instance is still handling requests when this constraint is   ║
-- ║     dropped, EVERY active-contract write from it will start       ║
-- ║     failing with: "there is no unique or exclusion constraint     ║
-- ║     matching the ON CONFLICT specification." That is a live       ║
-- ║     production outage, not a graceful degradation.                ║
-- ║                                                                    ║
-- ║  Verify with `fly releases` / `fly status` (or equivalent) that   ║
-- ║  only the new image is running before proceeding.                 ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- Once safe to apply, this migration completes the design *-expand.sql
-- started: it removes the OLD addr-only PRIMARY KEY (which by that point no
-- running code depends on) so the same wallet address can hold independent
-- active_contracts rows across networks/deployments — real coexistence, not
-- an app-level "refuse the write" guard.
--
-- Additive / data-preserving: this drops a CONSTRAINT, not data or a column
-- — no row is deleted, altered, or reinterpreted. No DELETE, no TRUNCATE, no
-- DROP TABLE.

-- ── Remove the old addr-only PRIMARY KEY ────────────────────────────
-- A constraint, not data — no rows are affected by this statement itself.
-- Safe only under the preconditions boxed above.
ALTER TABLE public.active_contracts DROP CONSTRAINT IF EXISTS active_contracts_pkey;

-- ── Replace its implicit lookup index with an explicit one ─────────
-- Many application queries still filter by addr alone (e.g. paginated
-- listings, peer lookups) and previously relied on the PK's implicit index
-- for that — replace it explicitly so those queries don't regress.
CREATE INDEX IF NOT EXISTS active_contracts_addr_idx ON public.active_contracts (addr);

-- ── Retain/ensure the network-scoped uniqueness guarantee ──────────
-- Idempotent — this index was already created by *-expand.sql. Included
-- here too so this migration is self-contained and correct even if somehow
-- run in isolation (e.g. against a database restored from a backup taken
-- between the two migrations).
CREATE UNIQUE INDEX IF NOT EXISTS active_contracts_network_scoped_addr
  ON public.active_contracts (chain_id, escrow_address, addr)
  WHERE chain_id IS NOT NULL AND escrow_address IS NOT NULL;
