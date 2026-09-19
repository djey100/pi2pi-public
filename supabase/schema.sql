-- pi2pi Supabase schema (Sprint 2 migration from in-memory state in server-arc.js)
-- Apply this in Supabase Dashboard → SQL Editor → New Query → paste → Run

-- ========= USERS =========
create table if not exists public.users (
  addr text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- ========= MESSAGES =========
create table if not exists public.messages (
  id bigserial primary key,
  from_addr text not null,
  to_addr text not null,
  text text not null,
  type text default 'user',
  actor_address text,
  actor_role text,
  event_type text,
  created_at timestamptz not null default now()
);
create index if not exists messages_pair_idx on public.messages (from_addr, to_addr);
create index if not exists messages_to_idx on public.messages (to_addr);
create index if not exists messages_from_idx on public.messages (from_addr);

-- ========= VIEWING REQUESTS =========
create table if not exists public.viewing_requests (
  id bigserial primary key,
  from_addr text not null,
  to_addr text not null,
  listing_id text,
  listing_title text,
  message text,
  status text default 'pending',
  signature text,
  signed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists vr_from_idx on public.viewing_requests (from_addr);
create index if not exists vr_to_idx on public.viewing_requests (to_addr);

-- ========= CONTRACT PROPOSALS =========
create table if not exists public.contract_proposals (
  id bigserial primary key,
  from_addr text not null,
  to_addr text not null,
  status text default 'proposed',
  signatures jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists cp_from_idx on public.contract_proposals (from_addr);
create index if not exists cp_to_idx on public.contract_proposals (to_addr);

-- ========= CONTRACT FORMS =========
-- Key is `${addrLower1}-${addrLower2}` (parties sorted alphabetically)
create table if not exists public.contract_forms (
  key text primary key,
  form jsonb not null,
  updated_at timestamptz not null default now()
);

-- ========= ACTIVE CONTRACTS =========
create table if not exists public.active_contracts (
  addr text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- ========= EARLY TERMINATIONS =========
create table if not exists public.early_terms (
  id bigserial primary key,
  from_addr text not null,
  to_addr text not null,
  term_type text not null,
  reason text,
  status text default 'proposed',
  response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index if not exists et_from_idx on public.early_terms (from_addr);
create index if not exists et_to_idx on public.early_terms (to_addr);
