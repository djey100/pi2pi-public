import React, { useState, useEffect } from 'react';
import { t } from '../i18n/index.js';
import { readUsdcBalance, getProvider } from '../wallet.js';
import { getUser, saveUser, saveTenantRequest, getCitySettings } from '../api/client.js';
import { logEventApi } from '../api/client.js';
import { ACTIVE_NETWORK_APP_URL } from '../helpers.js';
import QRShareBlock from './QRShareBlock.jsx';
import { IcBack } from './ui/Icons.jsx';
import Dropdown from './ui/Dropdown.jsx';
import Info from './ui/Info.jsx';

function logEvent(type, payload = {}) {
  const log = { time: new Date().toISOString(), type, ...payload };
  console.log("[pi2pi-log]", log);
  logEventApi(log);
}

export default function MyIntentPage({ user, suspendedInfo, onBack }) {
  const [serverIntent, setServerIntent] = useState(null);
  const isT = (user?.role || "tenant") === "tenant";

  useEffect(() => {
    const addr = user?.addr?.toLowerCase();
    if (!addr || addr.length < 42) return;
    getUser(addr).then(d => {
      const si = d?.intent || d?.listing || null;
      if (si) setServerIntent(si);
    }).catch(()=>{});
  }, [user?.addr]);

  const intent = serverIntent || user?.intent || user?.listing || null;
  const [editing, setEditing] = useState(false);
  const [city, setCity] = useState("");
  const [propType, setPropType] = useState(isT ? "1BR" : "Apartment");
  const [budget, setBudget] = useState("");
  const [duration, setDuration] = useState("6");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (intent) {
      setCity(intent.city || "");
      setPropType(intent.propType || intent.propertyType || (isT ? "1BR" : "Apartment"));
      setBudget(intent.budget || intent.rent || "");
      setDuration(intent.duration || "6");
      setEditing(false);
    } else {
      setEditing(true);
    }
  }, [intent?.city, intent?.budget]);
  const [saved, setSaved] = useState(false);
  const [balanceError, setBalanceError] = useState(null);

  const budgetNum = parseFloat(budget) || 0;
  const canSave = !!(city && budgetNum > 0);

  const save = async () => {
    setSaving(true);
    const newIntent = { city, propType, budget: String(budgetNum), duration };
    try {
      let addr = user?.addr;
      if (!addr || addr.length < 42) {
        const accs = await (getProvider()||window.ethereum)?.request({method:"eth_accounts"});
        addr = accs?.[0];
      }
      if (!addr) { setSaving(false); return; }
      try {
        const cs = await getCitySettings().catch(()=>[]);
        const cm = (cs||[]).find(c => city && (city.toLowerCase().includes(c.city.toLowerCase()) || c.city.toLowerCase().includes(city.toLowerCase())));
        const minRequired = Math.max(cm?.min_balance || 0, budgetNum);
        if (minRequired > 0) {
          const bal = await readUsdcBalance(addr);
          if (bal < minRequired) {
            setBalanceError({required: minRequired, balance: bal, city: city});
            setSaving(false); return;
          }
        }
      } catch(e){}
      const signMsg = `pi2pi: Save search intent`;
      const provider = getProvider() || window.ethereum;
      const sig = await provider.request({ method: "personal_sign", params: [signMsg, addr] });
      logEvent("UI_ACTION", { user: addr, action: "intent_saved", data: { city: newIntent.city, budget: newIntent.budget, signature: sig.slice(0,20)+"..." } });
      const prev = JSON.parse(localStorage.getItem("pi2pi_user_" + addr.toLowerCase()) || "{}");
      const updated = { ...prev, listing: newIntent, addr };
      localStorage.setItem("pi2pi_user_" + addr.toLowerCase(), JSON.stringify(updated));
      await saveUser(updated);
      await saveTenantRequest({ addr, intent: newIntent }).catch(()=>{});
      if (user) { user.listing = newIntent; user.intent = newIntent; user.intentData = newIntent; }
      setServerIntent(newIntent);
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 2000);
    } catch(e) { alert(e.message || t("err.save_failed")); }
    setSaving(false);
  };

  const CITIES = [{value:"Tbilisi, Georgia",label:"Tbilisi, Georgia"},{value:"Batumi, Georgia",label:"Batumi, Georgia"},{value:"Da Nang, Vietnam",label:"Da Nang, Vietnam"},{value:"Ho Chi Minh City, Vietnam",label:"Ho Chi Minh City, Vietnam"},{value:"Nha Trang, Vietnam",label:"Nha Trang, Vietnam"},{value:"Hanoi, Vietnam",label:"Hanoi, Vietnam"},{value:"Buenos Aires, Argentina",label:"Buenos Aires, Argentina"},{value:"São Paulo, Brazil",label:"São Paulo, Brazil"},{value:"Bangkok, Thailand",label:"Bangkok, Thailand"},{value:"Samui, Thailand",label:"Samui, Thailand"},{value:"Phuket, Thailand",label:"Phuket, Thailand"}];
  const TYPES = isT ? ["Studio","1BR","2BR","3BR","House"] : ["Apartment","House","Villa","Studio"];
  const DURATIONS = [{value:"6",label:t("mi.6_months")},{value:"12",label:t("mi.1_year")},{value:"18",label:t("mi.18_months")},{value:"24",label:t("mi.2_years")}];

  return (
    <div className="cf-wrap">
      {balanceError && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setBalanceError(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-bg-card)",borderRadius:16,padding:"24px 20px",maxWidth:380,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.3)"}}>
            <div style={{textAlign:"center",marginBottom:16}}>
              <div style={{fontSize:36,marginBottom:8}}>⚠️</div>
              <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>{t("balance.gate_title")}</div>
            </div>
            <div style={{background:"var(--color-danger-surface)",border:"1px solid var(--color-danger-border)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
              <div style={{fontSize:13,color:"var(--color-danger)",lineHeight:1.6}}>{t("balance.gate_insufficient", {amount: balanceError.required, city: balanceError.city})}</div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
              <span style={{color:"var(--muted)"}}>{t("balance.gate_city", {city: balanceError.city, amount: balanceError.required})}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 0",marginBottom:14}}>
              <span style={{color:"var(--muted)"}}>{t("balance.gate_your", {balance: balanceError.balance.toFixed(2)})}</span>
            </div>
            <div style={{fontSize:11,color:"var(--muted)",marginBottom:16,lineHeight:1.5}}>{t("balance.gate_topup")}</div>
            <button onClick={()=>setBalanceError(null)} style={{width:"100%",padding:"12px",borderRadius:10,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:14,cursor:"pointer"}}>OK</button>
          </div>
        </div>
      )}
      <button className="cf-back" onClick={onBack}><IcBack/> {t("cf.back")}</button>
      <div className="cf-title">{t("title.my_intent")}</div>
      <div className="cf-sub" style={{marginBottom:18}}>{isT ? t("mi.looking_for") : t("mi.offering")}</div>

      {editing ? (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <div className="field-label">{t("mi.city_region")}</div>
            <Dropdown value={city} placeholder={t("mi.select_city")} options={CITIES} onChange={setCity}/>
          </div>
          <div>
            <div className="field-label">{isT ? t("lw.property_type") : t("mi.im_offering")}</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {TYPES.map(t => (
                <button key={t} onClick={()=>setPropType(t)}
                  style={{padding:"7px 12px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"var(--ff)",
                    background:propType===t?"var(--color-primary)":"var(--color-bg-card)",
                    color:propType===t?"var(--color-primary-text)":"var(--color-text-secondary)",
                    border:`1.5px solid ${propType===t?"var(--color-primary)":"var(--color-border)"}`
                  }}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="field-label">{isT ? t("mi.max_budget") : t("mi.min_rent")}</div>
            <input className="field-inp" type="number" min="1" step="1" placeholder={t("ph.budget")} value={budget} onChange={e=>setBudget(e.target.value)}/>
          </div>
          <div>
            <div className="field-label">{t("field.duration")}</div>
            <Dropdown value={duration} placeholder={t("mi.select_duration")} options={DURATIONS} onChange={setDuration}/>
          </div>
          <button disabled={!canSave||saving} onClick={save}
            style={{width:"100%",padding:"12px",borderRadius:10,background:canSave?"var(--color-primary)":"var(--color-bg-secondary)",color:canSave?"var(--color-primary-text)":"var(--color-text-dim)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:canSave?"pointer":"not-allowed",marginTop:4}}>
            {saving ? t("body.saving") : t("btn.save_intent")}
          </button>
          {intent && <button onClick={()=>setEditing(false)} style={{width:"100%",padding:"10px",borderRadius:10,background:"none",border:"1px solid var(--color-border)",color:"var(--color-text-secondary)",fontFamily:"var(--ff)",fontWeight:600,fontSize:12,cursor:"pointer"}}>{t("btn.cancel")}</button>}
        </div>
      ) : (
        <div style={{border:"1px solid var(--color-border)",borderRadius:12,padding:16,background:"var(--color-bg-card)"}}>
          {(() => {
            const isSusp = !!intent?.suspended || !!suspendedInfo?.suspended;
            const isPaused = !isSusp && !!intent?.paused;
            const statusColor = isSusp ? "var(--color-danger)" : isPaused ? "var(--color-warning)" : "var(--color-primary)";
            const statusBg = isSusp ? "var(--color-danger-surface)" : isPaused ? "var(--color-warning-surface)" : "var(--color-primary-surface)";
            const statusText = isSusp ? t("mi.status_suspended") : isPaused ? t("mi.status_paused") : t("mi.status_active");
            const statusLabel = isSusp ? t("ml.status_suspended") : isPaused ? t("ml.status_paused") : t("ml.status_active");
            return (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <span style={{fontSize:12,fontWeight:700,color: statusColor}}>{statusText}</span>
                <span style={{fontSize:10,padding:"3px 8px",borderRadius:50,fontWeight:700,background: statusBg, color: statusColor}}>{statusLabel}</span>
              </div>
            );
          })()}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Info label={t("mi.city")} value={intent?.city || "—"}/>
            <Info label={t("lw.property_type")} value={intent?.propType || intent?.propertyType || "—"}/>
            <Info label={isT ? t("mi.max_budget_short") : t("mi.min_rent_short")} value={intent?.budget || intent?.rent ? `${intent?.budget || intent?.rent} USDC/mo` : "—"}/>
            <Info label={t("field.duration")} value={intent?.duration ? (intent?.duration === "12" ? t("mi.1_year") : `${intent?.duration} ${t("misc.months")}`) : "—"}/>
          </div>
          {saved && <div style={{marginTop:10,fontSize:12,color:"var(--color-primary)",fontWeight:700}}>{t("mi.saved")}</div>}
          <div style={{display:"flex",gap:8,marginTop:14}}>
            <button onClick={()=>setEditing(true)}
              style={{flex:1,padding:"10px",borderRadius:10,background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",color:"var(--color-text-primary)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
              {t("btn.edit_intent")}
            </button>
            {!intent?.suspended && <button onClick={async ()=>{
              const addr = user?.addr?.toLowerCase();
              if (!addr) return;
              const newIntent = { ...intent, paused: !intent?.paused };
              const prev = JSON.parse(localStorage.getItem("pi2pi_user_" + addr) || "{}");
              const updated = { ...prev, listing: newIntent, intent: newIntent };
              localStorage.setItem("pi2pi_user_" + addr, JSON.stringify(updated));
              await saveUser({ ...updated, addr }).catch(()=>{});
              await saveTenantRequest({ addr, intent: newIntent }).catch(()=>{});
              if (user) { user.listing = newIntent; user.intent = newIntent; }
              setServerIntent(newIntent);
            }}
              style={{flex:1,padding:"10px",borderRadius:10,background: intent?.paused ? "var(--color-primary)" : "var(--color-warning-surface)", border: intent?.paused ? "none" : "1px solid var(--color-warning)", color: intent?.paused ? "var(--color-primary-text)" : "var(--color-warning)", fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
              {intent?.paused ? t("btn.resume_intent") : t("btn.pause_intent")}
            </button>}
          </div>
          <div style={{marginTop:12,fontSize:11,color:"var(--color-text-dim)",lineHeight:1.5}}>
            {intent?.suspended ? t("mi.suspended_hint") : intent?.paused ? t("mi.paused_hint") : t("mi.intent_privacy")}
          </div>
          {!intent?.suspended && !intent?.paused && user?.addr && (
            <QRShareBlock
              url={`${ACTIVE_NETWORK_APP_URL}/#/tenant/${user.addr.toLowerCase()}`}
              type="tenant"
              title={`${intent?.propType || ""} · ${intent?.city || ""} · $${intent?.budget || ""}/${t("qr.month") || "mo"}`}
            />
          )}
        </div>
      )}
    </div>
  );
}
