-- Archived contracts table — supports multiple archived contracts per user
-- Run in Supabase SQL Editor (one-time migration)

CREATE TABLE IF NOT EXISTS archived_contracts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  addr            text NOT NULL,                      -- wallet address (lowercase)
  agreement_id    text,                               -- on-chain agreement ID
  peer_addr       text,                               -- counterparty address
  data            jsonb NOT NULL DEFAULT '{}',         -- original active_contracts.data
  snapshot        jsonb NOT NULL DEFAULT '{}',         -- immutable snapshot at archive time
  closed_reason   text,                               -- completed / rent_missed / mutual_exit / etc
  archived_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS archived_contracts_addr ON archived_contracts (addr);
CREATE INDEX IF NOT EXISTS archived_contracts_addr_archived ON archived_contracts (addr, archived_at DESC);
CREATE INDEX IF NOT EXISTS archived_contracts_agreement ON archived_contracts (agreement_id);

-- Prevent duplicate archives for same addr + agreement_id
CREATE UNIQUE INDEX IF NOT EXISTS archived_contracts_addr_agr_uniq
  ON archived_contracts (addr, agreement_id) WHERE agreement_id IS NOT NULL;

-- Note: active_contracts table remains unchanged (addr PK, one row per wallet).
-- On archive, the row is MOVED to archived_contracts (inserted + deleted from active_contracts).
-- This ensures active_contracts always has at most 1 row per addr = no breaking change.
