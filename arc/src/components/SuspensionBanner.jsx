import React, { useState, useEffect, useRef } from 'react';
import { t } from '../i18n/index.js';

export default function SuspensionBanner({ info, user, onRecheck }) {
  const [checking, setChecking] = useState(false);
  const doRecheck = async () => {
    setChecking(true);
    try { await onRecheck(); } catch {}
    setChecking(false);
  };
  return (
    <div style={{padding:20,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"60vh",textAlign:"center"}}>
      <div style={{width:80,height:80,borderRadius:"50%",background:"var(--color-danger)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:20}}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </div>
      <div style={{fontSize:20,fontWeight:800,color:"var(--color-danger)",marginBottom:8}}>{t("susp.title")}</div>
      <div style={{fontSize:13,color:"var(--color-text-secondary)",lineHeight:1.6,maxWidth:340,marginBottom:24}}>{t("susp.body")}</div>
      <div style={{background:"var(--color-danger-surface)",border:"1px solid var(--color-danger-border)",borderRadius:12,padding:"16px 20px",width:"100%",maxWidth:340,marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:8}}>
          <span style={{color:"var(--color-text-secondary)"}}>{t("susp.balance")}</span>
          <span style={{fontWeight:700,color:"var(--color-danger)"}}>{(info?.balance ?? 0).toFixed(2)} USDC</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:13}}>
          <span style={{color:"var(--color-text-secondary)"}}>{t("susp.required")}</span>
          <span style={{fontWeight:700,color:"var(--color-text-primary)"}}>{(info?.required ?? 0)} USDC</span>
        </div>
      </div>
      <button onClick={doRecheck} disabled={checking}
        style={{width:"100%",maxWidth:340,padding:"14px",borderRadius:12,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:14,cursor:checking?"wait":"pointer",marginBottom:12}}>
        {checking ? t("susp.rechecking") : t("susp.recheck")}
      </button>
      <div style={{fontSize:11,color:"var(--color-text-dim)",lineHeight:1.5,maxWidth:340}}>{t("susp.topup_hint")}</div>
      {user?.addr && <div style={{fontSize:11,color:"var(--color-text-secondary)",marginTop:8,wordBreak:"break-all",fontFamily:"monospace"}}>{user.addr}</div>}
    </div>
  );
}
