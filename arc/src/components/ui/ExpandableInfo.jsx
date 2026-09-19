import React, { useState } from 'react';

export default function ExpandableInfo({ title }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{marginTop:12,marginBottom:6,border:"1px solid var(--color-border)",borderRadius:10,background:"var(--color-bg-secondary)",overflow:"hidden"}}>
      <button type="button" onClick={()=>setOpen(o=>!o)}
        style={{width:"100%",padding:"11px 14px",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:"var(--ff)",fontSize:13,fontWeight:600,color:"var(--color-text-primary)",textAlign:"left"}}>
        <span style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{width:20,height:20,borderRadius:"50%",background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",color:"var(--color-primary)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,flexShrink:0}}>i</span>
          {title}
        </span>
        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style={{transform:`rotate(${open?180:0}deg)`,transition:"transform 0.15s"}}>
          <path d="M1 1l5 5 5-5" stroke="var(--color-text-dim)" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <div style={{padding:"0 14px 14px",fontSize:12,color:"var(--color-text-secondary)",lineHeight:1.65,borderTop:"1px solid var(--color-border)",paddingTop:12}}>
          <p style={{marginBottom:10}}>On pi2pi.io there are <strong style={{color:"var(--color-text-primary)"}}>3 paths</strong> for ending a rental before the agreed date:</p>
          <p style={{marginBottom:8}}><strong style={{color:"var(--color-primary)"}}>1. Mutual</strong> — both parties sign → deposits return to owners. No penalty.</p>
          <p style={{marginBottom:8}}><strong style={{color:"var(--color-warning)"}}>2. I accept loss</strong> — initiator's commitment deposit (1× rent) goes to counterparty. Counterparty's own deposit returns. Single signature.</p>
          <p style={{marginBottom:4}}><strong style={{color:"var(--color-danger)"}}>3. Disputed</strong> — both deposits frozen for 60 days. After expiry — each gets their own back. During freeze — parties can settle directly.</p>
        </div>
      )}
    </div>
  );
}
