import React from 'react';
import { t } from '../../i18n/index.js';

export default function WarningModal({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel, danger }) {
  return (
    <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",animation:"fadein .2s ease"}} onClick={onCancel}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-bg-card)",borderRadius:20,width:"calc(100% - 40px)",maxWidth:380,padding:"24px 20px",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{fontSize:32,textAlign:"center",marginBottom:10}}></div>
        <div style={{fontSize:17,fontWeight:700,textAlign:"center",marginBottom:8,color:"var(--color-text-primary)"}}>{title}</div>
        <div style={{fontSize:13,color:"#555",lineHeight:1.7,textAlign:"center",marginBottom:20,padding:"0 8px"}}>{message}</div>
        {danger && (
          <div style={{background:"var(--color-danger-surface)",border:"1px solid var(--color-danger-border)",borderRadius:10,padding:"10px 12px",marginBottom:16,fontSize:12,color:"var(--color-danger-dark)",lineHeight:1.6,textAlign:"center"}}>
            {danger}
          </div>
        )}
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel} style={{flex:1,padding:"12px",borderRadius:12,background:"var(--color-bg-card)",border:"1.5px solid #e5e7eb",fontFamily:"var(--ff)",fontWeight:600,fontSize:14,cursor:"pointer",color:"#6b7280"}}>
            {cancelLabel || t("btn.cancel")}
          </button>
          <button onClick={onConfirm} style={{flex:1,padding:"12px",borderRadius:12,background:"var(--color-danger)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:14,cursor:"pointer",color:"white"}}>
            {confirmLabel || "Proceed"}
          </button>
        </div>
      </div>
    </div>
  );
}
