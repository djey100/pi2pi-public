-- Network scoping for active_contracts / archived_contracts — PHASE A: EXPAND
-- (TASK 9B / 9B-REVISION / 9D)
-- Run in Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- This is the FIRST of two migrations (see also *-contract.sql, applied
-- separately and later). It is split this way specifically because the
-- currently-deployed production backend predates TASK 9B: it writes
-- active_contracts via a bare `.upsert({ addr, data, updated_at })` with no
-- explicit onConflict target. Supabase/PostgREST infers the ON CONFLICT
-- target from the table's PRIMARY KEY when none is given — so that old
-- backend's every write is silently dependent on active_contracts_pkey
-- (the addr-only primary key) continuing to exist. Dropping it while the
-- old backend is still deployed would break every old-backend upsert with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" — a live production outage. THIS MIGRATION DOES NOT DROP
-- THAT CONSTRAINT. See *-contract.sql for the safe removal, which may only
-- be applied after the old backend is fully retired.
--
-- Everything in this migration is safe to apply while the OLD backend is
-- still serving production traffic: purely additive columns/indexes, a
-- provenance-scoped backfill, and a NEW partial unique index that coexists
-- alongside the untouched addr PRIMARY KEY (PostgreSQL allows multiple
-- indexes covering overlapping columns with no conflict).
--
-- Additive / data-preserving: nullable columns, provenance-based backfill,
-- new indexes only — no DELETE, no TRUNCATE, no DROP TABLE, and (unlike an
-- earlier draft of this migration) no DROP CONSTRAINT here. NOT applied
-- automatically — see the runbook this migration's commit message/PR
-- references for exactly when to run it.

-- ── Columns ──────────────────────────────────────────────────────────
ALTER TABLE public.active_contracts
  ADD COLUMN IF NOT EXISTS chain_id integer,
  ADD COLUMN IF NOT EXISTS escrow_address text;

ALTER TABLE public.archived_contracts
  ADD COLUMN IF NOT EXISTS chain_id integer,
  ADD COLUMN IF NOT EXISTS escrow_address text;

-- ── Provenance-based backfill (Arc Testnet only) ────────────────────
-- Every row the app has written since arc/src/components/ContractFlow.jsx
-- started recording it stores the escrow contract it was created under in
-- data->>'escrowAddress' — real, already-recorded history, not a guessed
-- default. Rows whose data->>'escrowAddress' is missing or doesn't match a
-- known Arc Testnet address (active + historicalIntermediate + legacy — see
-- config/deployments.json["5042002"] and keeper/network.ts's
-- KNOWN_ARC_TESTNET_CONTRACTS, which this list mirrors) are left untouched —
-- chain_id/escrow_address stay NULL. NULL never matches a chain_id/
-- escrow_address-scoped query, so ambiguous rows fail closed — invisible to
-- every network-scoped read — rather than being guessed into one.
--
-- Live preflight (TASK 9C) found that as of this writing, ALL production
-- rows in both tables predate ContractFlow.jsx's escrowAddress write and
-- have no such field at all — so this backfill currently classifies 0 rows
-- as provably testnet. That is expected and safe, not a bug: it means the
-- backfill is a no-op today and will only start doing real work once the
-- new frontend build (which does write this field) has been live for a
-- while. Before running this against production, operators can still run
-- this diagnostic first to confirm current counts:
--
--   SELECT
--     count(*) FILTER (WHERE lower(data->>'escrowAddress') IN (
--       '0x728ff16de0d6dfcaa1a8e7ed2ff95d9cb49663c8',
--       '0x11184188c24ce546912617156c0693868a98b2a3',
--       '0x6cbf4d958da24b7adc98fb7633213ac26b5a6f3a',
--       '0xeac111678149818168dd8499882a234e2019a802'
--     )) AS provably_testnet,
--     count(*) FILTER (WHERE data->>'escrowAddress' IS NULL) AS ambiguous_no_field,
--     count(*) FILTER (WHERE data->>'escrowAddress' IS NOT NULL AND lower(data->>'escrowAddress') NOT IN (
--       '0x728ff16de0d6dfcaa1a8e7ed2ff95d9cb49663c8',
--       '0x11184188c24ce546912617156c0693868a98b2a3',
--       '0x6cbf4d958da24b7adc98fb7633213ac26b5a6f3a',
--       '0xeac111678149818168dd8499882a234e2019a802'
--     )) AS ambiguous_unrecognized_address
--   FROM public.active_contracts;
--
-- (repeat against public.archived_contracts)
UPDATE public.active_contracts
SET chain_id = 5042002,
    escrow_address = lower(data->>'escrowAddress')
