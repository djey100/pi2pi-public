import React, { useState } from 'react';
import { t } from '../i18n/index.js';

export default function VerifyHuman({ chosenRole, onDone }) {
  const [selected, setSelected] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [done, setDone] = useState(false);

  const verify = () => {
    setVerifying(true);
    setTimeout(() => { setDone(true); setVerifying(false); }, 2000);
  };

  return <React.Fragment>
    <StepHeader step={0} total={3}/>
    <div style={{textAlign:"center",marginBottom:14}}>
      <div style={{fontSize:32,marginBottom:6}}></div>
      <div className="modal-title">Proof of Humanity</div>
      <div style={{fontSize:15,fontWeight:600,color:"var(--color-text-secondary)",lineHeight:1.7,textAlign:"center",marginBottom:18,padding:"0 8px"}}>Real people only. No bots.</div>
    </div>
    {!done ? <React.Fragment>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
        {HUMANITY_METHODS.map(m=>(
          <button key={m.id} onClick={()=>setSelected(m.id)}
            style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:"var(--bg2)",border:`2px solid ${selected===m.id?"var(--text)":"var(--border)"}`,borderRadius:11,cursor:"pointer",fontFamily:"var(--ff)",textAlign:"left",transition:"all 0.18s"}}
          >
            <span style={{fontSize:22}}>{m.icon}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:13}}>{m.name}</div>
              <div style={{fontSize:11,color:"var(--muted)"}}>{m.sub}</div>
            </div>
            {selected===m.id&&<span style={{color:"var(--text)",fontWeight:700}}></span>}
          </button>
        ))}
      </div>
      {verifying
        ? <div style={{textAlign:"center"}}><div className="spinner"/><div style={{fontSize:12,color:"var(--muted)"}}>Verifying on-chain…</div></div>
        : <button className="btn-p" style={{opacity:selected?1:.4}} onClick={selected?verify:undefined}>Verify identity →</button>
      }
    </React.Fragment> : <React.Fragment>
      <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10,padding:"13px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:22}}></span>
        <div><div style={{fontWeight:700,fontSize:13,color:"var(--green)"}}>Humanity verified</div><div style={{fontSize:11,color:"var(--muted)"}}>via {HUMANITY_METHODS.find(m=>m.id===selected)?.name}</div></div>
      </div>
      <button className="btn-p" onClick={onDone}>Next: Proof of Funds →</button>
    </React.Fragment>}
  </React.Fragment>;
}
