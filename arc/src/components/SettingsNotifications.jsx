import React, { useState, useEffect } from 'react';
import { t, getLang, setLang, SUPPORTED_LANGS } from '../i18n/index.js';
import Dropdown from './ui/Dropdown.jsx';
import SwitchRoleSection from './SwitchRoleSection.jsx';
import { getUser, apiPost, apiDelete, apiPatch } from '../api/client.js';

export default function SettingsNotifications({ user }) {
  // ── Telegram ─────────────────────────────────────────────
  const [tgConnected, setTgConnected] = useState(false);
  const [tgUsername, setTgUsername] = useState("");
  const [tgConnecting, setTgConnecting] = useState(false);
  const [tgLoaded, setTgLoaded] = useState(false);

  const [email, setEmail] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailErr, setEmailErr] = useState("");
  const [emailPrefs, setEmailPrefs] = useState({ transactional: true, promo: true, support: true });
  const [emailLoaded, setEmailLoaded] = useState(false);

  // ── Display Name (one-time set) ─────────────────────────────────
  // Replaces the user's wallet address (0xabc…xyz) with a chosen name
  // everywhere the profile shows. Permanent — cannot be changed once set,
  // to avoid accidental renames mid-rental where counterparties already know you.
  const addr = (user?.addr || "").toLowerCase();
  const NAME_KEY = addr ? "pi2pi_displayname_" + addr : "";
  const LOCK_KEY = addr ? "pi2pi_displayname_locked_" + addr : "";
  const [displayName, setDisplayName] = useState("");
  const [locked, setLocked] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameSaveConfirm, setNameSaveConfirm] = useState(false);

  // Load display name + email from server (authoritative source)
  useEffect(() => {
    if (!addr) return;
    (async () => {
      try {
        const r = { ok: true, json: () => getUser(addr) };
        const d = await r.json();
        // Display name — server is authoritative
        if (d?.display_name) {
          setDisplayName(d.display_name);
          setNameInput(d.display_name);
          setLocked(!!d.display_name_locked);
          try { localStorage.setItem(NAME_KEY, d.display_name); localStorage.setItem(LOCK_KEY, d.display_name_locked?"1":"0"); } catch {}
        } else {
          // Fallback to localStorage if server has nothing
          try { const n = localStorage.getItem(NAME_KEY) || ""; setDisplayName(n); setNameInput(n); setLocked(localStorage.getItem(LOCK_KEY)==="1"); } catch {}
        }
        // Telegram
        if (d?.telegram_chat_id) {
          setTgConnected(true);
          setTgUsername(d.telegram_username || "");
        }
        setTgLoaded(true);
        // Email
        if (d?.email) {
          setEmail(d.email);
          setEmailInput(d.email);
          setEmailConfirmed(!!d.email_confirmed);
          setEmailPrefs(d.email_notifications || { transactional: true, promo: true, support: true });
          if (d.email && !d.email_confirmed) setEmailSent(true);
        }
      } catch {
        // Offline fallback
        try { const n = localStorage.getItem(NAME_KEY) || ""; setDisplayName(n); setNameInput(n); setLocked(localStorage.getItem(LOCK_KEY)==="1"); } catch {}
      }
      setEmailLoaded(true);
    })();
  }, [addr]);

  const sendEmailConfirm = async () => {
    setEmailErr(""); setEmailSending(true);
    try {
      const r = await apiPost("/api/email/set", { addr, email: emailInput.trim() });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Send failed");
      setEmail(emailInput.trim());
      setEmailSent(true);
      setEmailConfirmed(false);
    } catch (e) { setEmailErr(e.message); }
    finally { setEmailSending(false); }
  };

  const resendEmailConfirm = async () => {
    setEmailErr(""); setEmailSending(true);
    try {
      const r = await apiPost("/api/email/resend-confirm", { addr });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Send failed");
    } catch (e) { setEmailErr(e.message); }
    finally { setEmailSending(false); }
  };

  const removeEmail = async () => {
    if (!confirm(t("confirm.remove_email"))) return;
    try {
      await apiDelete("/api/email/" + addr);
      setEmail(""); setEmailInput(""); setEmailSent(false); setEmailConfirmed(false);
    } catch (e) { setEmailErr(e.message); }
  };

  const updatePrefs = async (field, value) => {
    const next = { ...emailPrefs, [field]: value };
    setEmailPrefs(next);
    try {
      await apiPatch("/api/email/preferences", { addr, [field]: value });
    } catch {}
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim());

  const shortAddr = addr ? addr.slice(0, 6) + "…" + addr.slice(-4) : "—";
  const trimmed = nameInput.trim();
  const [nameErr, setNameErr] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const latinOnly = /^[a-zA-Z][a-zA-Z0-9 ._-]*$/.test(trimmed);
  const canSave = !locked && trimmed.length >= 2 && trimmed.length <= 40 && trimmed !== displayName && latinOnly;

  const commitName = async () => {
    if (!canSave || !addr) return;
    setNameErr(""); setNameSaving(true);
    try {
      const r = await apiPost("/api/displayname", { addr, name: trimmed });
      const d = await r.json();
      if (!r.ok) { setNameErr(d.error || "Failed"); setNameSaving(false); return; }
      try { localStorage.setItem(NAME_KEY, trimmed); localStorage.setItem(LOCK_KEY, "1"); } catch {}
      setDisplayName(trimmed);
      setLocked(true);
      setNameSaveConfirm(false);
    } catch(e) { setNameErr(e.message || "Network error"); }
    setNameSaving(false);
  };

  // ── Theme toggle ─────────────────────────────────────────
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("pi2pi-theme") || "dark"; } catch { return "dark"; }
  });
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("pi2pi-theme", next); } catch {}
    try { if (window.pi2piWallet?._appKit?.setThemeMode) window.pi2piWallet._appKit.setThemeMode(next); } catch {}
  };

  return (
    <div style={{marginTop:12}}>
      {/* ── Theme toggle ──────────────────────────────────────── */}
      <div style={{marginBottom:22,paddingBottom:16,borderBottom:"1px solid var(--border)"}}>
        <div className="field-label">{t("title.appearance")}</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:8}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{theme === "dark" ? t("body.dark_mode") : t("body.light_mode")}</div>
          <button onClick={toggleTheme} style={{
            width:48,height:26,borderRadius:13,border:"none",cursor:"pointer",padding:2,
            background:theme==="dark"?"var(--color-primary)":"var(--color-border-strong)",
            transition:"background 0.2s",position:"relative",flexShrink:0
          }}>
            <div style={{
              width:22,height:22,borderRadius:11,background:"white",
              transition:"transform 0.2s",
              transform:theme==="dark"?"translateX(22px)":"translateX(0)"
            }}/>
          </button>
        </div>
        <div style={{fontSize:11,color:"var(--muted)",marginTop:6}}>{theme === "dark" ? t("body.dark_desc") : t("body.light_desc")}</div>

        {/* Language selector */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:14}}>
          <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{t("title.language")}</div>
          <Dropdown value={getLang()} options={SUPPORTED_LANGS.map(l=>({value:l.code,label:l.native}))}
            onChange={v=>{ setLang(v); window.location.reload(); }}/>
        </div>
      </div>

      {/* ── Display Name section ────────────────────────────────── */}
      <div style={{marginBottom:22,paddingBottom:16,borderBottom:"1px solid var(--border)"}}>
        <div className="field-label" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>{t("title.display_name")}</span>
          {locked && <span style={{fontSize:10,color:"var(--green)",fontWeight:700}}>{t("status.locked")}</span>}
        </div>
        <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.6,marginBottom:10}}>
          {t("body.choose_name_desc")} <strong style={{color:"var(--text)",fontFamily:"monospace"}}>{shortAddr}</strong>
        </div>
        {!locked && (
          <div style={{background:"var(--color-warning-surface)",border:"1px solid var(--color-warning-border)",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:11,color:"var(--color-warning)",lineHeight:1.5}}>
            {t("body.name_one_time")}
          </div>
        )}
        {locked ? (
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10}}>
            <span style={{color:"var(--green)",fontSize:16}}></span>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:700}}>{displayName}</div>
              <div style={{fontSize:11,color:"var(--muted)",fontFamily:"monospace"}}>{shortAddr}</div>
            </div>
          </div>
        ) : nameSaveConfirm ? (
          <div style={{background:"var(--color-warning-surface)",border:"1.5px solid var(--color-warning-border)",borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--color-warning)",marginBottom:6}}>Set "{trimmed}" as your permanent display name?</div>
            <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:10,lineHeight:1.5}}>This cannot be undone. After confirming, you will not be able to rename.</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-p" disabled={nameSaving} style={{flex:1,background:"var(--color-primary)",padding:"8px"}} onClick={commitName}>{nameSaving?"…":t("btn.set_permanently")}</button>
              <button className="btn-g" style={{flex:1,padding:"8px"}} onClick={()=>{setNameSaveConfirm(false);setNameErr("");}}>{t("btn.cancel")}</button>
            </div>
            {nameErr && <div style={{fontSize:11,color:"var(--color-danger)",marginTop:6}}>{nameErr}</div>}
          </div>
        ) : (<React.Fragment>
          <div style={{display:"flex",gap:8}}>
            <input className="field-inp" style={{flex:1}} type="text" placeholder={t("ph.name")}
              value={nameInput} onChange={e=>{setNameInput(e.target.value);setNameErr("");}} maxLength={40}/>
            <button className="bb-btn" disabled={!canSave||nameSaving} style={{fontSize:12,padding:"0 14px",whiteSpace:"nowrap",opacity:canSave?1:.4,cursor:canSave?"pointer":"not-allowed"}}
              onClick={()=>setNameSaveConfirm(true)}>{nameSaving?"…":t("btn.set_name")}</button>
          </div>
          {trimmed.length > 0 && !latinOnly && <div style={{fontSize:11,color:"var(--color-warning)",marginTop:4}}>Latin letters only (a-z, numbers, spaces, dots, hyphens)</div>}
          {nameErr && <div style={{fontSize:11,color:"var(--color-danger)",marginTop:4}}>{nameErr}</div>}
        </React.Fragment>)}
      </div>

      {/* ── Telegram section ──────────────────────────────────── */}
      <div style={{marginBottom:22,paddingBottom:16,borderBottom:"1px solid var(--border)"}}>
        <div className="field-label" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>Telegram</span>
          {tgConnected && <span style={{fontSize:10,color:"var(--green)",fontWeight:700}}>Connected</span>}
        </div>
        <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.6,marginBottom:10}}>
          {tgConnected
            ? "Receive instant notifications about messages, viewings, and contracts via Telegram."
            : "Connect Telegram to receive instant notifications about your rental activity."}
        </div>

        {tgConnected ? (
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10}}>
              <svg width="32" height="32" viewBox="0 0 240 240" fill="none"><circle cx="120" cy="120" r="120" fill="#2AABEE"/><path d="M98 175c-3.9 0-3.2-1.5-4.6-5.2L82 131.8l95-56.8" fill="#C8DAEA"/><path d="M98 175c3 0 4.3-1.4 6-3l16-15.6-20-12" fill="#A9C9DD"/><path d="M100 144.4l48.4 35.7c5.5 3 9.5 1.5 10.9-5.1l19.7-92.8c2-8.1-3.1-11.7-8.4-9.3L67 117.4c-7.9 3.2-7.8 7.6-1.4 9.5l26.1 8.1 60.4-38.1c2.8-1.7 5.4-.8 3.3 1.1" fill="white"/></svg>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:700}}>{tgUsername ? `@${tgUsername}` : "Telegram"}</div>
                <div style={{fontSize:11,color:"var(--muted)"}}>Notifications active</div>
              </div>
            </div>
            <button onClick={async () => {
              if (!confirm("Disconnect Telegram notifications?")) return;
              try {
                await apiPost("/api/telegram/disconnect", { addr });
                setTgConnected(false);
                setTgUsername("");
              } catch {}
            }} style={{width:"100%",marginTop:8,padding:"8px",borderRadius:8,background:"none",border:"1px solid var(--border)",color:"var(--muted)",fontSize:11,cursor:"pointer",fontFamily:"var(--ff)"}}>
              Disconnect Telegram
            </button>
          </div>
        ) : (
          <button
            disabled={tgConnecting || !addr}
            onClick={async () => {
              setTgConnecting(true);
              try {
                const r = await apiPost("/api/telegram/connect", { addr });
                const d = await r.json();
                if (d.link) {
                  window.open(d.link, "_blank");
                  // Poll for connection (user might take a few seconds in Telegram)
                  let attempts = 0;
                  const poll = setInterval(async () => {
                    attempts++;
                    if (attempts > 30) { clearInterval(poll); setTgConnecting(false); return; }
                    try {
                      const sr = await fetch(`/api/telegram/status/${addr}`);
                      const sd = await sr.json();
                      if (sd.connected) {
                        setTgConnected(true);
                        setTgUsername(sd.username || "");
                        setTgConnecting(false);
                        clearInterval(poll);
                      }
                    } catch {}
                  }, 2000);
                }
              } catch { setTgConnecting(false); }
            }}
            style={{
              width:"100%",padding:"12px",borderRadius:10,fontSize:13,fontWeight:700,
              cursor:addr?"pointer":"not-allowed",fontFamily:"var(--ff)",
              background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",
              opacity:tgConnecting?0.6:1,
              display:"flex",alignItems:"center",justifyContent:"center",gap:8
            }}>
            <svg width="20" height="20" viewBox="0 0 240 240" fill="none"><circle cx="120" cy="120" r="120" fill="white" fillOpacity="0.2"/><path d="M98 175c-3.9 0-3.2-1.5-4.6-5.2L82 131.8l95-56.8" fill="rgba(255,255,255,0.5)"/><path d="M98 175c3 0 4.3-1.4 6-3l16-15.6-20-12" fill="rgba(255,255,255,0.4)"/><path d="M100 144.4l48.4 35.7c5.5 3 9.5 1.5 10.9-5.1l19.7-92.8c2-8.1-3.1-11.7-8.4-9.3L67 117.4c-7.9 3.2-7.8 7.6-1.4 9.5l26.1 8.1 60.4-38.1c2.8-1.7 5.4-.8 3.3 1.1" fill="white"/></svg>
            {tgConnecting ? "Connecting…" : "Connect Telegram"}
          </button>
        )}
      </div>

      <div style={{fontSize:12,color:"var(--muted)",marginBottom:12,lineHeight:1.6}}>
        {t("body.email_instructions")}
      </div>

      {/* ── Email section (real flow, backed by /api/email/*) ─────── */}
      <div style={{marginBottom:12}}>
        <div className="field-label" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>{t("title.email")}</span>
          {emailConfirmed && <span style={{fontSize:10,color:"var(--green)",fontWeight:700}}>{t("status.verified")}</span>}
          {!emailConfirmed && emailSent && <span style={{fontSize:10,color:"var(--color-warning)",fontWeight:700}}>⧗ {t("status.unverified")}</span>}
        </div>

        {emailConfirmed ? (
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10}}>
            <span style={{color:"var(--green)",fontWeight:700}}></span>
            <span style={{flex:1,fontSize:13,fontWeight:600,wordBreak:"break-all"}}>{email}</span>
            <button onClick={removeEmail} style={{background:"none",border:"none",color:"var(--color-danger)",fontSize:11,cursor:"pointer",fontFamily:"var(--ff)"}}>{t("btn.remove")}</button>
          </div>
        ) : emailSent ? (
          <div>
            <div style={{padding:"10px 12px",background:"var(--bg2)",borderRadius:10,fontSize:12,color:"var(--muted)",lineHeight:1.5}}>
              Confirmation sent to <strong style={{color:"var(--text)"}}>{email}</strong><br/>
              Check inbox + Spam. Click the link inside to verify.
            </div>
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <button style={{flex:1,fontSize:11,color:"var(--teal)",background:"none",border:"1px solid var(--border)",padding:"6px",borderRadius:6,cursor:"pointer",fontFamily:"var(--ff)"}}
                disabled={emailSending} onClick={resendEmailConfirm}>
                {emailSending ? t("body.sending") : `↻ ${t("btn.resend")}`}
              </button>
              <button style={{flex:1,fontSize:11,color:"var(--color-danger)",background:"none",border:"1px solid var(--border)",padding:"6px",borderRadius:6,cursor:"pointer",fontFamily:"var(--ff)"}}
                onClick={removeEmail}>
                {t("btn.change_email")}
              </button>
            </div>
            {emailErr && <div style={{marginTop:6,fontSize:11,color:"var(--color-danger)"}}>{emailErr}</div>}
          </div>
        ) : (
          <>
            <div style={{display:"flex",gap:8}}>
              <input className="field-inp" style={{flex:1}} type="email" placeholder={t("ph.email")}
                value={emailInput} onChange={e=>setEmailInput(e.target.value)}/>
              <button className="bb-btn" disabled={!emailValid || emailSending || !addr} style={{fontSize:12,padding:"0 14px",whiteSpace:"nowrap",opacity:(emailValid && addr)?1:.4,cursor:(emailValid && addr)?"pointer":"not-allowed"}}
                onClick={sendEmailConfirm}>
                {emailSending ? "Sending…" : t("btn.confirm")}
              </button>
            </div>
            {emailErr && <div style={{marginTop:6,fontSize:11,color:"var(--color-danger)"}}>{emailErr}</div>}
          </>
        )}
      </div>

      {/* ── Email preferences (visible only after email verified) ── */}
      {emailConfirmed && (
        <div style={{marginBottom:12,padding:"10px 12px",background:"var(--bg2)",borderRadius:8}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>{t("body.what_to_send")}</div>
          <label style={{display:"flex",alignItems:"center",gap:10,padding:"4px 0",fontSize:13,cursor:"pointer"}}>
            <input type="checkbox" checked={emailPrefs.transactional} onChange={e=>updatePrefs("transactional", e.target.checked)}/>
            <div style={{flex:1}}>
              <div>{t("body.contract_message_alerts")}</div>
              <div style={{fontSize:10,color:"var(--muted)"}}>New messages, viewing requests, contract proposals, early termination</div>
            </div>
          </label>
          <label style={{display:"flex",alignItems:"center",gap:10,padding:"4px 0",fontSize:13,cursor:"pointer"}}>
            <input type="checkbox" checked={emailPrefs.promo} onChange={e=>updatePrefs("promo", e.target.checked)}/>
            <div style={{flex:1}}>
              <div>{t("body.product_updates")}</div>
              <div style={{fontSize:10,color:"var(--muted)"}}>New features, launches, occasional newsletter from pi2pi team</div>
            </div>
          </label>
        </div>
      )}


      {/* ── Switch Role ─────────────────────────────────────────── */}
      <SwitchRoleSection user={user}/>
    </div>
  );
}
