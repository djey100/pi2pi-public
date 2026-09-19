import React, { useState, useEffect } from 'react';
import { t } from '../i18n/index.js';
import { parseAgreement, ESCROW_ADDRESS, SEL, encUint } from '../helpers.js';
import { ethCallRpc } from '../wallet.js';
import WarningModal from './ui/WarningModal.jsx';

export default function EarlyTermResponseForm({ earlyTerm, onClose, onRespond, agreementId }) {
  const [tip, setTip] = useState(null);
  const [chainData, setChainData] = useState(null);
  const [myAddr, setMyAddr] = useState(null);
  const [settlMode, setSettlMode] = useState(null);
  const [showWithdrawWarning, setShowWithdrawWarning] = useState(false); // null | "full" | "prop"
  const [settlLL, setSettlLL] = useState("");
  const [settlTN, setSettlTN] = useState("");
  const [settlBusy, setSettlBusy] = useState(false);

  useEffect(() => {
    window.ethereum?.request({method:"eth_accounts"}).then(a=>{if(a?.[0])setMyAddr(a[0].toLowerCase());}).catch(()=>{});
  }, []);

  // Read on-chain data every time form opens
  useEffect(() => {
    if (!agreementId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const hex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(agreementId)));
        if (!cancelled) setChainData(parseAgreement(hex));
      } catch(e) {}
    };
    load();
    const t = setInterval(load, 5000);
    return () => { cancelled=true; clearInterval(t); };
  }, [agreementId]);

  const tips = {
    accept_loss: "Accept the initiator's deposit as compensation for early termination.",
    waive_claim: "Decline the initiator's deposit. Contract closes with no penalty.",
    acknowledge_breach: "Acknowledge fault and transfer your deposit to the initiator.",
    contest: "You disagree with a fee-free exit. Freeze all deposits for 60 days. Resolved offline by local law.",
    mutual_release: "Agree to terminate without financial claims. Deposits returned to each party.",
    cancel_dispute: "Cancel the dispute. Deposits return to each party. Contract settled.",
  };

  const HelpBtn = ({id}) => (
    <button onClick={e=>{e.stopPropagation();setTip(tip===id?null:id);}}
      style={{width:20,height:20,borderRadius:50,background:tip===id?"var(--accent)":"var(--bg2)",border:"1.5px solid var(--border)",color:tip===id?"white":"var(--muted)",fontSize:11,fontWeight:800,cursor:"pointer",flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:0,marginLeft:6}}>?</button>
  );
  const TipBox = ({id}) => tip===id ? (
    <div style={{background:"var(--color-bg-card)",color:"white",borderRadius:10,padding:"10px 12px",fontSize:11,lineHeight:1.6,marginTop:6,marginBottom:6}}>{tips[id]}</div>
  ) : null;

  if (!chainData) return (
    <div className="modal-ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal"><div className="modal-handle"/><div style={{textAlign:"center",padding:"20px"}}><div className="spinner"/></div></div>
    </div>
  );

  const st = chainData.state;
  const tt = chainData.earlyTermType; // 0=None, 1=Mutual, 2=InitiatorAccepts, 3=Disputed
  const isInitiator = myAddr === chainData.earlyTermInitiator;
  const isBondPoster = myAddr === chainData.disputeBondPoster;
  const ttLabel = ["None","No Claim Exit","Voluntary Exit","Dispute Exit"][tt] || "Unknown";
  const initShort = chainData.earlyTermInitiator ? chainData.earlyTermInitiator.slice(0,6)+"…"+chainData.earlyTermInitiator.slice(-4) : "—";

  // SETTLED
  if (st === 8) return (
    <div className="modal-ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal"><div className="modal-handle"/>
        <div style={{textAlign:"center",padding:"16px 0"}}>
          <div style={{fontSize:28,marginBottom:8}}></div>
          <div className="modal-title">{t("title.contract_settled")}</div>
          <div style={{fontSize:12,color:"var(--muted)",marginTop:8}}>All funds have been distributed.</div>
          <button className="btn-g" style={{marginTop:16}} onClick={onClose}>{t("btn.close")}</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="modal-ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxHeight:"85vh",overflowY:"auto"}} onClick={()=>setTip(null)}>
        <div className="modal-handle"/>
        <div style={{fontSize:28,textAlign:"center",marginBottom:8}}></div>

        {/* === EARLY TERM PROPOSED (4) === */}
        {st === 4 && isInitiator && (
          <React.Fragment>
            <div className="modal-title">Terminate Early — You Initiated</div>
            <div className="modal-sub" style={{lineHeight:1.7,marginBottom:12}}>
              You proposed <strong>{ttLabel}</strong>. Waiting for counterparty.
            </div>
            <div style={{background:"var(--color-warning-surface)",border:"1px solid var(--color-warning-border)",borderRadius:10,padding:"12px",marginBottom:12}}>
              <div style={{fontSize:12,color:"var(--color-warning)",lineHeight:1.6}}>
                Counterparty has 7 days to respond. If no response — deposits return to each party automatically.
              </div>
            </div>
            {earlyTerm.reason && <div style={{fontSize:12,color:"var(--muted)",fontStyle:"italic",marginBottom:8}}>Reason: "{earlyTerm.reason}"</div>}
            {tt === 2 && (
              <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:10,padding:"12px",marginBottom:8}}>
                <div style={{fontSize:12,color:"var(--color-primary)",fontWeight:700}}>
                  Your deposit has been transferred to counterparty. Contract terminated.
                </div>
              </div>
            )}
          </React.Fragment>
        )}

        {st === 4 && !isInitiator && (
          <React.Fragment>
            <div className="modal-title">{t("title.terminate_early_request")}</div>
            <div className="modal-sub" style={{lineHeight:1.7,marginBottom:12}}>
              Initiator: <strong>{initShort}</strong> · Type: <strong>{ttLabel}</strong>
            </div>
            {earlyTerm.reason && <div style={{fontSize:12,color:"var(--muted)",fontStyle:"italic",marginBottom:12}}>Reason: "{earlyTerm.reason}"</div>}
            <div style={{fontSize:11,color:"var(--muted)",marginBottom:12,lineHeight:1.6,background:"var(--bg2)",padding:"8px 10px",borderRadius:8}}>
              pi2pi does not make decisions. Financial claims and physical vacancy are two independent processes governed by local law.
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {tt === 2 && <React.Fragment>
                <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:10,padding:"12px",marginBottom:8}}>
                  <div style={{fontSize:12,color:"var(--color-primary)",lineHeight:1.6,fontWeight:700}}>
                    Counterparty exited early and transferred their deposit to you as compensation. No action needed from your side.
                  </div>
                  <div style={{fontSize:11,color:"var(--color-primary)",marginTop:6}}>
                    Property inspection window: 7 days. If no damage claim filed, security deposit returns to tenant automatically.
                  </div>
                </div>
              </React.Fragment>}
              {tt === 1 && <React.Fragment>
                <button onClick={()=>onRespond(earlyTerm.etId,"mutual_exit","signMutualExit")}
                  style={{padding:"12px",borderRadius:10,background:"var(--green)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                  Mutual Release <HelpBtn id="mutual_release"/></button><TipBox id="mutual_release"/>
                <button onClick={()=>onRespond(earlyTerm.etId,"counter_claim","counterpartyContest")}
                  style={{padding:"12px",borderRadius:10,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                  Counter-Claim Deposit </button>
                <div style={{fontSize:10,color:"var(--muted)",textAlign:"center",marginTop:4}}>Lock both deposits · 60 days to resolve · Sign only</div>
              </React.Fragment>}
              {tt === 3 && <React.Fragment>
                <div style={{background:"var(--color-danger-surface)",border:"1px solid var(--color-danger-border)",borderRadius:10,padding:"12px",marginBottom:8}}>
                  <div style={{fontSize:12,color:"var(--color-danger)",lineHeight:1.6}}>
                    Initiator claims your deposit. Choose your response:
                  </div>
                </div>
                <button onClick={()=>onRespond(earlyTerm.etId,"accept_claim","acceptInitiatorLoss")}
                  style={{padding:"12px",borderRadius:10,background:"var(--green)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:8}}>
                  Accept — Give My Deposit </button>
                <button onClick={()=>onRespond(earlyTerm.etId,"refuse_freeze","counterpartyContest")}
                  style={{padding:"12px",borderRadius:10,background:"var(--color-warning)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:4}}>
                  Refuse & Freeze </button>
                <div style={{fontSize:10,color:"var(--muted)",textAlign:"center",marginBottom:8}}>I disagree. Lock both deposits for 60 days. Resolve via local law.</div>
                <button onClick={()=>onRespond(earlyTerm.etId,"counter_claim","counterpartyContest")}
                  style={{padding:"12px",borderRadius:10,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:4}}>
                  Counter-Claim — Demand Their Deposit </button>
                <div style={{fontSize:10,color:"var(--muted)",textAlign:"center"}}>I'm the victim. Lock both deposits + I claim initiator's deposit. 60 days.</div>
              </React.Fragment>}
            </div>
          </React.Fragment>
        )}

        {/* === DISPUTE OPEN (7) === */}
        {st === 7 && (() => {
          const left = Math.max(0, chainData.freezeStart + chainData.freezeDuration - Math.floor(Date.now()/1000));
          const totalPool = chainData.commitDep + chainData.hostDep + chainData.propDep + chainData.disputeBond;
          const iPostedBond = myAddr === chainData.disputeBondPoster;

          const freezeEndDate = new Date((chainData.freezeStart + chainData.freezeDuration) * 1000).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
          return (
          <React.Fragment>
            <div className="modal-title">{iPostedBond ? "Dispute — You Initiated" : "Dispute in Progress"}</div>
            <div className="modal-sub" style={{lineHeight:1.7,marginBottom:12}}>
              {iPostedBond
                ? "Deposits frozen 60 days. You can cancel the dispute."
                : "Counterparty initiated dispute. Deposits frozen 60 days. Resolved offline by local law."}
            </div>
            <div style={{background:"var(--color-info-surface)",borderRadius:10,padding:"12px",marginBottom:12,color:"white"}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>Funds Frozen</div>
              <div style={{fontSize:12}}>{Math.floor(left/86400)}d {Math.floor((left%86400)/3600)}h remaining</div>
              <div style={{fontSize:11,opacity:0.6,marginTop:4}}>Auto-release: {freezeEndDate}</div>
              <div style={{fontSize:11,opacity:0.6,marginTop:2}}>Frozen deposit: {chainData.disputeBond} USDC · Total pool: {totalPool.toFixed(2)} USDC</div>
            </div>

            {/* Dispute initiator: can cancel dispute */}
            {iPostedBond && (
              <React.Fragment>
              {showWithdrawWarning && <WarningModal
                title={t("modal.cancel_dispute.title")}
                message={t("modal.cancel_dispute.message")}
                danger={t("modal.cancel_dispute.danger")}
                confirmLabel={t("modal.cancel_dispute.confirm")}
                onConfirm={()=>{setShowWithdrawWarning(false);onRespond(earlyTerm.etId,"cancel_dispute","cancelDisputeExit");}}
                onCancel={()=>setShowWithdrawWarning(false)}
              />}
              <button onClick={()=>setShowWithdrawWarning(true)}
                style={{width:"100%",padding:"12px",borderRadius:10,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:8}}>
                {t("btn.cancel_rental_dispute")}
              </button>
              </React.Fragment>
            )}

            {/* Non-initiator who IS earlyTermInitiator: can concede */}
            {!iPostedBond && myAddr === chainData.earlyTermInitiator && (
              <button onClick={()=>onRespond(earlyTerm.etId,"concede","concedeDispute")}
                style={{width:"100%",padding:"12px",borderRadius:10,background:"var(--green)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:8}}>
                Accept Counterparty Claim              </button>
            )}

            {/* Non-initiator, non-claimant: accept dispute exit */}
            {myAddr !== chainData.disputeBondPoster && myAddr !== chainData.earlyTermInitiator && (
              <button onClick={()=>onRespond(earlyTerm.etId,"accept_dispute_exit","acceptDisputeExit")}
                style={{width:"100%",padding:"12px",borderRadius:10,background:"var(--color-primary)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:8}}>
                Accept Claim — settle dispute              </button>
            )}

            <div style={{fontSize:10,color:"var(--muted)",lineHeight:1.5,marginBottom:4}}>
              {iPostedBond
                ? "Cancelling the dispute unfreezes deposits. Your deposit goes to counterparty as penalty."
                : "Accepting means your deposit goes to the counterparty. Contract settles."}
            </div>
          </React.Fragment>
          );
        })()}

        <button className="btn-g" style={{marginTop:12}} onClick={onClose}>{t("btn.close")}</button>
      </div>
    </div>
  );
}
