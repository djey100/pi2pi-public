import React, { useState } from 'react';
import { t } from '../../i18n/index.js';

export default function InputModal({ title, message, placeholder, defaultValue, min, max, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  const [val, setVal] = useState(defaultValue || "");
  const [err, setErr] = useState("");
  const submit = () => {
    const n = parseInt(val);
    if (isNaN(n)) { setErr("Enter a number"); return; }
    if (min !== undefined && n < min) { setErr("Min: "+min); return; }
    if (max !== undefined && n > max) { setErr("Max: "+max); return; }
    onConfirm(n);
  };
  return (
    <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",animation:"fadein .2s ease"}} onClick={onCancel}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-bg-card)",borderRadius:20,width:"calc(100% - 40px)",maxWidth:380,padding:"24px 20px",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{fontSize:32,textAlign:"center",marginBottom:10}}></div>
        <div style={{fontSize:17,fontWeight:700,textAlign:"center",marginBottom:8,color:"var(--color-text-primary)"}}>{title}</div>
        <div style={{fontSize:13,color:"#555",lineHeight:1.7,textAlign:"center",marginBottom:16,padding:"0 8px"}}>{message}</div>
        <input type="number" value={val} placeholder={placeholder} onChange={e=>{setVal(e.target.value);setErr("");}} autoFocus
          style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #e5e7eb",fontSize:15,fontFamily:"var(--ff)",marginBottom:err?6:16,boxSizing:"border-box"}}
          onKeyDown={e=>{if(e.key==="Enter")submit();}}
        />
        {err && <div style={{fontSize:11,color:"var(--color-danger)",textAlign:"center",marginBottom:12}}>{err}</div>}
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel} style={{flex:1,padding:"12px",borderRadius:12,background:"var(--color-bg-card)",border:"1.5px solid #e5e7eb",fontFamily:"var(--ff)",fontWeight:600,fontSize:14,cursor:"pointer",color:"#6b7280"}}>
            {cancelLabel || t("btn.cancel")}
          </button>
          <button onClick={submit} style={{flex:1,padding:"12px",borderRadius:12,background:"var(--color-info)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:14,cursor:"pointer",color:"white"}}>
            {confirmLabel || "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
