import React from 'react';
import { t } from '../../i18n/index.js';

export default function DealStateBanner({ view, nextStep }) {
  const tones = {
    danger:  { bg:"var(--color-danger-surface)",  border:"var(--color-danger-border)",  color:"var(--color-danger)" },
    warning: { bg:"var(--color-warning-surface)", border:"var(--color-warning-border)", color:"var(--color-warning)" },
    success: { bg:"var(--color-primary-surface)", border:"var(--color-primary-border)", color:"var(--color-primary)" },
    info:    { bg:"var(--color-info-surface)",    border:"var(--color-info-border)",    color:"var(--color-info)" },
    neutral: { bg:"var(--color-bg-secondary)",    border:"var(--color-border)",         color:"var(--color-text-secondary)" },
  };
  const s = tones[view.tone] || tones.neutral;
  return (
    <div style={{background:s.bg, border:`1px solid ${s.border}`, borderRadius:10, padding:"11px 14px", marginBottom:10}}>
      <div style={{display:"flex", alignItems:"center", gap:10}}>
        <div style={{width:8, height:8, borderRadius:"50%", background:s.color, flexShrink:0, boxShadow:`0 0 6px ${s.color}`}}/>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontSize:11, fontWeight:700, color:s.color, textTransform:"uppercase", letterSpacing:"0.8px"}}>{view.label}</div>
          {view.detail && <div style={{fontSize:11, color:"var(--color-text-secondary)", marginTop:2, lineHeight:1.45}}>{view.detail}</div>}
        </div>
      </div>
      {nextStep && (
        <div style={{marginTop:10, paddingTop:10, borderTop:`1px dashed ${s.border}`, display:"flex", alignItems:"flex-start", gap:8}}>
          <span style={{fontSize:9, fontWeight:800, color:s.color, textTransform:"uppercase", letterSpacing:"1px", flexShrink:0, marginTop:1}}>{t("misc.next")}</span>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:12, fontWeight:600, color:"var(--color-text-primary)", lineHeight:1.4}}>{nextStep.text}</div>
            {nextStep.who && <div style={{fontSize:10, color:"var(--color-text-dim)", marginTop:2}}>{t("nextstep.actor_label", {who: t("nextstep.actor."+nextStep.who)})}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
