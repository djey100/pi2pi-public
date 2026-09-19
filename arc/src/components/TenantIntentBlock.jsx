import React from 'react';
import { t } from '../i18n/index.js';

export default function TenantIntentBlock({ user, onOpenMyIntent }) {
  const intent = user?.intent || user?.listing || null;
  if (!intent) {
    return (
      <div onClick={onOpenMyIntent} style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:12,padding:"12px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,color:"var(--color-text-primary)",marginBottom:2}}>{t("ti.set_intent")}</div>
          <div style={{fontSize:12,color:"var(--color-text-secondary)",lineHeight:1.4}}>{t("ti.set_intent_sub")}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
      </div>
    );
  }
  const summary = `${intent.propType || intent.propertyType || "Any"} in ${intent.city || "any city"} · max ${intent.budget || intent.rent || "—"} USDC · ${intent.duration === "12" ? "1 year" : (intent.duration || "—") + " mo"}`;
  return (
    <div onClick={onOpenMyIntent} style={{background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",borderRadius:12,padding:"10px 14px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",gap:10}}>
      <div style={{minWidth:0,flex:1}}>
        <div style={{fontSize:14,fontWeight:700,color:"var(--color-text-primary)",marginBottom:3}}>{t("ti.my_intent")}</div>
        <div style={{fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{summary}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" strokeWidth="1.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
    </div>
  );
}
