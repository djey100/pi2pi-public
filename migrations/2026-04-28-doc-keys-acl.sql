-- doc_keys ACL: add owner_addr and peer_addr for decrypt authorization
-- Run this in Supabase SQL Editor

ALTER TABLE doc_keys
  ADD COLUMN IF NOT EXISTS owner_addr text,
  ADD COLUMN IF NOT EXISTS peer_addr text;

CREATE INDEX IF NOT EXISTS doc_keys_owner_addr_idx ON doc_keys(owner_addr);
CREATE INDEX IF NOT EXISTS doc_keys_peer_addr_idx ON doc_keys(peer_addr);

-- Normalize existing addresses to lowercase
UPDATE doc_keys SET owner_addr = lower(owner_addr) WHERE owner_addr IS NOT NULL;
UPDATE doc_keys SET peer_addr = lower(peer_addr) WHERE peer_addr IS NOT NULL;
