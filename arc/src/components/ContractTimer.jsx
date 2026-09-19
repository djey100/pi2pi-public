import React, { useState, useEffect } from 'react';
import { getLang } from '../i18n/index.js';
import { ESCROW_ADDRESS, PROPDEP_ADDRESS, SEL, SEL_PROPDEP, encUint } from '../helpers.js';
import { ethCallRpc } from '../wallet.js';
import { getActiveContract } from '../api/client.js';

export default function ContractTimer({ agreementId, userAddr }) {
  const [agrId, setAgrId] = useState(agreementId || null);
  const [timerData, setTimerData] = useState(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  // Update agrId when prop changes
  useEffect(() => {
    if (agreementId) setAgrId(agreementId);
  }, [agreementId]);

  // Fallback: if no agreementId prop, resolve from server using userAddr or wallet
  useEffect(() => {
    if (agrId) return;
    async function load() {
      try {
        let addr = userAddr;
        if (!addr) {
          // Try Circle wallet first, then injected provider
          addr = window.pi2piWallet?._circleAddress;
          if (!addr) {
            const provider = window.pi2piWallet?.provider || window.ethereum;
            if (!provider) return;
            const accs = await provider.request({ method: "eth_accounts" });
            addr = accs?.[0];
          }
        }
        if (!addr) return;
        const d = await getActiveContract(addr);
        if (d?.agreementId && !d?.archived) setAgrId(d.agreementId);
      } catch {}
    }
    load();
  }, [userAddr, agrId]);

  // Step 2: fetch contract time data every 20 seconds + on resume
  useEffect(() => {
    if (!agrId) return;
    let cancelled = false;
    async function sync() {
      if (cancelled) return;
      try {
        const id = BigInt(agrId);
        const [ctHex, nrdHex, agrHex] = await Promise.all([
          ethCallRpc(ESCROW_ADDRESS, SEL.currentTime),
          ethCallRpc(ESCROW_ADDRESS, SEL.nextRentDue + encUint(id)),
          ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(id)),
        ]);
        const contractNow = Number(BigInt(ctHex));
        const nextRent = Number(BigInt(nrdHex));
        const leaseEnd = agrHex ? Number(BigInt("0x" + agrHex.slice(2 + 9*64, 2 + 10*64))) : 0;
        const state = agrHex ? Number(BigInt("0x" + agrHex.slice(2 + 10*64, 2 + 11*64))) : 0;
        // Rental freeze (word 26=freezeStart, 27=freezeDuration)
        const rentalFreezeStart = agrHex ? Number(BigInt("0x" + agrHex.slice(2 + 26*64, 2 + 27*64))) : 0;
        const rentalFreezeDuration = agrHex ? Number(BigInt("0x" + agrHex.slice(2 + 27*64, 2 + 28*64))) : 0;
        // PropDep state
        let pdFreezeEnd = 0, pdState = 0;
        try {
          const pdHex = await ethCallRpc(PROPDEP_ADDRESS, SEL_PROPDEP.getPropDep + encUint(id));
          if (pdHex && pdHex.length > 66) {
            pdState = Number(BigInt("0x" + pdHex.slice(2 + 4*64, 2 + 5*64)));
            pdFreezeEnd = Number(BigInt("0x" + pdHex.slice(2 + 15*64, 2 + 16*64)));
          }
        } catch {}
        if (!cancelled) setTimerData({ contractNow, localAnchor: Date.now(), nextRent, leaseEnd, state, rentalFreezeStart, rentalFreezeDuration, pdState, pdFreezeEnd });
      } catch (e) { console.warn("ContractTimer sync error:", e); }
    }
    sync();
    const iv = setInterval(sync, 20000);
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    const onFocus = () => sync();
    const onPageShow = () => sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => { cancelled = true; clearInterval(iv); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onPageShow); };
  }, [agrId]);

  // Step 3: tick every second
  const [showTimerTip, setShowTimerTip] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  // Close tooltip on click anywhere
  useEffect(() => {
    if (!showTimerTip) return;
    const close = () => setShowTimerTip(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showTimerTip]);

  if (!agrId || !timerData) return null;
  // Show timer for Active(3), EarlyTermProposed(4), CheckoutProposed(5), DisputeOpen(7), LeaseEnded(9)
  // Also show if PropDep has active dispute regardless of rental state
  const hasActiveDispute = timerData.state === 7 || timerData.pdState === 4;
  if (timerData.state < 3 && !hasActiveDispute) return null;
  if (timerData.state > 5 && timerData.state !== 7 && timerData.state !== 9 && !hasActiveDispute) return null;
  if (timerData.state === 8 && !hasActiveDispute) return null; // Settled — no timer unless propDep dispute
  if (timerData.state === 9 && !hasActiveDispute) return null; // LeaseEnded — no timer unless propDep dispute

  // Virtual time = contract anchor + local elapsed
  const elapsed = (Date.now() - timerData.localAnchor) / 1000;
  const virtualNow = timerData.contractNow + elapsed;

  const rentDelta = timerData.nextRent - virtualNow;
  const leaseDelta = timerData.leaseEnd - virtualNow;

  const fmt = (sec) => {
    const abs = Math.abs(Math.floor(sec));
    const d = Math.floor(abs / 86400);
    const h = Math.floor((abs % 86400) / 3600);
    if (d > 0) return d + "d " + h + "h";
    const m = Math.floor((abs % 3600) / 60);
    return h + "h " + m + "m";
  };

  const overdue = rentDelta < 0;
  const rentColor = overdue ? "#ef4444" : rentDelta < 5 * 86400 ? "#f59e0b" : "#00d4aa";
  const blink = now % 2 === 0;
  const blinkDots = <span style={{opacity:blink?1:0.15,transition:"opacity 0.4s",fontSize:11,fontWeight:600,lineHeight:1,margin:"0 2px",display:"inline-flex",flexDirection:"column",alignItems:"center",gap:2,verticalAlign:"middle"}}><span style={{width:2,height:2,borderRadius:"50%",background:"currentColor"}}></span><span style={{width:2,height:2,borderRadius:"50%",background:"currentColor"}}></span></span>;

  const fmtBlink = (sec) => {
    const abs = Math.abs(Math.floor(sec));
    const d = Math.floor(abs / 86400);
    const h = Math.floor((abs % 86400) / 3600);
    if (d > 0) return <>{d}d{blinkDots}{h}h</>;
    const m = Math.floor((abs % 3600) / 60);
    return <>{h}h{blinkDots}{m}m</>;
  };

  const rentLabel = fmtBlink(rentDelta);
  const rentLabelPlain = fmt(rentDelta);
  const leaseLabel = leaseDelta > 0 ? fmtBlink(leaseDelta) : "ended";
  const leaseLabelPlain = leaseDelta > 0 ? fmt(leaseDelta) : "ended";
  const clockIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={rentColor} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>;
  const docIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>;

  // Dispute counters
  const rentalFreezeEnd = timerData.rentalFreezeStart > 0 ? timerData.rentalFreezeStart + timerData.rentalFreezeDuration : 0;
  const rentalDisputeActive = timerData.state === 7 && rentalFreezeEnd > 0;
  const rentalDisputeDelta = rentalFreezeEnd - virtualNow;
  const pdDisputeActive = timerData.pdState === 4 && timerData.pdFreezeEnd > 0;
  const pdDisputeDelta = timerData.pdFreezeEnd - virtualNow;

  const lockIcon = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
  const shieldIcon = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;

  const isRu = typeof getLang === "function" && getLang() === "ru";

  return (
    <div style={{position:"relative",display:"flex",gap:4,alignItems:"center",fontSize:13,fontWeight:800,fontFamily:"var(--ffm)",letterSpacing:"-0.3px",flexShrink:1,minWidth:0,overflow:"visible",cursor:"pointer"}}
      onClick={e=>{e.stopPropagation();setShowTimerTip(v=>!v);}}
    >
      {timerData.state >= 3 && timerData.state <= 5 && (<>
        <span style={{display:"flex",alignItems:"center",gap:3,color:rentColor,whiteSpace:"nowrap"}}>
          {overdue && <span style={{fontSize:12}}>⚠</span>}
          {!overdue && clockIcon}
          <span>{rentLabel}</span>
        </span>
        <span style={{color:"var(--border)",fontSize:10,opacity:0.4}}>|</span>
        <span style={{display:"flex",alignItems:"center",gap:3,color:"#5eead4",whiteSpace:"nowrap"}}>
          {docIcon}
          <span>{leaseLabel}</span>
        </span>
      </>)}

      {rentalDisputeActive && (<>
        <span style={{color:"var(--border)",fontSize:10,opacity:0.4}}>|</span>
        <span style={{display:"flex",alignItems:"center",gap:3,color:"#ef4444",whiteSpace:"nowrap"}}>
          {lockIcon}
          <span>{rentalDisputeDelta > 0 ? fmtBlink(rentalDisputeDelta) : "done"}</span>
        </span>
      </>)}

      {pdDisputeActive && (<>
        <span style={{color:"var(--border)",fontSize:10,opacity:0.4}}>|</span>
        <span style={{display:"flex",alignItems:"center",gap:3,color:"#f59e0b",whiteSpace:"nowrap"}}>
          {shieldIcon}
          <span>{pdDisputeDelta > 0 ? fmtBlink(pdDisputeDelta) : "done"}</span>
        </span>
      </>)}

      {showTimerTip && (
        <div onClick={e=>e.stopPropagation()} style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",marginTop:8,width:240,background:"var(--color-glass-bg)",backdropFilter:"blur(24px) saturate(180%)",WebkitBackdropFilter:"blur(24px) saturate(180%)",border:"1px solid var(--color-glass-border)",borderRadius:12,boxShadow:"var(--color-glass-shadow)",padding:"12px 14px",zIndex:99999,fontSize:12,fontWeight:500,color:"var(--color-text-primary)",fontFamily:"var(--ff)"}}>
          {timerData.state >= 3 && timerData.state <= 5 && (<>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            {clockIcon}
            <div>
              <div style={{fontWeight:700,color:rentColor}}>{overdue ? (isRu?"Просрочка":"Rent overdue") : (isRu?"До оплаты":"Next payment")}</div>
              <div style={{fontSize:11,color:"var(--dim)"}}>{overdue ? (isRu?"Депозит под угрозой":"Deposit at risk") : (isRu?"Время до оплаты аренды":"Time until rent is due")}</div>
            </div>
            <div style={{marginLeft:"auto",fontWeight:800,color:rentColor}}>{rentLabelPlain}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {docIcon}
            <div>
              <div style={{fontWeight:700,color:"#5eead4"}}>{isRu?"Контракт":"Lease ends"}</div>
              <div style={{fontSize:11,color:"var(--dim)"}}>{isRu?"До конца аренды":"Contract duration left"}</div>
            </div>
            <div style={{marginLeft:"auto",fontWeight:800,color:"#5eead4"}}>{leaseLabelPlain}</div>
          </div>
          </>)}
          {rentalDisputeActive && (
            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8,paddingTop:8,borderTop:"1px solid var(--color-border)"}}>
              {lockIcon}
              <div>
                <div style={{fontWeight:700,color:"#ef4444"}}>{isRu?"Диспут":"Dispute freeze"}</div>
                <div style={{fontSize:11,color:"var(--dim)"}}>{isRu?"Депозиты заморожены":"Deposits frozen"}</div>
              </div>
              <div style={{marginLeft:"auto",fontWeight:800,color:"#ef4444"}}>{rentalDisputeDelta > 0 ? fmt(rentalDisputeDelta) : "done"}</div>
            </div>
          )}
          {pdDisputeActive && (
            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8,...(!rentalDisputeActive?{paddingTop:8,borderTop:"1px solid var(--color-border)"}:{})}}>
              {shieldIcon}
              <div>
                <div style={{fontWeight:700,color:"#f59e0b"}}>{isRu?"Залог имущества":"Property dispute"}</div>
                <div style={{fontSize:11,color:"var(--dim)"}}>{isRu?"Бонд заморожен":"Bond frozen"}</div>
              </div>
              <div style={{marginLeft:"auto",fontWeight:800,color:"#f59e0b"}}>{pdDisputeDelta > 0 ? fmt(pdDisputeDelta) : "done"}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
