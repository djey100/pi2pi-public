import React, { useState, useEffect, useRef } from 'react';
import { t } from '../i18n/index.js';
import {
  ESCROW_ADDRESS, ARC_TESTNET_CHAIN, USDC_DECIMALS, EXPLORER_BASE_URL,
  SEL, encAddr, encUint, parseAgreement,
} from '../helpers.js';
import {
  getProvider, encBytes32, sysMsg, sendTxRaw, waitReceipt,
} from '../wallet.js';
import {
  logEventApi, getUser, sendMessage, getMessages, getInbox,
  createViewingRequest, respondViewingRequest,
  getActiveContract, createContractProposal, cancelContractProposal,
  signContract, apiGet, apiPost,
} from '../api/client.js';
import { IcBack } from './ui/Icons.jsx';
import AvatarBox from './AvatarBox.jsx';
import EarlyTermResponseForm from './EarlyTermResponseForm.jsx';
import { Toast } from './ui/Toast.jsx';

function logEvent(type, payload = {}) {
  const log = { time: new Date().toISOString(), type, ...payload };
  console.log("[pi2pi-log]", log);
  logEventApi(log);
}

function RealChatPage({ myAddr, peerAddr, role, suspended, onBack, onContractComplete, onGoToContract }) {
  // Mark inbox as seen when entering chat (clears unread badge for this conversation)
  useEffect(() => {
    if (myAddr && myAddr.length >= 42) apiPost(`/api/inbox/${myAddr.toLowerCase()}/seen`).catch(() => {});
  }, [myAddr, peerAddr]);
  const [msgs, setMsgs] = useState([]);
  const [inp, setInp] = useState("");
  const [contract, setContract] = useState(null);
  const [signing, setSigning] = useState(false);
  const [chatLoaded, setChatLoaded] = useState(false); // first poll done
  const [viewingStatus, setViewingStatus] = useState(null);
  const [viewingInitiator, setViewingInitiator] = useState(null);
  const [viewingVrId, setViewingVrId] = useState(null);
  const [acceptingViewing, setAcceptingViewing] = useState(false);
  const [earlyTerm, setEarlyTerm] = useState(null);
  const [hasAgreement, setHasAgreement] = useState(false);
  const [chatAgreementId, setChatAgreementId] = useState(null);
  const [chatOnChainState, setChatOnChainState] = useState(null); // on-chain state for hiding buttons
  const [showEarlyForm, setShowEarlyForm] = useState(false);
  const [chatToast, setChatToast] = useState(null);
  const [txStatus, setTxStatus] = useState(""); // "" | "signing" | "done" | error string
  const [myContractBusy, setMyContractBusy] = useState(false); // I have active contract with someone else
  const [peerContractBusy, setPeerContractBusy] = useState(false); // peer has active contract with someone else
  const bodyRef = useRef(null);

  // Get full address — try all sources
  const [fullAddr, setFullAddr] = useState(myAddr && myAddr.length >= 42 && !myAddr.includes("…") ? myAddr : "");
  useEffect(() => {
    if (fullAddr && fullAddr.length >= 42 && !fullAddr.includes("…")) return;
    // Try myAddr prop
    if (myAddr && myAddr.length >= 42 && !myAddr.includes("…")) { setFullAddr(myAddr); return; }
    // Try Circle wallet
    const circleAddr = window.pi2piWallet?._circleAddress;
    if (circleAddr && circleAddr.length >= 42) { setFullAddr(circleAddr); return; }
    // Try MetaMask/WC
    const provider = window.pi2piWallet?.provider || window.ethereum;
    provider?.request({method:"eth_accounts"}).then(a=>{if(a?.[0])setFullAddr(a[0]);}).catch(()=>{});
  }, [myAddr]);

  // Poll messages + contract status
  useEffect(() => {
    if (!fullAddr || !peerAddr) return;
    let cancelled = false;
    const poll = () => {
      if (cancelled) return;
      getMessages(fullAddr, peerAddr).then(d => ({ok:true,json:()=>d}))
        .then(r=>r.json()).then(data=>{ if(!cancelled) setMsgs((data||[]).sort((a,b)=>a.createdAt-b.createdAt)); }).catch(()=>{});
      getInbox(fullAddr).then(d=>({ok:true,json:()=>d}))
        .then(r=>r.json()).then(resp=>{
          if(cancelled) return;
          const items = resp?.items || resp || [];
          const cp = items.find(i=>(i.type==="contract_received"||i.type==="contract_sent") &&
            i.status !== "cancelled" && i.status !== "rejected" &&
            (i.fromAddr===peerAddr.toLowerCase()||i.toAddr===peerAddr.toLowerCase()));
          setContract(cp || null);
          // Check if I have active contract with ANOTHER peer
          const myOtherContract = items.find(i=>(i.type==="contract_received"||i.type==="contract_sent") &&
            i.status !== "cancelled" && i.status !== "rejected" &&
            i.fromAddr!==peerAddr.toLowerCase() && i.toAddr!==peerAddr.toLowerCase());
          setMyContractBusy(!!myOtherContract);
          // Check if peer is busy with contract with someone else
          apiGet("/api/contract-busy/" + peerAddr.toLowerCase()).then(d=>{
            if(!cancelled) setPeerContractBusy(d.busy && !cp);
          }).catch(()=>{});
          // Check viewing request status between us
          const vr = items.find(i=>(i.type==="viewing_request_received"||i.type==="viewing_request_sent") &&
            (i.fromAddr===peerAddr.toLowerCase()||i.toAddr===peerAddr.toLowerCase()));
          if(vr) {
            setViewingStatus(vr.status);
            setViewingInitiator(vr.fromAddr);
            if(vr.vrId) setViewingVrId(vr.vrId);
          }
          // Early term
          const et = items.find(i=>(i.type==="early_term_received"||i.type==="early_term_sent") &&
            (i.fromAddr===peerAddr.toLowerCase()||i.toAddr===peerAddr.toLowerCase()));
          if(et) setEarlyTerm(et);
          // Check if agreement already deployed
          getActiveContract(fullAddr).then(async (ac)=>{
            if(ac?.agreementId) {
              setHasAgreement(true);
              setChatAgreementId(ac.agreementId);
              try {
                const hex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(ac.agreementId)));
                setChatOnChainState(parseAgreement(hex).state);
              } catch(e){}
            }
            if (!cancelled) setChatLoaded(true);
          }).catch(()=>{ if (!cancelled) setChatLoaded(true); });
        }).catch(()=>{ if (!cancelled) setChatLoaded(true); });
    };
    poll();
    const t = setInterval(poll, 3000);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled=true; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [fullAddr, peerAddr]);

  // Auto-scroll
  useEffect(() => {
    if(bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs.length]);

  const _hasUrl = (s) => /https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(com|org|net|io|co|me|app|dev|xyz|info|biz|pro|tech|site|online|store|shop|link|click|top)\b|\bt\.me\/|wa\.me\//i.test(s);
  const send = async (text) => {
    if (suspended) return; // blocked
    if (!text.trim() || !fullAddr || !peerAddr) return;
    if (_hasUrl(text)) { setChatToast(t("err.links_not_allowed")); setTimeout(() => setChatToast(null), 3000); return; }
    try {
      const r = await sendMessage({ fromAddr: fullAddr, toAddr: peerAddr, text: text.trim() });
      const d = await r.json().catch(()=>({}));
      if (d.error === "account_suspended") return; // server blocked
      if (d.error === "links_not_allowed") { setChatToast(t("err.links_not_allowed")); setTimeout(() => setChatToast(null), 3000); return; }
    } catch(e){}
    setInp("");
  };

  // Request viewing (tenant) or Offer viewing (landlord)
  const sendViewing = async () => {
    if (viewingStatus && viewingStatus !== "declined") return;
    const label = role==="tenant" ? "I'd like to request a viewing" : "I'd like to offer you a viewing of my property";
    await sendMessage({ fromAddr: fullAddr, toAddr: peerAddr, text: "" + label });
    await createViewingRequest({ fromAddr: fullAddr, toAddr: peerAddr, listingTitle: role==="tenant"?"Viewing request":"Viewing offer", message: label });
    setViewingStatus("pending");
  };

  // Accept viewing via personal_sign
  const acceptViewing = async () => {
    if (!viewingVrId || acceptingViewing || !window.ethereum) return;
    setAcceptingViewing(true);
    try {
      const payload = JSON.stringify({ action: "confirm_viewing", vrId: viewingVrId, addr: fullAddr, ts: Date.now() });
      const signature = await getProvider().request({ method: "personal_sign", params: [payload, fullAddr] });
      logEvent("UI_ACTION", { user: fullAddr, action: "viewing_accepted", data: { vrId: viewingVrId, peerAddr, signature: signature.slice(0,20)+"..." } });
      await respondViewingRequest(viewingVrId, { status: "confirmed", signature, signedBy: fullAddr });
      setViewingStatus("confirmed");
    } catch(e) {
      // User rejected — do nothing
    }
    setAcceptingViewing(false);
  };

  // Propose contract (initiator — auto-signs as proposer)
  const [proposeError, setProposeError] = useState("");
  const [proposing, setProposing] = useState(false);
  const proposeContract = async () => {
    if (contract || proposing) return;
    setProposing(true);
    setProposeError("");
    try {
      const propSigMsg = `pi2pi: Propose contract to ${peerAddr}`;
      const propProvider = getProvider() || window.ethereum;
      const propSig = await propProvider.request({ method: "personal_sign", params: [propSigMsg, fullAddr] });
      logEvent("UI_ACTION", { user: fullAddr, action: "contract_proposed", data: { peerAddr, signature: propSig.slice(0,20)+"..." } });
      const resp = await createContractProposal({ fromAddr: fullAddr, toAddr: peerAddr, signature: propSig });
      const cp = await resp.json();
      if (!resp.ok) {
        if (cp.error === "active_proposal_exists") {
          setProposeError(t("contract.err_you_have_active"));
        } else if (cp.error === "peer_has_active_proposal") {
          setProposeError(t("contract.err_peer_busy"));
        } else {
          setProposeError(cp.error || "Error");
        }
        setProposing(false);
        return;
      }
      await sendMessage({ fromAddr: fullAddr, toAddr: peerAddr, text: "I'd like to propose a rental agreement. Let's sign on-chain." });
      setContract({ ...cp, type:"contract_sent", contractId: cp.id });
      // Clear stale contract flow session data from previous contracts
      try {
        const stepKey = "pi2pi_cf_step_" + (peerAddr||"").toLowerCase();
        sessionStorage.removeItem(stepKey);
        sessionStorage.removeItem("pi2pi_lease_read");
      } catch {}
    } catch(e){ setProposeError(e.message); }
    setProposing(false);
  };

  // Cancel contract proposal
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const cancelContract = async () => {
    setCancelConfirm(false);
    if (!contract?.contractId) return;
    try {
      await cancelContractProposal(contract.contractId, { addr: fullAddr });
      setContract(null);
    } catch(e){}
  };

  // Accept contract (counterparty) → redirect to contract preparation
  const [accepting, setAccepting] = useState(false);
  const acceptContract = async () => {
    if (!contract?.contractId || accepting) return;
    setAccepting(true);
    try {
      const acceptSigMsg = `pi2pi: Accept contract ${contract.contractId}`;
      const acceptProvider = getProvider() || window.ethereum;
      const acceptSig = await acceptProvider.request({ method: "personal_sign", params: [acceptSigMsg, fullAddr] });
      logEvent("UI_ACTION", { user: fullAddr, action: "contract_accepted", data: { contractId: contract.contractId, peerAddr, signature: acceptSig.slice(0,20)+"..." } });
      await sendMessage({ fromAddr: fullAddr, toAddr: peerAddr, text: "I accept the rental agreement. Ready to sign on-chain." });
      await signContract({ contractId: contract.contractId, addr: fullAddr, signature: acceptSig });
      // Clear stale contract flow session data
      try {
        const stepKey = "pi2pi_cf_step_" + (peerAddr||"").toLowerCase();
        sessionStorage.removeItem(stepKey);
        sessionStorage.removeItem("pi2pi_lease_read");
      } catch {}
      if (onGoToContract) { onGoToContract(peerAddr); return; }
    } catch(e) {}
    setAccepting(false);
  };

  // Sign on-chain (initiator, after both accepted)
  const signOnChain = async () => {
    if (signing) return;
    setSigning(true);
    setTxStatus("signing");
    try {
      // Switch chain
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] });
      } catch(e) {
        if (e.code === 4902) await window.ethereum.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });
        else throw e;
      }

      const tenantAddr = role === "tenant" ? fullAddr : peerAddr;
      const landlordAddr = role === "landlord" ? fullAddr : peerAddr;
      const MR = 2; // minimum rent in USDC
      const rentWei = BigInt(MR) * BigInt(10 ** USDC_DECIMALS);
      const propWei = 0n;
      const contentHash = "0x" + "0".repeat(64);

      // Pre-flight balance check (tenant pays first rent + commitment = 2× MR)
      if (role === "tenant" && !await checkUsdcBalance(MR*2, "tenant deposit (rent + commitment)")) {
        return;
      }

      // createAgreement
      setTxStatus("Creating agreement on-chain…");
      const createData = SEL.createAgreement
        + encAddr(tenantAddr) + encAddr(landlordAddr)
        + encUint(rentWei) + encUint(propWei) + encUint(6n)
        + encBytes32(contentHash);
      const createTx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, createData);

      setTxStatus("Waiting for confirmation…");
      const receipt = await waitReceipt(createTx);
      if (!receipt || receipt.status === "0x0") throw new Error("createAgreement reverted");

      const agreementId = receipt.logs?.[0]?.topics?.[1] || "0x0";

      // Only tenant does approve + deposit
      if (role === "tenant") {
        setTxStatus("Approving USDC…");
        const totalUsdc = rentWei + rentWei + propWei;
        const approveData = SEL.approve + encAddr(ESCROW_ADDRESS) + encUint(totalUsdc);
        const approveTx = await sendTxRaw(fullAddr, USDC_ADDRESS, approveData);
        const approveRc = await waitReceipt(approveTx);
        if (!approveRc || approveRc.status === "0x0") throw new Error("USDC approve reverted");

        setTxStatus("Depositing…");
        const depositData = SEL.tenantDeposit + encUint(BigInt(agreementId));
        const depositTx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, depositData);
        const depositRc = await waitReceipt(depositTx);
        if (!depositRc || depositRc.status === "0x0") throw new Error("tenantDeposit reverted");
      }

      setTxStatus("done");
      await sysMsg(fullAddr, peerAddr, "Rental agreement created on-chain."+(role==="tenant"?" Tenant deposited "+(MR*2)+" USDC.":""), role, "rental_agreement_created");
      // Send a contract document chat message with explorer links
      const explorerTx = EXPLORER_BASE_URL + "/tx/" + createTx;
      const explorerAgr = EXPLORER_BASE_URL + "/address/" + ESCROW_ADDRESS;
      await sysMsg(fullAddr, peerAddr, t("chat.agreement_on_chain") + "\n\n" + explorerTx, role, "contract_document");
      if (onContractComplete) onContractComplete({ txHash: createTx, agreementId });
    } catch(err) {
      setTxStatus(err.code === 4001 ? "Cancelled by user" : (err.message || "Transaction failed"));
      setSigning(false);
    }
  };

  const [peerDisplayName, setPeerDisplayName] = useState(null);
  useEffect(() => {
    if (!peerAddr || peerAddr.length < 42) return;
    getUser(peerAddr).then(d => {
      if (d?.display_name) setPeerDisplayName(d.display_name);
    }).catch(()=>{});
  }, [peerAddr]);
  const shortPeer = peerDisplayName || (peerAddr ? peerAddr.slice(0,6)+"…"+peerAddr.slice(-4) : "—");

  // Input visibility: landlord who sent viewing offer can't type until tenant writes
  const iAmViewingInitiator = viewingInitiator?.toLowerCase() === fullAddr?.toLowerCase();
  const peerHasWritten = msgs.some(m => m.fromAddr?.toLowerCase() === peerAddr?.toLowerCase());
  const canType = role === "tenant" || !iAmViewingInitiator || peerHasWritten || viewingStatus === "confirmed";

  // I am receiver of viewing = can accept
  const canAcceptViewing = viewingStatus === "pending" && !iAmViewingInitiator && viewingVrId;

  const iAmInitiator = contract && contract.fromAddr?.toLowerCase() === fullAddr?.toLowerCase();
  const bothSigned = contract?.status === "signed-by-both";
  const iProposed = contract?.type === "contract_sent" || iAmInitiator;
  const counterpartyAccepted = bothSigned;

  return (
    <div className="chat-wrap">
      {chatToast && <div onClick={() => setChatToast(null)} style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",zIndex:10000,background:"var(--color-danger-surface)",border:"1.5px solid var(--color-danger-border)",color:"var(--color-danger-dark)",borderRadius:12,padding:"10px 16px",fontSize:13,fontWeight:600,fontFamily:"var(--ff)",boxShadow:"0 8px 24px rgba(0,0,0,0.15)",cursor:"pointer",display:"flex",alignItems:"center",gap:8,maxWidth:320,animation:"fadein .2s ease"}}><span style={{fontSize:15}}>⚠</span>{chatToast}</div>}
      <div className="chat-hdr">
        <button className="chat-back" onClick={onBack}><IcBack/></button>
        <AvatarBox id={null} size={36} radius={50} walletAddr={peerAddr}/>
        <div>
          <div className="chat-nm">{shortPeer}</div>
          <div className="chat-st">● {role==="tenant"?t("role.landlord"):t("role.tenant")} · {t("misc.on_chain")}</div>
        </div>
        <div className="chat-tag">{t("deal.live")}</div>
      </div>
      <div className="chat-body" ref={bodyRef}>
        {msgs.length===0 && (
          <div className="sys-msg">{t("chat.start_conversation")}</div>
        )}
        {msgs.map((m, mi) => {
          const isMe = m.fromAddr?.toLowerCase() === fullAddr?.toLowerCase();
          const fmtTime = (ts) => new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
          const senderRole = isMe ? role : (role === "landlord" ? "tenant" : "landlord");

          // ── SYSTEM EVENTS ──
          if (m.type === "system") {
            const actor = m.actorAddress?.toLowerCase();
            const actorIsMe = actor === fullAddr?.toLowerCase();
            // Determine actual role: use actorRole if set, otherwise derive from current user's role
            const actualRole = m.actorRole || (actorIsMe ? role : (role === "landlord" ? "tenant" : "landlord"));
            const roleLabel = actualRole === "landlord" ? t("role.landlord") : t("role.tenant");
            const actorLabel = actorIsMe ? roleLabel + " (" + t("misc.you") + ")" : roleLabel;
            const actorColor = actualRole === "landlord" ? "#085041" : "#185fa5";
            // Event color by eventType
            const evColorMap = {
              dispute_opened:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              bond_posted:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              damage_claimed:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              bond_withdrawn:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              dispute_conceded:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              damage_accepted:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              damage_cancelled:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              contract_activated:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              contract_activated_ll:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              rent_paid:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              lease_ended:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              lease_terminated:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              rent_missed:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              renewal_vote:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              grace_granted:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              deal_archived:{bg:"#f1efef",border:"#d3d1c7",text:"#5f5e5a"},
              contract_document:{bg:"#f0f4ff",border:"var(--color-info-border)",text:"var(--color-info)"},
              rental_agreement_created:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              early_exit_requested:{bg:"#faeeda",border:"#fac775",text:"#633806"},
              viewing_requested:{bg:"#f1efef",border:"#d3d1c7",text:"#5f5e5a"},
              viewing_confirmed:{bg:"#f1efef",border:"#d3d1c7",text:"#5f5e5a"},
              viewing_declined:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              contract_cancelled:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              contract_proposed:{bg:"#f1efef",border:"#d3d1c7",text:"#5f5e5a"},
              contract_accepted:{bg:"#f1efef",border:"#d3d1c7",text:"#5f5e5a"},
              peer_suspended:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              peer_resumed:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              // Deposit events
              tenant_deposited:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              landlord_deposited:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              // Contract lifecycle
              contract_created:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              contract_signed:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              // Early termination
              early_term_requested:{bg:"#faeeda",border:"#fac775",text:"#633806"},
              early_term_accepted:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              early_term_rejected:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              // Damage claims & disputes
              damage_claimed:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              damage_accepted:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              damage_resolved:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              dispute_opened:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              dispute_conceded:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              dispute_resolved:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              // Bonds & frozen funds
              bond_posted:{bg:"#fcebeb",border:"#f7c1c1",text:"#791f1f"},
              bond_withdrawn:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              frozen_released:{bg:"#e1f5ee",border:"#9fe1cb",text:"#085041"},
              // Viewing
              viewing_offered:{bg:"#f1efef",border:"#d3d1c7",text:"#5f5e5a"},
            };
            const ec = evColorMap[m.eventType] || {bg:"#f1efef",border:"#d3d1c7",text:"#5f5e5a"};
            // Show separator before system events (if previous was not system)
            const prevIsSystem = mi > 0 && msgs[mi-1]?.type === "system";
            return (
              <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,margin:"8px 0"}}>
                {!prevIsSystem && <div style={{width:"100%",height:"0.5px",background:"#d3d1c7",margin:"4px 0 8px"}}/>}
                <div style={{width:"100%",borderRadius:10,padding:"8px 14px",fontSize:12,textAlign:"center",background:ec.bg,border:"0.5px solid "+ec.border,color:ec.text,lineHeight:1.4}}>
                  {(() => {
                    if (m.eventType) {
                      // Try i18n keys in order: chat.sys.X, chat.sys_X, chat.X — fallback to m.text
                      for (const prefix of ["chat.sys.", "chat.sys_", "chat."]) {
                        const key = prefix + m.eventType;
                        const val = t(key, m.params || {});
                        if (val !== key) return val;
                      }
                    }
                    return m.text;
                  })()}
                </div>
                <div style={{fontSize:11,color:"#888780",display:"flex",gap:5,alignItems:"center"}}>
                  <span style={{fontWeight:500,color:actorColor}}>{actorLabel}</span>
                  <span>·</span>
                  <span>{fmtTime(m.createdAt)}</span>
                </div>
              </div>
            );
          }

          // ── USER MESSAGES — role-colored bubbles ──
          return (
            <div key={m.id} style={{display:"flex",justifyContent:isMe?"flex-end":"flex-start",marginBottom:8}}>
              <div style={{maxWidth:"75%",display:"flex",flexDirection:"column",gap:3}}>
                <div style={{fontSize:11,fontWeight:500,color:isMe?(role==="landlord"?"#085041":"#185fa5"):(senderRole==="landlord"?"#085041":"#185fa5"),textAlign:isMe?"right":"left"}}>
                  {isMe ? (t("role."+role)+" ("+t("misc.you")+")") : t("role."+(senderRole || "tenant"))}
                </div>
                <div style={{padding:"9px 13px",fontSize:13,lineHeight:1.45,background:isMe?"#e6f1fb":"#e1f5ee",color:isMe?"#042c53":"#04342c",borderRadius:isMe?"16px 16px 4px 16px":"16px 16px 16px 4px",wordBreak:"break-word",minWidth:160}}>
                  {m.text}
                </div>
                <div style={{fontSize:11,color:"#888780",textAlign:isMe?"right":"left",marginTop:1}}>
                  {fmtTime(m.createdAt)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="chat-foot">
        {/* Contract busy banner — above input, always visible */}
        {!contract && (myContractBusy || peerContractBusy) && (
          <div style={{padding:"10px 14px",fontSize:12,color:"var(--color-warning)",textAlign:"center",background:"var(--color-warning-surface)",border:"1px solid var(--color-warning-border)",borderRadius:10,margin:"0 0 8px",lineHeight:1.5,fontWeight:600}}>
            {myContractBusy ? t("contract.you_busy") : t("contract.peer_busy")}
          </div>
        )}
        {suspended ? (
          <div style={{padding:"10px 14px",fontSize:12,color:"var(--color-danger)",textAlign:"center",background:"var(--color-danger-surface)",borderRadius:10,margin:"0 0 8px",fontWeight:600}}>
            {t("chat.you_suspended")}
          </div>
        ) : canType ? (
          <div className="chat-inp-row">
            <input className="chat-inp" placeholder={t("ph.type_message")} value={inp} onChange={e=>setInp(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send(inp)}/>
            <button className="chat-send" onClick={()=>send(inp)}>↑</button>
          </div>
        ) : (
          <div style={{padding:"10px 14px",fontSize:12,color:"var(--muted)",textAlign:"center",background:"var(--bg2)",borderRadius:10,margin:"0 0 8px"}}>
            {t("chat.waiting_peer_respond", {peer: shortPeer})}
          </div>
        )}
        <div className="chat-actions">
          {/* Wait for first poll before showing any action buttons */}
          {!chatLoaded ? null :
          /* STATE: Settled — show final message, no buttons */
          chatOnChainState === 8 ? (
            <div style={{textAlign:"center",fontSize:12,color:"var(--green)",fontWeight:700,padding:"8px 0"}}>
              {t("title.contract_settled")} — all funds distributed
            </div>
          ) : earlyTerm && earlyTerm.status==="proposed" && chatOnChainState !== null && chatOnChainState >= 3 && chatOnChainState <= 4 && earlyTerm.fromAddr?.toLowerCase() !== fullAddr?.toLowerCase() ? (
            <button className="ca-btn accent" onClick={()=>setShowEarlyForm(true)}
              style={{background:"var(--color-danger)",color:"white"}}>
              Open Terminate Early Form →
            </button>
          ) : !contract ? (
            /* STATE: Before contract — viewing + propose */
            (myContractBusy || peerContractBusy) ? null : (
            <React.Fragment>
              {canAcceptViewing && (
                <button className="ca-btn accent" onClick={acceptViewing} disabled={acceptingViewing}>
                  {acceptingViewing ? t("body.signing") : t("inbox.confirm_viewing")}
                </button>
              )}
              {(!viewingStatus || viewingStatus==="declined") && (
                <button className="ca-btn" onClick={sendViewing}>
                  {role==="tenant" ? t("chatpage.request_viewing") : t("chatpage.offer_viewing")}
                </button>
              )}
              {viewingStatus==="pending" && iAmViewingInitiator && (
                <button className="ca-btn" style={{opacity:.5,cursor:"default"}}>{t("chat.waiting_acceptance")}</button>
              )}
              <button className="ca-btn accent" onClick={proposeContract} disabled={proposing} style={proposing?{opacity:.5}:{}}>{proposing ? t("body.processing") : t("chat.propose_contract")}</button>
              {proposeError && <div style={{fontSize:12,color:"var(--color-danger-dark)",padding:"6px 0",textAlign:"center"}}>{proposeError}</div>}
            </React.Fragment>
            )
          ) : !counterpartyAccepted ? (
            /* STATE: Contract proposed, waiting */
            <React.Fragment>
              {iProposed && (
                <button className="ca-btn" style={{opacity:.5,cursor:"default"}}>{t("chat.waiting_acceptance")}</button>
              )}
              {!iProposed && contract.status !== "signed-by-both" && (
                <button className="ca-btn accent" onClick={acceptContract} disabled={accepting}>
                  {accepting ? t("body.processing") : t("chat.accept_contract")}
                </button>
              )}
              <button className="ca-btn" onClick={()=>setCancelConfirm(true)} style={{color:"var(--color-danger-dark)"}}>{t("contract.cancel_btn")}</button>
            </React.Fragment>
          ) : (
            /* STATE: Both accepted — go to agreement (hide if already deployed) */
            onGoToContract && !hasAgreement ? (
              <button className="ca-btn accent" onClick={()=>onGoToContract(peerAddr)}
                style={{background:"var(--green)",color:"var(--color-primary-text)"}}>
                {t("btn.go_dashboard")}
              </button>
            ) : null
          )
          }
        </div>
      </div>
      {/* Early Term Response Form in chat */}
      {showEarlyForm && earlyTerm && earlyTerm.type==="early_term_received" && earlyTerm.status==="proposed" && (
        <EarlyTermResponseForm
          earlyTerm={earlyTerm}
          agreementId={chatAgreementId}
          onClose={()=>setShowEarlyForm(false)}
          onRespond={async (etId, response, onChainFn)=>{
            setShowEarlyForm(false);
            // On-chain call via MetaMask
            try {
              await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] }).catch(e=>{
                if(e.code===4902) return window.ethereum.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });
              });
              // Get agreementId from server
              const acResp = { ok: true, json: () => getActiveContract(fullAddr) };
              const ac = await acResp.json();
              const agrId = ac?.agreementId;
              if (!agrId) { alert(t("err.no_agreement")); return; }

              if (onChainFn === "signMutualExit") {
                const data = SEL.signMutualExit + encUint(BigInt(agrId));
                const tx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, data);
                const rc = await waitReceipt(tx);
                if (!rc || rc.status === "0x0") throw new Error("signMutualExit reverted");
              } else if (onChainFn === "executeInitiatorAcceptsLoss") {
                const data = SEL.executeInitiatorAcceptsLoss + encUint(BigInt(agrId));
                const tx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, data);
                const rc = await waitReceipt(tx);
                if (!rc || rc.status === "0x0") throw new Error("executeInitiatorAcceptsLoss reverted");
              } else if (onChainFn === "waiveInitiatorLoss") {
                const data = SEL.waiveInitiatorLoss + encUint(BigInt(agrId));
                const tx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, data);
                const rc = await waitReceipt(tx);
                if (!rc || rc.status === "0x0") throw new Error("waiveInitiatorLoss reverted");
              } else if (onChainFn === "cancelDisputeExit") {
                const data = SEL.cancelDisputeExit + encUint(BigInt(agrId));
                const tx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, data);
                const rc = await waitReceipt(tx);
                if (!rc || rc.status === "0x0") throw new Error("cancelDisputeExit reverted");
              } else if (onChainFn === "concedeDispute") {
                const data = SEL.concedeDispute + encUint(BigInt(agrId));
                const tx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, data);
                const rc = await waitReceipt(tx);
                if (!rc || rc.status === "0x0") throw new Error("concedeDispute reverted");
              } else if (onChainFn === "acceptDisputeExit") {
                const data = SEL.acceptDisputeExit + encUint(BigInt(agrId));
                const tx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, data);
                const rc = await waitReceipt(tx);
                if (!rc || rc.status === "0x0") throw new Error("acceptDisputeExit reverted");
              } else if (onChainFn === "exitWithLoss") {
                // Sprint 4: atomic exit from Active state
                const data = SEL.exitWithLoss + encUint(BigInt(agrId));
                const tx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, data);
                const rc = await waitReceipt(tx);
                if (!rc || rc.status === "0x0") throw new Error("exitWithLoss reverted");
              } else if (onChainFn === "counterpartyContest") {
                // Sprint 4: no bond posting — just freezes existing deposits
                const ph = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(agrId)));
                const pw = (i) => parseInt(ph.slice(2+i*64, 2+(i+1)*64), 16);
                const pa = (i) => "0x" + ph.slice(2+i*64+24, 2+(i+1)*64);
                if (pw(10) !== 4) { alert(t("err.wrong_state_et")); return; }
                if (pw(28) !== 1) { alert(t("err.wrong_term_type")); return; }
                if (fullAddr.toLowerCase() === pa(29).toLowerCase()) { alert(t("err.initiator_cannot_contest")); return; }
                const data = SEL.counterpartyContest + encUint(BigInt(agrId));
                const tx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, data);
                const rc = await waitReceipt(tx);
                if (!rc || rc.status === "0x0") throw new Error("counterpartyContest reverted");
              }
            } catch(e) {
              if (e.code === 4001) return;
              alert(t("err.error") + ": " + (e.message || e));
              return;
            }
            // Update server after successful on-chain tx
            try {
              await apiPatch("/api/early-term/" + etId, { response, status: onChainFn === "counterpartyContest" ? "freeze" : "settled" });
              const chatMsgMap2 = {
                signMutualExit: {text:"Mutual exit signed. Deposits returned to each party.",ev:"bond_withdrawn"},
                exitWithLoss: {text:"Deposit transferred to counterparty. Contract settled.",ev:"damage_accepted"},
                counterpartyContest: {text:"Deposits frozen 60 days. Dispute opened.",ev:"dispute_opened"},
                cancelDisputeExit: {text:"Dispute cancelled. Initiator's deposit → counterparty as penalty.",ev:"bond_withdrawn"},
                concedeDispute: {text:"Dispute conceded. Counterparty claim accepted.",ev:"dispute_conceded"},
                acceptDisputeExit: {text:"Dispute claim accepted. Deposits transferred. Contract settled.",ev:"damage_accepted"},
              };
              const cm = chatMsgMap2[onChainFn];
              await sysMsg(fullAddr, peerAddr, cm?.text || ("Terminate Early response: " + response), role, cm?.ev);
              // Refresh on-chain state
              if (agrId) {
                try {
                  const hex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(agrId)));
                  setChatOnChainState(parseAgreement(hex).state);
                } catch(e){}
              }
            } catch(e){}
          }}
        />
      )}
      {/* Cancel contract confirm modal */}
      {cancelConfirm && (
        <div className="modal-ov" onClick={e => { if (e.target === e.currentTarget) setCancelConfirm(false); }}>
          <div className="modal" style={{maxWidth:340,padding:"28px 24px 20px",textAlign:"center"}}>
            <div className="modal-handle"/>
            <div style={{fontSize:15,fontWeight:600,color:"var(--color-text-primary)",marginBottom:20,lineHeight:1.4}}>{t("contract.cancel_confirm")}</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button onClick={() => setCancelConfirm(false)} style={{flex:1,padding:"10px 0",borderRadius:10,background:"var(--color-bg-secondary)",color:"var(--color-text-secondary)",border:"none",fontSize:14,fontWeight:600,cursor:"pointer"}}>{t("contract.cancel_no")}</button>
              <button onClick={cancelContract} style={{flex:1,padding:"10px 0",borderRadius:10,background:"var(--color-danger)",color:"white",border:"none",fontSize:14,fontWeight:600,cursor:"pointer"}}>{t("contract.cancel_yes")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RealChatPage;
