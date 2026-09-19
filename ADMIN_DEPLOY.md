# pi2pi Admin Panel — Deploy Guide

Phase 1 of the admin panel is ready. This is what's shipped and how to turn it on.

## What got built

- `supabase/admin_schema.sql` — 4 new tables: `admin_users`, `admin_audit`, `events`, `promocodes`
- `create_admin.js` — bootstrap script (first Owner only; refuses if one exists)
- `admin_routes.js` — all `/api/admin/*` endpoints (login, stats, users, promocodes, admins CRUD, audit)
- `arc/admin.html` + `arc/admin.jsx` — login → dashboard → users → promocodes → admins → audit
- `server-arc.js` — imports `handleAdmin`, serves `/admin` and `/admin.jsx`
- `package.json` — adds `bcryptjs` dependency and `create-admin` script

## Deploy steps

### 1. Install the new dependency

```bash
npm install
```

(bcryptjs is already in package.json.)

### 2. Run the SQL schema in Supabase

Open Supabase Dashboard → SQL Editor → paste contents of `supabase/admin_schema.sql` → Run.

This creates `admin_users`, `admin_audit`, `events`, `promocodes`.

### 3. Set `ADMIN_SESSION_SECRET`

Long random string used to HMAC-sign admin session cookies. Without it the server refuses all `/api/admin/*` requests.

**Local (`.env`):**

```
ADMIN_SESSION_SECRET=<paste 64+ random chars — e.g. `openssl rand -hex 48`>
```

**Fly.io:**

```bash
fly secrets set ADMIN_SESSION_SECRET="$(openssl rand -hex 48)"
```

### 4. Bootstrap the first Owner

```bash
node --env-file=.env create_admin.js you@pi2pi.io YourStrongPassword8+ "Your Name"
```

Prints ID/email on success. Script refuses to run twice — any additional admins are created from the UI.

### 5. Deploy

```bash
fly deploy
```

### 6. Log in

Open `https://pi2pi-project.fly.dev/admin` (or your domain once wired), sign in with the Owner email + password.

## Roles

| Role | Can do |
|------|--------|
| **Owner** (you) | Everything. Create/disable other admins, see audit log, revoke promos. |
| **Manager** | Issue/revoke promocodes, see all user data. Cannot manage admins. |
| **Support** | Read-only on user data and promocodes. |

Only Owner can create more admins. Do it from the **Admins** page once logged in.

## Promocode flow (Tbilisi launch)

1. Admin → Promocodes → **Generate batch** (e.g. 50 codes with prefix `TBILISI`, 30-day expiry, note "Vake area first wave")
2. Copy the batch from the green panel, hand out physically
3. Landlord enters code at registration → server marks `used_by_addr` + lifts proof-of-funds gate for listing
4. Admin tracks who used what from the **Promocodes** tab

*Note — the frontend redemption flow (landlord-side UI) is still TODO. For now codes can be issued and tracked, and the backend endpoint to consume them will land next.*

## Notes & TODOs

- **Promocode consumption endpoint:** `POST /api/promocodes/redeem` — not yet added. Needed before Tbilisi trip.
- **Listing view counter + events:** `POST /api/events` endpoint + calls from main app — not yet added.
- **Ban/unban user endpoint:** not yet added.
- **Real-time engagement funnel chart:** Phase 2, once `events` table has data.
- **Custom domain:** `/admin` is on the same origin as the main app. When you wire `pi2pi.io` via Namecheap → Fly certs, it automatically covers admin too.

## Security notes

- Session cookies are `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=7d`.
- Passwords hashed with bcrypt cost 12.
- Admin password changes: Owner → Admins page → (TODO: add password reset endpoint; currently must be done via SQL or create_admin replacement).
- All writes are logged to `admin_audit` with actor, action, target, and metadata.
- The admin HTML has `<meta name="robots" content="noindex">` to avoid accidental indexing.

## Backup before deploy

Before `fly deploy`, back up current production state:

```bash
bash backup.sh
```

And make sure you still have the JSX backups in `backups/`.
