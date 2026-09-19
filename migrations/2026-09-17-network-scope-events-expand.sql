-- Network scoping for events — PHASE A: EXPAND, no backfill needed (TASK 10J)
-- Run in Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- Root cause: admin_routes.js's /api/admin/stats (view_listing count) and
-- GET /api/admin/users/:addr (per-user event history) read the `events`
-- table (supabase/admin_schema.sql) with no network filter — the same class
-- of gap TASK 10H/10I found and fixed for `listings`/`users.data.intent`.
-- server-arc.js/admin_routes.js have already been fixed (TASK 10J) to scope
-- only the marketplace-specific event types (post_listing, view_listing,
-- request_viewing, start_contract, sign_contract) by this `network` column;
-- identity/social event types (e.g. register, open_chat, send_message) are
-- left unscoped, matching the `messages` table's existing treatment.
--
-- Unlike listings.network (TASK 10G), NO BACKFILL is included or needed:
-- as of this migration's authoring, the `events` table is verified EMPTY in
-- production (checked read-only via PostgREST), and there is no live write
-- path into it anywhere in this codebase (no `.from("events").insert(...)`
-- call in server-arc.js, admin_routes.js, or arc/src — nor in this repo's
-- git history for those files). There is nothing to attribute. If/when a
-- write path to `events` is reintroduced, it MUST stamp network=NETWORK
-- from trusted runtime config, never from client input, exactly like the
-- `listings`/`users.data.intent` write paths TASK 10F/10I already require.
--
-- Additive / data-preserving: one nullable column, one index — no DELETE,
-- no TRUNCATE, no DROP TABLE, no DROP COLUMN, no UPDATE of any kind.

-- ── Column ───────────────────────────────────────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS network text;

-- ── Index ────────────────────────────────────────────────────────────
-- Supports both admin_routes.js's applyEventsNetworkScope() filters:
-- `network = X` (mainnet) and `network = X OR network IS NULL` (testnet,
-- transitional), scoped to the marketplace event types that actually use it.
CREATE INDEX IF NOT EXISTS events_network_event_idx ON public.events(network, event);

-- ── Verify ───────────────────────────────────────────────────────────
SELECT network, event, count(*) FROM public.events GROUP BY network, event ORDER BY network, event;
