// ─── pi2pi Admin Panel ───────────────────────────────────────────────
// Internal dashboard — served at /admin, reads /api/admin/* endpoints.
// Single-file React component tree. Inline CSS at top.
// ─────────────────────────────────────────────────────────────────────

const CSS = `
  :root {
    --a-bg: #fafbfc; --a-bg2: #ffffff; --a-bg3: #f9fafb; --a-bg4: #f3f4f6;
    --a-text: #111827; --a-text2: #1f2937; --a-muted: #6b7280; --a-dim: #4b5563; --a-label: #374151;
    --a-border: #e5e7eb; --a-border2: #d1d5db;
    --a-primary: #2563eb; --a-primary-h: #1d4ed8; --a-primary-s: #eff6ff; --a-primary-t: #1e40af;
    --a-danger: #dc2626; --a-danger-s: #fef2f2; --a-danger-b: #fecaca; --a-danger-t: #991b1b;
    --a-success-s: #f0fdf4; --a-success-t: #166534; --a-success-b: #bbf7d0;
    --a-warn-s: #fef3c7; --a-warn-t: #92400e;
    --a-link: #2563eb; --a-shadow: 0 10px 30px rgba(0,0,0,0.08);
  }
  [data-theme="dark"] {
    --a-bg: #05070D; --a-bg2: #0F1629; --a-bg3: #0A0F1C; --a-bg4: #1C2540;
    --a-text: #EAF0FF; --a-text2: #C8D0E0; --a-muted: #7F8AA3; --a-dim: #4B5563; --a-label: #7F8AA3;
    --a-border: #1C2540; --a-border2: #2A3560;
    --a-primary: #00FFA3; --a-primary-h: #00E695; --a-primary-s: rgba(0,255,163,0.10); --a-primary-t: #00FFA3;
    --a-danger: #FF5A5F; --a-danger-s: rgba(255,90,95,0.10); --a-danger-b: rgba(255,90,95,0.20); --a-danger-t: #FF5A5F;
    --a-success-s: rgba(0,255,163,0.10); --a-success-t: #00FFA3; --a-success-b: rgba(0,255,163,0.20);
    --a-warn-s: rgba(255,200,87,0.10); --a-warn-t: #FFC857;
    --a-link: #3ABEFF; --a-shadow: 0 10px 30px rgba(0,0,0,0.4);
  }

  * { box-sizing: border-box; }
  body { margin: 0; background: var(--a-bg); color: var(--a-text2); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  a { color: var(--a-link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  button { cursor: pointer; font-family: inherit; }
  input, select, textarea { font-family: inherit; font-size: 14px; color: var(--a-text); background: var(--a-bg2); }

  .admin-shell { display: flex; min-height: 100vh; background: var(--a-bg); }
  .admin-sidebar { width: 220px; background: var(--a-bg2); color: var(--a-text2); padding: 20px 0; flex-shrink: 0; border-right: 1px solid var(--a-border); }
  .admin-sidebar h1 { font-size: 16px; margin: 0 20px 24px; font-weight: 600; letter-spacing: 0.3px; color: var(--a-text); }
  .admin-nav-item { display: block; padding: 10px 20px; color: var(--a-dim); cursor: pointer; border-left: 3px solid transparent; font-size: 14px; }
  .admin-nav-item:hover { background: var(--a-bg4); color: var(--a-text); text-decoration: none; }
  .admin-nav-item.active { background: var(--a-primary-s); color: var(--a-primary-t); border-left-color: var(--a-primary); font-weight: 500; }
  .admin-sidebar-footer { position: absolute; bottom: 20px; width: 220px; padding: 0 20px; color: var(--a-muted); font-size: 12px; border-top: 1px solid var(--a-bg4); padding-top: 16px; }
  .admin-sidebar-footer-email { color: var(--a-text); margin-bottom: 4px; font-weight: 500; }

  .admin-main { flex: 1; padding: 24px 32px; overflow-x: auto; }
  .admin-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .admin-header h2 { margin: 0; font-size: 22px; color: var(--a-text); }

  .btn { padding: 8px 16px; border-radius: 6px; border: 1px solid var(--a-border2); background: var(--a-bg2); color: var(--a-text); font-size: 14px; }
  .btn:hover { background: var(--a-bg3); }
  .btn-primary { background: var(--a-primary); color: #fff; border-color: var(--a-primary); }
  .btn-primary:hover { background: var(--a-primary-h); }
  .btn-danger { color: var(--a-danger); border-color: var(--a-danger-b); }
  .btn-danger:hover { background: var(--a-danger-s); }
  .btn-sm { padding: 4px 10px; font-size: 12px; }

  .card { background: var(--a-bg2); border: 1px solid var(--a-border); border-radius: 8px; padding: 18px; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }
  .stat-card { background: var(--a-bg2); border: 1px solid var(--a-border); border-radius: 8px; padding: 16px; }
  .stat-label { font-size: 12px; color: var(--a-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .stat-value { font-size: 26px; font-weight: 600; color: var(--a-text); }
  .stat-sub { font-size: 12px; color: var(--a-muted); margin-top: 4px; }

  table { width: 100%; border-collapse: collapse; background: var(--a-bg2); }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--a-border); font-size: 13px; color: var(--a-text2); }
  th { background: var(--a-bg3); font-weight: 600; color: var(--a-label); font-size: 12px; text-transform: uppercase; letter-spacing: 0.3px; }
  tr:hover td { background: var(--a-bg3); }
  .table-wrap { background: var(--a-bg2); border: 1px solid var(--a-border); border-radius: 8px; overflow: hidden; }

  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-owner { background: var(--a-warn-s); color: var(--a-warn-t); }
  .badge-manager { background: var(--a-primary-s); color: var(--a-primary-t); }
  .badge-support { background: var(--a-primary-s); color: var(--a-primary-t); }
  .badge-landlord { background: var(--a-success-s); color: var(--a-success-t); }
  .badge-tenant { background: var(--a-primary-s); color: var(--a-primary-t); }
  .badge-warn { background: var(--a-danger-s); color: var(--a-danger-t); }
  .badge-ok { background: var(--a-success-s); color: var(--a-success-t); }
  .badge-used { background: var(--a-bg4); color: var(--a-dim); }
  .badge-unused { background: var(--a-success-s); color: var(--a-success-t); }

  .login-box { max-width: 380px; margin: 80px auto; background: var(--a-bg2); border-radius: 12px; padding: 36px; box-shadow: var(--a-shadow); border: 1px solid var(--a-border); }
  .login-box h1 { margin: 0 0 6px; font-size: 22px; color: var(--a-text); }
  .login-box p { color: var(--a-muted); margin: 0 0 24px; font-size: 14px; }

  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 12px; color: var(--a-label); margin-bottom: 4px; font-weight: 500; }
  .field input, .field select, .field textarea { width: 100%; padding: 8px 12px; border: 1px solid var(--a-border2); border-radius: 6px; background: var(--a-bg); color: var(--a-text); }
  .field input:focus, .field select:focus { outline: 2px solid var(--a-primary); outline-offset: -1px; border-color: transparent; }

  .error-box { background: var(--a-danger-s); color: var(--a-danger-t); padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 13px; border: 1px solid var(--a-danger-b); }
  .success-box { background: var(--a-success-s); color: var(--a-success-t); padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 13px; border: 1px solid var(--a-success-b); }

  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .modal-box { background: var(--a-bg2); border: 1px solid var(--a-border); border-radius: 10px; max-width: 720px; width: 100%; max-height: 90vh; overflow-y: auto; padding: 24px; color: var(--a-text); }
  .modal-box h3 { margin: 0 0 16px; font-size: 18px; }
  .modal-close { float: right; background: none; border: none; font-size: 22px; color: var(--a-muted); line-height: 1; }

  .filter-bar { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .filter-bar select, .filter-bar input { padding: 6px 10px; border: 1px solid var(--a-border2); border-radius: 6px; background: var(--a-bg); color: var(--a-text); }

  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .muted { color: var(--a-muted); }
  .code-list { background: #f9fafb; color: #111827; padding: 14px; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; border: 1px solid #e5e7eb; }

  @media (max-width: 720px) {
    .admin-shell { flex-direction: column; }
    .admin-sidebar { width: 100%; padding: 12px; }
    .admin-sidebar h1 { margin: 0 0 10px; }
    .admin-sidebar-footer { position: static; width: auto; padding: 10px 0 0; }
    .admin-nav-item { display: inline-block; padding: 6px 12px; border-left: none; border-bottom: 3px solid transparent; }
    .admin-nav-item.active { border-left: none; border-bottom-color: #60a5fa; }
    .admin-main { padding: 16px; }
  }
`;

