import React from 'react';

export default function Info({ label, value }) {
  return (
    <div>
      <div style={{fontSize:10,color:"var(--color-text-secondary)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.3px",marginBottom:3}}>{label}</div>
      <div style={{fontSize:13,fontWeight:600,color:"var(--color-text-primary)"}}>{value}</div>
    </div>
  );
}
