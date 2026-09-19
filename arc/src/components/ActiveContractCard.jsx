import React, { useState, useEffect, useRef, useCallback } from 'react';
import { t } from '../i18n/index.js';
import {
  ESCROW_ADDRESS, PROPDEP_ADDRESS, USDC_ADDRESS, ARC_TESTNET_CHAIN, USDC_DECIMALS,
  SEL, SEL_PROPDEP, encAddr, encUint,
  parseAgreement, parsePropDep, mapRevertReason,
  getDealView, getNextStep, getDealActions, toDecAgreementId,
} from '../helpers.js';
import {
  getProvider, checkUsdcBalance, ethCallRpc,
  sysMsg, sendTxRaw, waitReceipt,
} from '../wallet.js';
import { logEventApi, sendEarlyTerm, archiveContract } from '../api/client.js';
import { Toast, ToastStack } from './ui/Toast.jsx';
import DealStateBanner from './ui/DealStateBanner.jsx';
import InputModal from './ui/InputModal.jsx';
import ClosureDetailsBlock from './ClosureDetailsBlock.jsx';
import EarlyTermModal from './EarlyTermModal.jsx';
import { PropDepositBlock } from './PropDepComponents.jsx';

function logEvent(type, payload = {}) {
  const log = { time: new Date().toISOString(), type, ...payload };
  console.log("[pi2pi-log]", log);
  logEventApi(log);
}

