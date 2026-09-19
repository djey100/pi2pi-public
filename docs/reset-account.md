# Reset Account — Dev/Test Only

**Status:** Dev/test feature. NOT a user-facing production flow.

## What it does

`POST /api/users/:addr/reset` performs a full account wipe:

1. Checks for active contracts (blocks reset if any exist — 409)
2. Also checks if this addr is a counterparty in someone else's active contract (409)
3. Deletes draft listings (including photos from storage)
4. Archives active/paused/suspended/published listings
5. Deletes messages, viewing requests, contract proposals, early terms, contract forms
6. Deletes the user row

Returns: `{ ok, deletedDraftListings, archivedListings, deletedUser, photoWarnings? }`

## Feature flag

### Backend

Controlled by `ENABLE_ACCOUNT_RESET` environment variable.

- `ENABLE_ACCOUNT_RESET=true` — endpoint is active
- Not set or any other value — endpoint returns 404

On Fly.io production: do NOT set this variable (reset is disabled by default).

For local development: set in `.env` or run with `ENABLE_ACCOUNT_RESET=true node server-arc.js`.

### Frontend

Controlled by `VITE_ENABLE_ACCOUNT_RESET` build-time variable + localhost detection.

- On `localhost` — reset buttons always visible (for dev convenience)
- With `VITE_ENABLE_ACCOUNT_RESET=true` — visible on any host
- Production build without the variable — buttons hidden

The two menu items hidden in production:
- "Reset account" (wipes current user)
- "Reset all (both accounts + server)" (disabled endpoint)

## Safety guarantees

- Cannot reset if you have an active (non-archived) contract
- Cannot reset if you are a counterparty in someone else's active contract
- All Supabase errors are checked (fail-closed, not swallowed)
- Photo storage cleanup is best-effort (warnings returned, not blocking)
- Auth required: only the wallet owner can reset their own account

## Legacy endpoint

`DELETE /api/users/:addr` returns 410 Gone with a message to use the new endpoint.

## Local development

```bash
# Start server with reset enabled
ENABLE_ACCOUNT_RESET=true node server-arc.js

# Build frontend with reset visible
VITE_ENABLE_ACCOUNT_RESET=true npm run build
# Or just use localhost — reset buttons show automatically
```