WHERE chain_id IS NULL
  AND lower(data->>'escrowAddress') IN (
    '0x728ff16de0d6dfcaa1a8e7ed2ff95d9cb49663c8', -- active (switched 2026-09-06)
    '0x11184188c24ce546912617156c0693868a98b2a3', -- historicalIntermediate
    '0x6cbf4d958da24b7adc98fb7633213ac26b5a6f3a', -- legacy[0] (2026-06-12 to 2026-09-06)
    '0xeac111678149818168dd8499882a234e2019a802'  -- legacy[1] (pre-audit pair)
  );

UPDATE public.archived_contracts
SET chain_id = 5042002,
    escrow_address = lower(data->>'escrowAddress')
WHERE chain_id IS NULL
  AND lower(data->>'escrowAddress') IN (
    '0x728ff16de0d6dfcaa1a8e7ed2ff95d9cb49663c8',
    '0x11184188c24ce546912617156c0693868a98b2a3',
    '0x6cbf4d958da24b7adc98fb7633213ac26b5a6f3a',
    '0xeac111678149818168dd8499882a234e2019a802'
  );

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS active_contracts_chain_idx ON public.active_contracts (chain_id, escrow_address);
CREATE INDEX IF NOT EXISTS archived_contracts_chain_idx ON public.archived_contracts (chain_id, escrow_address);

-- ── active_contracts: new partial unique index, coexisting with the OLD PK ──
-- This is the real, forward-looking uniqueness guarantee — one row per
-- wallet per (network, deployment) — but it does NOT touch or replace
-- active_contracts_pkey (the addr-only PRIMARY KEY). PostgreSQL has no
-- problem with two indexes covering overlapping/different column sets on
-- the same table simultaneously, so this is safe to add while the OLD
-- addr-PK-dependent backend is still running: the old backend's upserts
-- keep inferring ON CONFLICT (addr) against the still-present PK, completely
-- unaffected by this new index's existence. It is partial (chain_id IS NOT
-- NULL AND escrow_address IS NOT NULL) so it never blocks or touches the
-- ambiguous legacy rows left NULL above.
CREATE UNIQUE INDEX IF NOT EXISTS active_contracts_network_scoped_addr
  ON public.active_contracts (chain_id, escrow_address, addr)
  WHERE chain_id IS NOT NULL AND escrow_address IS NOT NULL;

-- ── archived_contracts: cross-network AND cross-deployment agreement_id collision guard ──
-- archived_contracts has its own independent `id bigserial` PRIMARY KEY,
-- untouched by any of this — there is no old-PK compatibility concern here
-- at all, unlike active_contracts. Arc Testnet and Arc Mainnet each
-- independently start nextAgreementId() at 0 — and, on Arc Testnet alone,
-- each of the four historical deployments did too — so the same
-- agreement_id can legitimately exist multiple times across (chain_id,
-- escrow_address) pairs. This scopes uniqueness to (chain_id,
-- escrow_address, agreement_id, addr) instead of the old, network-blind
-- duplicate check that previously lived only in application code — a
-- partial index so it never blocks the NULL/ambiguous rows above.
CREATE UNIQUE INDEX IF NOT EXISTS archived_contracts_network_scoped_agreement
  ON public.archived_contracts (chain_id, escrow_address, agreement_id, addr)
  WHERE chain_id IS NOT NULL AND escrow_address IS NOT NULL AND agreement_id IS NOT NULL;

-- ── Deliberately NOT done in this migration ─────────────────────────
-- active_contracts_pkey (the addr-only PRIMARY KEY) is NOT dropped here —
-- see *-contract.sql. Ambiguous legacy rows (chain_id/escrow_address still
-- NULL) are never deleted, merged, or guessed into a network — they remain
-- exactly as they were, simply invisible to every chain_id+escrow_address-
-- scoped runtime query, until an operator manually resolves their
-- provenance.