function ActiveContractCard({ contract, role, onContractClose, onOpenEarlyExitForm, loadFinancialEvents }) {
  if (!contract || !contract.listing) return null;
  const { listing, signedAt, txHash } = contract;
  if (!listing || !listing.price) return null;
  const isLL = role === "landlord";
  const [archiveError, setArchiveError] = useState("");
  const agrId = contract.agreementId;

  // On-chain state
  const [onChainState, setOnChainState] = useState(null);
  const [agrData, setAgrData] = useState(null);
  // Use on-chain rent (authoritative) with fallback to listing price
  const MR = agrData?.rent || listing.price;
  const [propDepData, setPropDepData] = useState(null); // for getDealView priority merging
  // Virtual time from contract (supports timeOffset for dev testing)
  const [contractNowMs, setContractNowMs] = useState(Date.now());
  useEffect(() => {
    const sync = async () => {
      try {
        const hex = await ethCallRpc(ESCROW_ADDRESS, SEL.currentTime);
        if (hex) setContractNowMs(Number(BigInt(hex)) * 1000);
      } catch {}
    };
    sync();
    const iv = setInterval(sync, 15000);
    return () => clearInterval(iv);
  }, []);
  // Sprint 9d: live ticker — re-renders banner every 30s so countdown stays fresh
  // MUST be declared before any early return (hooks rule #1)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const [showEarlyTerm, setShowEarlyTerm] = useState(null);
  const [depositing, setDepositing] = useState(false);
  const [earlyConfirmStep, setEarlyConfirmStep] = useState(0); // 0=none, 1=first confirm, 2=second confirm
  const [connectedAddr, setConnectedAddr] = useState(null);
  useEffect(() => {
    window.ethereum?.request({method:"eth_accounts"}).then(a=>{if(a?.[0]) setConnectedAddr(a[0].toLowerCase());}).catch(()=>{});
  }, []);
  // Toast notifications
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((msg, kind) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, kind: kind || "info" }]);
  }, []);
  const removeToast = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  // Modal for extendRentGrace input
  const [showGraceModal, setShowGraceModal] = useState(false);
  const [showEndLeaseConfirm, setShowEndLeaseConfirm] = useState(false);
  // Auto-enforce cooldown — prevents re-triggering before tx confirms
  const enforcingRef = React.useRef(false);

  const prevStateRef = React.useRef(null);
  const refreshOnChainState = useCallback(async () => {
    if (!agrId) return;
    try {
      const hex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(agrId)));
      const agr = parseAgreement(hex);
      if (prevStateRef.current !== null && prevStateRef.current !== agr.state) {
        logEvent("STATE_CHANGE", { action: "contractStateChanged", contractId: agrId, data: { from: prevStateRef.current, to: agr.state } });
      }
      prevStateRef.current = agr.state;
      setOnChainState(agr.state);
      setAgrData(agr);
      // Also fetch PropDep state + timers for banner priority merging + countdowns (Sprint 9c/9d)
      try {
        const phex = await ethCallRpc(PROPDEP_ADDRESS, SEL_PROPDEP.getPropDep + encUint(BigInt(agrId)));
        if (phex && phex.length > 2) {
          const pd = parsePropDep(phex);
          setPropDepData(pd);
        }
      } catch (pe) { /* PropDep fetch is optional */ }
    } catch(e) {}
  }, [agrId]);

  useEffect(() => {
    refreshOnChainState();
    const t = setInterval(refreshOnChainState, 10000);
    return () => clearInterval(t);
  }, [refreshOnChainState]);

  // ─── AUTO-ARCHIVE MSG — only when BOTH rental and propDep are fully resolved
  const archiveSentRef = React.useRef(false);
  useEffect(() => {
    if (!agrData || archiveSentRef.current) return;
    const terminal = agrData.state === 8 || agrData.state === 9;
    if (!terminal) return;
    // Don't send archive message if propDep is still unresolved
    const hasPD = agrData.hasPropDep || (agrData.propDep > 0);
    const pdOk = propDepData ? (propDepData.state === 0 || propDepData.state === 5) : !hasPD;
    if (!pdOk) return;
    archiveSentRef.current = true;
    (async () => {
      try {
        const accs = await window.ethereum?.request({method:"eth_accounts"});
        const me = accs?.[0]; if (!me) return;
        await chatMsg(me, t("chat.deal_archived"), "deal_archived");
      } catch{}
    })();
  }, [agrData?.state, agrId]);

  // ─── AUTO-ENFORCE — landlord-side keeper bot fallback ──────────────────────
  // When LL views the page and an enforcement condition is met, the UI auto-prompts
  // MetaMask to call the permissionless function. In production, a backend keeper
  // does this — but having UI auto-trigger gives the same UX without requiring
  // tenants to wait on a server. Tenants don't auto-enforce because actions like
  // flagRentMissed punish them (forfeit deposit), so it would be self-harm.
  // Auto-enforce removed — keeper bot handles enforcement.
  // UI only shows passive notification + manual fallback button via dealActions.

  // Chat message helper — sends system message visible to both parties
  const chatMsg = async (myAddr, text, evType, params) => {
    if (!agrData?.tenant || !agrData?.landlord) return;
    const peer = myAddr.toLowerCase() === agrData.tenant.toLowerCase() ? agrData.landlord : agrData.tenant;
    await sysMsg(myAddr, peer, text, isLL?"landlord":"tenant", evType, params);
  };

  // Deposit helper
  const doDeposit = async (type) => {
    if (!agrId || !window.ethereum || depositing) return;
    setDepositing(true);
    try {
      await getProvider()?.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] }).catch(e=>{if(e.code===4902) return getProvider()?.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });});
      const accs = await (getProvider()||window.ethereum)?.request({method:"eth_accounts"});
      const myAddr = accs?.[0]; if (!myAddr) return;
      const rentWei = BigInt(MR) * BigInt(10 ** USDC_DECIMALS);
      if (type === "tenant") {
        if (!await checkUsdcBalance(MR*2, "tenant deposit (commitment + first rent)")) { setDepositing(false); return; }
        const total = rentWei + rentWei;
        logEvent("TX_SENT", { user: myAddr, action: "tenantDeposit", contractId: agrId, data: { amount: MR*2 } });
        await sendTxRaw(myAddr, USDC_ADDRESS, SEL.approve + encAddr(ESCROW_ADDRESS) + encUint(total)).then(waitReceipt);
        await sendTxRaw(myAddr, ESCROW_ADDRESS, SEL.tenantDeposit + encUint(BigInt(agrId))).then(waitReceipt);
        logEvent("TX_CONFIRMED", { user: myAddr, action: "tenantDeposit", contractId: agrId });
        await chatMsg(myAddr, t("chat.tenant_deposited", {amount: MR*2}),"tenant_deposited");
      } else {
        if (!await checkUsdcBalance(MR, "landlord hosting deposit")) { setDepositing(false); return; }

        logEvent("TX_SENT", { user: myAddr, action: "landlordDeposit", contractId: agrId, data: { amount: MR } });
        await sendTxRaw(myAddr, USDC_ADDRESS, SEL.approve + encAddr(ESCROW_ADDRESS) + encUint(rentWei)).then(waitReceipt);
        await sendTxRaw(myAddr, ESCROW_ADDRESS, SEL.landlordDeposit + encUint(BigInt(agrId))).then(waitReceipt);
        logEvent("TX_CONFIRMED", { user: myAddr, action: "landlordDeposit", contractId: agrId });
        await chatMsg(myAddr, t("chat.landlord_deposited", {amount: MR}),"landlord_deposited");
        await chatMsg(myAddr, t("chat.agreement_on_chain"),"contract_document");
        // Auto-pause landlord's listings when contract activates
        try {
          const { data: myListings } = await getListings({owner_addr:myAddr.toLowerCase(),status:"active"});
          for (const l of (myListings||[])) {
            await listingAction(l.id, "pause", myAddr).catch(()=>{});
          }
        } catch(e) { console.warn("[auto-pause] error:", e.message); }
      }
      await refreshOnChainState();
    } catch(e) { logEvent("TX_FAILED", { user: myAddr, action: "deposit_" + type, contractId: agrId, data: { error: e.message } }); if (e.code !== 4001) alert(mapRevertReason(e)); }
    setDepositing(false);
  };

  const st = onChainState;
  const stateNames = ["Created","AwaitingLandlordDep","AwaitingTenantDep","Active","EarlyTermProposed","CheckoutProposed","DamageClaimed","DisputeOpen","Settled","LeaseEnded"];
  const shortId = toDecAgreementId(agrId);
  const fmt = d => d > 0 ? new Date(d*1000).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "—";

  // Cancelled unfunded — contract was never activated
  if (st === 8 && agrData && !agrData.activatedAt) {
    const isRuLang = getLang() === "ru";
    return (
      <div className="sc-card" style={{marginBottom:16,border:"1px solid var(--color-danger-border)",background:"var(--color-danger-surface)"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <span style={{fontSize:20}}>⛔</span>
          <div>
            <div style={{fontWeight:700,fontSize:14}}>Agreement #{shortId}</div>
            <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,background:"var(--color-danger-border)",color:"var(--color-danger)",fontWeight:700}}>
              {isRuLang ? "ОТМЕНЁН" : "CANCELLED"}
            </span>
          </div>
        </div>
        <div style={{fontSize:13,color:"var(--color-danger-dark)",marginBottom:8,fontWeight:600}}>
          {isRuLang
            ? "Контракт отменён — вторая сторона не внесла депозит в течение 24 часов."
            : "Contract cancelled — counterparty did not deposit within 24 hours."}
        </div>
        <div style={{fontSize:12,color:"var(--muted)",marginBottom:6}}>
          {isRuLang ? "Все средства возвращены." : "All funds have been returned."}
        </div>
        <button className="btn-p" style={{background:"var(--color-bg-secondary)",color:"var(--color-text-secondary)",marginTop:8}} onClick={()=>onContractClose?.("cancelled_unfunded")}>
          {isRuLang ? "Закрыть" : "Dismiss"}
        </button>
      </div>
    );
  }

  // Deposit pages (state 0-2)
  if (st !== null && st >= 0 && st <= 2) {
    return (
      <div className="sc-card" style={{marginBottom:16,border:"1px solid var(--color-warning-border)",background:"var(--color-warning-surface)"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <span style={{fontSize:20}}></span>
          <div><div style={{fontWeight:700,fontSize:14}}>Agreement #{shortId}</div><span style={{fontSize:10,padding:"2px 8px",borderRadius:10,background:"var(--color-warning-border)",color:"var(--color-warning)",fontWeight:700}}>{t("status.awaiting_deposits")}</span></div>
        </div>
        {st === 0 && <div style={{fontSize:12,color:"var(--color-warning)",marginBottom:10}}>{t("body.both_must_deposit")}</div>}
        {st === 1 && <div style={{fontSize:12,color:"var(--color-warning)",marginBottom:10}}>{t("body.tenant_deposited_wait", {amount: MR})}</div>}
        {st === 2 && <div style={{fontSize:12,color:"var(--color-warning)",marginBottom:10}}>{t("body.landlord_deposited_wait", {amount: MR*2})}</div>}
        {(st===0||st===2) && !isLL && (
          agrData?.tenantDep ? <div style={{fontSize:13,color:"var(--green)",fontWeight:700,marginTop:6}}>{t("body.deposited")}</div>
          : <button className="btn-p" disabled={depositing} onClick={()=>doDeposit("tenant")}>{depositing?(t("body.processing")):t("btn.tenant_deposit", {amount: MR*2})}</button>
        )}
        {(st===0||st===1) && isLL && (
          agrData?.landlordDep ? <div style={{fontSize:13,color:"var(--green)",fontWeight:700,marginTop:6}}>{t("body.deposited")}</div>
          : <button className="btn-p" disabled={depositing} onClick={()=>doDeposit("landlord")}>{depositing?(t("body.processing")):t("btn.landlord_deposit", {amount: MR})}</button>
        )}
        {(st===1 && !isLL) && <div style={{fontSize:12,color:"var(--muted)",marginTop:6}}>{t("body.waiting_landlord")}</div>}
        {(st===2 && isLL) && <div style={{fontSize:12,color:"var(--muted)",marginTop:6}}>{t("body.waiting_tenant")}</div>}
      </div>
    );
  }

  if (st === null) return null;

  // Sprint 9: State Map v1.0-driven top banner (Agreement + PropDep priority merge)
  // `tick` hook is declared higher up (before any early return) so render hook count stays stable
  // Use on-chain rent if available, fallback to listing.price
  const effectiveMR = agrData?.rent || MR;
  const dealView = getDealView(agrData, propDepData, contractNowMs);
  const nextStep = getNextStep(dealView, role, agrData, propDepData);
  const dealActions = getDealActions(dealView, role, agrData, propDepData, connectedAddr, contractNowMs);
  // Fail-closed: propDep is "resolved" only when we KNOW it's None(0) or Settled(5).
  // If agrData says there IS a propDep but propDepData is null (fetch failed), treat as unresolved.
  const _hasPD = agrData?.hasPropDep || (agrData?.propDep > 0);
  const propDepResolved = propDepData ? (propDepData.state === 0 || propDepData.state === 5) : !_hasPD;

  // ─── Named action handlers (referenced by dealActions[].id) ────────────────
  const switchChain = async () => {
    await getProvider()?.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] }).catch(e=>{if(e.code===4902) return getProvider()?.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });});
  };
  const getMe = async () => {
    const accs = await (getProvider()||window.ethereum)?.request({method:"eth_accounts"});
    return accs?.[0] || null;
  };

  const handlePayRent = async () => {
    setDepositing(true);
    let me = null;
    try {
      await switchChain();
      me = await getMe();
      if(!me) { alert(t("err.wallet_not_connected") || "Wallet not connected. Please reconnect."); return; }
      if (!await checkUsdcBalance(MR, "monthly rent payment")) return;
      const rentWei = BigInt(MR) * BigInt(10 ** USDC_DECIMALS);
      // Approve exact rent amount (Arc USDC precompile may reject approve > balance)
      const approveData = SEL.approve + encAddr(ESCROW_ADDRESS) + encUint(rentWei);
      const payData = SEL.payRent + encUint(BigInt(agrId));
      const isCircle = window.pi2piWallet && window.pi2piWallet.type === "circle" && typeof window.pi2piWallet.executeBatch === "function";
      // Check allowance — skip approve if already enough (saves 1 tx)
      let needApprove = true;
      try {
        const allowanceHex = await ethCallRpc(USDC_ADDRESS, SEL.allowance + encAddr(me) + encAddr(ESCROW_ADDRESS));
        if (allowanceHex && BigInt(allowanceHex) >= rentWei) needApprove = false;
      } catch {}
      if (needApprove) console.log("[payRent] need approve:", MR, "USDC");
      else console.log("[payRent] allowance OK, skipping approve");
      logEvent("TX_SENT", { user: me, action: "payRent", contractId: agrId, data: { amount: MR, month: (agrData.rentPayments||0)+2 } });
      if (isCircle) {
        const batch = needApprove ? [{ to: USDC_ADDRESS, data: approveData },{ to: ESCROW_ADDRESS, data: payData }] : [{ to: ESCROW_ADDRESS, data: payData }];
        await window.pi2piWallet.executeBatch(batch);
      } else {
        if (needApprove) {
          const approveTx = await sendTxRaw(me, USDC_ADDRESS, approveData);
          const approveRc = await waitReceipt(approveTx);
          if (!approveRc || approveRc.status === "0x0") throw new Error("USDC approve failed — try again");
        }
        const payTx = await sendTxRaw(me, ESCROW_ADDRESS, payData);
        const payRc = await waitReceipt(payTx);
        if (!payRc || payRc.status === "0x0") throw new Error("Pay rent failed — try again");
      }
      logEvent("TX_CONFIRMED", { user: me, action: "payRent", contractId: agrId });
      const rentParams = {amount: MR, month: (agrData.rentPayments||0)+2};
      await chatMsg(me, t("chat.rent_paid", rentParams), "rent_paid", rentParams);
      await refreshOnChainState();
    } catch(e) {
      const safeUser = me || "";
      if (e.code === 4001 || /rejected|cancelled|closed|denied|credential.?request.?failed/i.test(e.message || "")) {
        logEvent("TX_FAILED", { user: safeUser, action: "payRent", contractId: agrId, data: { error: "cancelled" } });
      } else {
        logEvent("TX_FAILED", { user: safeUser, action: "payRent", contractId: agrId, data: { error: e.message } });
        alert(mapRevertReason(e));
      }
    } finally {
      setDepositing(false);
    }
  };

  const handleEndLease = async () => {
    setDepositing(true);
    try {
      await switchChain();
      const me = await getMe();
      logEvent("TX_SENT", { user: me, action: "endLease", contractId: agrId });
      await sendTxRaw(me, ESCROW_ADDRESS, SEL.endLease + encUint(BigInt(agrId))).then(waitReceipt);
      logEvent("TX_CONFIRMED", { user: me, action: "endLease", contractId: agrId });
      await chatMsg(me, t("chat.lease_ended"),"lease_ended");
      await refreshOnChainState();
    } catch(e){ logEvent("TX_FAILED", { user: me, action: "endLease", contractId: agrId, data: { error: e.message } }); if(e.code!==4001) alert(mapRevertReason(e)); }
    setDepositing(false);
  };

  const handleFlagRentMissed = async () => {
    setDepositing(true);
    try {
      await switchChain();
      const me = await getMe();
      logEvent("TX_SENT", { user: me, action: "flagRentMissed", contractId: agrId });
      const txHash = await sendTxRaw(me, ESCROW_ADDRESS, SEL.flagRentMissed + encUint(BigInt(agrId)));
      const rc = await waitReceipt(txHash);
      if (!rc || rc.status !== "0x1") { logEvent("TX_FAILED", { user: me, action: "flagRentMissed", contractId: agrId, data: { error: "receipt status != 0x1" } }); alert(t("err.flag_reverted")); setDepositing(false); return; }
      logEvent("TX_CONFIRMED", { user: me, action: "flagRentMissed", contractId: agrId });
      await chatMsg(me, t("chat.rent_missed"),"rent_missed");
      await chatMsg(me, t("chat.hosting_returned"),"rent_missed");
      await chatMsg(me, t("chat.tenant_vacate", {days: 3}),"rent_missed");
      await chatMsg(me, t("chat.lease_terminated"),"lease_terminated");
      await refreshOnChainState();
    } catch(e){ logEvent("TX_FAILED", { user: me, action: "flagRentMissed", contractId: agrId, data: { error: e.message } }); if(e.code!==4001) alert(mapRevertReason(e)); }
    setDepositing(false);
  };

  const handleReleaseFrozenFunds = async () => {
    try {
      const me = await getMe();
      await switchChain();
      logEvent("TX_SENT", { user: me, action: "releaseFrozenFunds", contractId: agrId });
      await sendTxRaw(me, ESCROW_ADDRESS, SEL.releaseFrozenFunds + encUint(BigInt(agrId))).then(waitReceipt);
      logEvent("TX_CONFIRMED", { user: me, action: "releaseFrozenFunds", contractId: agrId });
      await chatMsg(me, t("chat.frozen_released"),"bond_withdrawn");
      await refreshOnChainState();
    } catch(e){ if(e.code!==4001) { logEvent("TX_FAILED", { user: connectedAddr, action: "releaseFrozenFunds", contractId: agrId, data: { error: e.message } }); alert(mapRevertReason(e)); } }
  };

  const handleAcceptClaim = async () => {
    try {
      const me = await getMe(); if(!me) return;
      await switchChain();
      const amInit = agrData.earlyTermInitiator && connectedAddr && agrData.earlyTermInitiator.toLowerCase() === connectedAddr;
      const fn = amInit ? SEL.concedeDispute : SEL.acceptDisputeExit;
      const actionName = amInit ? "concedeDispute" : "acceptDisputeExit";
      logEvent("TX_SENT", { user: me, action: actionName, contractId: agrId });
      await sendTxRaw(me, ESCROW_ADDRESS, fn + encUint(BigInt(agrId))).then(waitReceipt);
      logEvent("TX_CONFIRMED", { user: me, action: actionName, contractId: agrId });
      await chatMsg(me, t("chat.claim_accepted"),"damage_accepted");
      await refreshOnChainState();
    } catch(e){ if(e.code!==4001) { logEvent("TX_FAILED", { user: connectedAddr, action: "acceptClaim", contractId: agrId, data: { error: e.message } }); alert(mapRevertReason(e)); } }
  };

  // Handler dispatch map
  const actionHandlers = {
    payRent: handlePayRent,
    endLease: handleEndLease,
    flagRentMissed: handleFlagRentMissed,
    grantGrace: () => setShowGraceModal(true),
    terminateEarly: () => setEarlyConfirmStep(1),
    openETForm: () => onOpenEarlyExitForm?.({type:"early_term_received",status:"proposed",termType:"unknown",etId:0}),
    releaseFrozenFunds: handleReleaseFrozenFunds,
    acceptClaim: handleAcceptClaim,
  };

  // Action button style helper
  const actionStyle = (tone) => {
    const base = {width:"100%",padding:"10px",borderRadius:10,border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8};
    if (tone === "accent") return {...base, background:"var(--accent)", color:"white"};
    if (tone === "success") return {...base, background:"var(--green)", color:"white", fontWeight:800, fontSize:13, padding:"12px"};
    if (tone === "danger") return {...base, background:"var(--color-danger)", color:"white"};
    if (tone === "warning") return {...base, background:"var(--color-warning)", color:"white", fontSize:11, padding:"9px", borderRadius:8};
    if (tone === "primary") return {...base, background:"var(--color-info)", color:"white"};
    if (tone === "outline-danger") return {...base, background:"var(--color-bg-card)", border:"1.5px solid var(--color-danger-border)", color:"var(--color-danger)"};
    if (tone === "outline-warning") return {...base, background:"var(--color-bg-card)", border:"1.5px solid var(--color-warning-border)", color:"var(--color-warning)", fontSize:11, padding:"9px", borderRadius:8};
    return base;
  };

  return (
    <React.Fragment>
    <DealStateBanner view={dealView} nextStep={nextStep}/>
    <div className="sc-card" style={{marginBottom:16,border:`1px solid var(--color-border)`}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div>
          <div style={{fontWeight:700,fontSize:14,color:"var(--color-text-primary)",letterSpacing:"-0.2px"}}>Agreement #{shortId}</div>
          <div style={{fontSize:11,color:"var(--color-text-secondary)",fontFamily:"var(--ffm)",marginTop:2}}>
            {(st === 8 || st === 9) && propDepResolved
              ? <span>{t("misc.archived")} · {t("misc.started")} {fmt(agrData?.activatedAt)}</span>
              : (st === 8 || st === 9)
                ? <span>{t("deal.settled_partial")} · {t("misc.started")} {fmt(agrData?.activatedAt)}</span>
                : <>{fmt(agrData?.createdAt)} — {fmt(agrData?.leaseEnd)}</>}
          </div>
        </div>
      </div>

      {/* === ACTIVE (3) === */}
      {st === 3 && agrData && (
        <div>
          {/* Dates & Rent */}
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontSize:12,color:"var(--muted)"}}>{t("field.monthly_rent_short")}</span>
            <span style={{fontSize:14,fontWeight:800}}>{agrData.rent} USDC</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontSize:12,color:"var(--muted)"}}>{t("field.lease_period")}</span>
            <span style={{fontSize:11,fontWeight:600}}>{fmt(agrData.activatedAt)} — {fmt(agrData.leaseEnd)}</span>
          </div>

          {/* Deposits Locked */}
          <div style={{background:"var(--color-info-surface)",border:"1px solid var(--color-info-border)",borderRadius:10,padding:"10px 12px",marginBottom:10,marginTop:8}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--color-info)",marginBottom:6}}>{<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"-2px",width:14,height:14}}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>} {t("title.deposits_locked")}</div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:2}}>
              <span style={{color:"var(--muted)"}}>{t("deposit.commitment")}</span><span style={{fontWeight:700}}>{agrData.commitDep} USDC</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:2}}>
              <span style={{color:"var(--muted)"}}>{t("deposit.hosting")}</span><span style={{fontWeight:700}}>{agrData.hostDep} USDC</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}>
              <span style={{color:"var(--muted)"}}>{t("deposit.first_rent")}</span><span style={{fontWeight:700,color:"var(--green)"}}>{agrData.rent} USDC</span>
            </div>
          </div>

          {/* Rent info */}
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--muted)",marginBottom:10}}>
            <span>{t("misc.payments")}: {(agrData.rentPayments||0)+1} {t("misc.incl_first")}</span>
            <span>{t("misc.ends")}: {fmt(agrData.leaseEnd)}</span>
          </div>

          {/* Time Travel removed — use admin panel instead */}

          {/* Lease ending info — 21 days before lease end */}
          {(() => {
            const nowSec = Math.floor(Date.now()/1000);
            const within21 = agrData.leaseEnd > 0 && nowSec >= agrData.leaseEnd - 21*86400;
            if (!within21) return null;
            const daysLeft = Math.max(0, Math.ceil((agrData.leaseEnd - nowSec) / 86400));
            const peerAddr = isLL ? agrData.tenant : agrData.landlord;
            return (
              <div style={{background:"var(--color-info-surface)",border:"1.5px solid var(--color-info-border)",borderRadius:12,padding:"14px 16px",marginBottom:10}}>
                <div style={{fontSize:13,fontWeight:800,color:"var(--color-info)",marginBottom:6}}>Lease ends in {daysLeft} day{daysLeft===1?"":"s"}</div>
                <div style={{fontSize:11,color:"var(--color-info)",lineHeight:1.6,marginBottom:10}}>This lease will end naturally. Deposits will be returned. If you wish to continue renting, start a new agreement from scratch.</div>
                <button onClick={()=>{try{window.dispatchEvent(new CustomEvent("pi2pi-new-agreement",{detail:{peer:peerAddr}}));}catch{}}} style={{width:"100%",padding:"11px",borderRadius:10,background:"var(--color-info)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  Start a New Agreement with {peerAddr.slice(0,6)}…{peerAddr.slice(-4)}
                </button>
              </div>
            );
          })()}

          {/* ─── Action buttons driven by getDealActions ─── */}
          {dealActions.filter(a=>a.label!=="_info").length > 0 && (
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
              {dealActions.filter(a=>a.label!=="_info" && actionHandlers[a.id]).map(a => (
                <button key={a.id} disabled={depositing || a.disabled} onClick={a.disabled ? undefined : actionHandlers[a.id]} style={{...actionStyle(a.tone), ...(a.disabled ? {opacity:0.4, cursor:"not-allowed"} : {}), ...(a.id==="payRent" && !a.disabled ? {background:"#10b981", color:"#fff", fontSize:14, fontWeight:900, padding:"14px", letterSpacing:"0.3px", textShadow:"0 1px 2px rgba(0,0,0,0.3)"} : {})}}>
                  {depositing && (a.id==="payRent"||a.id==="endLease"||a.id==="flagRentMissed") ? (t("body.processing")) : <>{a.icon} {a.label === "Pay Rent" ? t("btn.pay_rent", {amount: effectiveMR}) : a.label}</>}
                </button>
              ))}
            </div>
          )}

          {/* Grace modal */}
          {showGraceModal && (
            <InputModal title={t("grace.title")} message={t("grace.message")} placeholder={t("grace.placeholder")} defaultValue="5" min={1} max={14} confirmLabel={t("grace.confirm")}
              onCancel={()=>setShowGraceModal(false)}
              onConfirm={async (n)=>{
                setShowGraceModal(false); setDepositing(true);
                try {
                  await switchChain(); const me = await getMe();
                  logEvent("TX_SENT", { user: me, action: "extendRentGrace", contractId: agrId, data: { days: n } });
                  const txHash = await sendTxRaw(me, ESCROW_ADDRESS, SEL.extendRentGrace + encUint(BigInt(agrId)) + encUint(BigInt(n)));
                  const rc = await waitReceipt(txHash);
                  if (!rc || rc.status !== "0x1") { logEvent("TX_FAILED", { user: me, action: "extendRentGrace", contractId: agrId }); toast(t("toast.grace_reverted"), "error"); setDepositing(false); return; }
                  logEvent("TX_CONFIRMED", { user: me, action: "extendRentGrace", contractId: agrId, data: { days: n, txHash } });
                  await chatMsg(me, t("chat.grace_granted", {days: n}),"grace_granted");
                  toast(t("toast.grace_ok", {days: n}), "success");
                  await refreshOnChainState();
                } catch(e){ if(e.code!==4001) toast(e.message||t("err.failed"), "error"); }
                setDepositing(false);
              }}
            />
          )}
        </div>
      )}

      {/* === EARLY TERM PROPOSED (4) + DISPUTE OPEN (7) �� actions from getDealActions === */}
      {(st === 4 || st === 7) && dealActions.filter(a=>a.label!=="_info" && actionHandlers[a.id]).length > 0 && (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {dealActions.filter(a=>a.label!=="_info").map(a => {
            if (a.id === "disputeWaiting") return <div key={a.id} style={{fontSize:12,color:"var(--muted)",lineHeight:1.6}}>{t("body.dispute_claimant")}</div>;
            if (a.id === "acceptClaim") return (
              <React.Fragment key={a.id}>
                <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.6,marginBottom:4}}>{t("body.dispute_respondent")}</div>
                <button onClick={actionHandlers[a.id]} style={actionStyle(a.tone)}>{a.label}</button>
              </React.Fragment>
            );
            return <button key={a.id} disabled={depositing} onClick={actionHandlers[a.id]} style={actionStyle(a.tone)}>{a.icon} {a.label}</button>;
          })}
        </div>
      )}

      {/* === PropDep info/actions — show for active contracts OR settled with unresolved PropDep === */}
      {((st >= 3 && st < 8 && agrData.propDep > 0) || ((st === 8 || st === 9) && !propDepResolved)) && <PropDepositBlock agreementId={agrId} role={isLL?"landlord":"tenant"}/>}

      {/* === SETTLED (8) / LEASE ENDED (9) — only show closure/archive when PropDep is also resolved === */}
      {(st === 8 || st === 9) && propDepResolved && <ClosureDetailsBlock st={st} agrData={agrData} agrId={agrId} loadFinancialEvents={loadFinancialEvents} />}
      {(st === 8 || st === 9) && propDepResolved && !contract?.archived && !contract?.closed && (
        <React.Fragment>
          {archiveError && (
            <div style={{background:"var(--color-danger-surface)",border:"1.5px solid var(--color-danger-border)",borderRadius:10,padding:"10px 13px",fontSize:12,color:"var(--color-danger)",lineHeight:1.6,marginTop:8}}>
              {archiveError}
            </div>
          )}
          <button onClick={async () => {
            setArchiveError("");
            if (!window.pi2piWallet?._authenticated) {
              setArchiveError("Reconnect wallet to archive this agreement.");
              return;
            }
            const addr = connectedAddr || myAddr;
            if (!addr) { setArchiveError("No wallet address. Please reconnect."); return; }
            try {
              const r = await archiveContract(addr);
              if (!r || !r.ok) {
                const body = typeof r?.json === "function" ? await r.json().catch(() => ({})) : {};
                setArchiveError(body?.error || "Archive failed");
                return;
              }
              onContractClose?.("archived");
            } catch (e) {
              setArchiveError(e.message || "Archive failed");
            }
          }} className="btn-g" style={{marginTop:12,width:"100%",background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)"}}>
            {t("btn.archive_contract")}
          </button>
        </React.Fragment>
      )}

      {/* === EarlyTermModal === */}
      {/* Terminate Early confirmation step 1 */}
      {earlyConfirmStep===1 && (
        <div className="modal-ov" onClick={()=>setEarlyConfirmStep(0)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-handle"/>
            <div style={{fontSize:28,textAlign:"center",marginBottom:8}}></div>
            <div className="modal-title">{t("title.are_you_sure")}</div>
            <div className="modal-sub" style={{lineHeight:1.7,marginBottom:16}}>{t("body.et_cannot_undo")}</div>
            <button className="btn-p" style={{background:"var(--color-danger)"}} onClick={()=>setEarlyConfirmStep(2)}>{t("btn.continue")}</button>
            <button className="btn-g" style={{marginTop:8}} onClick={()=>setEarlyConfirmStep(0)}>{t("btn.cancel")}</button>
          </div>
        </div>
      )}
      {/* Terminate Early confirmation step 2 */}
      {earlyConfirmStep===2 && (
        <div className="modal-ov" onClick={()=>setEarlyConfirmStep(0)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-handle"/>
            <div style={{fontSize:28,textAlign:"center",marginBottom:8}}></div>
            <div className="modal-title">{t("title.discussed_with_party")}</div>
            <div className="modal-sub" style={{lineHeight:1.7,marginBottom:16}}>{t("body.et_discuss")}</div>
            <button className="btn-p" onClick={()=>{setEarlyConfirmStep(0);setShowEarlyTerm(true);}}>{t("et.yes_proceed")}</button>
            <button className="btn-g" style={{marginTop:8}} onClick={()=>setEarlyConfirmStep(0)}>{t("et.no_go_back")}</button>
          </div>
        </div>
      )}
      {showEarlyTerm && <EarlyTermModal onClose={()=>setShowEarlyTerm(null)} onSubmit={async (termType, reason)=>{
        setShowEarlyTerm(null);
        let myAddr = null;
        try { const accs = await (getProvider()||window.ethereum)?.request({method:"eth_accounts"}); myAddr = accs?.[0]; } catch{}
        if (!myAddr) { alert(t("err.wallet_not_connected")); return; }
        const peerAddr = contract.listing?.contract || contract.peerAddr || "";
        if (!peerAddr || !agrId) { alert(t("err.missing_data")); return; }
        try {
          await getProvider()?.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] }).catch(e=>{if(e.code===4902) return getProvider()?.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });});
          // Check state
          const stateHex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(agrId)));
          const stateVal = parseInt(stateHex.slice(2 + 10*64, 2 + 11*64), 16);
          if (stateVal !== 3) { alert(t("err.wrong_state", {state: stateNames[stateVal]})); return; }
          // Sign early termination intent
          const etSigMsg = `pi2pi: Early termination (${termType}) agreement ${agrId}`;
          const etSig = await (getProvider()||window.ethereum).request({ method: "personal_sign", params: [etSigMsg, myAddr] });
          logEvent("UI_ACTION", { user: myAddr, action: "early_termination_" + termType.toLowerCase(), contractId: agrId, data: { reason, signature: etSig.slice(0,20)+"..." } });
          if (termType === "InitiatorAccepts") {
            // Sprint 4: atomic exitWithLoss — single transaction, no propose step
            await sendTxRaw(myAddr, ESCROW_ADDRESS, SEL.exitWithLoss + encUint(BigInt(agrId))).then(waitReceipt);
            const vacateDays = isLL ? 7 : 3;
            try {
              await sendEarlyTerm({fromAddr:myAddr,toAddr:peerAddr,termType,reason});
              await sysMsg(myAddr, peerAddr,
                t("chat.et_offer", {role: isLL ? t("role.landlord") : t("role.tenant"), days: vacateDays}) +
                (reason ? " Reason: " + reason : ""),
                isLL ? "landlord" : "tenant", "early_exit_executed");
            } catch(e){}
          } else if (termType === "Disputed") {
            // Sprint 4: proposeEarlyTermination(Disputed) goes directly to DisputeOpen
            // No bond posting — existing deposits frozen as stakes. Single transaction.
            const proposeData = SEL.proposeEarlyTermination + encUint(BigInt(agrId)) + encUint(3n);
            await sendTxRaw(myAddr, ESCROW_ADDRESS, proposeData).then(waitReceipt);
            try {
              await sendEarlyTerm({fromAddr:myAddr,toAddr:peerAddr,termType,reason});
              await sysMsg(myAddr, peerAddr, t("chat.et_dispute")+(reason?" Reason: "+reason:""), isLL?"landlord":"tenant", "early_exit_requested");
            } catch(e){}
          } else {
            // Mutual — unchanged: proposeEarlyTermination(Mutual)
            const proposeData = SEL.proposeEarlyTermination + encUint(BigInt(agrId)) + encUint(1n);
            await sendTxRaw(myAddr, ESCROW_ADDRESS, proposeData).then(waitReceipt);
            try {
              await sendEarlyTerm({fromAddr:myAddr,toAddr:peerAddr,termType,reason});
              await sysMsg(myAddr, peerAddr, t("chat.et_mutual")+(reason?" Reason: "+reason:""), isLL?"landlord":"tenant", "early_exit_requested");
            } catch(e){}
          }
          await refreshOnChainState();
        } catch(e) { if(e.code!==4001) alert(mapRevertReason(e)); }
      }}/>}
      <ToastStack toasts={toasts} removeToast={removeToast} />
    </div>
    </React.Fragment>
  );
}



export default ActiveContractCard;
