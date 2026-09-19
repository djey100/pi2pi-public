import React from 'react';

export default function StepHeader({ step, total }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:18}}>
      {Array.from({length:total},(_,i)=>(
        <div key={i} style={{flex:1,height:3,borderRadius:2,background:i<step?"var(--text)":i===step?"var(--accent)":"var(--border2)",transition:"all 0.3s"}}/>
      ))}
    </div>
  );
}
