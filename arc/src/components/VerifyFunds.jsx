import React, { useState } from 'react';
import { t } from '../i18n/index.js';
import Dropdown from './ui/Dropdown.jsx';
import { Ic } from './ui/Icons.jsx';

export default function VerifyFunds({ chosenRole, onDone }) {
  const [checking, setChecking] = useState(false);
  const [done, setDone] = useState(false);
  const minAmount = 2;

  const check = () => {
    setChecking(true);
    setTimeout(() => { setDone(true); setChecking(false); }, 2000);
  };

  return <React.Fragment>
    <StepHeader step={1} total={3}/>
    <div style={{textAlign:"center",marginBottom:14}}>
      <div style={{fontSize:32,marginBottom:6}}></div>
      <div className="modal-title">Proof of Funds</div>
      <div style={{fontSize:15,fontWeight:600,color:"var(--color-text-secondary)",lineHeight:1.7,textAlign:"center",marginBottom:18,padding:"0 8px"}}>Show you can pay. Hold at least 1× monthly rent.<br/><span style={{fontSize:13,fontWeight:500,color:"#6b7280"}}>Just checked, never locked.</span></div>
    </div>
    <div style={{background:"var(--bg2)",border:"1.5px solid var(--border)",borderRadius:10,padding:"13px 14px",marginBottom:14}}>
      <div style={{fontSize:10,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>Required balance</div>
      <div style={{fontSize:24,fontWeight:800,marginBottom:2}}>{minAmount.toLocaleString()} USDC</div>
      <div style={{fontSize:11,color:"var(--muted)"}}>Minimum monthly rent · your region · not locked</div>
      <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid var(--border)",display:"flex",justifyContent:"space-between",fontSize:12}}>
        <span style={{color:"var(--muted)"}}>Your balance</span>
        <span style={{fontWeight:700,color:"var(--teal)"}}>8,642 USDC </span>
      </div>
    </div>
    {!done ? <React.Fragment>
      {checking
        ? <div style={{textAlign:"center"}}><div className="spinner"/><div style={{fontSize:12,color:"var(--muted)"}}>Checking wallet balance…</div></div>
        : <button className="btn-p" onClick={check}>Check balance →</button>
      }
    </React.Fragment> : <React.Fragment>
      <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10,padding:"13px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:22}}></span>
        <div><div style={{fontWeight:700,fontSize:13,color:"var(--green)"}}>Funds confirmed</div><div style={{fontSize:11,color:"var(--muted)"}}>8,642 USDC · balance will be monitored</div></div>
      </div>
      <button className="btn-p" onClick={onDone}>Next: Proof of Intent →</button>
    </React.Fragment>}
  </React.Fragment>;
}
