import React, { useState, useEffect, useRef, useCallback } from 'react';
import { t, getLang } from '../i18n/index.js';
import {
  ESCROW_ADDRESS, PROPDEP_ADDRESS, USDC_ADDRESS, ARC_TESTNET_CHAIN,
  SEL, SEL_PROPDEP, encAddr, encUint, parseAgreement, parsePropDep, mapRevertReason,
} from '../helpers.js';
import {
  getProvider, ensureWalletReady, checkUsdcBalance,
  ethCallRpc, sendTxRaw, waitReceipt, sysMsg,
} from '../wallet.js';
import WarningModal from './ui/WarningModal.jsx';
import InfoTip from './ui/InfoTip.jsx';

function PropDepositBlock({ agreementId, role }) {
  // Wrapper that reads on-chain data and delegates to PropDepSection
  const [agrData, setAgrData] = useState(null);
  const isLL = role === "landlord";

  const reload = React.useCallback(async () => {
    if (!agreementId) return;
    try {
      // 1. Read RentalEscrow agreement (parties, propDep amount, main state)
      const hex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(agreementId)));
      const agr = parseAgreement(hex);

      // 2. Read PropDepEscrow propDep struct (claim, bond, propDep state)
      let pd = null;
      try {
        const phex = await ethCallRpc(PROPDEP_ADDRESS, SEL_PROPDEP.getPropDep + encUint(BigInt(agreementId)));
        if (phex && phex.length > 2) pd = parsePropDep(phex);
      } catch(e){}

      setAgrData({
        tenant: agr.tenant, landlord: agr.landlord,
        propDep: agr.propDep, state: agr.state,
        // PropDep fields (from PropDepEscrow, with fallback if not yet created)
        propDepState:        pd?.state ?? 0,
        windowStart:         pd?.windowStart ?? 0,
        windowEnd:           pd?.windowEnd ?? 0,
        damageClaim:         pd?.claimAmount ?? 0,
        damageDeadline:      pd?.claimDeadline ?? 0,
        tenantAcceptedClaim: pd?.tenantAccepted ?? 0,
        tenantDisputedClaim: pd?.tenantDisputed ?? 0,
        disputeBond:         pd?.disputeBond ?? 0,
        freezeStart:         pd?.freezeStart ?? 0,
        freezeDuration:      60*86400, // PropDep uses fixed 60 days
        earlyTermType:       agr.earlyTermType,
      });
    } catch(e){}
  }, [agreementId]);

  useEffect(() => { reload(); const t = setInterval(reload, 10000); return () => clearInterval(t); }, [reload]);

  // Auto-enforce removed — keeper bot handles PropDep enforcement.

  if (!agrData) return null;
  // PropDep state 0 (None) — no property deposit exists for this agreement
  if ((agrData.state === 8 || agrData.state === 9) && agrData.propDepState === 0) return (
    <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:10,padding:"10px 12px",marginBottom:10}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--color-primary)"}}>{<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"-2px",width:14,height:14}}><path d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z"/></svg>} Property Security Deposit</div>
      <div style={{fontSize:12,color:"var(--color-primary)",fontWeight:700}}>No damage claimed. Full deposit returned to Tenant.</div>
    </div>
  );
  // PropDep state 5 (Settled) — pass through to PropDepSection for reason-aware copy
  if (agrData.propDep <= 0) return (
    <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 12px",marginBottom:10,opacity:0.6}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--muted)"}}>{<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"-2px",width:14,height:14}}><path d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z"/></svg>} Property Security Deposit</div>
      <div style={{fontSize:12,color:"var(--muted)"}}>{t("body.no_propdep_set")}</div>
    </div>
  );
  return <PropDepSection agrData={agrData} isLL={isLL} agrId={agreementId} onRefresh={reload}/>;
}

// WarningModal, InputModal extracted to ./components/ui/WarningModal.jsx, InputModal.jsx
// Toast, ToastStack extracted to ./components/ui/Toast.jsx
// ─── INFO TOOLTIP — reusable help icon with popup ────────────────────────────
// InfoTip extracted to ./components/ui/InfoTip.jsx

