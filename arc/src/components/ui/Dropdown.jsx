import React, { useState, useEffect, useRef } from 'react';

export default function Dropdown({ value, options, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [open]);

  const selected = options.find(o => o.value === value);
  const displayText = selected ? selected.label : (placeholder || "Select…");
  const hasValue = !!selected;

  return (
    <div ref={ref} style={{position:"relative"}}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{
          width:"100%", maxWidth:"100%",
          background: "var(--color-bg-input)",
          border: `1.5px solid ${open ? "var(--color-primary)" : "var(--color-border)"}`,
          borderRadius: "var(--rsm, 10px)", padding:"11px 38px 11px 13px",
          color: hasValue ? "var(--color-text-primary)" : "var(--color-text-placeholder)",
          fontFamily:"var(--ff)", fontSize:16, fontWeight:500,
          outline:"none", cursor:"pointer", textAlign:"left",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          boxSizing:"border-box", position:"relative",
        }}
      >
        <span style={{flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{displayText}</span>
        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style={{position:"absolute", right:13, top:"50%", transform:`translateY(-50%) rotate(${open?180:0}deg)`, transition:"transform 0.15s", flexShrink:0}}>
          <path d="M1 1l5 5 5-5" stroke="var(--color-text-dim)" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 6px)", left:0, right:0,
          background:"var(--color-glass-bg)",
          backdropFilter:"blur(24px) saturate(180%)",
          WebkitBackdropFilter:"blur(24px) saturate(180%)",
          border:"1px solid var(--color-glass-border)",
          borderRadius:"var(--rsm, 10px)",
          maxHeight:260, overflowY:"auto", zIndex:200,
          boxShadow:"var(--color-glass-shadow)",
          padding:4,
          fontFamily:"var(--ff)",
        }}>
          {options.filter(o => !o.hidden).map(opt => {
            const isSel = opt.value === value;
            return (
              <div key={opt.value} onClick={() => { if (!opt.disabled) { onChange(opt.value); setOpen(false); } }}
                style={{
                  padding:"10px 12px", cursor: opt.disabled ? "default" : "pointer",
                  fontSize:14, fontWeight:500, borderRadius:6,
                  color: opt.disabled ? "var(--color-text-dim)" : (isSel ? "var(--color-primary)" : "var(--color-text-primary)"),
                  background: isSel ? "rgba(22, 199, 132, 0.18)" : "transparent",
                  transition:"background 0.12s",
                }}
                onMouseOver={e => { if (!opt.disabled && !isSel) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                onMouseOut={e => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
              >
                {opt.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
