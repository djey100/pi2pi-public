import React, { useState } from 'react';
import { t } from '../i18n/index.js';
import WarningModal from './ui/WarningModal.jsx';

export default function EarlyTermModal({ onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [tip, setTip] = useState(null);
  const [showClaimWarning, setShowClaimWarning] = useState(false);
  const MIN_REASON_LEN = 30;
  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= MIN_REASON_LEN;

  const tips = {
    offer: t("et.tip_offer"),
    par: t("et.tip_par"),
    claim: t("et.tip_claim"),
  };

  const HelpBtn = ({id}) => (
    <button onClick={e=>{e.stopPropagation();setTip(tip===id?null:id);}}
      style={{width:22,height:22,borderRadius:50,background:tip===id?"var(--accent)":"var(--bg2)",border:"1.5px solid var(--border)",color:tip===id?"white":"var(--muted)",fontSize:12,fontWeight:800,cursor:"pointer",flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:0,marginLeft:6,verticalAlign:"middle"}}>?</button>
  );

  const TipBox = ({id}) => tip===id ? (
    <div style={{background:"var(--color-bg-secondary)",color:"var(--color-text-primary)",border:"1px solid var(--color-border)",borderRadius:10,padding:"10px 12px",fontSize:11,lineHeight:1.6,marginTop:6,marginBottom:6,boxShadow:"0 4px 14px rgba(0,0,0,0.08)"}}>{tips[id]}</div>
  ) : null;

  return (
    <div className="modal-ov" onClick={e=>{if(e.target===e.currentTarget) onClose();}}>
      <div className="modal" style={{maxHeight:"85vh",overflowY:"auto"}} onClick={()=>setTip(null)}>
        <div className="modal-handle"/>
        <div style={{fontSize:28,textAlign:"center",marginBottom:8}}></div>
        <div className="modal-title">{t("et.title")}</div>
        <div className="modal-sub" style={{lineHeight:1.7,marginBottom:12}}>
          {t("et.choose")}
        </div>

        <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",marginBottom:4}}>{t("et.reason_label")}</div>
        <textarea style={{width:"100%",padding:"10px",border:`1.5px solid ${trimmedReason.length > 0 && !reasonValid ? "var(--color-danger-border)" : "var(--border)"}`,borderRadius:10,fontFamily:"var(--ff)",fontSize:13,minHeight:50,resize:"vertical",outline:"none",marginBottom:4,boxSizing:"border-box"}}
          placeholder={t("ph.reason")} value={reason} onChange={e=>setReason(e.target.value)}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:10,color:reasonValid?"var(--color-primary)":"var(--muted)",lineHeight:1.4}}>{reasonValid ? "" : t("et.reason_required")}</div>
          <div style={{fontSize:10,fontWeight:600,color:reasonValid?"var(--color-primary)":"var(--muted)",flexShrink:0}}>{trimmedReason.length} / {MIN_REASON_LEN}</div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {/* Option 1: Offer My Deposit */}
          <div>
            <button disabled={!reasonValid} onClick={()=>onSubmit("InitiatorAccepts", trimmedReason)}
              style={{width:"100%",padding:"14px",background:"var(--bg2)",border:"1.5px solid var(--border)",borderRadius:12,cursor:reasonValid?"pointer":"not-allowed",fontFamily:"var(--ff)",textAlign:"left",opacity:reasonValid?1:0.5}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{t("et.offer_title")} <HelpBtn id="offer"/></div>
              <div style={{fontSize:11,color:"var(--muted)"}}>{t("et.offer_sub")}</div>
            </button>
            <TipBox id="offer"/>
          </div>

          {/* Option 2: Exit at Par */}
          <div>
            <button disabled={!reasonValid} onClick={()=>onSubmit("Mutual", trimmedReason)}
              style={{width:"100%",padding:"14px",background:"var(--bg2)",border:"1.5px solid var(--border)",borderRadius:12,cursor:reasonValid?"pointer":"not-allowed",fontFamily:"var(--ff)",textAlign:"left",opacity:reasonValid?1:0.5}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{t("et.par_title")} <HelpBtn id="par"/></div>
              <div style={{fontSize:11,color:"var(--muted)"}}>{t("et.par_sub")}</div>
            </button>
            <TipBox id="par"/>
          </div>

          {/* Option 3: Claim Counterparty Deposit */}
          <div>
            {showClaimWarning && <WarningModal
              title={t("et.claim_title")}
              message={t("et.claim_warning")}
              confirmLabel={t("et.claim_confirm")}
              onConfirm={()=>{setShowClaimWarning(false);onSubmit("Disputed", trimmedReason);}}
              onCancel={()=>setShowClaimWarning(false)}
            />}
            <button disabled={!reasonValid} onClick={()=>setShowClaimWarning(true)}
              style={{width:"100%",padding:"14px",background:"var(--bg2)",border:"1.5px solid var(--color-danger-border)",borderRadius:12,cursor:reasonValid?"pointer":"not-allowed",fontFamily:"var(--ff)",textAlign:"left",opacity:reasonValid?1:0.5}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:2,color:"var(--color-danger)"}}>{t("et.claim_title")} <HelpBtn id="claim"/></div>
              <div style={{fontSize:11,color:"var(--muted)"}}>{t("et.claim_sub")}</div>
            </button>
            <TipBox id="claim"/>
          </div>
        </div>

        <button className="btn-g" style={{marginTop:12}} onClick={onClose}>{t("btn.cancel")}</button>
      </div>
    </div>
  );
}