function PropDepSection({ agrData, isLL, agrId, onRefresh }) {
  const [claimAmt, setClaimAmt] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = React.useRef(false);
  const [showBondWithdrawWarning, setShowBondWithdrawWarning] = useState(false);
  const [showCancelClaimWarning, setShowCancelClaimWarning] = useState(false);
  const [showDropClaimWarning, setShowDropClaimWarning] = useState(false);
  const d = agrData;
  // Use contract virtual time for all time comparisons
  const [contractNow, setContractNow] = useState(Math.floor(Date.now()/1000));
  useEffect(() => {
    const sync = async () => {
      try {
        const hex = await ethCallRpc(PROPDEP_ADDRESS, SEL_PROPDEP.getState ? "0xd18e81b3" : "0xd18e81b3"); // currentTime()
        if (hex) setContractNow(Number(BigInt(hex)));
      } catch {}
    };
    sync();
    const iv = setInterval(sync, 15000);
    return () => clearInterval(iv);
  }, []);
  const nowSec = contractNow;
  const getPeer = (me) => me.toLowerCase() === d.tenant ? d.landlord : d.tenant;

  // If agreement is settled/ended but PropDep is still active (1-4), do NOT short-circuit.
  // Landlord may still need to release deposit or file damage claim.
  // Only show resolved if propDepState is actually 0 (None) or 5 (Settled).
  if ((d.state === 8 || d.state === 9) && (d.propDepState === 0)) return (
    <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:10,padding:"10px 12px",marginBottom:10}}>
      <div style={{fontSize:12,color:"var(--color-primary)",fontWeight:700}}>{t("propdep.resolved_returned") || "Property deposit resolved. Returned to tenant."}</div>
    </div>
  );

  // Unified tx helper with mutex + refresh + wallet readiness guard
  const tx = async (fn) => {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(true);
    try {
      const walletCheck = await ensureWalletReady();
      if (!walletCheck.ready) {
        alert(walletCheck.error || t("err.wallet_not_connected") || "Wallet not connected");
        pendingRef.current = false; setPending(false);
        return;
      }
      const me = walletCheck.address;
      await getProvider()?.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] }).catch(e=>{if(e.code===4902) return getProvider()?.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });});
      await fn(me);
      if (onRefresh) await onRefresh();
    } catch(e) { if(e.code!==4001) alert(mapRevertReason(e)); }
    pendingRef.current = false; setPending(false);
  };
  const chat = async (me, text, evType) => { await sysMsg(me, getPeer(me), text, isLL?"landlord":"tenant", evType); };

  const hasClaim = d.damageClaim > 0;
  const accepted = !!d.tenantAcceptedClaim;
  const disputed = !!d.tenantDisputedClaim;
  const hasBond = d.disputeBond > 0;
  const bg = accepted?"var(--color-primary-surface)":hasClaim||hasBond?"var(--color-danger-surface)":"var(--color-primary-surface)";
  const bdr = accepted?"var(--color-primary-border)":hasClaim||hasBond?"var(--color-danger-border)":"var(--color-primary-border)";
  const hdrColor = accepted?"var(--color-primary)":hasClaim?"var(--color-danger)":"var(--color-primary)";

  // SETTLED — determine resolution type from struct fields preserved after settlement
  if (d.propDepState === 5) {
    const wasDisputed = !!d.tenantDisputedClaim;
    const hadFreeze = d.freezeStart > 0;
    const freezeExpired = wasDisputed && hadFreeze;
    const claimAccepted = accepted; // tenantAcceptedClaim

    let settledText;
    if (claimAccepted) {
      settledText = <>Damage claim settled — {d.damageClaim} USDC → Landlord. {(d.propDep - d.damageClaim) > 0 ? (d.propDep - d.damageClaim).toFixed(2)+" USDC returned to Tenant." : ""}</>;
    } else if (freezeExpired) {
      settledText = <>Dispute expired unresolved. Property deposit returned to Tenant. Landlord bond returned to Landlord. No damage claim was paid by the protocol.</>;
    } else {
      settledText = <>No damage claimed. Full deposit returned to Tenant.</>;
    }

    return (
      <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:10,padding:"10px 12px",marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:700,color:"var(--color-primary)",marginBottom:4,display:"flex",alignItems:"center",gap:4}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14,flexShrink:0}}><path d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z"/></svg> Property Deposit — {d.propDep || d.damageClaim || 0} USDC</div>
        <div style={{fontSize:12,color:"var(--color-primary)",fontWeight:700}}>{settledText}</div>
      </div>
    );
  }

  return (
    <div style={{background:bg,border:`1px solid ${bdr}`,borderRadius:10,padding:"10px 12px",marginBottom:10}}>
      <div style={{fontSize:11,fontWeight:700,color:hdrColor,marginBottom:6}}>{<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"-2px",width:14,height:14}}><path d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z"/></svg>} {t("title.property_security_deposit")} — {d.propDep} USDC</div>

      {/* Window not yet open — propDep is locked during active lease */}
      {d.propDepState === 1 && nowSec < d.windowStart && !hasClaim && (
        d.state === 7 || d.state === 8 ? (
          <div style={{fontSize:12,color:"var(--color-warning)"}}>
            {getLang()==="ru"
              ? `Контракт в диспуте. Окно для претензий откроется ${new Date(d.windowStart*1000).toLocaleDateString()}. Депозит ${d.propDep} USDC заблокирован до разрешения.`
              : `Contract in dispute. Inspection window opens ${new Date(d.windowStart*1000).toLocaleDateString()}. Deposit ${d.propDep} USDC locked until resolution.`}
          </div>
        ) : (
          <div style={{fontSize:12,color:"var(--muted)"}}>
            {getLang()==="ru"
              ? `Заблокирован — активная аренда. Окно для проверки откроется ${new Date(d.windowStart*1000).toLocaleDateString()}.`
              : `Locked — active lease. Inspection window opens ${new Date(d.windowStart*1000).toLocaleDateString()}.`}
          </div>
        )
      )}

      {/* PropDep not created — show different message based on rental state */}
      {(d.propDepState === 0) && (
        <div style={{fontSize:12,color: d.state >= 8 ? "var(--green)" : "var(--muted)"}}>
          {d.state >= 8
            ? (getLang()==="ru" ? "Возвращён — контракт не был активирован" : "Returned — contract was not activated")
            : t("propdep.locked_active")}
        </div>
      )}

      {/* STEP 1 — LL acts first: PropDep Active, window open, no claim yet */}
      {d.propDepState === 1 && nowSec >= d.windowStart && nowSec <= d.windowEnd && !hasClaim && !accepted && !disputed && (
        isLL ? (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <button disabled={pending} onClick={()=>tx(async(me)=>{

              await sendTxRaw(me,PROPDEP_ADDRESS,SEL_PROPDEP.releaseDepositEarly+encUint(BigInt(agrId))).then(waitReceipt);
              await chat(me,t("chat.propdep.no_damage"),"damage_accepted");
            })} style={{padding:"9px",borderRadius:8,background:"var(--green)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
              {pending?t("body.processing"):<>{t("propdep.btn.no_damage", {amount: d.propDep})} <InfoTip text={t("propdep.tip.no_damage")}/></>}
            </button>
            {(() => { const minClaim = Math.ceil(d.propDep * 0.3 * 100) / 100; return (
            <div style={{fontSize:11,color:"var(--muted)",marginBottom:2}}>Minimum claim: {minClaim} USDC (30% of {d.propDep} USDC deposit)</div>
            ); })()}
            <div style={{display:"flex",gap:6}}>
              <input type="number" min={Math.ceil(d.propDep * 0.3 * 100) / 100} max={d.propDep} step="0.01" placeholder={t("ph.claim_amount")} value={claimAmt} onChange={e=>setClaimAmt(e.target.value)}
                style={{flex:1,padding:"8px",border:`1.5px solid ${claimAmt && Number(claimAmt) < Math.ceil(d.propDep * 0.3 * 100) / 100 ? "var(--color-danger)" : "var(--border)"}`,borderRadius:8,fontFamily:"var(--ff)",fontSize:12}}/>
              <button disabled={pending||!claimAmt||Number(claimAmt)<Math.ceil(d.propDep*0.3*100)/100} onClick={()=>tx(async(me)=>{
                const amt = BigInt(Math.round(Number(claimAmt)*1e6));
                const escrowBal = await ethCallRpc(USDC_ADDRESS, SEL.balanceOf + encAddr(ESCROW_ADDRESS));
                console.log('fileDamageClaim:', {agrId, claimAmt, state: d.state, propDep: d.propDep, escrowBalance: parseInt(escrowBal,16)/1e6, escrow: ESCROW_ADDRESS});
                await sendTxRaw(me,PROPDEP_ADDRESS,SEL_PROPDEP.fileDamageClaim+encUint(BigInt(agrId))+encUint(amt)).then(waitReceipt);
                await chat(me,t("chat.propdep.claim_filed", {amount: claimAmt}),"damage_claimed");
              })} style={{padding:"8px 14px",borderRadius:8,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                {pending?"…":<>{t("propdep.btn.file_claim")} <InfoTip text={t("propdep.tip.file_claim")}/></>}
              </button>
            </div>
          </div>
        ) : (
          <div style={{fontSize:12,color:"var(--muted)"}}>{t("body.waiting_landlord_inspect")}</div>
        )
      )}

      {/* STEP 2 — Tenant responds to claim. PropDep state Claimed */}
      {d.propDepState === 2 && hasClaim && !accepted && !disputed && !hasBond && (
        <div>
          <div style={{fontSize:13,color:"var(--color-danger)",fontWeight:700,marginBottom:4}}>{t("propdep.body.tenant_claim_notice", {amount: d.damageClaim})}</div>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:8}}>{t("propdep.body.response_deadline", {date: new Date(d.damageDeadline*1000).toLocaleDateString()})}</div>
          {!isLL ? (
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <button disabled={pending} onClick={()=>tx(async(me)=>{

                await sendTxRaw(me,PROPDEP_ADDRESS,SEL_PROPDEP.acceptClaim+encUint(BigInt(agrId))).then(waitReceipt);

                await chat(me,t("chat.propdep.accepted", {amount: d.damageClaim}),"damage_accepted");
              })} style={{padding:"10px",borderRadius:8,background:"var(--green)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {pending?t("body.processing"):<>{t("propdep.btn.accept_claim", {amount: d.damageClaim})} <InfoTip text={t("propdep.tip.accept_claim_tenant")}/></>}
              </button>
              <button disabled={pending} onClick={()=>tx(async(me)=>{

                await sendTxRaw(me,PROPDEP_ADDRESS,SEL_PROPDEP.disputeClaim+encUint(BigInt(agrId))).then(waitReceipt);

                await chat(me,t("chat.propdep.disputed"),"damage_claimed");
              })} style={{padding:"10px",borderRadius:8,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {pending?t("body.processing"):<>{t("propdep.btn.dispute_claim")} <InfoTip text={t("propdep.tip.dispute_claim")}/></>}
              </button>
            </div>
          ) : (
            <div>
              <div style={{fontSize:12,color:"var(--muted)",marginBottom:6}}>{t("propdep.body.claim_filed_wait", {amount: d.damageClaim})}</div>
              {showCancelClaimWarning && <WarningModal
                title={t("modal.cancel_damage_claim.title")}
                message={t("modal.cancel_damage_claim.message")}
                danger={t("modal.cancel_damage_claim.danger")}
                confirmLabel={t("modal.cancel_damage_claim.confirm")}
                cancelLabel={t("btn.go_back")}
                onConfirm={()=>{setShowCancelClaimWarning(false);tx(async(me)=>{
                  await sendTxRaw(me,PROPDEP_ADDRESS,SEL_PROPDEP.withdrawClaim+encUint(BigInt(agrId))).then(waitReceipt);
                  await chat(me,t("chat.propdep.cancelled"),"damage_cancelled");
                });}}
                onCancel={()=>setShowCancelClaimWarning(false)}
              />}
              <button disabled={pending} onClick={()=>setShowCancelClaimWarning(true)} style={{width:"100%",padding:"9px",borderRadius:8,background:"var(--color-bg-card)",border:"1.5px solid var(--border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:11,cursor:"pointer",color:"var(--muted)"}}>
                {pending?t("body.processing"):<>{t("propdep.btn.cancel_claim")} <InfoTip text={t("propdep.tip.cancel_claim")}/></>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 3 — Tenant disputed, no freeze yet */}
      {hasClaim && disputed && !hasBond && (
        <div>
          <div style={{fontSize:13,color:"var(--color-danger)",fontWeight:700,marginBottom:4}}>{t("propdep.body.claim_tenant_disputed", {amount: d.damageClaim})}</div>
          {isLL ? (
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <div style={{background:"var(--color-warning-surface)",border:"1px solid var(--color-warning-border)",borderRadius:8,padding:"8px 10px",fontSize:11,color:"var(--color-warning)",lineHeight:1.5}}>
                {t("propdep.body.freeze_or_drop")}
              </div>
              <button disabled={pending} onClick={()=>tx(async(me)=>{
                if (!await checkUsdcBalance(d.damageClaim, "freeze deposit confirmation")) return;
                const amt = BigInt(Math.round(d.damageClaim*1e6));
                // Debug: check escrow balance before bond
                const escrowBal = await ethCallRpc(USDC_ADDRESS, SEL.balanceOf + encAddr(ESCROW_ADDRESS));
                const myBal = await ethCallRpc(USDC_ADDRESS, SEL.balanceOf + encAddr(me));
                console.log('PropDep postDisputeBond:', {agrId, damageClaim: d.damageClaim, bondAmt: amt.toString(), escrowBalance: parseInt(escrowBal,16)/1e6, myBalance: parseInt(myBal,16)/1e6, escrow: ESCROW_ADDRESS, me});
                {
                  const approveData = SEL.approve + encAddr(PROPDEP_ADDRESS) + encUint(amt);
                  const bondData = SEL_PROPDEP.postBond + encUint(BigInt(agrId));
                  const isCircle = window.pi2piWallet && window.pi2piWallet.type === "circle" && typeof window.pi2piWallet.executeBatch === "function";
                  if (isCircle) {
                    await window.pi2piWallet.executeBatch([
                      { to: USDC_ADDRESS, data: approveData },
                      { to: PROPDEP_ADDRESS, data: bondData },
                    ]);
                  } else {
                    await sendTxRaw(me,USDC_ADDRESS,approveData).then(waitReceipt);
                    await sendTxRaw(me,PROPDEP_ADDRESS,bondData).then(waitReceipt);
                  }
                }
                await chat(me,t("chat.propdep.bond_posted"),"bond_posted");
              })} style={{padding:"9px",borderRadius:8,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {pending?t("body.processing"):<>{t("propdep.btn.freeze_deposits")} <InfoTip text={t("propdep.tip.freeze_deposits")}/></>}
              </button>
              {showDropClaimWarning && <WarningModal
                title={t("modal.drop_damage_claim.title")}
                message={t("modal.drop_damage_claim.message")}
                danger={t("modal.drop_damage_claim.danger")}
                confirmLabel={t("modal.drop_damage_claim.confirm")}
                cancelLabel={t("btn.go_back")}
                onConfirm={()=>{setShowDropClaimWarning(false);tx(async(me)=>{
                  await sendTxRaw(me,PROPDEP_ADDRESS,SEL_PROPDEP.withdrawClaim+encUint(BigInt(agrId))).then(waitReceipt);
                  await chat(me,t("chat.propdep.dropped"),"damage_cancelled");
                });}}
                onCancel={()=>setShowDropClaimWarning(false)}
              />}
              <button disabled={pending} onClick={()=>setShowDropClaimWarning(true)} style={{padding:"9px",borderRadius:8,background:"var(--color-bg-card)",border:"1.5px solid var(--border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:11,cursor:"pointer",color:"var(--muted)"}}>
                {pending?t("body.processing"):<>{t("propdep.btn.drop_claim")} <InfoTip text={t("propdep.tip.drop_claim")}/></>}
              </button>
            </div>
          ) : (
            <div>
              <div style={{fontSize:12,color:"var(--muted)",marginBottom:6}}>{t("propdep.body.you_disputed")}</div>
              <button disabled={pending} onClick={()=>tx(async(me)=>{
                await sendTxRaw(me,PROPDEP_ADDRESS,SEL_PROPDEP.acceptClaim+encUint(BigInt(agrId))).then(waitReceipt);
                await chat(me,t("chat.propdep.changed_mind", {amount: d.damageClaim}),"damage_accepted");
              })} style={{padding:"9px",borderRadius:8,background:"var(--color-bg-card)",border:"1.5px solid var(--border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:11,cursor:"pointer",color:"var(--muted)"}}>
                {pending?t("body.processing"):<>{t("propdep.btn.change_mind_accept", {amount: d.damageClaim})} <InfoTip text={t("propdep.tip.change_mind")}/></>}
              </button>
              {nowSec > d.damageDeadline + 3*86400 && (
                <button disabled={pending} onClick={()=>tx(async(me)=>{
                  await sendTxRaw(me,PROPDEP_ADDRESS,SEL_PROPDEP.expireDamageClaim+encUint(BigInt(agrId))).then(waitReceipt);
                  await chat(me,t("chat.propdep.expired"),"damage_cancelled");
                })} style={{marginTop:6,width:"100%",padding:"9px",borderRadius:8,background:"var(--green)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  {pending?t("body.processing"):<>{t("propdep.btn.expire_claim")} <InfoTip text={t("propdep.tip.expire_claim")}/></>}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* STEP 4 — Deposits frozen */}
      {disputed && hasBond && (
        <div>
          <div style={{background:"var(--color-info-surface)",borderRadius:8,padding:"10px",marginBottom:8,color:"white"}}>
            <div style={{fontWeight:700,fontSize:12,marginBottom:4}}>{t("propdep.body.deposits_frozen_amount", {amount: d.disputeBond})}</div>
            {(() => {
              const freezeEnd = d.freezeStart + d.freezeDuration;
              const left = Math.max(0, freezeEnd - nowSec);
              const endDate = new Date(freezeEnd*1000).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
              return left > 0
                ? <div style={{fontSize:11,opacity:0.7}}>{t("misc.d_h_remaining", {d: Math.floor(left/86400), h: Math.floor((left%86400)/3600)})} · {t("misc.auto_release", {date: endDate})}</div>
                : <div style={{fontSize:11,color:"var(--color-primary-border)",fontWeight:700}}>{t("propdep.body.freeze_ready")}</div>;
            })()}
          </div>
          {isLL ? (
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {showBondWithdrawWarning && <WarningModal
                title={t("modal.cancel_dispute.title")}
                message={t("modal.cancel_dispute.message")}
                danger={t("modal.cancel_dispute.danger")}
                confirmLabel={t("modal.cancel_dispute.confirm")}
                onConfirm={()=>{setShowBondWithdrawWarning(false);tx(async(me)=>{
                  await sendTxRaw(me,PROPDEP_ADDRESS,SEL_PROPDEP.withdrawClaim+encUint(BigInt(agrId))).then(waitReceipt);
                  await chat(me,t("chat.propdep.dispute_cancelled"),"bond_withdrawn");
                });}}
                onCancel={()=>setShowBondWithdrawWarning(false)}
              />}
              <button disabled={pending} onClick={()=>setShowBondWithdrawWarning(true)} style={{width:"100%",padding:"9px",borderRadius:8,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {pending?t("body.processing"):<>{t("propdep.btn.cancel_dispute")} <InfoTip text={t("propdep.tip.cancel_dispute")}/></>}
              </button>
              {(() => { const freezeEnd = d.freezeStart + d.freezeDuration; return nowSec >= freezeEnd && d.freezeStart > 0 ? (
                <button disabled={pending} onClick={()=>tx(async(me)=>{
                  await sendTxRaw(me,PROPDEP_ADDRESS,SEL_PROPDEP.releaseFrozenFunds+encUint(BigInt(agrId))).then(waitReceipt);
                  await chat(me,t("chat.propdep.freeze_expired"),"bond_withdrawn");
                })} style={{width:"100%",padding:"9px",borderRadius:8,background:"var(--green)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  {pending?t("body.processing"):<>{t("propdep.btn.release_frozen")} <InfoTip text={t("propdep.tip.release_frozen")}/></>}
                </button>
              ) : null; })()}
            </div>
          ) : (
            <button disabled={pending} onClick={()=>tx(async(me)=>{
              const escrowBal = await ethCallRpc(USDC_ADDRESS, SEL.balanceOf + encAddr(ESCROW_ADDRESS));
              console.log('PropDep acceptDamageClaimAfterBond:', {agrId, damageClaim: d.damageClaim, propDep: d.propDep, disputeBond: d.disputeBond, escrowBalance: parseInt(escrowBal,16)/1e6, escrow: ESCROW_ADDRESS});
              await sendTxRaw(me,PROPDEP_ADDRESS,SEL_PROPDEP.acceptClaimAfterBond+encUint(BigInt(agrId))).then(waitReceipt);
              await chat(me,t("chat.propdep.accepted", {amount: d.damageClaim}),"damage_accepted");
            })} style={{width:"100%",padding:"9px",borderRadius:8,background:"var(--green)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
              {pending?t("body.processing"):<>{t("propdep.btn.accept_claim_short", {amount: d.damageClaim})} <InfoTip text={t("propdep.tip.accept_after_bond")}/></>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ContractDocuments extracted to ./components/ContractDocuments.jsx

// Closure details — rendered when agreement reaches a terminal state (Settled / LeaseEnded).
// ClosureDetailsBlock extracted to ./components/ClosureDetailsBlock.jsx


export { PropDepositBlock, PropDepSection };
export default PropDepSection;
