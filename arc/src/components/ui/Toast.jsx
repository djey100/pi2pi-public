import React, { useEffect } from 'react';

export function Toast({ msg, kind, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [onClose]);
  const colors = {
    success: { bg: "var(--color-primary-surface)", border: "#6ee7b7", text: "#065f46", icon: "" },
    error:   { bg: "var(--color-danger-surface)", border: "var(--color-danger-border)", text: "var(--color-danger-dark)", icon: "" },
    info:    { bg: "var(--color-info-surface)", border: "var(--color-info-border)", text: "var(--color-info)", icon: "ℹ" },
  }[kind || "info"];
  return (
    <div onClick={onClose} style={{background:colors.bg,border:"1.5px solid "+colors.border,color:colors.text,borderRadius:12,padding:"12px 14px",fontSize:13,fontWeight:600,fontFamily:"var(--ff)",lineHeight:1.5,boxShadow:"0 8px 24px rgba(0,0,0,0.12)",cursor:"pointer",display:"flex",alignItems:"flex-start",gap:10,maxWidth:340,animation:"fadein .2s ease"}}>
      <span style={{fontSize:16,flexShrink:0}}>{colors.icon}</span>
      <span>{msg}</span>
    </div>
  );
}

export function ToastStack({ toasts, removeToast }) {
  return (
    <div style={{position:"fixed",top:20,right:20,zIndex:10000,display:"flex",flexDirection:"column",gap:10,pointerEvents:"none"}}>
      {toasts.map(t => (
        <div key={t.id} style={{pointerEvents:"auto"}}>
          <Toast msg={t.msg} kind={t.kind} onClose={()=>removeToast(t.id)} />
        </div>
      ))}
    </div>
  );
}
