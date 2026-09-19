// pi2pi API client — thin wrappers around fetch()
// Step 2 of refactoring plan. Same response shapes, just centralized calls.
// Step 4 (security): adds CSRF token and credentials for wallet auth session.

let _csrfToken = null;

// Set CSRF token after login
export function setCsrfToken(token) { _csrfToken = token; }
export function getCsrfToken() { return _csrfToken; }

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (_csrfToken) h["X-CSRF-Token"] = _csrfToken;
  return h;
}

const CREDS = { credentials: "include" }; // send session cookie

async function apiGet(url) {
  const r = await fetch(url, CREDS);
  return r.json();
}

// Guard: check auth before mutating request.
// Pure check — returns null if authenticated, 401 if not. No side effects.
// Circle reconnect is handled by the lazy stub provider on user gesture, not here.
let _authGuardWarned = false;
function checkAuthGuard() {
  if (typeof window === 'undefined' || !window.pi2piWallet) return null;
  const w = window.pi2piWallet;
  if (w._authenticated) { _authGuardWarned = false; return null; }
  if (!w.provider) return null;
  if (!_authGuardWarned) {
    console.warn("[api] Wallet connected but not authenticated.");
    _authGuardWarned = true;
  }
  return { ok: false, status: 401, json: () => Promise.resolve({ error: "Wallet not authenticated. Please reconnect." }) };
}

async function apiPost(url, body) {
  const blocked = checkAuthGuard();
  if (blocked) return blocked;
  const r = await fetch(url, { method: "POST", headers: authHeaders(), body: JSON.stringify(body), ...CREDS });
  return r;
}

async function apiPatch(url, body) {
  const blocked = checkAuthGuard();
  if (blocked) return blocked;
  const r = await fetch(url, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(body), ...CREDS });
  return r;
}

async function apiDelete(url) {
  const blocked = checkAuthGuard();
  if (blocked) return blocked;
  const r = await fetch(url, { method: "DELETE", headers: authHeaders(), ...CREDS });
  return r;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function authGetNonce(addr) {
  const r = await fetch("/api/auth/nonce?addr=" + encodeURIComponent(addr), CREDS);
  return r.json();
}

export async function authVerify(addr, message, signature) {
  const r = await fetch("/api/auth/verify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addr, message, signature }), ...CREDS
  });
  const data = await r.json();
  if (data.csrf) _csrfToken = data.csrf;
  return data;
}

export async function authLogout() {
  _csrfToken = null;
  return fetch("/api/auth/logout", { method: "POST", ...CREDS });
}

export async function authCheckSession() {
  const r = await fetch("/api/auth/session", CREDS);
  const data = await r.json();
  if (data.csrf) _csrfToken = data.csrf;
  return data;
}

// ─── Event logging ────────────────────────────────────────────────────────────
export function logEventApi(log) {
  fetch('/api/log', { method: 'POST', headers: authHeaders(), body: JSON.stringify(log), ...CREDS }).catch(() => {});
}

// ─── Users ────────────────────────────────────────────────────────────────────
export async function getUser(addr) {
  return apiGet("/api/users/" + addr.toLowerCase());
}

export async function patchUser(addr, data) {
  return apiPatch("/api/users/" + addr.toLowerCase(), data);
}

export async function getUserStatus(addr) {
  return apiGet("/api/user-status/" + addr.toLowerCase());
}

// ─── Listings ─────────────────────────────────────────────────────────────────
export async function getListings(params) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return apiGet("/api/listings" + qs);
}

export async function getListing(id) {
  return apiGet("/api/listings/" + id);
}

export async function getOwnerListings(addr) {
  return apiGet("/api/listings/owner/" + addr.toLowerCase());
}

export async function createListing(data) {
  const r = await apiPost("/api/listings", data);
  return r.json();
}

export async function updateListing(id, data) {
  return apiPatch("/api/listings/" + id, data);
}

export async function deleteListing(id, ownerAddr) {
  return apiDelete("/api/listings/" + id + "?owner_addr=" + ownerAddr.toLowerCase());
}

export async function publishListing(id) {
  const r = await apiPost("/api/listings/" + id + "/publish", {});
  return r;
}

export async function listingAction(id, action, ownerAddr) {
  const body = ownerAddr ? { owner_addr: ownerAddr.toLowerCase() } : {};
  return apiPost("/api/listings/" + id + "/" + action, body);
}

export async function composeDescription(data) {
  const r = await apiPost("/api/listings/compose-description", data);
  return r.json();
}

// ─── Messages ─────────────────────────────────────────────────────────────────
export async function getMessages(addr1, addr2) {
  return apiGet("/api/messages/" + addr1.toLowerCase() + "/" + addr2.toLowerCase());
}

export async function sendMessage(data) {
  return apiPost("/api/messages", data);
}

// ─── Viewing requests ─────────────────────────────────────────────────────────
export async function createViewingRequest(data) {
  return apiPost("/api/viewing-request", data);
}

export async function getViewingRequests(addr) {
  return apiGet("/api/viewing-request/" + addr.toLowerCase());
}

// ─── Active contracts ─────────────────────────────────────────────────────────
export async function getActiveContract(addr) {
  return apiGet("/api/active-contract/" + addr.toLowerCase());
}

