import React, { useState } from 'react';

export default function InfoTip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{position:"relative",display:"inline-flex",alignItems:"center",marginLeft:6}}>
      <span onClick={(e)=>{e.stopPropagation();setShow(v=>!v);}}
        style={{width:18,height:18,borderRadius:50,background:"#f0f4ff",border:"1px solid var(--color-info-border)",color:"var(--color-info)",fontSize:11,fontWeight:800,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>?</span>
      {show && (
        <div onClick={(e)=>e.stopPropagation()} style={{position:"absolute",bottom:"calc(100% + 8px)",left:"50%",transform:"translateX(-50%)",width:260,background:"#fafbff",border:"1px solid #dbeafe",borderRadius:12,padding:"10px 12px",fontSize:11,color:"var(--color-text-secondary)",lineHeight:1.6,boxShadow:"0 4px 16px rgba(0,0,0,0.08)",zIndex:100,cursor:"default"}}>
          {text}
          <div style={{position:"absolute",bottom:-6,left:"50%",transform:"translateX(-50%) rotate(45deg)",width:10,height:10,background:"#fafbff",borderRight:"1px solid #dbeafe",borderBottom:"1px solid #dbeafe"}}/>
        </div>
      )}
    </span>
  );
}