// ── API helper ──────────────────────────────────────────────────────
let _adminCsrf = null;
// Read CSRF from cookie (set at login)
function getAdminCsrf() {
  if (_adminCsrf) return _adminCsrf;
  try {
    const m = document.cookie.match(/pi2pi_admin_csrf=([^;]+)/);
    if (m) _adminCsrf = decodeURIComponent(m[1]);
  } catch {}
  return _adminCsrf;
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  // Add CSRF token for mutating requests
  const method = opts.method || "GET";
  if (method === "POST" || method === "PATCH" || method === "DELETE") {
    const csrf = getAdminCsrf();
    if (csrf) headers["X-Admin-CSRF-Token"] = csrf;
  }
  const fetchOpts = { credentials: "include", headers };
  if (opts.method) fetchOpts.method = opts.method;
  if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
  const res = await fetch("/api/admin" + path, fetchOpts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  // Store CSRF from login response
  if (json.csrf) _adminCsrf = json.csrf;
  return json;
}

const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "—";
const fmtDate = (d) => d ? new Date(d).toLocaleString() : "—";
const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString() : "—";

// ── Login screen ────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const res = await api("/login", { method: "POST", body: { email, password } });
      onLogin(res.admin);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="login-box">
      <h1>pi2pi Admin</h1>
      <p>Internal panel. Sign in with your admin credentials.</p>
      <form onSubmit={submit}>
        {err && <div className="error-box">{err}</div>}
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus required />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

// ── Pie chart (inline SVG, no deps) ────────────────────────────────
function PieChart({ slices, size = 180 }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <div className="muted" style={{ padding: 20 }}>No data yet</div>;
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  let angle = -Math.PI / 2;
  const paths = slices.map((s, i) => {
    const slice = (s.value / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += slice;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = slice > Math.PI ? 1 : 0;
    const d = slices.length === 1
      ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
      : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return <path key={i} d={d} fill={s.color} stroke="#fff" strokeWidth="2" />;
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <svg width={size} height={size}>{paths}</svg>
      <div>
        {slices.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13 }}>
            <span style={{ display: "inline-block", width: 12, height: 12, background: s.color, borderRadius: 3 }} />
            <span>{s.label}</span>
            <strong style={{ marginLeft: 6 }}>{s.value}</strong>
            <span className="muted" style={{ fontSize: 12 }}>({total ? Math.round(s.value / total * 100) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────
function Dashboard() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/stats").then(setStats).catch(e => setErr(e.message));
  }, []);

  if (err) return <div className="error-box">{err}</div>;
  if (!stats) return <div className="muted">Loading…</div>;

  const topCities = Object.entries(stats.cities || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const fmtUsdc = (n) => n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " USDC";

  return (
    <>
      {/* ── Top-line metrics ─────────────────────────────────── */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total Users</div>
          <div className="stat-value">{stats.users.total}</div>
          <div className="stat-sub">{stats.users.landlords} landlords · {stats.users.tenants} tenants</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Listings</div>
          <div className="stat-value">{stats.listings.total}</div>
          <div className="stat-sub">{stats.users.insufficientFunds} with insufficient funds</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Contracts</div>
          <div className="stat-value">{stats.contracts.active}</div>
          <div className="stat-sub">{stats.disputes.total} in dispute</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Listing Views</div>
          <div className="stat-value">{stats.listings.views}</div>
          <div className="stat-sub" style={{ color: "#b45309" }}>⚠ tracking not wired yet</div>
        </div>
      </div>

      {/* ── Engagement metrics ────────────────────────────────── */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Conversations</div>
          <div className="stat-value">{stats.chats.conversations}</div>
          <div className="stat-sub">{stats.chats.messages} messages total</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Viewing Requests</div>
          <div className="stat-value">{stats.engagement.viewingRequests}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Contract Proposals</div>
          <div className="stat-value">{stats.engagement.contractProposals}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Disputes</div>
          <div className="stat-value">{stats.disputes.total}</div>
          <div className="stat-sub">{stats.disputes.earlyTermRequests} early-term requests</div>
        </div>
      </div>

      {/* ── Three-column: roles + wallet + cities ────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Landlords vs Tenants</h3>
          <PieChart slices={[
            { label: "Landlords", value: stats.users.landlords, color: "#60a5fa" },
            { label: "Tenants", value: stats.users.tenants, color: "#fbbf24" },
            { label: "Unset role", value: Math.max(0, stats.users.total - stats.users.landlords - stats.users.tenants), color: "#e5e7eb" },
          ]} />
        </div>
        <div className="card">
          <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Wallet Types</h3>
          <PieChart slices={[
            { label: "Circle (passkey)",  value: stats.wallets?.circle || 0,        color: "#10b981" },
            { label: "MetaMask / Rabby",  value: stats.wallets?.injected || 0,      color: "#f97316" },
            { label: "WalletConnect",     value: stats.wallets?.walletconnect || 0, color: "#6366f1" },
            { label: "Unknown (old data)", value: stats.wallets?.unknown || 0,       color: "#e5e7eb" },
          ]} />
          {(stats.wallets?.unknown || 0) > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: "#b45309" }}>
              ⚠ "Unknown" = users who registered before walletType tracking was added. New registrations will populate the other categories.
            </div>
          )}
        </div>
      </div>

      {/* ── Identity verifications ────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Identity / Proof of Humanity</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <div>
            <div className="stat-label">🌍 World ID</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{stats.identity?.worldIdVerified || 0}</div>
            <div className="stat-sub">proof of personhood</div>
          </div>
          <div>
            <div className="stat-label">🔐 Circle Biometric</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{stats.identity?.circleBiometric || 0}</div>
            <div className="stat-sub">passkey / FaceID wallet</div>
          </div>
          <div>
            <div className="stat-label">🛡️ Coinbase Verified</div>
            <div className="stat-value" style={{ fontSize: 22, color: "#9ca3af" }}>—</div>
            <div className="stat-sub" style={{ color: "#b45309" }}>⚠ not tracked yet</div>
          </div>
          <div>
            <div className="stat-label">Total users</div>
            <div className="stat-value" style={{ fontSize: 22 }}>{stats.users.total}</div>
            <div className="stat-sub">for comparison</div>
          </div>
        </div>
        <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--a-bg3)", border: "1px solid var(--a-border)", borderRadius: 6, fontSize: 12, color: "var(--a-dim)" }}>
          <strong>Coinbase Verified</strong> is currently checked only on the client (via Base EAS GraphQL, cached 10min).
          To track on this dashboard we'd need a server-side cron that queries EAS for every user and caches the result. Not built yet.
        </div>
      </div>

      {/* ── Top cities ────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Top cities</h3>
        {topCities.length === 0 && <div className="muted">No listings yet</div>}
        {topCities.map(([city, n]) => (
          <div key={city} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: 13 }}>
            <span>{city}</span>
            <strong>{n}</strong>
          </div>
        ))}
      </div>

      {/* ── Platform economics ─────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Platform Economics</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <div>
            <div className="stat-label">TVL (estimated)</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{fmtUsdc(stats.economics.tvlEstimate)}</div>
            <div className="stat-sub">deposits in active escrows</div>
          </div>
          <div>
            <div className="stat-label">Property Deposits</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{fmtUsdc(stats.economics.propDepTotal)}</div>
            <div className="stat-sub">PropDep escrow subset</div>
          </div>
          <div>
            <div className="stat-label">Lending APY</div>
            <div className="stat-value" style={{ fontSize: 20 }}>
              {stats.economics.lendingActive ? (stats.economics.lendingApy || "—") : "—"}
            </div>
            <div className="stat-sub" style={{ color: stats.economics.lendingActive ? "#166534" : "#b45309" }}>
              {stats.economics.lendingActive ? "live" : "⚠ lending not live yet"}
            </div>
          </div>
          <div>
            <div className="stat-label">Platform Profit</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{fmtUsdc(stats.economics.platformProfitTotal)}</div>
            <div className="stat-sub">30% of realized yield</div>
          </div>
        </div>
        {!stats.economics.lendingActive && (
          <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--a-warn-s)", border: "1px solid var(--a-border2)", borderRadius: 6, fontSize: 12, color: "var(--a-warn-t)" }}>
            <strong>Lending integration not yet deployed.</strong> Once Sprint 3b (Aave v3 on Arc) ships,
            deposits will auto-supply to the lending pool, APY + profit will populate here.
          </div>
        )}
      </div>
    </>
  );
}

// ── Disputes (live on-chain state) ─────────────────────────────────
// Countdown helper: unix seconds → human-readable "in 2d 4h" / "3h 12m ago" / "expired"
function countdown(ts) {
  if (!ts || ts === 0) return null;
  const now = Math.floor(Date.now() / 1000);
  const diff = ts - now;
  const past = diff < 0;
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86400);
  const h = Math.floor((abs % 86400) / 3600);
  const m = Math.floor((abs % 3600) / 60);
  let s = "";
  if (d > 0) s = `${d}d ${h}h`;
  else if (h > 0) s = `${h}h ${m}m`;
  else s = `${m}m`;
  return past ? { text: s + " ago", expired: true } : { text: "in " + s, expired: false };
}
const fmtAbsTime = (ts) => ts ? new Date(ts * 1000).toLocaleString() : "—";
const roleOf = (addr, d) => {
  if (!addr) return null;
  const a = addr.toLowerCase();
  if (a === (d.tenant || "").toLowerCase()) return "tenant";
  if (a === (d.landlord || "").toLowerCase()) return "landlord";
  return null;
};

function DisputesPage() {
  // Tab persists across refresh via sessionStorage
  const [tab, _setTab] = useState(() => {
    try { return sessionStorage.getItem("pi2pi_admin_disputes_tab") || "active"; }
    catch { return "active"; }
  });
  const setTab = (t) => {
    try { sessionStorage.setItem("pi2pi_admin_disputes_tab", t); } catch {}
    _setTab(t);
  };
  return (
    <>
      <div className="filter-bar" style={{ marginBottom: 14 }}>
        <button className={"btn " + (tab === "active" ? "btn-primary" : "")} onClick={() => setTab("active")}>● Active</button>
        <button className={"btn " + (tab === "history" ? "btn-primary" : "")} onClick={() => setTab("history")}>History</button>
      </div>
      {tab === "active" ? <ActiveDisputes /> : <HistoryDisputes />}
    </>
  );
}

function ActiveDisputes() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all"); // all | rental | propdep | needsAction
  const [selected, setSelected] = useState(null); // dispute being detail-viewed

  const load = async () => {
    setLoading(true); setErr("");
    try { setData(await api("/disputes")); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (err) return <div className="error-box">{err}</div>;
  if (!data) return <div className="muted">Loading on-chain state…</div>;

  const items = data.items || [];
  const filtered = items.filter(d => {
    if (filter === "rental") return d.rental.inDispute;
    if (filter === "propdep") return d.propdep.inDispute;
    if (filter === "needsAction") return d.rental.freezeExpired || d.propdep.freezeExpired;
    return true;
  });

  return (
    <>
      {/* Summary buckets */}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-label">Total active disputes</div>
          <div className="stat-value">{data.total}</div>
          <div className="stat-sub">across rental + propdep</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rental 60-day freeze</div>
          <div className="stat-value" style={{ color: "#b45309" }}>
            {data.buckets.needsResolutionRental}
          </div>
          <div className="stat-sub">+{data.buckets.keeperCanReleaseRental} ready for release</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">PropDep freeze</div>
          <div className="stat-value" style={{ color: "#b45309" }}>
            {data.buckets.needsResolutionPropdep}
          </div>
          <div className="stat-sub">+{data.buckets.keeperCanReleasePropdep} ready for release</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Awaiting tenant response</div>
          <div className="stat-value">{data.buckets.landlordClaimPendingTenant}</div>
          <div className="stat-sub">propdep claims filed</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Awaiting landlord bond</div>
          <div className="stat-value">{data.buckets.awaitingBond}</div>
          <div className="stat-sub">tenant disputed, LL silent</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Early term proposed</div>
          <div className="stat-value">{data.buckets.earlyTermProposed}</div>
          <div className="stat-sub">mutual exit pending</div>
        </div>
      </div>

      <div className="filter-bar">
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All disputes ({items.length})</option>
          <option value="rental">Rental escrow only</option>
          <option value="propdep">PropDep escrow only</option>
          <option value="needsAction">⚠ Freeze expired — ready for release</option>
        </select>
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {filtered.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--a-muted)" }}>
          {items.length === 0
            ? "✨ No active disputes on-chain. All rentals running clean."
            : "No disputes match the selected filter."}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Parties</th>
                <th>Initiator</th>
                <th>Rental</th>
                <th>PropDep</th>
                <th>Deadline</th>
                <th>At risk</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                // Decide primary initiator + primary deadline to show inline
                const initAddr = d.rental.state === 7 && d.rental.detail?.disputeBondPoster && d.rental.detail.disputeBondPoster !== "0x0000000000000000000000000000000000000000"
                  ? d.rental.detail.disputeBondPoster
                  : (d.rental.detail?.earlyTermInitiator && d.rental.detail.earlyTermInitiator !== "0x0000000000000000000000000000000000000000"
                    ? d.rental.detail.earlyTermInitiator
                    : (d.propdep.inDispute ? d.landlord : null));
                const initRole = roleOf(initAddr, d) || (d.propdep.inDispute ? "landlord" : null);
                // Inline deadline priority:
                // propdep state 4 freeze > rental state 7 freeze > state 4 response > state 5 checkout > propdep 2 tenant response > propdep 3 LL bond
                let deadline = null;
                if (d.propdep.state === 4 && d.propdep.detail?.freezeEndTs) {
                  deadline = { label: "PropDep freeze", ts: d.propdep.detail.freezeEndTs };
                } else if (d.rental.state === 7 && d.rental.detail?.freezeEndTs) {
                  deadline = { label: "Rental freeze", ts: d.rental.detail.freezeEndTs };
                } else if (d.rental.state === 4 && d.rental.detail?.responseDeadlineTs) {
                  deadline = { label: "Counterparty response", ts: d.rental.detail.responseDeadlineTs };
                } else if (d.rental.state === 5 && d.rental.detail?.checkoutDeadlineTs) {
                  deadline = { label: "Checkout response", ts: d.rental.detail.checkoutDeadlineTs };
                } else if (d.propdep.state === 2 && d.propdep.detail?.tenantResponseDeadlineTs) {
                  deadline = { label: "Tenant response", ts: d.propdep.detail.tenantResponseDeadlineTs };
                } else if (d.propdep.state === 3 && d.propdep.detail?.landlordBondDeadlineTs) {
                  deadline = { label: "LL post bond", ts: d.propdep.detail.landlordBondDeadlineTs };
                }
                const cd = deadline ? countdown(deadline.ts) : null;
                return (
                  <tr key={d.agreementId}>
                    <td><strong>#{d.agreementId}</strong></td>
                    <td style={{ fontSize: 11, lineHeight: 1.5 }}>
                      <div><span className="badge badge-tenant" style={{ marginRight: 6 }}>T</span><span className="mono">{short(d.tenant)}</span></div>
                      <div><span className="badge badge-landlord" style={{ marginRight: 6 }}>L</span><span className="mono">{short(d.landlord)}</span></div>
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {initRole ? (
                        <>
                          <span className={"badge badge-" + initRole}>{initRole === "tenant" ? "Tenant" : "Landlord"}</span>
                          <div className="mono muted" style={{ fontSize: 10, marginTop: 2 }}>{short(initAddr)}</div>
                          {d.rental.state === 7
                            ? <div className="muted" style={{ fontSize: 10 }}>Dispute</div>
                            : d.rental.detail?.earlyTermTypeLabel && d.rental.detail.earlyTermTypeLabel !== "None" && (
                              <div className="muted" style={{ fontSize: 10 }}>{d.rental.detail.earlyTermTypeLabel}</div>
                            )}
                        </>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      {d.rental.inDispute ? (
                        <span className="badge" style={{ background: stateColor(d.rental.state, "rental") + "22", color: stateColor(d.rental.state, "rental") }}>
                          {d.rental.label}
                        </span>
                      ) : <span className="muted">{d.rental.label}</span>}
                    </td>
                    <td>
                      {d.propdep.inDispute ? (
                        <>
                          <span className="badge" style={{ background: stateColor(d.propdep.state, "propdep") + "22", color: stateColor(d.propdep.state, "propdep") }}>
                            {d.propdep.label}
                          </span>
                          {d.propdep.detail?.claimAmountUsdc > 0 && (
                            <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>claim: {d.propdep.detail.claimAmountUsdc} USDC</div>
                          )}
                        </>
                      ) : <span className="muted">{d.propdep.label}</span>}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {cd ? (
                        <>
                          <div style={{ color: cd.expired ? "#dc2626" : "#111827", fontWeight: cd.expired ? 600 : 400 }}>
                            {cd.expired ? "⚠ " : ""}{cd.text}
                          </div>
                          <div className="muted" style={{ fontSize: 10 }}>{deadline.label}</div>
                        </>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td style={{fontSize:11}}>
                      {d.rental.detail?.monthlyRentUsdc > 0 && <div>{(d.rental.detail.commitmentUsdc||0)+(d.rental.detail.hostingUsdc||0)} USDC deposits</div>}
                      {d.propdep.detail?.amountUsdc > 0 && <div>{d.propdep.detail.amountUsdc} USDC prop.dep</div>}
                    </td>
                    <td>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        <button className="btn btn-sm" onClick={() => setSelected(d)}>Details</button>
                        <button className="btn btn-sm" onClick={() => {setPage("inspector");sessionStorage.setItem("pi2pi_admin_inspector_id",d.agreementId);}}>Inspector</button>
                        <button className="btn btn-sm" onClick={() => {setPage("walletdiag");sessionStorage.setItem("pi2pi_admin_walletdiag_addr",d.tenant);}}>T diag</button>
                        <button className="btn btn-sm" onClick={() => {setPage("walletdiag");sessionStorage.setItem("pi2pi_admin_walletdiag_addr",d.landlord);}}>L diag</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && <DisputeDetailModal d={selected} onClose={() => setSelected(null)} />}

      <details style={{ marginTop: 16, padding: "12px 14px", background: "var(--a-bg3)", border: "1px solid var(--a-border)", borderRadius: 6, fontSize: 12, color: "var(--a-dim)" }}>
        <summary style={{cursor:"pointer",fontWeight:700}}>State reference guide</summary>
        <ul style={{ margin: "6px 0 0 20px", padding: 0, lineHeight: 1.6 }}>
          <li><strong>Rental 4 (EarlyTermProposed)</strong> — mutual exit proposed, 7d timeout</li>
          <li><strong>Rental 5 (CheckoutProposed)</strong> — lease ending, 14d checkout</li>
          <li><strong>Rental 7 (DisputeOpen)</strong> — 60-day freeze on deposits</li>
          <li><strong>PropDep 2 (Claimed)</strong> — landlord filed claim, tenant has 3d</li>
          <li><strong>PropDep 3 (Disputed)</strong> — tenant disputed, landlord must post bond in 3d</li>
          <li><strong>PropDep 4 (Frozen)</strong> — bond posted, 60-day freeze</li>
        </ul>
      </details>
    </>
  );
}

function DisputeDetailModal({ d, onClose }) {
  const re = d.rental.detail;
  const pd = d.propdep.detail;
  const Row = ({ k, v, mono }) => (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>
      <span className="muted">{k}</span>
      <span className={mono ? "mono" : ""} style={{ wordBreak: "break-all" }}>{v ?? "—"}</span>
    </div>
  );
  const Section = ({ title, color, children }) => (
    <div style={{ marginBottom: 14 }}>
      <h4 style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700, color: color || "#111827", textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</h4>
      {children}
    </div>
  );
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>Dispute #{d.agreementId}</h3>

        <Section title="Parties">
          <Row k="Contract ID" v={"#" + d.agreementId} />
          <Row k="Tenant"   v={d.tenant} mono />
          <Row k="Landlord" v={d.landlord} mono />
          <Row k="City"     v={d.city || "(no metadata in DB)"} />
          <Row k="Rent"     v={d.rent ? d.rent + " USDC/mo" : "---"} />
          <Row k="Contract first seen" v={fmtDate(d.contractStartedAt)} />
        </Section>

        <Section title="Amounts at Risk" color="#b45309">
          <Row k="Commitment Deposit (TN)" v={d.rent ? d.rent + " USDC" : "---"} />
          <Row k="Hosting Deposit (LL)" v={d.rent ? d.rent + " USDC" : "---"} />
          <Row k="PropDep amount" v={d.propDepAmount ? d.propDepAmount + " USDC" : "0 / none"} />
          {re?.disputeBondPoster && re.disputeBondPoster !== "0x0000000000000000000000000000000000000000" && (
            <Row k="Dispute bond" v={d.rent ? d.rent + " USDC" : "---"} />
          )}
          {pd?.disputeBondMicro > 0 && (
            <Row k="PropDep dispute bond" v={(pd.disputeBondMicro / 1e6) + " USDC"} />
          )}
          <Row k="Total at stake" v={(() => {
            const r = Number(d.rent || 0);
            const pd_amt = Number(d.propDepAmount || 0);
            const total = r * 2 + pd_amt; // commitment + hosting + propDep
            return total > 0 ? total + " USDC" : "---";
          })()} />
        </Section>

        {d.rental.inDispute && (
          <Section title={`Rental escrow — ${d.rental.label}`} color={stateColor(d.rental.state, "rental")}>
            {re?.earlyTermInitiator && re.earlyTermInitiator !== "0x0000000000000000000000000000000000000000" && (
              <>
                <Row k="Initiator" v={
                  <>
                    <span className={"badge badge-" + (re.initiatorRole || "")} style={{ marginRight: 8 }}>
                      {re.initiatorRole === "tenant" ? "Tenant" : re.initiatorRole === "landlord" ? "Landlord" : "?"}
                    </span>
                    <span className="mono">{re.earlyTermInitiator}</span>
                  </>
                } />
                <Row k="Early term type" v={re.earlyTermTypeLabel} />
                <Row k="Proposed at" v={fmtAbsTime(re.earlyTermProposedAt)} />
              </>
            )}
            {d.rental.state === 4 && re?.responseDeadlineTs > 0 && (
              <Row k="Counterparty response deadline" v={
                <>
                  {fmtAbsTime(re.responseDeadlineTs)}
                  {" · "}<strong style={{ color: countdown(re.responseDeadlineTs)?.expired ? "#dc2626" : "#111827" }}>
                    {countdown(re.responseDeadlineTs)?.text}
                  </strong>
                </>
              } />
            )}
            {d.rental.state === 5 && re?.checkoutDeadlineTs > 0 && (
              <Row k="Checkout response deadline" v={fmtAbsTime(re.checkoutDeadlineTs) + " · " + (countdown(re.checkoutDeadlineTs)?.text || "")} />
            )}
            {d.rental.state === 7 && (
              <>
                <Row k="Dispute initiated by (bond poster)" v={
                  <>
                    {(() => {
                      const r = roleOf(re?.disputeBondPoster, d);
                      return r ? <span className={"badge badge-" + r} style={{ marginRight: 8 }}>{r === "tenant" ? "Tenant" : "Landlord"}</span> : null;
                    })()}
                    <span className="mono">{re?.disputeBondPoster}</span>
                  </>
                } />
                <Row k="Freeze started" v={fmtAbsTime(re.freezeStart)} />
                <Row k="Freeze ends (60d)" v={
                  <>
                    {fmtAbsTime(re.freezeEndTs)}
                    {" · "}<strong style={{ color: countdown(re.freezeEndTs)?.expired ? "#dc2626" : "#111827" }}>
                      {countdown(re.freezeEndTs)?.text}
                      {countdown(re.freezeEndTs)?.expired && " — keeper can call releaseFrozenFunds"}
                    </strong>
                  </>
                } />
                {re?.vacateDeadline > 0 && (
                  <Row k="Initiator must vacate by" v={fmtAbsTime(re.vacateDeadline)} />
                )}
              </>
            )}
          </Section>
        )}

        {d.propdep.inDispute && (
          <Section title={`PropDep escrow — ${d.propdep.label}`} color={stateColor(d.propdep.state, "propdep")}>
            <Row k="Initiator" v={
              <>
                <span className="badge badge-landlord" style={{ marginRight: 8 }}>Landlord</span>
                <span className="muted">filed damage claim</span>
              </>
            } />
            <Row k="Claim amount" v={pd?.claimAmountUsdc ? pd.claimAmountUsdc + " USDC" : "—"} />
            {d.propdep.state === 2 && pd?.tenantResponseDeadlineTs > 0 && (
              <Row k="Tenant response deadline" v={
                <>
                  {fmtAbsTime(pd.tenantResponseDeadlineTs)}
                  {" · "}<strong style={{ color: countdown(pd.tenantResponseDeadlineTs)?.expired ? "#dc2626" : "#111827" }}>
                    {countdown(pd.tenantResponseDeadlineTs)?.text}
                  </strong>
                </>
              } />
            )}
            {d.propdep.state === 3 && pd?.landlordBondDeadlineTs > 0 && (
              <Row k="Landlord bond deadline" v={
                <>
                  {fmtAbsTime(pd.landlordBondDeadlineTs)}
                  {" · "}<strong style={{ color: countdown(pd.landlordBondDeadlineTs)?.expired ? "#dc2626" : "#111827" }}>
                    {countdown(pd.landlordBondDeadlineTs)?.text}
                  </strong>
                </>
              } />
            )}
            {d.propdep.state === 4 && (
              <>
                <Row k="Bond posted" v={pd?.disputeBondMicro ? (pd.disputeBondMicro / 1e6) + " USDC" : "—"} />
                <Row k="Bond poster" v={pd?.bondPoster} mono />
                <Row k="Freeze started" v={fmtAbsTime(pd.freezeStart)} />
                <Row k="Freeze ends (60d)" v={
                  <>
                    {fmtAbsTime(pd.freezeEndTs)}
                    {" · "}<strong style={{ color: countdown(pd.freezeEndTs)?.expired ? "#dc2626" : "#111827" }}>
                      {countdown(pd.freezeEndTs)?.text}
                      {countdown(pd.freezeEndTs)?.expired && " — keeper can call releaseFrozenFunds"}
                    </strong>
                  </>
                } />
              </>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

// ── History: resolved disputes ─────────────────────────────────────
function HistoryDisputes() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState("all"); // all / rental / propdep
  const [selected, setSelected] = useState(null);

  const load = async (nocache = false) => {
    setLoading(true); setErr("");
    try { setData(await api("/disputes/history" + (nocache ? "?nocache=1" : ""))); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (err) return <div className="error-box">{err}</div>;
  if (!data) return <div className="muted">Scanning on-chain event logs… this can take 5-20 seconds on first load.</div>;

  const items = data.items || [];
  const filtered = items.filter(i => {
    if (outcomeFilter === "rental") return i.source === "rental";
    if (outcomeFilter === "propdep") return i.source === "propdep";
    return true;
  });

  // Bucket counts by outcome reason
  const byReason = items.reduce((m, i) => {
    m[i.reason] = (m[i.reason] || 0) + 1;
    return m;
  }, {});
  const topReasons = Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <>
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="stat-label">Total resolved disputes</div>
          <div className="stat-value">{data.total}</div>
          <div className="stat-sub">in last ~{Math.round(data.scanWindow.blocks / 1000)}k blocks</div>
        </div>
        {topReasons.map(([r, n]) => {
          const rentalOutcome = items.find(i => i.reason === r && i.source === "rental")?.outcome;
          const propdepOutcome = items.find(i => i.reason === r && i.source === "propdep")?.outcome;
          const oc = rentalOutcome || propdepOutcome;
          return (
            <div key={r} className="stat-card">
              <div className="stat-label" style={{ color: oc?.color }}>{oc?.label || r}</div>
              <div className="stat-value">{n}</div>
              <div className="stat-sub"><span className="mono">{r}</span></div>
            </div>
          );
        })}
      </div>

      <div className="filter-bar">
        <select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)}>
          <option value="all">All disputes ({items.length})</option>
          <option value="rental">Rental escrow only</option>
          <option value="propdep">PropDep escrow only</option>
        </select>
        <button className="btn btn-sm" onClick={() => load(false)} disabled={loading}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
        <button className="btn btn-sm" onClick={() => load(true)} disabled={loading}>↻ Force rescan</button>
        <span className="muted" style={{ alignSelf: "center", fontSize: 11 }}>
          {data.cached ? `cache: ${data.cachedAgeSec}s old` : "fresh scan"}
        </span>
      </div>

      {filtered.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--a-muted)" }}>
          No resolved disputes found in the scan window.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Source</th>
                <th>Parties</th>
                <th>Outcome</th>
                <th>Reason</th>
                <th>Settled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(i => (
                <tr key={i.source + "-" + i.agreementId + "-" + i.txHash}>
                  <td><strong>#{i.agreementId}</strong></td>
                  <td>
                    <span className="badge" style={{ background: i.source === "rental" ? "#dbeafe" : "#fef3c7", color: i.source === "rental" ? "#1e40af" : "#92400e" }}>
                      {i.source === "rental" ? "Rental" : "PropDep"}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, lineHeight: 1.5 }}>
                    <div><span className="badge badge-tenant" style={{ marginRight: 6 }}>T</span><span className="mono">{short(i.tenant)}</span></div>
                    <div><span className="badge badge-landlord" style={{ marginRight: 6 }}>L</span><span className="mono">{short(i.landlord)}</span></div>
                  </td>
                  <td>
                    <span className="badge" style={{ background: (i.outcome?.color || "#6b7280") + "22", color: i.outcome?.color }}>
                      {i.outcome?.label}
                    </span>
                    {i.outcome?.detail && <div style={{fontSize:10,color:"var(--a-dim)",marginTop:2,maxWidth:220}}>{i.outcome.detail}</div>}
                  </td>
                  <td className="muted" style={{ fontSize: 11 }}>{i.settledAt ? new Date(i.settledAt * 1000).toLocaleString() : fmtDateShort(i.blockNumber)}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => setSelected(i)}>Timeline</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <HistoryDetailModal d={selected} onClose={() => setSelected(null)} />}

      <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--a-bg3)", border: "1px solid var(--a-border)", borderRadius: 6, fontSize: 11, color: "var(--a-muted)" }}>
        Scan window: blocks <span className="mono">{data.scanWindow.fromBlock}</span> → <span className="mono">{data.scanWindow.toBlock}</span> (~2M blocks, Arc RPC limits each <code>getLogs</code> call to 10k blocks, so full scan = ~200 parallel calls, cached 5 min). Older disputes not shown — current contract deployed 2026-04-13, so nothing is missed for this deployment.
      </div>
    </>
  );
}

function HistoryDetailModal({ d, onClose }) {
  const [msgs, setMsgs] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!d.tenant || !d.landlord) { setErr("missing parties"); return; }
    api(`/disputes/history/${d.tenant}/${d.landlord}`)
      .then(r => setMsgs(r.items || []))
      .catch(e => setErr(e.message));
  }, [d]);

  const iconFor = (eventType) => {
    const m = {
      viewing_requested:  "👁",
      viewing_confirmed:  "✅",
      contract_proposed:  "📋",
      contract_accepted:  "✍️",
      deposit_placed:     "💰",
      agreement_activated: "🏠",
      rent_paid:          "💵",
      early_term_proposed: "🚪",
      early_term_mutual:  "🤝",
      early_term_executed: "➡️",
      damage_claim_filed: "⚠️",
      damage_claim_accepted: "✔",
      damage_claim_disputed: "❗",
      bond_posted:        "🔒",
      dispute_freeze_started: "🧊",
      agreement_settled:  "🏁",
    };
    return m[eventType] || "·";
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>Timeline — Dispute #{d.agreementId}</h3>

        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", fontSize: 12, lineHeight: 1.8 }}>
            <span className="muted">Source</span><span>{d.source === "rental" ? "Rental escrow" : "PropDep escrow"}</span>
            <span className="muted">Outcome</span>
            <span>
              <span className="badge" style={{ background: (d.outcome?.color || "#6b7280") + "22", color: d.outcome?.color }}>{d.outcome?.label}</span>
              {" · "}<span className="mono muted" style={{ fontSize: 11 }}>{d.reason}</span>
            </span>
            <span className="muted">Tenant</span><span className="mono">{d.tenant}</span>
            <span className="muted">Landlord</span><span className="mono">{d.landlord}</span>
            <span className="muted">Settled block</span><span className="mono">{d.blockNumber}</span>
            <span className="muted">Settled at</span><span>{d.settledAt ? new Date(d.settledAt * 1000).toLocaleString() : "—"}</span>
            <span className="muted">Tx</span>
            <span className="mono" style={{ fontSize: 10, wordBreak: "break-all" }}>{d.txHash}</span>
          </div>
        </div>

        <h4 style={{ margin: "0 0 10px", fontSize: 13 }}>Chat timeline between parties</h4>

        {err && <div className="error-box">{err}</div>}
        {!msgs && !err && <div className="muted">Loading…</div>}
        {msgs && msgs.length === 0 && <div className="muted" style={{ padding: 16 }}>No messages recorded in DB for this pair. If the dispute happened entirely on-chain without passing through the app UI, chat log will be empty.</div>}

        {msgs && msgs.length > 0 && (
          <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid var(--a-border)", borderRadius: 6, padding: 10 }}>
            {msgs.map(m => {
              const isSystem = m.type === "system";
              const fromTenant = m.from_addr === (d.tenant || "").toLowerCase();
              return (
                <div key={m.id} style={{ padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontSize: 14 }}>{isSystem ? iconFor(m.event_type) : "💬"}</span>
                    <span className="badge" style={{ background: fromTenant ? "#e0e7ff" : "#dcfce7", color: fromTenant ? "#3730a3" : "#166534", fontSize: 10 }}>
                      {fromTenant ? "Tenant" : "Landlord"}
                    </span>
                    <span className="muted" style={{ fontSize: 10 }}>{new Date(m.created_at).toLocaleString()}</span>
                    {m.event_type && <span className="mono muted" style={{ fontSize: 10 }}>{m.event_type}</span>}
                  </div>
                  <div style={{ paddingLeft: 28, color: isSystem ? "#374151" : "#111827", fontStyle: isSystem ? "italic" : "normal" }}>
                    {m.text}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper used by DisputeDetailModal — state color shared with table above
function stateColor(s, kind) {
  if (kind === "rental") {
    if (s === 7) return "#b45309";
    if (s === 4) return "#2563eb";
    if (s === 5) return "#6366f1";
  }
  if (kind === "propdep") {
    if (s === 4) return "#b45309";
    if (s === 3) return "#dc2626";
    if (s === 2) return "#2563eb";
  }
  return "#6b7280";
}

// ── Users list ─────────────────────────────────────────────────────
function printUserQR(u) {
  const isLandlord = u.role === "landlord";
  const heading = isLandlord ? "FOR RENT" : "LOOKING FOR";
  const title = isLandlord
    ? `${u.city || "Property"} · $${u.rent || "?"}/mo`
    : `${u.propType || ""} · ${u.city || ""} · $${u.rent || "?"}/mo`;
  const url = isLandlord
    ? `https://my.pi2pi.io/#/listing/real-${u.listingId || ""}`
    : `https://my.pi2pi.io/#/tenant/${u.addr}`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(url)}`;
  const card = `<div class="card"><div class="heading">${heading}</div><div class="details">${u.name || short(u.addr)} · ${title}</div><img class="qr" src="${qrImg}" width="180" height="180" alt="QR"/><div class="brand">pi2pi.io</div><div class="sub">Rental agreements on blockchain</div></div>`;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>pi2pi QR</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif}.page{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;width:210mm;height:297mm;padding:5mm}.card{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:1px dashed #ccc;padding:10mm}.heading{font-size:28px;font-weight:900;letter-spacing:2px;margin-bottom:8px}.details{font-size:14px;font-weight:600;color:#333;margin-bottom:16px;line-height:1.4}.qr{margin:0 0 12px}.brand{font-size:13px;font-weight:700;color:#555}.sub{font-size:9px;color:#999;margin-top:3px}@media print{.page{padding:0}.card{border:1px dashed #ddd}}</style></head><body><div class="page">${card}${card}${card}${card}</div><script>setTimeout(()=>window.print(),800)<\/script></body></html>`);
  win.document.close();
}

function UsersList({ onSelectUser }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    try {
      const q = roleFilter ? `?role=${roleFilter}` : "";
      const res = await api("/users" + q);
      setData(res);
    } catch (e) { setErr(e.message); }
  };

  useEffect(() => { load(); }, [roleFilter]);

  if (err) return <div className="error-box">{err}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const filtered = search
    ? data.items.filter(u =>
        u.addr.toLowerCase().includes(search.toLowerCase()) ||
        (u.city || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.name || "").toLowerCase().includes(search.toLowerCase())
      )
    : data.items;

  return (
    <>
      <div className="filter-bar">
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          <option value="landlord">Landlords</option>
          <option value="tenant">Tenants</option>
        </select>
        <input
          type="text"
          placeholder="Search address or city…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <span className="muted" style={{ alignSelf: "center" }}>{filtered.length} of {data.total}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Address</th><th>Role</th><th>Wallet</th><th>Identity</th><th>City</th><th>Rent</th><th>Balance</th><th>Updated</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.addr}>
                <td>{u.name || <span className="muted">—</span>}</td>
                <td className="mono">{short(u.addr)}</td>
                <td>{u.role ? <span className={"badge badge-" + u.role}>{u.role}</span> : "—"}</td>
                <td style={{ fontSize: 11 }}>
                  {u.walletType === "circle" && <span title="Circle Modular Wallet (passkey)">🔐 Circle</span>}
                  {u.walletType === "injected" && <span title="MetaMask / Rabby / Brave">🦊 Injected</span>}
                  {u.walletType === "walletconnect" && <span title="WalletConnect">🔗 WC</span>}
                  {!u.walletType && <span className="muted">—</span>}
                </td>
                <td style={{ fontSize: 11 }}>
                  {u.worldIdVerified && <span title="World ID verified" style={{ marginRight: 4 }}>🌍</span>}
                  {u.circleBiometric && <span title="Circle Biometric (passkey wallet)">🔐</span>}
                  {!u.worldIdVerified && !u.circleBiometric && <span className="muted">—</span>}
                </td>
                <td>{u.city || "—"}</td>
                <td>{u.rent ? u.rent + " USDC" : "—"}</td>
                <td>
                  {u.lastBalance != null ? u.lastBalance.toFixed(2) : "—"}
                  {u.fundsCheckFailed && <span className="badge badge-warn" style={{ marginLeft: 4, fontSize: 10 }}>low</span>}
                </td>
                <td className="muted">{fmtDateShort(u.updatedAt)}</td>
                <td style={{display:"flex",gap:4}}>
                  <button className="btn btn-sm" onClick={() => onSelectUser(u.addr)}>Detail</button>
                  {(u.role === "tenant" || u.role === "landlord") && <button className="btn btn-sm" onClick={() => printUserQR(u)} title="Print QR">QR</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── User detail modal ──────────────────────────────────────────────
function UserDetail({ addr, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/users/" + addr).then(setData).catch(e => setErr(e.message));
  }, [addr]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>User <span className="mono">{short(addr)}</span></h3>
        {err && <div className="error-box">{err}</div>}
        {!data && !err && <div className="muted">Loading…</div>}
        {data && (
          <>
            <div className="card" style={{ marginBottom: 12 }}>
              <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--a-muted)", textTransform: "uppercase" }}>Profile</h4>
              <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                <div><strong>Address:</strong> <span className="mono">{addr}</span></div>
                <div><strong>Role:</strong> {data.profile?.role || "—"}</div>
                <div><strong>Balance:</strong> {data.profile?.lastBalance != null ? data.profile.lastBalance + " USDC" : "—"}</div>
                <div><strong>Last checked:</strong> {fmtDate(data.profile?.lastBalanceCheck)}</div>
                <div><strong>Profile updated:</strong> {fmtDate(data.profileUpdated)}</div>
              </div>
            </div>

            {data.profile?.listing && (
              <div className="card" style={{ marginBottom: 12 }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--a-muted)", textTransform: "uppercase" }}>Listing</h4>
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                  <div><strong>City:</strong> {data.profile.listing.city || "—"}</div>
                  <div><strong>Type:</strong> {data.profile.listing.propertyType || "—"}</div>
                  <div><strong>Rent:</strong> {data.profile.listing.rent} USDC/mo</div>
                  {data.profile.listing.addressLine && <div><strong>Address:</strong> {data.profile.listing.addressLine}</div>}
                </div>
              </div>
            )}

            {data.activeContract && (
              <div className="card" style={{ marginBottom: 12 }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--a-muted)", textTransform: "uppercase" }}>Active Contract</h4>
                <div style={{ fontSize: 13 }} className="mono">
                  Agreement ID: {data.activeContract.agreementId || "—"}<br/>
                  Peer: {data.activeContract.peer || "—"}
                </div>
              </div>
            )}

            {(data.viewings || []).length > 0 && (
              <div className="card" style={{ marginBottom: 12 }}>
                <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--a-muted)", textTransform: "uppercase" }}>Recent viewings ({data.viewings.length})</h4>
                <table>
                  <thead><tr><th>From</th><th>To</th><th>Status</th><th>When</th></tr></thead>
                  <tbody>
                    {data.viewings.slice(0, 10).map((v, i) => (
                      <tr key={i}>
                        <td className="mono">{short(v.from_addr)}</td>
                        <td className="mono">{short(v.to_addr)}</td>
                        <td>{v.status || "—"}</td>
                        <td className="muted">{fmtDateShort(v.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(data.events || []).length > 0 && (
              <div className="card">
                <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "var(--a-muted)", textTransform: "uppercase" }}>Events ({data.events.length})</h4>
                <table>
                  <thead><tr><th>Event</th><th>Target</th><th>When</th></tr></thead>
                  <tbody>
                    {data.events.slice(0, 20).map((e, i) => (
                      <tr key={i}>
                        <td>{e.event}</td>
                        <td className="mono">{e.target_addr ? short(e.target_addr) : "—"}</td>
                        <td className="muted">{fmtDateShort(e.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Promocodes ─────────────────────────────────────────────────────
function Promocodes({ canWrite }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [showGen, setShowGen] = useState(false);
  const [lastGenerated, setLastGenerated] = useState(null);

  const load = async () => {
    try { setData(await api("/promocodes")); }
    catch (e) { setErr(e.message); }
  };

  useEffect(() => { load(); }, []);

  const revoke = async (code) => {
    if (!confirm(`Revoke ${code}?`)) return;
    try { await api("/promocodes/" + code, { method: "DELETE" }); load(); }
    catch (e) { alert(e.message); }
  };

  if (err) return <div className="error-box">{err}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, alignItems: "center" }}>
        <div>
          <strong>{data.total}</strong> total · <strong>{data.used}</strong> used · <strong>{data.unused}</strong> unused
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setShowGen(true)}>+ Generate batch</button>
        )}
      </div>

      {lastGenerated && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong>Last batch ({lastGenerated.length} codes)</strong>
            <button className="btn btn-sm" onClick={() => {
              navigator.clipboard.writeText(lastGenerated.join("\n"));
              alert("Copied to clipboard");
            }}>Copy all</button>
          </div>
          <div className="code-list">{lastGenerated.join("\n")}</div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Status</th><th>Perks</th><th>Expires</th><th>Used by</th><th>Notes</th>{canWrite && <th></th>}</tr></thead>
          <tbody>
            {data.items.slice(0, 200).map(p => (
              <tr key={p.code}>
                <td className="mono"><strong>{p.code}</strong></td>
                <td>
                  {p.used_by_addr
                    ? <span className="badge badge-used">Used</span>
                    : <span className="badge badge-unused">Unused</span>}
                </td>
                <td style={{ fontSize: 11 }}>{Object.keys(p.perks || {}).join(", ") || "—"}</td>
                <td className="muted">{fmtDateShort(p.expires_at)}</td>
                <td className="mono">{p.used_by_addr ? short(p.used_by_addr) : "—"}</td>
                <td>{p.notes || "—"}</td>
                {canWrite && <td>
                  {!p.used_by_addr && <button className="btn btn-sm btn-danger" onClick={() => revoke(p.code)}>Revoke</button>}
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showGen && (
        <GeneratePromoModal
          onClose={() => setShowGen(false)}
          onGenerated={(codes) => { setLastGenerated(codes); setShowGen(false); load(); }}
        />
      )}
    </>
  );
}

function GeneratePromoModal({ onClose, onGenerated }) {
  const [count, setCount] = useState(10);
  const [prefix, setPrefix] = useState("TBILISI");
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const res = await api("/promocodes", { method: "POST", body: {
        count: Number(count), prefix, expiresInDays: Number(expiresInDays),
        perks: { bypass_funds_check: true },
        notes: notes || null,
      }});
      onGenerated(res.codes);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>Generate promocode batch</h3>
        {err && <div className="error-box">{err}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Prefix (uppercase, max 12 chars)</label>
            <input value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase())} maxLength={12} />
          </div>
          <div className="field">
            <label>Quantity (1–100)</label>
            <input type="number" min="1" max="100" value={count} onChange={e => setCount(e.target.value)} />
          </div>
          <div className="field">
            <label>Expires in (days)</label>
            <input type="number" min="1" max="365" value={expiresInDays} onChange={e => setExpiresInDays(e.target.value)} />
          </div>
          <div className="field">
            <label>Notes (optional — shown in list)</label>
            <textarea rows="2" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Tbilisi launch, Vake area, batch 1" />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
            {busy ? "Generating…" : `Generate ${count} codes`}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── City Settings ─────────────────────────────────────────────────
function CitySettingsPage({ canWrite }) {
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [newCity, setNewCity] = useState("");
  const [newMin, setNewMin] = useState("");

  useEffect(() => {
    api("/city-settings").then(d => { setCities(Array.isArray(d) ? d : []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const updateMin = (i, val) => {
    setCities(prev => prev.map((c, j) => j === i ? { ...c, min_balance: Number(val) || 0 } : c));
  };
  const removeCity = (i) => {
    setCities(prev => prev.filter((_, j) => j !== i));
  };
  const addCity = () => {
    const name = newCity.trim();
    if (!name) return;
    if (cities.some(c => c.city.toLowerCase() === name.toLowerCase())) { setMsg({ type: "error", text: "City already exists" }); return; }
    setCities(prev => [...prev, { city: name, min_balance: Number(newMin) || 0 }]);
    setNewCity(""); setNewMin("");
  };
  const saveAll = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await api("/city-settings", { method: "POST", body: { cities } });
      if (r.ok !== undefined && !r.ok) throw new Error(r.error || "Save failed");
      setMsg({ type: "success", text: `Saved! ${cities.length} cities configured.` });
    } catch (e) { setMsg({ type: "error", text: e.message }); }
    setSaving(false);
    setTimeout(() => setMsg(null), 4000);
  };

  if (loading) return <div style={{padding:20,color:"var(--a-muted)"}}>Loading...</div>;

  return (
    <div style={{padding:"0 0 20px"}}>
      <p style={{fontSize:12,color:"var(--a-muted)",marginBottom:16}}>Minimum wallet balance required to publish a listing in each city.</p>

      {cities.length === 0 ? (
        <div className="card" style={{textAlign:"center",padding:24,color:"var(--a-muted)"}}>No cities configured yet. Add one below.</div>
      ) : (
        <div className="card" style={{marginBottom:16}}>
          <table className="tbl" style={{width:"100%"}}>
            <thead><tr><th style={{textAlign:"left"}}>City</th><th style={{textAlign:"right",width:120}}>Min Balance</th><th style={{width:60}}></th></tr></thead>
            <tbody>
              {cities.map((c, i) => (
                <tr key={i}>
                  <td style={{fontWeight:600}}>{c.city}</td>
                  <td style={{textAlign:"right"}}>
                    <input type="number" min="0" step="1" value={c.min_balance}
                      onChange={e => updateMin(i, e.target.value)}
                      disabled={!canWrite}
                      style={{width:80,padding:"4px 8px",borderRadius:4,border:"1px solid var(--a-border2)",background:"var(--a-bg2)",color:"var(--a-text)",fontSize:13,fontWeight:700,textAlign:"right"}}/>
                    <span style={{fontSize:11,color:"var(--a-muted)",marginLeft:4}}>USDC</span>
                  </td>
                  <td style={{textAlign:"center"}}>
                    {canWrite && <button className="btn btn-sm" style={{color:"var(--a-danger)"}} onClick={() => removeCity(i)}>✕</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canWrite && (
        <div className="card" style={{marginBottom:16}}>
          <div style={{fontWeight:700,marginBottom:10,fontSize:13}}>Add City</div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <input type="text" placeholder="City name" value={newCity} onChange={e => setNewCity(e.target.value)}
              style={{flex:1,minWidth:120,padding:"8px 12px",borderRadius:6,border:"1px solid var(--a-border2)",background:"var(--a-bg2)",color:"var(--a-text)",fontSize:13}}/>
            <input type="number" placeholder="Min USDC" min="0" step="1" value={newMin} onChange={e => setNewMin(e.target.value)}
              style={{width:100,padding:"8px 12px",borderRadius:6,border:"1px solid var(--a-border2)",background:"var(--a-bg2)",color:"var(--a-text)",fontSize:13}}/>
            <button className="btn btn-primary btn-sm" onClick={addCity}>Add</button>
          </div>
        </div>
      )}

      {canWrite && (
        <button className="btn btn-primary" onClick={saveAll} disabled={saving} style={{width:"100%"}}>
          {saving ? "Saving..." : "Save All"}
        </button>
      )}

      {msg && (
        <div style={{marginTop:10,padding:"8px 12px",borderRadius:6,fontSize:12,
          background: msg.type === "success" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
          color: msg.type === "success" ? "#22c55e" : "#ef4444",
          border: `1px solid ${msg.type === "success" ? "#166534" : "#991b1b"}`}}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ── Admins (Owner only) ────────────────────────────────────────────
function AdminsPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    try { setData(await api("/admins")); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (id, active) => {
    if (!confirm(active ? "Deactivate this admin?" : "Reactivate this admin?")) return;
    try { await api("/admins/" + id, { method: "PATCH", body: { active: !active } }); load(); }
    catch (e) { alert(e.message); }
  };

  if (err) return <div className="error-box">{err}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New admin</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Created</th><th>Last login</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data.items.map(a => (
              <tr key={a.id}>
                <td>{a.email}</td>
                <td>{a.display_name || "—"}</td>
                <td><span className={"badge badge-" + a.role}>{a.role}</span></td>
                <td className="muted">{fmtDateShort(a.created_at)}</td>
                <td className="muted">{fmtDateShort(a.last_login)}</td>
                <td>{a.active ? <span className="badge badge-ok">Active</span> : <span className="badge badge-warn">Disabled</span>}</td>
                <td>
                  {a.role !== "owner" && (
                    <button className="btn btn-sm" onClick={() => toggleActive(a.id, a.active)}>
                      {a.active ? "Disable" : "Enable"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showCreate && <CreateAdminModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
    </>
  );
}

function CreateAdminModal({ onClose, onCreated }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("manager");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await api("/admins", { method: "POST", body: { email, password, role, displayName } });
      onCreated();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h3>Create admin</h3>
        {err && <div className="error-box">{err}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Password (min 8)</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required />
          </div>
          <div className="field">
            <label>Role</label>
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="manager">Manager — write access (no admin management)</option>
              <option value="support">Support — read-only + chat</option>
            </select>
          </div>
          <div className="field">
            <label>Display name (optional)</label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
            {busy ? "Creating…" : "Create admin"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Audit log ─────────────────────────────────────────────────────
function AuditLog() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/audit").then(setData).catch(e => setErr(e.message));
  }, []);

  if (err) return <div className="error-box">{err}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Metadata</th></tr></thead>
        <tbody>
          {data.items.map((r, i) => (
            <tr key={r.id || i}>
              <td className="muted">{fmtDate(r.created_at)}</td>
              <td>{r.admin_email}</td>
              <td><strong>{r.action}</strong></td>
              <td className="mono">{r.target || "—"}</td>
              <td style={{ fontSize: 11 }}>{r.metadata ? JSON.stringify(r.metadata) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Contracts Overview ──────────────────────────────────────────
const CONTRACT_STATE_BADGES = {
  0: { label: "Created", bg: "#6b728022", color: "#6b7280" },
  1: { label: "AwaitLL", bg: "#6b728022", color: "#6b7280" },
  2: { label: "AwaitTN", bg: "#6b728022", color: "#6b7280" },
  3: { label: "Active", bg: "#05966922", color: "#059669" },
  4: { label: "EarlyTerm", bg: "#f59e0b22", color: "#f59e0b" },
  5: { label: "Checkout", bg: "#f59e0b22", color: "#f59e0b" },
  6: { label: "DamageClaim", bg: "#f9731622", color: "#f97316" },
  7: { label: "Dispute", bg: "#dc262622", color: "#dc2626" },
  8: { label: "Settled", bg: "#3b82f622", color: "#3b82f6" },
  9: { label: "LeaseEnded", bg: "#6b728022", color: "#6b7280" },
};
const PROPDEP_STATE_BADGES = {
  0: { label: "None", bg: "#6b728022", color: "#6b7280" },
  1: { label: "Active", bg: "#05966922", color: "#059669" },
  2: { label: "Claimed", bg: "#f9731622", color: "#f97316" },
  3: { label: "Disputed", bg: "#dc262622", color: "#dc2626" },
  4: { label: "Frozen", bg: "#6366f122", color: "#6366f1" },
  5: { label: "Settled", bg: "#3b82f622", color: "#3b82f6" },
};

function ContractsPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    setLoading(true); setErr("");
    try { setData(await api("/contracts-overview")); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (err) return <div className="error-box">{err}</div>;
  if (!data) return <div className="muted">Loading on-chain contracts...</div>;

  const items = data.items || [];
  const filtered = items.filter(c => {
    if (statusFilter === "active" && c.state !== 3) return false;
    if (statusFilter === "settled" && c.state !== 8) return false;
    if (statusFilter === "dispute" && c.state !== 7) return false;
    if (statusFilter === "created" && c.state !== 0) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!(c.tenant || "").toLowerCase().includes(s) && !(c.landlord || "").toLowerCase().includes(s) && !String(c.id).includes(s)) return false;
    }
    return true;
  });

  const totalActive = items.filter(c => c.state === 3).length;
  const totalSettled = items.filter(c => c.state === 8).length;
  const totalDispute = items.filter(c => c.state === 7).length;

  const fmtUsdc = (raw) => {
    if (!raw || raw === "0") return "0";
    return (Number(BigInt(raw)) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
  };
  const fmtTs = (ts) => ts && ts > 0 ? new Date(ts * 1000).toLocaleDateString() : "---";

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total Contracts</div>
          <div className="stat-value">{items.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active</div>
          <div className="stat-value" style={{ color: "#059669" }}>{totalActive}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Settled</div>
          <div className="stat-value" style={{ color: "#3b82f6" }}>{totalSettled}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Disputes</div>
          <div className="stat-value" style={{ color: "#dc2626" }}>{totalDispute}</div>
        </div>
      </div>

      <div className="filter-bar">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All ({items.length})</option>
          <option value="active">Active ({totalActive})</option>
          <option value="settled">Settled ({totalSettled})</option>
          <option value="dispute">Dispute ({totalDispute})</option>
          <option value="created">Created</option>
        </select>
        <input
          type="text"
          placeholder="Search by wallet or ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button className="btn btn-sm" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {filtered.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--a-muted)" }}>
          No contracts match the current filter.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>Tenant</th>
                <th>Landlord</th>
                <th>Rent</th>
                <th>Deposits</th>
                <th>Created</th>
                <th>Lease End</th>
                <th>Rents</th>
                <th>PropDep</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const badge = CONTRACT_STATE_BADGES[c.state] || { label: c.stateName, bg: "#6b728022", color: "#6b7280" };
                const pdBadge = PROPDEP_STATE_BADGES[c.propDepState] || { label: c.propDepStateName, bg: "#6b728022", color: "#6b7280" };
                const totalDep = (Number(BigInt(c.commitmentDeposit || "0")) + Number(BigInt(c.hostingDeposit || "0")) + Number(BigInt(c.propSecurityDeposit || "0"))) / 1e6;
                const isExpanded = expanded === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr onClick={() => setExpanded(isExpanded ? null : c.id)} style={{ cursor: "pointer" }}>
                      <td><strong>#{c.id}</strong></td>
                      <td><span className="badge" style={{ background: badge.bg, color: badge.color }}>{badge.label}</span></td>
                      <td className="mono" style={{ fontSize: 11 }}>{short(c.tenant)}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{short(c.landlord)}</td>
                      <td>{fmtUsdc(c.monthlyRent)}</td>
                      <td>{totalDep.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      <td className="muted" style={{ fontSize: 11 }}>{fmtTs(c.createdAt)}</td>
                      <td className="muted" style={{ fontSize: 11 }}>{fmtTs(c.leaseEndTime)}</td>
                      <td>{c.activatedAt > 0 ? (1 + (c.rentsPaid||0)) : 0}</td>
                      <td><span className="badge" style={{ background: pdBadge.bg, color: pdBadge.color, fontSize: 10 }}>{pdBadge.label}</span></td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan="10" style={{ padding: 0, background: "var(--a-bg3)" }}>
                          <ContractDetails contract={c} fmtUsdc={fmtUsdc} fmtTs={fmtTs} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ContractDetails({ contract: c, fmtUsdc, fmtTs }) {
  const [logs, setLogs] = useState(null);
  const [logsErr, setLogsErr] = useState("");

  useEffect(() => {
    api("/logs?contract_id=" + c.id + "&limit=200")
      .then(r => setLogs(r.logs || []))
      .catch(e => setLogsErr(e.message));
  }, [c.id]);

  const badge = CONTRACT_STATE_BADGES[c.state] || { label: c.stateName, bg: "#6b728022", color: "#6b7280" };
  const commitment = Number(BigInt(c.commitmentDeposit || "0")) / 1e6;
  const hosting = Number(BigInt(c.hostingDeposit || "0")) / 1e6;
  const propSec = Number(BigInt(c.propSecurityDeposit || "0")) / 1e6;
  const monthlyRentUsdc = Number(BigInt(c.monthlyRent || "0")) / 1e6;
  // First rent is included in tenant deposit and paid to landlord at activation
  const firstRentPaid = c.activatedAt > 0;
  const additionalRents = c.rentsPaid || 0;
  const totalRentPayments = firstRentPaid ? 1 + additionalRents : 0;
  const totalRentCollected = totalRentPayments * monthlyRentUsdc;
  // Escrow holds only commit + hosting after activation (first rent → landlord, propSec → PropDep)
  const escrowBalance = commitment + hosting;
  const totalDeposited = (firstRentPaid ? monthlyRentUsdc : 0) + commitment + propSec + hosting;

  // Risk indicators
  const risks = [];
  if (c.state === 3 && c.activatedAt > 0) {
    const now = Math.floor(Date.now() / 1000);
    const monthSec = 30 * 86400;
    const grace = 3 * 86400;
    const nextRentDue = c.lastRentTimestamp > 0
      ? c.lastRentTimestamp + monthSec
      : c.activatedAt + monthSec;
    if (now > nextRentDue + grace) {
      risks.push({ label: "RENT OVERDUE", color: "#dc2626", bg: "#dc262622" });
    }
  }
  if (c.state === 7) risks.push({ label: "DISPUTE ACTIVE", color: "#dc2626", bg: "#dc262622" });
  if (c.state === 4) risks.push({ label: "ET PENDING", color: "#f59e0b", bg: "#f59e0b22" });

  const Row = ({ k, v, mono: m }) => (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", padding: "5px 0", borderBottom: "1px solid var(--a-border)", fontSize: 12 }}>
      <span style={{ color: "var(--a-muted)" }}>{k}</span>
      <span className={m ? "mono" : ""} style={{ wordBreak: "break-all" }}>{v ?? "---"}</span>
    </div>
  );

  const EVT_COLORS = {
    TX_SENT: { bg: "#eff6ff", color: "#1d4ed8" },
    TX_CONFIRMED: { bg: "#f0fdf4", color: "#166534" },
    TX_FAILED: { bg: "#fef2f2", color: "#991b1b" },
    API_ERROR: { bg: "#fff7ed", color: "#9a3412" },
    STATE_CHANGE: { bg: "#faf5ff", color: "#6b21a8" },
    UI_ACTION: { bg: "#f9fafb", color: "#374151" },
  };

  return (
    <div style={{ padding: "16px 20px" }}>
      {/* Risk Indicators */}
      {risks.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {risks.map((r, i) => (
            <span key={i} className="badge" style={{ background: r.bg, color: r.color, fontSize: 12, fontWeight: 700, padding: "4px 12px" }}>{r.label}</span>
          ))}
        </div>
      )}

      {/* Section A: Overview */}
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--a-muted)" }}>Overview</h4>
        <Row k="Contract ID" v={"#" + c.id} />
        <Row k="Status" v={<span className="badge" style={{ background: badge.bg, color: badge.color }}>{badge.label} ({c.state})</span>} />
        <Row k="Tenant" v={c.tenant} mono />
        <Row k="Landlord" v={c.landlord} mono />
        <Row k="Monthly Rent" v={monthlyRentUsdc.toLocaleString() + " USDC"} />
        <Row k="Created" v={c.createdAt > 0 ? new Date(c.createdAt * 1000).toLocaleString() : "---"} />
        <Row k="Activated" v={c.activatedAt > 0 ? new Date(c.activatedAt * 1000).toLocaleString() : "---"} />
        <Row k="Lease End" v={c.leaseEndTime > 0 ? new Date(c.leaseEndTime * 1000).toLocaleString() : "---"} />
      </div>

      {/* Section B: Money */}
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--a-muted)" }}>Money</h4>
        <Row k="Commitment Deposit (tenant)" v={commitment.toLocaleString() + " USDC → escrow"} />
        <Row k="Hosting Deposit (landlord)" v={hosting.toLocaleString() + " USDC → escrow"} />
        <Row k="Property Security (tenant)" v={propSec > 0 ? propSec.toLocaleString() + " USDC → PropDepEscrow" : "none"} />
        <Row k="First Rent (tenant)" v={firstRentPaid
          ? <span style={{color:"#10b981",fontWeight:700}}>{monthlyRentUsdc.toLocaleString() + " USDC → paid to landlord"}</span>
          : <span style={{color:"#f59e0b"}}>Not yet paid</span>} />
        <Row k="Additional Rents Paid" v={additionalRents > 0
          ? <span style={{color:"#10b981",fontWeight:700}}>{additionalRents} × {monthlyRentUsdc} = {(additionalRents * monthlyRentUsdc).toLocaleString()} USDC</span>
          : "0"} />
        <Row k="Total Rent Payments" v={<strong>{totalRentPayments} ({totalRentCollected.toLocaleString()} USDC)</strong>} />
        <Row k="Total Deposited" v={<strong>{totalDeposited.toLocaleString()} USDC</strong>} />
        <Row k="In RentalEscrow" v={escrowBalance.toLocaleString() + " USDC (commit + hosting)"} />
        <Row k="In PropDepEscrow" v={propSec > 0 ? propSec.toLocaleString() + " USDC" : "---"} />
        <Row k="Freeze Start" v={c.freezeStart > 0 ? new Date(c.freezeStart * 1000).toLocaleString() : "---"} />
        <Row k="Freeze Duration" v={c.freezeDuration > 0 ? Math.round(c.freezeDuration / 86400) + " days" : "---"} />
        <Row k="PropDep State" v={c.propDepStateName + " (" + c.propDepState + ")"} />
      </div>

      {/* Section C: Timeline */}
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--a-muted)" }}>Event Timeline</h4>
        {logsErr && <div className="error-box" style={{ fontSize: 12 }}>{logsErr}</div>}
        {!logs && !logsErr && <div className="muted" style={{ fontSize: 12 }}>Loading events...</div>}
        {logs && logs.length === 0 && <div className="muted" style={{ fontSize: 12, padding: "8px 0" }}>No events recorded for this contract.</div>}
        {logs && logs.length > 0 && (
          <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--a-border)", borderRadius: 6, padding: 8 }}>
            {logs.map((l, i) => {
              const tc = EVT_COLORS[l.type] || { bg: "#f9fafb", color: "#374151" };
              return (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", borderBottom: "1px solid var(--a-border)", fontSize: 11 }}>
                  <span className="muted" style={{ whiteSpace: "nowrap", minWidth: 130 }}>{l.time ? new Date(l.time).toLocaleString() : "---"}</span>
                  <span className="badge" style={{ background: tc.bg, color: tc.color, fontSize: 10 }}>{l.type}</span>
                  <span style={{ flex: 1 }}>{l.action || "---"}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Time Travel ─────────────────────────────────────────────────
function TimeTravelPage() {
  const [agrId, setAgrId] = useState("0");
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [customDays, setCustomDays] = useState("");

  const fetchState = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/time-travel/state?id=" + agrId, { credentials: "include" });
      const data = await r.json();
      setState(data);
    } catch (e) { setState({ error: e.message }); }
    setLoading(false);
  };

  useEffect(() => { fetchState(); }, [agrId]);

  const doWarp = async (seconds, label) => {
    setResult({ loading: true, label });
    try {
      // Sequential — same deployer key, can't send two txs in parallel (nonce conflict)
      const d1 = await api("/time-travel", { method: "POST", body: { contract: "rental", delta: seconds } });
      const d2 = await api("/time-travel", { method: "POST", body: { contract: "propdep", delta: seconds } });
      setResult({ ok: true, label, hash: d1.hash });
      setTimeout(fetchState, 3000);
    } catch (e) {
      setResult({ error: e.message, label });
    }
  };

  const fmtTs = (ts) => {
    if (!ts || ts === "0") return "—";
    return new Date(Number(ts) * 1000).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const fmtDelta = (ts) => {
    if (!state?.rental?.currentTime || !ts || ts === "0") return "";
    const diff = Number(ts) - Number(state.rental.currentTime);
    const days = Math.round(diff / 86400);
    if (days > 0) return ` (in ${days}d)`;
    if (days < 0) return ` (${-days}d ago)`;
    return " (now)";
  };

  const DAY = 86400;
  const presets = [
    { label: "+1 day", delta: DAY, bg: "var(--a-accent)" },
    { label: "+3 days", delta: 3 * DAY, bg: "var(--a-accent)" },
    { label: "+7 days", delta: 7 * DAY, bg: "var(--a-accent)" },
    { label: "+14 days", delta: 14 * DAY, bg: "var(--a-accent)" },
    { label: "+30 days", delta: 30 * DAY, bg: "#8b5cf6" },
    { label: "+60 days", delta: 60 * DAY, bg: "#8b5cf6" },
    { label: "+180 days", delta: 180 * DAY, bg: "#dc2626" },
  ];

  const keyPoints = [
    { label: "Deposit deadline (24h)", delta: 25 * 3600, bg: "#f59e0b" },
    { label: "Rent overdue (35d)", delta: 36 * DAY, bg: "#ef4444" },
    { label: "Claim deadline (3d)", delta: 4 * DAY, bg: "#f59e0b" },
    { label: "Bond posting (3d)", delta: 4 * DAY, bg: "#f59e0b" },
    { label: "ET response (7d)", delta: 8 * DAY, bg: "#f59e0b" },
    { label: "Checkout (14d)", delta: 15 * DAY, bg: "#f59e0b" },
    { label: "Freeze expire (60d)", delta: 61 * DAY, bg: "#6366f1" },
    { label: "Safety net (+240d)", delta: 241 * DAY, bg: "#dc2626" },
  ];

  const btnStyle = (bg) => ({ padding: "8px 6px", borderRadius: 6, background: bg, color: "white", border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
  const kpStyle = (bg) => ({ padding: "8px 8px", borderRadius: 6, background: bg + "20", color: bg, border: "1px solid " + bg + "40", fontSize: 11, fontWeight: 600, cursor: "pointer", textAlign: "left", fontFamily: "inherit" });

  return (
    <div>
      {/* Agreement selector */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Agreement ID:</label>
          <input value={agrId} onChange={e => setAgrId(e.target.value)} style={{ width: 80, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--a-border)", background: "var(--a-bg)", color: "var(--a-text)", fontSize: 14, fontWeight: 700 }} />
          <button className="btn btn-primary btn-sm" onClick={fetchState}>Refresh</button>
        </div>
        {result && (
          <div style={{ padding: "8px 12px", borderRadius: 6, marginBottom: 10, fontSize: 12, background: result.loading ? "#3b82f620" : result.ok ? "#05966920" : "#dc262620", color: result.loading ? "#3b82f6" : result.ok ? "#059669" : "#dc2626" }}>
            {result.loading ? "⏳ " + result.label + "..." : result.ok ? "✅ " + result.label + " — tx: " + (result.hash || "").slice(0, 14) + "..." : "❌ " + result.label + ": " + result.error}
          </div>
        )}
      </div>

      {/* State display */}
      {state && !state.error && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Agreement #{agrId} State</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 12 }}>
            <div><b>Virtual time:</b> {fmtTs(state.rental?.currentTime)}</div>
            <div><b>Rental:</b> <span style={{ color: "#3b82f6", fontWeight: 700 }}>{state.rental?.stateName}</span></div>
            <div><b>PropDep:</b> <span style={{ color: "#059669", fontWeight: 700 }}>{state.propDep?.stateName}</span></div>
            <div><b>Rent:</b> {state.rental?.monthlyRent ? (Number(state.rental.monthlyRent) / 1e6).toFixed(0) + " USDC" : "—"}</div>
            <div><b>Created:</b> {fmtTs(state.rental?.createdAt)}{fmtDelta(state.rental?.createdAt)}</div>
            <div><b>Activated:</b> {fmtTs(state.rental?.activatedAt)}{fmtDelta(state.rental?.activatedAt)}</div>
            <div><b>Lease end:</b> {fmtTs(state.rental?.leaseEndTime)}{fmtDelta(state.rental?.leaseEndTime)}</div>
            <div><b>Rents paid:</b> {(state.rental?.firstRentPaid ? 1 : 0) + (Number(state.rental?.rentPaymentsMade) || 0)} (first: {state.rental?.firstRentPaid ? "yes" : "no"}, recurring: {state.rental?.rentPaymentsMade || 0})</div>
            <div><b>Freeze:</b> {fmtTs(state.rental?.freezeStart)}{fmtDelta(state.rental?.freezeStart)}</div>
            <div><b>Checkout:</b> {fmtTs(state.rental?.checkoutStartedAt)}{fmtDelta(state.rental?.checkoutStartedAt)}</div>
            <div><b>ET proposed:</b> {fmtTs(state.rental?.earlyTermProposedAt)}{fmtDelta(state.rental?.earlyTermProposedAt)}</div>
            <div><b>PD window:</b> {fmtTs(state.propDep?.windowStart)} — {fmtTs(state.propDep?.windowEnd)}</div>
            <div><b>Tenant:</b> {(state.rental?.tenant || "").slice(0, 10)}...</div>
            <div><b>Landlord:</b> {(state.rental?.landlord || "").slice(0, 10)}...</div>
          </div>
        </div>
      )}
      {state?.error && <div className="card" style={{ color: "#dc2626", marginBottom: 12 }}>Error: {state.error}</div>}

      {/* Warp buttons */}
      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>⏭ Jump Forward</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 12 }}>
          {presets.map(p => (<button key={p.label} onClick={() => doWarp(p.delta, p.label)} style={btnStyle(p.bg)}>{p.label}</button>))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={customDays} onChange={e => setCustomDays(e.target.value)} placeholder="Custom days" style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--a-border)", background: "var(--a-bg)", color: "var(--a-text)", fontSize: 12 }} />
          <button style={{ padding: "6px 16px", borderRadius: 6, background: "#10b981", color: "white", border: "none", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.5px" }} onClick={() => { const d = parseInt(customDays); if (d) { doWarp(d * DAY, "+" + d + " days"); setCustomDays(""); } }}>JUMP</button>
        </div>
      </div>

      {/* Key checkpoints */}
      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>🎯 Key Checkpoints</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {keyPoints.map(p => (<button key={p.label} onClick={() => doWarp(p.delta, p.label)} style={kpStyle(p.bg)}>{p.label}</button>))}
        </div>
      </div>

      {/* Reset */}
      <div className="card">
        <button onClick={async () => {
          try {
            await api("/time-travel", { method: "POST", body: { contract: "rental", reset: true } });
            await api("/time-travel", { method: "POST", body: { contract: "propdep", reset: true } });
            setResult({ ok: true, label: "Reset to real time" });
            setTimeout(fetchState, 3000);
          } catch (e) { setResult({ error: e.message, label: "Reset" }); }
        }} style={{ width: "100%", padding: 10, borderRadius: 6, background: "#6b7280", color: "white", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>⟲ Reset to Real Time</button>
      </div>
    </div>
  );
}

// ── Event Log page ──────────────────────────────────────────────
const EVENT_TYPE_COLORS = {
  TX_SENT: { bg: "#eff6ff", color: "#1d4ed8" },
  TX_CONFIRMED: { bg: "#f0fdf4", color: "#166534" },
  TX_FAILED: { bg: "#fef2f2", color: "#991b1b" },
  API_ERROR: { bg: "#fff7ed", color: "#9a3412" },
  STATE_CHANGE: { bg: "#faf5ff", color: "#6b21a8" },
  UI_ACTION: { bg: "#f9fafb", color: "#374151" },
  SECURITY_EVENT: { bg: "#fef2f2", color: "#991b1b" },
};
const EVENT_TYPES = Object.keys(EVENT_TYPE_COLORS);

function EventLogPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [limit, setLimit] = useState(100);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType) params.set("type", filterType);
      if (filterUser) params.set("user", filterUser);
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo) params.set("to", filterTo);
      params.set("limit", String(limit));
      const data = await api("/logs?" + params.toString());
      setLogs(data.logs || []);
    } catch (e) { console.error("Failed to fetch logs:", e); }
    setLoading(false);
  };

  useEffect(() => { fetchLogs(); }, []);
  useEffect(() => {
    const iv = setInterval(fetchLogs, 30000);
    return () => clearInterval(iv);
  }, [filterType, filterUser, filterFrom, filterTo, limit]);

  const exportCSV = () => {
    const header = "Time,Type,User,Action,Contract ID,Data\n";
    const rows = logs.map(l =>
      [l.time, l.type, l.user_addr||"", l.action||"", l.contract_id||"", JSON.stringify(l.data||{}).replace(/"/g,'""')].map(v => `"${v}"`).join(",")
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "pi2pi-event-logs.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="filter-bar">
        <select value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input placeholder="User address (0x...)" value={filterUser} onChange={e => setFilterUser(e.target.value)} style={{width:200}} />
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} title="From date" />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} title="To date" />
        <select value={limit} onChange={e => setLimit(Number(e.target.value))}>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={250}>250</option>
          <option value={500}>500</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={fetchLogs}>Refresh</button>
        <button className="btn btn-sm" onClick={exportCSV}>Export CSV</button>
      </div>
      {loading ? (
        <div className="muted" style={{padding:20}}>Loading...</div>
      ) : logs.length === 0 ? (
        <div className="muted" style={{padding:20}}>No events found</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>User</th>
                <th>Action</th>
                <th>Contract</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => {
                const tc = EVENT_TYPE_COLORS[l.type] || { bg: "#f9fafb", color: "#374151" };
                return (
                  <tr key={l.id || i}>
                    <td className="mono">{fmtDate(l.time)}</td>
                    <td><span className="badge" style={{background:tc.bg, color:tc.color}}>{l.type}</span></td>
                    <td className="mono">{short(l.user_addr)}</td>
                    <td>{l.action || "—"}</td>
                    <td className="mono">{l.contract_id || "—"}</td>
                    <td className="mono" style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={JSON.stringify(l.data)}>{l.data ? JSON.stringify(l.data) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── System Health page ───────────────────────────────────────────
function SystemHealthPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [keeperStatus, setKeeperStatus] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [health, keeper] = await Promise.all([
        api("/system-health"),
        fetch("/api/admin/keeper/status").then(r => r.json()).catch(() => null),
      ]);
      setData(health);
      setKeeperStatus(keeper);
    } catch (e) { setData({ ok: false, errors: [e.message], warnings: [] }); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const Check = ({ ok, label, detail }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--a-border)" }}>
      <span style={{ fontSize: 16 }}>{ok ? "✅" : "❌"}</span>
      <span style={{ fontWeight: 600, minWidth: 200 }}>{label}</span>
      <span style={{ color: "var(--a-muted)", fontSize: 12, fontFamily: "monospace" }}>{detail}</span>
    </div>
  );

  return (
    <div className="admin-section">
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>
      {data && (
        <div>
          <div style={{ padding: "12px 16px", borderRadius: 8, marginBottom: 16, background: data.ok ? "rgba(5,150,105,0.1)" : "rgba(220,38,38,0.1)", border: `1px solid ${data.ok ? "#059669" : "#dc2626"}` }}>
            <strong>{data.ok ? "✅ System OK" : "❌ Issues detected"}</strong>
            {data.errors?.map((e, i) => <div key={i} style={{ color: "#dc2626", marginTop: 4 }}>Error: {e}</div>)}
            {data.warnings?.map((w, i) => <div key={i} style={{ color: "#f59e0b", marginTop: 4 }}>Warning: {w}</div>)}
          </div>
          <h3>On-chain</h3>
          <Check ok={data.chainId === 5042002} label="Chain ID" detail={data.chainId} />
          <Check ok={data.latestBlock > 0} label="Latest Block" detail={data.latestBlock} />
          <Check ok={true} label="RPC Host" detail={data.rpcHost} />
          <Check ok={data.bytecodeExists?.rental} label="RentalEscrow bytecode" detail={data.rentalEscrow} />
          <Check ok={data.bytecodeExists?.propDep} label="PropDepEscrow bytecode" detail={data.propDepEscrow} />
          <Check ok={data.wiringOk} label="Contract wiring" detail={data.wiringOk ? "OK" : "MISMATCH"} />
          <Check ok={data.rentalEscrowOwner !== "0x0000000000000000000000000000000000000000"} label="RentalEscrow owner" detail={data.rentalEscrowOwner} />
          <Check ok={data.propDepEscrowOwner !== "0x0000000000000000000000000000000000000000"} label="PropDepEscrow owner" detail={data.propDepEscrowOwner} />
          <Check ok={data.nextAgreementId >= 0} label="Next Agreement ID" detail={data.nextAgreementId} />
          <Check ok={data.rentalCurrentTime > 0} label="Rental currentTime" detail={data.rentalCurrentTime ? new Date(data.rentalCurrentTime * 1000).toISOString() : "N/A"} />
          <Check ok={data.propDepCurrentTime > 0} label="PropDep currentTime" detail={data.propDepCurrentTime ? new Date(data.propDepCurrentTime * 1000).toISOString() : "N/A"} />
          <h3 style={{ marginTop: 16 }}>Environment</h3>
          {data.envFlags && Object.entries(data.envFlags).map(([k, v]) => (
            <Check key={k} ok={true} label={k} detail={String(v ?? "not set")} />
          ))}
          <h3 style={{ marginTop: 16 }}>Keeper</h3>
          {keeperStatus ? (
            <div>
              <Check ok={keeperStatus.status === "healthy"} label="Status" detail={keeperStatus.status + (keeperStatus.ageSeconds != null ? ` (${keeperStatus.ageSeconds}s ago)` : "")} />
              <Check ok={!keeperStatus.warnings?.length} label="Address match" detail={keeperStatus.warnings?.length ? keeperStatus.warnings.join("; ") : "OK"} />
              {keeperStatus.lastAction && <Check ok={true} label="Last action" detail={keeperStatus.lastAction} />}
              {keeperStatus.lastError && <Check ok={false} label="Last error" detail={keeperStatus.lastError} />}
              {keeperStatus.scannedCount != null && <Check ok={true} label="Scanned" detail={keeperStatus.scannedCount + " agreements"} />}
            </div>
          ) : <div style={{ color: "var(--a-muted)" }}>No keeper heartbeat data</div>}
        </div>
      )}
    </div>
  );
}

// ── Agreement Inspector page ────────────────────────────────────
function AgreementInspectorPage() {
  const [id, setId] = useState(() => {
    try { const s = sessionStorage.getItem("pi2pi_admin_inspector_id"); if (s) { sessionStorage.removeItem("pi2pi_admin_inspector_id"); return s; } } catch {} return "";
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);

  const load = async () => {
    if (!id && id !== "0" && id !== 0) return;
    setLoading(true); setError(null);
    try {
      const r = await api("/agreements/" + id);
      if (r.error) throw new Error(r.error);
      setData(r);
    } catch (e) { setError(e.message); setData(null); }
    setLoading(false);
  };

  // Auto-load if ID was pre-filled from another page (e.g. Disputes → Inspector)
  useEffect(() => { if (id) load(); }, []);

  const Field = ({ label, value, mono }) => (
    <div style={{ display: "flex", padding: "4px 0", borderBottom: "1px solid var(--a-border)", gap: 8 }}>
      <span style={{ minWidth: 180, fontWeight: 600, fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--a-muted)", fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-all" }}>{String(value ?? "—")}</span>
    </div>
  );

  const RENTAL_STATES = ["Created", "AwaitingLL", "AwaitingTN", "Active", "EarlyTerm", "Checkout", "DamageClaim", "Dispute", "Settled", "LeaseEnded"];

  return (
    <div className="admin-section">
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input type="number" min="0" placeholder="Agreement ID" value={id} onChange={e => setId(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--a-border)", background: "var(--a-bg2)", color: "var(--a-text)", width: 160, fontFamily: "monospace" }}
          onKeyDown={e => e.key === "Enter" && load()} />
        <button className="btn btn-primary" onClick={load} disabled={loading}>{loading ? "Loading…" : "Load"}</button>
      </div>
      {error && <div style={{ color: "#dc2626", marginBottom: 12 }}>{error}</div>}
      {data && (
        <div>
          {/* Combined closure status banner */}
          {(() => {
            const rs = data.rental?.stateNum;
            const ps = data.propDep?.stateNum ?? 0;
            const rentalTerminal = rs === 8 || rs === 9;
            const propDepResolved = ps === 0 || ps === 5;
            const propDepActive = ps >= 1 && ps <= 4;
            const PDLABELS = ["None","Active","Claimed","Disputed","Frozen","Settled"];
            if (rentalTerminal && propDepActive) return (
              <div style={{padding:"12px 16px",borderRadius:8,marginBottom:16,background:"rgba(245,158,11,0.1)",border:"1px solid #f59e0b"}}>
                <strong style={{color:"#b45309"}}>⚠ Partially settled</strong>
                <div style={{fontSize:12,marginTop:4}}>Rental contract is settled, but property security deposit is still <strong>{PDLABELS[ps]||ps}</strong>.</div>
                {data.propDep?.amount > 0 && <div style={{fontSize:12,marginTop:2}}>{data.propDep.amount} USDC still held in PropDepEscrow.</div>}
                {ps === 1 && <div style={{fontSize:12,color:"var(--a-muted)",marginTop:4}}>Landlord can release deposit early or file a damage claim during the inspection window.</div>}
                {ps === 2 && <div style={{fontSize:12,color:"#dc2626",marginTop:4}}>Damage claim filed. Tenant has 3 days to accept or dispute.</div>}
                {ps === 3 && <div style={{fontSize:12,color:"#dc2626",marginTop:4}}>Tenant disputed. Landlord must post bond within 3 days or claim drops.</div>}
                {ps === 4 && <div style={{fontSize:12,color:"#dc2626",marginTop:4}}>Deposits frozen for 60 days. Awaiting resolution or expiry.</div>}
              </div>
            );
            if (rentalTerminal && propDepResolved) return (
              <div style={{padding:"12px 16px",borderRadius:8,marginBottom:16,background:"rgba(5,150,105,0.1)",border:"1px solid #059669"}}>
                <strong style={{color:"#059669"}}>✅ Fully closed</strong>
                <div style={{fontSize:12,marginTop:4}}>Rental settled. Property deposit {ps===0?"not applicable":"resolved"}. All funds distributed.</div>
              </div>
            );
            return null;
          })()}

          {/* Keeper banner — context-aware */}
          {data.diagnosis && (
            <div style={{ padding: "12px 16px", borderRadius: 8, marginBottom: 16, background: data.diagnosis.shouldKeeperCall ? "rgba(245,158,11,0.1)" : "rgba(5,150,105,0.1)", border: `1px solid ${data.diagnosis.shouldKeeperCall ? "#f59e0b" : "#059669"}` }}>
              <strong>Keeper: {data.diagnosis.shouldKeeperCall || "No action needed"}</strong>
              {data.diagnosis.reason && <div style={{ marginTop: 4, fontSize: 12, color: "var(--a-muted)" }}>{data.diagnosis.reason}</div>}
              {!data.diagnosis.shouldKeeperCall && (data.propDep?.stateNum >= 1 && data.propDep?.stateNum <= 4) && (
                <div style={{marginTop:4,fontSize:12,color:"#b45309"}}>Property deposit still open. Keeper watches PropDep window/freeze expiry.</div>
              )}
              {data.diagnosis.warnings?.map((w, i) => <div key={i} style={{ color: "#f59e0b", marginTop: 4, fontSize: 12 }}>⚠ {w}</div>)}
            </div>
          )}
          <h3>Rental Agreement #{data.agreementId}</h3>
          <div style={{ display: "inline-block", padding: "4px 10px", borderRadius: 4, background: "var(--a-bg3)", fontWeight: 700, marginBottom: 8 }}>
            Rental: {data.rental?.stateLabel || data.rental?.stateNum} ({data.rental?.stateNum})
          </div>
          {(data.rental?.stateNum === 8 || data.rental?.stateNum === 9) && (
            <div style={{fontSize:12,color:"var(--a-muted)",marginBottom:4}}>Rental deposits returned. {data.propDep?.stateNum >= 1 && data.propDep?.stateNum <= 4 ? "Property deposit handled separately — still active." : "Property deposit resolved."}</div>
          )}
          {data.rental && (
            <div>
              <Field label="Tenant" value={data.rental.tenant} mono />
              <Field label="Landlord" value={data.rental.landlord} mono />
              <Field label="Monthly Rent" value={data.rental.monthlyRent + " USDC"} />
              <Field label="Commitment Dep" value={data.rental.commitmentDeposit + " USDC"} />
              <Field label="Hosting Dep" value={data.rental.hostingDeposit + " USDC"} />
              <Field label="Prop Security Dep" value={data.rental.propSecurityDeposit + " USDC"} />
              <Field label="Duration (months)" value={data.rental.leaseDurationMonths} />
              <Field label="Activated" value={data.rental.activatedAt ? new Date(data.rental.activatedAt * 1000).toISOString() : "—"} />
              <Field label="Lease End" value={data.rental.leaseEndTime ? new Date(data.rental.leaseEndTime * 1000).toISOString() : "—"} />
              <Field label="First Rent Paid" value={String(!!data.rental.firstRentPaid)} />
              <Field label="Recurring Rent Payments" value={data.rental.rentPaymentsMade} />
              <Field label="Total Rent Periods Paid" value={data.rental.firstRentPaid ? data.rental.rentPaymentsMade + 1 : data.rental.rentPaymentsMade} />
              <Field label="Next Rent Due" value={data.rental.nextRentDue ? new Date(data.rental.nextRentDue * 1000).toISOString() : "—"} />
              <Field label="Base Grace End (3d)" value={data.rental.nextRentDue ? new Date((data.rental.nextRentDue + 259200) * 1000).toISOString() : "—"} />
              <Field label="Landlord Extension" value={(data.rental.rentGraceExtensionDays ?? (data.rental.rentGraceExtension / 86400)) + " days (" + (data.rental.rentGraceExtension || 0) + "s)"} />
              <Field label="Final Grace End" value={data.rental.graceEnd ? new Date(data.rental.graceEnd * 1000).toISOString() : "—"} />
              <Field label="isRentOverdue" value={String(data.rental.isRentOverdue)} />
              <Field label="isLeaseExpired" value={String(data.rental.isLeaseExpired)} />
              <Field label="isDepositDeadlineExpired" value={String(data.rental.isDepositDeadlineExpired)} />
              <Field label="isFreezeExpired" value={String(data.rental.isFreezeExpired)} />
              <Field label="Current Time" value={data.rental.currentTime ? new Date(data.rental.currentTime * 1000).toISOString() : "—"} />
            </div>
          )}
          {data.propDep && data.propDep.stateNum > 0 && (
            <div style={{ marginTop: 16, ...(data.propDep.stateNum >= 1 && data.propDep.stateNum <= 4 ? { border: "2px solid #f59e0b", borderRadius: 10, padding: 12 } : {}) }}>
              <h3>Property Deposit {data.propDep.stateNum >= 1 && data.propDep.stateNum <= 4 ? "⚠" : "✅"}</h3>
              <div style={{ display: "inline-block", padding: "4px 10px", borderRadius: 4, background: data.propDep.stateNum >= 1 && data.propDep.stateNum <= 4 ? "rgba(245,158,11,0.15)" : "var(--a-bg3)", fontWeight: 700, marginBottom: 8, color: data.propDep.stateNum >= 2 && data.propDep.stateNum <= 4 ? "#dc2626" : undefined }}>
                State: {data.propDep.stateLabel} ({data.propDep.stateNum})
              </div>
              <Field label="Amount" value={data.propDep.amount + " USDC"} />
              {data.propDep.windowStart > 0 && <Field label="Window Start" value={new Date(data.propDep.windowStart * 1000).toISOString()} />}
              {data.propDep.windowEnd > 0 && <Field label="Window End" value={new Date(data.propDep.windowEnd * 1000).toISOString()} />}
              <Field label="Claim Amount" value={data.propDep.claimAmount + " USDC"} />
              {data.propDep.claimDeadline > 0 && <Field label="Claim Deadline" value={new Date(data.propDep.claimDeadline * 1000).toISOString()} />}
              {data.propDep.freezeStart > 0 && <Field label="Freeze Start" value={new Date(data.propDep.freezeStart * 1000).toISOString()} />}
              {data.propDep.freezeEnd > 0 && <Field label="Freeze End" value={new Date(data.propDep.freezeEnd * 1000).toISOString()} />}
              <Field label="isFreezeExpired" value={String(data.propDep.isFreezeExpired)} />
              {data.propDep.stateNum === 1 && (() => {
                const now = Math.floor(Date.now() / 1000);
                const ws = data.propDep.windowStart || 0;
                const we = data.propDep.windowEnd || 0;
                if (ws > 0 && now < ws) return (
                  <div style={{fontSize:12,color:"#6b7280",marginTop:8,padding:"6px 8px",background:"rgba(107,114,128,0.08)",borderRadius:6}}>
                    Deposit is locked. Inspection window has not started yet.
                  </div>
                );
                if (ws > 0 && we > 0 && now >= ws && now <= we) return (
                  <div style={{fontSize:12,color:"#b45309",marginTop:8,padding:"6px 8px",background:"rgba(245,158,11,0.08)",borderRadius:6}}>
                    <strong>Inspection window active.</strong> Landlord can <em>releaseDepositEarly</em> (return to tenant) or <em>fileDamageClaim</em>.
                  </div>
                );
                if (we > 0 && now > we) return (
                  <div style={{fontSize:12,color:"#dc2626",marginTop:8,padding:"6px 8px",background:"rgba(220,38,38,0.08)",borderRadius:6}}>
                    Inspection window ended. Keeper will call <em>expirePropDepWindow</em> to return deposit.
                  </div>
                );
                return (
                  <div style={{fontSize:12,color:"#b45309",marginTop:8,padding:"6px 8px",background:"rgba(245,158,11,0.08)",borderRadius:6}}>
                    <strong>Next actions:</strong> Landlord can <em>releaseDepositEarly</em> or <em>fileDamageClaim</em> during inspection window.
                  </div>
                );
              })()}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-sm" onClick={() => setShowRaw(!showRaw)}>{showRaw ? "Hide" : "Show"} raw JSON</button>
            {showRaw && <pre style={{ marginTop: 8, padding: 12, background: "var(--a-bg2)", borderRadius: 6, fontSize: 11, overflow: "auto", maxHeight: 400 }}>{JSON.stringify(data, null, 2)}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Wallet Diagnostics page ─────────────────────────────────────
function WalletDiagnosticsPage() {
  const [addr, setAddr] = useState(() => {
    try { const s = sessionStorage.getItem("pi2pi_admin_walletdiag_addr"); if (s) { sessionStorage.removeItem("pi2pi_admin_walletdiag_addr"); return s; } } catch {} return "";
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    if (!addr || !addr.startsWith("0x")) return;
    setLoading(true); setError(null);
    try {
      const r = await api("/wallet/" + addr.toLowerCase() + "/diagnostics");
      if (r.error) throw new Error(r.error);
      setData(r);
    } catch (e) { setError(e.message); setData(null); }
    setLoading(false);
  };

  useEffect(() => { if (addr && addr.startsWith("0x")) load(); }, []);

  return (
    <div className="admin-section">
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input placeholder="0x... wallet address" value={addr} onChange={e => setAddr(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--a-border)", background: "var(--a-bg2)", color: "var(--a-text)", width: 360, fontFamily: "monospace", fontSize: 12 }}
          onKeyDown={e => e.key === "Enter" && load()} />
        <button className="btn btn-primary" onClick={load} disabled={loading}>{loading ? "Loading…" : "Diagnose"}</button>
      </div>
      {error && <div style={{ color: "#dc2626", marginBottom: 12 }}>{error}</div>}
      {data && (
        <div>
          {data.warnings?.length > 0 && (
            <div style={{ padding: "12px 16px", borderRadius: 8, marginBottom: 16, background: "rgba(245,158,11,0.1)", border: "1px solid #f59e0b" }}>
              {data.warnings.map((w, i) => <div key={i} style={{ color: "#f59e0b" }}>⚠ {w}</div>)}
            </div>
          )}
          <h3>User</h3>
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "4px 12px", fontSize: 13, marginBottom: 16 }}>
            <span style={{ fontWeight: 600 }}>Exists</span><span>{data.userExists ? "Yes" : "No"}</span>
            <span style={{ fontWeight: 600 }}>Role</span><span>{data.role || "—"}</span>
            <span style={{ fontWeight: 600 }}>Wallet Type</span><span>{data.walletType || "—"}</span>
            <span style={{ fontWeight: 600 }}>Display Name</span><span>{data.displayName || "—"}</span>
            <span style={{ fontWeight: 600 }}>Email Confirmed</span><span>{String(data.emailConfirmed ?? "—")}</span>
            <span style={{ fontWeight: 600 }}>Messages</span><span>{data.messageCount ?? 0}</span>
          </div>
          <h3>Listings ({Object.values(data.listingsSummary || {}).reduce((a, b) => a + b, 0)} total)</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {Object.entries(data.listingsSummary || {}).map(([status, count]) => (
              <span key={status} style={{ padding: "3px 10px", borderRadius: 4, background: "var(--a-bg3)", fontSize: 12 }}>
                {status}: {count}
              </span>
            ))}
          </div>
          {data.activeContracts && (data.activeContracts.asOwner?.length > 0 || data.activeContracts.asPeer?.length > 0) && (
            <div style={{ marginBottom: 16 }}>
              <h3>Active Contracts</h3>
              {data.activeContracts.asOwner?.map((c, i) => <div key={i} style={{ fontSize: 12, fontFamily: "monospace", color: "var(--a-muted)" }}>Owner: agr#{c.data?.agreementId} peer={c.data?.peerAddr?.slice(0,10)}…</div>)}
              {data.activeContracts.asPeer?.map((c, i) => <div key={i} style={{ fontSize: 12, fontFamily: "monospace", color: "var(--a-muted)" }}>Peer in: {c.addr?.slice(0,10)}… agr#{c.data?.agreementId}</div>)}
            </div>
          )}
          {(data.contractProposals?.length > 0 || data.viewingRequests?.length > 0 || data.earlyTerms?.length > 0) && (
            <div>
              <h3>Pending Items</h3>
              {data.contractProposals?.length > 0 && <div style={{ fontSize: 12 }}>Contract proposals: {data.contractProposals.length}</div>}
              {data.viewingRequests?.length > 0 && <div style={{ fontSize: 12 }}>Viewing requests: {data.viewingRequests.length}</div>}
              {data.earlyTerms?.length > 0 && <div style={{ fontSize: 12 }}>Early terms: {data.earlyTerms.length}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root app ─────────────────────────────────────────────────────
function AdminApp() {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  // Nav persists across browser refresh via sessionStorage; cleared on logout.
  const [page, _setPage] = useState(() => {
    try { return sessionStorage.getItem("pi2pi_admin_page") || "dashboard"; }
    catch { return "dashboard"; }
  });
  const setPage = (p) => {
    try { sessionStorage.setItem("pi2pi_admin_page", p); } catch {}
    _setPage(p);
  };
  const [selectedUser, setSelectedUser] = useState(null);
  const [showDevNav, setShowDevNav] = useState(false);

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    api("/me").then(setAdmin).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Safety: if restored nav points at an owner-only page but we're not owner, reset
  useEffect(() => {
    if (admin && admin.role !== "owner" && (page === "admins" || page === "audit")) {
      setPage("dashboard");
    }
  }, [admin]);

  const logout = async () => {
    try { await api("/logout", { method: "POST" }); } catch {}
    try { sessionStorage.removeItem("pi2pi_admin_page"); } catch {}
    setAdmin(null);
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--a-muted)" }}>Loading…</div>;
  if (!admin) return <LoginScreen onLogin={setAdmin} />;

  const isOwner = admin.role === "owner";
  const canWrite = isOwner || admin.role === "manager";

  const titles = {
    system: "System Health",
    inspector: "Agreement Inspector",
    disputes: "Dispute Center",
    users: "Users",
    promocodes: "Promocodes",
    cities: "City Settings",
    admins: "Admin Users",
    walletdiag: "Wallet Diagnostics",
    contracts: "Contracts Overview",
    eventlog: "Event Log",
    audit: "Audit Log",
    timetravel: "⏩ Time Travel",
  };

  return (
    <div className="admin-shell">
      <div className="admin-sidebar" style={{ position: "relative" }}>
        <h1>pi2pi Admin</h1>
        <div className={"admin-nav-item" + (page === "system" ? " active" : "")} onClick={() => setPage("system")}>System</div>
        <div className={"admin-nav-item" + (page === "inspector" ? " active" : "")} onClick={() => setPage("inspector")}>Inspector</div>
        <div className={"admin-nav-item" + (page === "disputes" ? " active" : "")} onClick={() => setPage("disputes")}>Disputes</div>
        <div className={"admin-nav-item" + (page === "users" ? " active" : "")} onClick={() => setPage("users")}>Users</div>
        <div className={"admin-nav-item" + (page === "promocodes" ? " active" : "")} onClick={() => setPage("promocodes")}>Promocodes</div>
        <div className={"admin-nav-item" + (page === "cities" ? " active" : "")} onClick={() => setPage("cities")}>City Settings</div>
        {isOwner && <div className={"admin-nav-item" + (page === "admins" ? " active" : "")} onClick={() => setPage("admins")}>Admins</div>}
        <div style={{borderTop:"1px solid var(--a-border)",margin:"8px 0",paddingTop:4}}>
          <div className="admin-nav-item" onClick={()=>setShowDevNav(!showDevNav)} style={{fontSize:11,color:"var(--a-muted)",cursor:"pointer"}}>{showDevNav?"▾":"▸"} Diagnostics / Dev</div>
          {showDevNav && <>
            <div className={"admin-nav-item" + (page === "contracts" ? " active" : "")} onClick={() => setPage("contracts")} style={{paddingLeft:20,fontSize:12}}>Contracts</div>
            <div className={"admin-nav-item" + (page === "walletdiag" ? " active" : "")} onClick={() => setPage("walletdiag")} style={{paddingLeft:20,fontSize:12}}>Wallet Diag</div>
            <div className={"admin-nav-item" + (page === "eventlog" ? " active" : "")} onClick={() => setPage("eventlog")} style={{paddingLeft:20,fontSize:12}}>Event Log</div>
            {isOwner && <div className={"admin-nav-item" + (page === "audit" ? " active" : "")} onClick={() => setPage("audit")} style={{paddingLeft:20,fontSize:12}}>Audit Log</div>}
            {isOwner && <div className={"admin-nav-item" + (page === "timetravel" ? " active" : "")} onClick={() => setPage("timetravel")} style={{paddingLeft:20,fontSize:12,color:"#f59e0b"}}>⏩ Time Travel</div>}
          </>}
        </div>
        <div className="admin-sidebar-footer">
          <div className="admin-sidebar-footer-email">{admin.email}</div>
          <div style={{ marginBottom: 8 }}><span className={"badge badge-" + admin.role}>{admin.role}</span></div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <span style={{fontSize:11,color:"var(--a-muted)"}}>Theme</span>
            <button onClick={()=>{const n=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";document.documentElement.setAttribute("data-theme",n);try{localStorage.setItem("pi2pi-admin-theme",n);}catch{}}}
              style={{padding:"3px 10px",borderRadius:4,border:"1px solid var(--a-border2)",background:"var(--a-bg3)",color:"var(--a-muted)",fontSize:11,cursor:"pointer"}}>
              {typeof document!=="undefined"&&document.documentElement.getAttribute("data-theme")==="dark"?"☀ Light":"🌙 Dark"}
            </button>
          </div>
          <button className="btn btn-sm" onClick={logout} style={{ width: "100%" }}>Sign out</button>
        </div>
      </div>

      <div className="admin-main">
        <div className="admin-header">
          <h2>{titles[page]}</h2>
        </div>
        {page === "dashboard" && <SystemHealthPage />}
        {page === "system" && <SystemHealthPage />}
        {page === "inspector" && <AgreementInspectorPage />}
        {page === "walletdiag" && <WalletDiagnosticsPage />}
        {page === "contracts" && <ContractsPage />}
        {page === "disputes" && <DisputesPage />}
        {page === "users" && <UsersList onSelectUser={setSelectedUser} />}
        {page === "promocodes" && <Promocodes canWrite={canWrite} />}
        {page === "cities" && <CitySettingsPage canWrite={canWrite} />}
        {page === "admins" && isOwner && <AdminsPage />}
        {page === "audit" && isOwner && <AuditLog />}
        {page === "eventlog" && <EventLogPage />}
        {page === "timetravel" && isOwner && <TimeTravelPage />}
      </div>

      {selectedUser && <UserDetail addr={selectedUser} onClose={() => setSelectedUser(null)} />}
    </div>
  );
}