// ─── Contract forms ───────────────────────────────────────────────────────────
export async function getContractForm(addr, peerAddr) {
  return apiGet("/api/contract-form/" + addr.toLowerCase() + "/" + peerAddr.toLowerCase());
}

export async function saveContractForm(data) {
  return apiPost("/api/contract-form", data);
}

// ─── Contract proposals ───────────────────────────────────────────────────────
export async function getContractProposals(addr) {
  return apiGet("/api/contract-proposal/" + addr.toLowerCase());
}

// ─── City settings ────────────────────────────────────────────────────────────
export async function getCitySettings() {
  return apiGet("/api/city-settings");
}

// ─── Form uploads (multipart — no Content-Type header, browser sets boundary) ──
async function apiFormPost(url, formData) {
  const blocked = checkAuthGuard();
  if (blocked) return blocked;
  const h = {};
  if (_csrfToken) h["X-CSRF-Token"] = _csrfToken;
  return fetch(url, { method: "POST", headers: h, body: formData, ...CREDS });
}

// ─── IPFS uploads ─────────────────────────────────────────────────────────────
export async function uploadFile(formData, encrypt = false) {
  const url = encrypt ? "/api/ipfs/upload-file?encrypt=1" : "/api/ipfs/upload-file";
  const r = await apiFormPost(url, formData);
  return r.json();
}

export async function uploadListingPhoto(formData) {
  const r = await apiFormPost("/api/upload/listing-photo", formData);
  return r.json();
}

// ─── Users (create/update) ────────────────────────────────────────────────────
export async function saveUser(data) {
  return apiPost("/api/users", data);
}

// ─── Tenant requests ──────────────────────────────────────────────────────────
export async function saveTenantRequest(data) {
  return apiPost("/api/tenant-requests", data);
}

export async function getTenantRequests() {
  return apiGet("/api/tenant-requests");
}

// ─── Early termination ───────────────────────────────────────────────────────
export async function sendEarlyTerm(data) {
  return apiPost("/api/early-term", data);
}

export async function respondEarlyTerm(id, data) {
  return apiPatch("/api/early-term/" + id, data);
}

// ─── Archive ──────────────────────────────────────────────────────────────────
export async function archiveContract(addr) {
  // Ensure wallet session is live before archive (triggers Circle lazy reconnect if needed)
  const wallet = typeof window !== 'undefined' && window.pi2piWallet;
  if (wallet && wallet._circlePendingReconnect) {
    try { await wallet.connectCircleWallet(wallet._circleSessionUsername ? { username: wallet._circleSessionUsername } : {}); } catch {}
  }
  return apiPost("/api/active-contract/" + addr.toLowerCase() + "/archive", {});
}

export async function getArchivedContracts(addr) {
  return apiGet("/api/archived-contracts/" + addr.toLowerCase());
}

// ─── Inbox ────────────────────────────────────────────────────────────────────
export async function getInbox(addr) {
  return apiGet("/api/inbox/" + addr.toLowerCase());
}

// ─── Stats ────────────────────────────────────────────────────────────────────
export async function getStats(addr) {
  return apiGet("/api/stats/" + addr.toLowerCase());
}

// ─── Viewing request actions ──────────────────────────────────────────────────
export async function respondViewingRequest(vrId, data) {
  return apiPatch("/api/viewing-request/" + vrId, data);
}

// ─── Contract proposal actions ────────────────────────────────────────────────
export async function cancelContractProposal(proposalId, data) {
  return apiPost("/api/contract-proposal/" + proposalId + "/cancel", data);
}

// ─── Active contracts list ────────────────────────────────────────────────────
export async function getActiveContracts() {
  return apiGet("/api/active-contracts");
}

// ─── World ID verification ───────────────────────────────────────────────────
export async function verifyWorldId(data) {
  return apiPost("/api/verify/worldid", data);
}

// ─── Contract signing ─────────────────────────────────────────────────────────
export async function signContract(data) {
  return apiPost("/api/contract-sign", data);
}

// ─── Contract proposals (create) ──────────────────────────────────────────────
export async function createContractProposal(data) {
  return apiPost("/api/contract-proposal", data);
}

// ─── Save active contract ─────────────────────────────────────────────────────
export async function saveActiveContract(data) {
  return apiPost("/api/active-contract", data);
}

// ─── Publish listing (with signature) ─────────────────────────────────────────
export async function publishListingWithSig(id, data) {
  const r = await apiPost("/api/listings/" + id + "/publish", data);
  return r;
}

// ─── IPFS upload JSON ─────────────────────────────────────────────────────────
export async function uploadIpfsJson(data) {
  const r = await apiPost("/api/ipfs/upload", data);
  return r.json();
}

// ─── Reset all (danger) ───────────────────────────────────────────────────────
export async function resetAll() {
  return apiPost("/api/reset-all", {});
}

// ─── Delete user (legacy — now returns 410) ─────────────────────────────────
export async function deleteUser(addr) {
  return apiDelete("/api/users/" + addr.toLowerCase());
}

// ─── Reset account (safe — checks active contract, cleans listings) ──────────
export async function resetAccount(addr) {
  const r = await apiPost("/api/users/" + addr.toLowerCase() + "/reset", {});
  return r;
}

// ─── Helpers exposed for edge cases ───────────────────────────────────────────
export { apiGet, apiPost, apiPatch, apiDelete };
