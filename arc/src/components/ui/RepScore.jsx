import React from 'react';
import { t } from '../../i18n/index.js';

export default function RepScore({ role, viewings=0, rentals=0, disputes=0, size="sm" }) {
  const isLarge = size==="lg";
  const v = viewings || 0;
  const r = rentals || 0;
  const d = disputes || 0;

  const color = v === 0 && r === 0 ? "var(--muted)" : "var(--color-primary)";
  const disputeColor = d > 0 ? "var(--color-danger)" : "var(--muted)";

  return (
    <div className="tooltip-wrap" style={{display:"inline-block",position:"relative"}}>
      <div style={{
        display:"inline-flex", alignItems:"center", gap: isLarge?8:5,
        background:"var(--bg2)", borderRadius: isLarge?10:6,
        padding: isLarge?"7px 12px":"3px 8px",
        border:"1.5px solid var(--border)", cursor:"default"
      }}>
        <span style={{fontWeight:800, fontSize: isLarge ? 20 : 12, letterSpacing:"-0.5px"}}>
          <span style={{color}}>{v}</span>
          <span style={{opacity:0.4, fontWeight:400}}>/</span>
          <span style={{color}}>{r}</span>
          <span style={{opacity:0.4, fontWeight:400}}>/</span>
          <span style={{color:disputeColor}}>{d}</span>
        </span>
        <span style={{fontSize: isLarge?10:9, color:"var(--muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.4px"}}>
          {isLarge ? t("rep.label_long") : t("rep.label_short")}
        </span>
      </div>
      <div className="tooltip-box" style={{
        position:"absolute", bottom:"calc(100% + 6px)", left:0,
        background:"var(--color-bg-card)", color:"var(--color-text-primary)", borderRadius:9,
        padding:"9px 12px", fontSize:11, lineHeight:1.6,
        width:200, zIndex:100, pointerEvents:"none",
        opacity:0, transition:"opacity 0.15s", fontWeight:400,
        border:"1px solid var(--border)", boxShadow:"0 4px 12px rgba(0,0,0,0.2)"
      }}>
        {t("rep.label_long")}
      </div>
    </div>
  );
}
