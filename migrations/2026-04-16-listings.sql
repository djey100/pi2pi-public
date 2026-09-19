-- pi2pi listings table — created 2026-04-16
-- Apply via Supabase SQL editor (project: pi2pi production)
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS listings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_addr      text NOT NULL,
  status          text NOT NULL DEFAULT 'draft',
  district        text NOT NULL,
  address         text NOT NULL DEFAULT '',
  zone_lat        double precision,
  zone_lng        double precision,
  property_type   text NOT NULL,
  floor           integer,
  monthly_rent    numeric NOT NULL,
  min_stay_months integer NOT NULL DEFAULT 6,
  amenities       jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  description     text NOT NULL DEFAULT '',
  description_mode    text NOT NULL DEFAULT 'auto',
  description_prompts jsonb,
  draft_data      jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  archived_at     timestamptz,
  suspended_at    timestamptz,

  CONSTRAINT chk_status CHECK (status IN ('draft','active','paused','suspended','archived')),
  CONSTRAINT chk_property_type CHECK (property_type IN ('Studio','1BR','2BR','3BR','House','Room')),
  CONSTRAINT chk_min_stay CHECK (min_stay_months IN (6,12,18,24)),
  CONSTRAINT chk_district CHECK (district IN ('Vake','Vera','Saburtalo','Old Town','Mtatsminda','Other')),
  CONSTRAINT chk_description_mode CHECK (description_mode IN ('auto','manual'))
);

-- Force lowercase wallet addresses on insert/update
CREATE OR REPLACE FUNCTION listings_lowercase_addr() RETURNS trigger AS $$
BEGIN
  NEW.owner_addr := lower(NEW.owner_addr);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listings_lowercase_addr_trg ON listings;
CREATE TRIGGER listings_lowercase_addr_trg
  BEFORE INSERT OR UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION listings_lowercase_addr();

-- Indexes
CREATE INDEX IF NOT EXISTS listings_owner_status ON listings(owner_addr, status);
CREATE INDEX IF NOT EXISTS listings_active ON listings(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS listings_district_active ON listings(district) WHERE status = 'active';

-- Verify table exists and structure is correct
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'listings'
ORDER BY ordinal_position;
