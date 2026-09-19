import React, { useState, useEffect, useRef, Fragment } from 'react';
import { t, getLang } from '../i18n/index.js';
import {
  ESCROW_ADDRESS, USDC_ADDRESS, ARC_TESTNET_CHAIN, USDC_DECIMALS,
  SEL, encAddr, encUint, parseAgreement, toDecAgreementId,
} from '../helpers.js';
import {
  getProvider, checkUsdcBalance, ethCallRpc,
  sysMsg, sendTxRaw, waitReceipt,
} from '../wallet.js';
import {
  logEventApi, getUser, getInbox, getStats, getArchivedContracts,
  respondViewingRequest, respondEarlyTerm, apiPost, apiPatch,
} from '../api/client.js';
import { getIdentityBadges } from '../services/identity.js';
import AvatarBox from './AvatarBox.jsx';
import AccountHeader from './AccountHeader.jsx';
import ActiveContractCard from './ActiveContractCard.jsx';
import { InboxBlock } from './InboxComponents.jsx';
import { PropDepositBlock } from './PropDepComponents.jsx';
import ContractDocuments from './ContractDocuments.jsx';
import LandlordListingsBlock from './LandlordListingsBlock.jsx';
import TenantIntentBlock from './TenantIntentBlock.jsx';
import SettingsNotifications from './SettingsNotifications.jsx';
import EarlyTermResponseForm from './EarlyTermResponseForm.jsx';
import RepScore from './ui/RepScore.jsx';
import { LEASE_TEXTS } from './ContractFlow.jsx';

function logEvent(type, payload = {}) {
  const log = { time: new Date().toISOString(), type, ...payload };
  console.log("[pi2pi-log]", log);
  logEventApi(log);
}

function Dashboard({ role, user, tab, onOpenChat, onUnreadChange, onViewListing, onStartContract, activeContract, viewingRequestedListing, onClearViewingRequest, inboxMsgs, onInboxMsgsChange, earlyTermState, onEarlyTermStateChange, onContractClose, chatOpenedListing, onClearChatOpened, onOpenRealChat, onStartRealContract, onCreateListing, onOpenMyListings, onOpenMyIntent, triggerWorldIDVerify, loadFinancialEvents }) {
  if (!user) return null;
  const isLL = (user?.role || role) === "landlord";
  // Tab filter: "inbox" | "deals" | "account" — each shows only its section
  const showAccount = tab === "account";
  const showDeals   = !tab || tab === "deals";
  const showInbox   = tab === "inbox";

  // Mark inbox as seen when user opens inbox tab
  useEffect(() => {
    if (showInbox && user?.addr && user.addr.length >= 42) {
      const now = Date.now();
      apiPost(`/api/inbox/${user.addr.toLowerCase()}/seen`).catch(() => {});
      lastSeenRef.current = now;
      setLastSeenInbox(now);
    }
  }, [showInbox]);

  // ── Inbox data ──────────────────────────────────────────────────────────────
  const isEndingContract = activeContract?.daysLeft !== undefined;
  const isEarlyContract  = activeContract?.earlyTermination === true;

  const INBOX_LL_DEFAULT = [
    { id:1, type:"viewing_req",  from:"Yuki Tanaka",  avatar:"yuki",  listingId:0, text:"Requesting to view your Da Nang City Apartment.", time:"2m ago",  read:false, status:null },
    { id:2, type:"viewing_req",  from:"Priya Shah",   avatar:"priya", listingId:0, text:"Requesting to view your Da Nang City Apartment.", time:"1h ago",  read:false, status:null },
    { id:3, type:"message",      from:"Marco Ricci",  avatar:"marco", listingId:0, text:"Hi, is the apartment still available for 6 months?", time:"3h ago", read:true, status:null },
    { id:4, type:"application",  from:"Priya Shah",   avatar:"priya", listingId:0, text:"Submitted a rental application.", time:"5h ago", read:true, status:null },
  ];
  const INBOX_LL_ENDING = [
    { id:1, type:"message", from:"Priya Shah", avatar:"priya", listingId:2, text:"Hi Marco, the lease is ending soon — should we start a new agreement or are you moving out?", time:"3h ago", read:false, status:null },
  ];
  const INBOX_TN_DEFAULT = [
    { id:1, type:"suggestion", from:"Alex Chen", avatar:"alex", listingId:0, text:"Da Nang City Apartment · 500 USDC/mo · 1BR · 55m²", time:"5m ago", read:false, status:null },
  ];
  const INBOX_TN_ENDING = [
    { id:1, type:"message", from:"Marco Ricci", avatar:"marco", listingId:2, text:"Hello! Just a reminder that our contract ends in 7 days. Please check the checkout section.", time:"1h ago", read:false, status:null },
  ];

  // Ledger (LL) — sees incoming early termination request FROM tenant
  const INBOX_LL_EARLY = [
    { id:1, type:"early_term_request", from:"Yuki Tanaka", avatar:"yuki", listingId:1,
      variant:"green",
      reason:"family_emergency",
      reasonText:"My mother passed away and I need to return home urgently. I am deeply sorry. I understand I am responsible for early termination and accept the penalty.",
      offer:"compensate",
      offerAmt:420,
      propDepAmt:840,
      time:"2h ago", read:false, status:null,
      text:"Requesting early termination — family emergency. Offering Commitment Deposit as compensation." },
    { id:2, type:"early_term_request", from:"Yuki Tanaka", avatar:"yuki", listingId:1,
      variant:"red",
      reason:"uninhabitable",
      reasonText:"Black mold has been spreading across the bedroom and bathroom walls for over three weeks. I reported it twice with no response. The apartment is a health hazard and I am unable to continue living here. This is a landlord obligation breach under the lease agreement.",
      offer:"uninhabitable",
      propDepAmt:840,
      hostingDepAmt:420,
      time:"1h ago", read:false, status:null,
      text:"Forced to vacate — uninhabitable conditions. Landlord in breach of obligations." },
  ];
  // Rainbow (TN) — sees TWO letters from landlord: green (LL fault) + red (TN fault)
  const INBOX_TN_EARLY = [
    { id:1, type:"early_term_request", from:"Nino Beridze", avatar:"nino", listingId:1,
      variant:"green", // LL self-initiated, accepts responsibility
      reason:"renovation",
      reasonText:"The building requires urgent structural renovation — we have no choice but to vacate all units. I sincerely apologize. I will transfer my full Hosting Deposit to you as compensation.",
      offer:"compensate",
      offerAmt:420,
      time:"2h ago", read:false, status:null,
      text:"Requesting early termination — urgent renovation. Offering Hosting Deposit as compensation." },
    { id:2, type:"early_term_request", from:"Nino Beridze", avatar:"nino", listingId:1,
      variant:"red",
      reason:"violation",
      reasonText:"Multiple noise complaints from neighbors have been filed against you. You are in breach of the house rules. I am initiating early termination due to your violations.",
      offer:"violation",
      propDepAmt:840,
      demands:[
        { id:"dep_only",        label:"Commitment Deposit only", amt:420,  desc:"Your Commitment Deposit (420 USDC) transfers to me as penalty for violations." },
        { id:"dep_and_propdep", label:"Commitment Deposit + 60% Property Deposit", amt:924, desc:"Commitment Deposit (420) + 60% of Property Security Deposit (504) = 924 USDC" },
      ],
      selectedDemand: null,
      time:"1h ago", read:false, status:null,
      text:"Termination notice — house rules violation. Review landlord demands." },
  ];

  // LL with active (non-ending, non-early) contract — only sees messages from current tenant
  const INBOX_LL_ACTIVE = [
    { id:1, type:"message", from:"Yuki Tanaka", avatar:"yuki", listingId:activeContract?.listing?.id||0,
      text:"Hi! Just wanted to confirm — the rent payment is scheduled for next month. All good on my end.",
      time:"1h ago", read:false, status:null },
  ];
  // TN with active (non-ending, non-early) contract — message from landlord
  const INBOX_TN_ACTIVE = [
    { id:1, type:"message", from:activeContract?.listing?.host||"Landlord", avatar:activeContract?.listing?.hostAvatar||"alex", listingId:activeContract?.listing?.id||0,
      text:"Hello! Just a reminder that rent is due next month. Feel free to reach out if you have any questions.",
      time:"2h ago", read:false, status:null },
  ];

  const isActiveContract = !!activeContract && !isEndingContract && !isEarlyContract;
  const INBOX = isLL
    ? (isEarlyContract ? INBOX_LL_EARLY : isEndingContract ? INBOX_LL_ENDING : isActiveContract ? INBOX_LL_ACTIVE : INBOX_LL_DEFAULT)
    : (isEarlyContract ? INBOX_TN_EARLY : isEndingContract ? INBOX_TN_ENDING : isActiveContract ? INBOX_TN_ACTIVE : INBOX_TN_DEFAULT);
  const [msgs, setMsgsLocal] = useState(inboxMsgs || INBOX);
  const setMsgs = (updater) => {
    setMsgsLocal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      onInboxMsgsChange?.(next);
      return next;
    });
  };
  const [expanded, setExpanded] = useState(null);
  const [realInbox, setRealInbox] = useState([]);
  const [archivedContracts, setArchivedContracts] = useState([]);
  const [showArchive, setShowArchive] = useState(false);
  const [showDeleteContract, setShowDeleteContract] = useState(false);
  const [peerNames, setPeerNames] = useState({}); // addr → display_name
  const [lastSeenInbox, setLastSeenInbox] = useState(0);
  const lastSeenRef = useRef(0);
  // Unread = actionable items (pending viewings, unread messages, pending contracts/ET)
  const realUnread = realInbox.filter(m =>
    (m.type==="viewing_request_received" && m.status==="pending") ||
    (m.type==="message_received" && m.createdAt && new Date(m.createdAt).getTime() > lastSeenRef.current) ||
    ((m.type==="contract_received") && m.status !== "cancelled" && m.status !== "rejected" && m.status !== "signed-by-both") ||
    (m.type==="early_term_received" && m.status==="proposed")
  ).length;
  const unread = realUnread;

  // Poll server for real inbox items
  useEffect(() => {
    if (!user?.addr) return;
    let cancelled = false;
    let timer = null;
    let pollFn = null;
    async function start() {
      let addr = user.addr;
      if (addr.includes("…") || addr.length < 42) {
        try {
          const accs = await (getProvider()||window.ethereum)?.request({ method: "eth_accounts" });
          if (accs?.[0]) addr = accs[0];
          else return;
        } catch { return; }
      }
      const poll = () => {
        if (cancelled) return;
        getArchivedContracts(addr).then(a => { if (!cancelled) setArchivedContracts(a||[]); }).catch(()=>{});
        getInbox(addr).then(resp => {
          if (cancelled) return;
          const items = resp?.items || resp || [];
          setRealInbox(Array.isArray(items) ? items : []);
          if (resp?.lastSeenInbox) { const v = Math.max(lastSeenRef.current, resp.lastSeenInbox); lastSeenRef.current = v; setLastSeenInbox(v); }
          // Load peer display names
          const myA = addr.toLowerCase();
          const peerAddrs = new Set();
          (items||[]).forEach(i => { if(i.fromAddr && i.fromAddr !== myA) peerAddrs.add(i.fromAddr); if(i.toAddr && i.toAddr !== myA) peerAddrs.add(i.toAddr); });
          for (const pa of peerAddrs) {
            getUser(pa).then(d => {
              if (d?.display_name) setPeerNames(prev => ({...prev, [pa]: d.display_name}));
            }).catch(()=>{});
          }
          const cp = (items||[]).find(i => (i.type==="contract_received"||i.type==="contract_sent") && i.status !== "rejected" && i.status !== "cancelled");
          setActiveProposal(cp || null);
        }).catch(()=>{});
      };
      poll();
      pollFn = poll;
      timer = setInterval(poll, 5000);
    }
    start();
    const onVisible = () => { if (document.visibilityState === "visible" && pollFn) pollFn(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; if(timer) clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [user?.addr]);

  // Respond to real viewing requests via server
  const [respondingVr, setRespondingVr] = useState(null); // vrId being signed
  const [showEarlyTermResponse, setShowEarlyTermResponse] = useState(null);
  const [dashOnChainState, setDashOnChainState] = useState(null); // on-chain state for inbox
  const [repStats, setRepStats] = useState({ viewings: 0, rentals: 0 });
  const [activeProposal, setActiveProposal] = useState(null); // contract proposal from server

  // Force refresh on-chain state (called after respondEarlyTerm)
  const refreshDashState = async () => {
    if (!activeContract?.agreementId) return;
    try {
      const hex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(activeContract.agreementId)));
      setDashOnChainState(parseAgreement(hex).state);
    } catch(e){}
  };

  // Read on-chain state for inbox
  useEffect(() => {
    if (!activeContract?.agreementId) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const hex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(activeContract.agreementId)));
        if (!cancelled) setDashOnChainState(parseAgreement(hex).state);
      } catch(e){}
    };
    poll();
    const t = setInterval(poll, 8000);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled=true; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [activeContract?.agreementId]);

  // Load reputation stats from server
  useEffect(() => {
    if (!user?.addr) return;
    let cancelled = false;
    let timer = null;
    let cleanupVis = null;
    (async () => {
      let addr = user.addr;
      if (addr.includes("…") || addr.length < 42) {
        try { const accs = await window.ethereum?.request({method:"eth_accounts"}); if(accs?.[0]) addr=accs[0]; else return; } catch{ return; }
      }
      const poll = () => {
        if (cancelled) return;
        getStats(addr).then(s=>{ if(!cancelled) setRepStats(s); }).catch(()=>{});
      };
      poll();
      timer = setInterval(poll, 5000);
      const onV = () => { if (document.visibilityState === "visible") poll(); };
      document.addEventListener("visibilitychange", onV);
      cleanupVis = onV;
    })();
    return () => { cancelled=true; if(timer) clearInterval(timer); if(cleanupVis) document.removeEventListener("visibilitychange", cleanupVis); };
  }, [user?.addr]);

  const respondReal = async (vrId, status) => {
    if (status === "declined") {
      // Decline — no signature needed
      try {
        await respondViewingRequest(vrId, { status: "declined" });
      } catch(e) {}
    } else if (status === "confirmed") {
      // Accept — requires MetaMask personal_sign
      if (!window.ethereum) return;
      setRespondingVr(vrId);
      try {
        let addr = user?.addr;
        if (!addr || addr.includes("…") || addr.length < 42) {
          const accs = await (getProvider()||window.ethereum)?.request({ method: "eth_accounts" });
          addr = accs?.[0];
        }
        if (!addr) { setRespondingVr(null); return; }
        // Sign viewing confirmation
        const payload = JSON.stringify({ action: "confirm_viewing", vrId, addr, ts: Date.now() });
        const signature = await getProvider().request({
          method: "personal_sign",
          params: [payload, addr]
        });
        logEvent("UI_ACTION", { user: addr, action: "viewing_accepted_inbox", data: { vrId, signature: signature.slice(0,20)+"..." } });
        // Send to server with signature
        await respondViewingRequest(vrId, { status: "confirmed", signature, signedBy: addr });
        // Send chat message to peer
        const vrItem = realInbox.find(i=>i.vrId===vrId);
        const peer = vrItem ? (vrItem.fromAddr===addr.toLowerCase()?vrItem.toAddr:vrItem.fromAddr) : null;
        // server auto-creates system message for viewing confirmed
      } catch(e) {
        // User rejected signature — don't update
        setRespondingVr(null);
        return;
      }
      setRespondingVr(null);
    }
    // Refresh inbox
    try {
      const addr = user?.addr?.length >= 42 ? user.addr : await window.ethereum?.request({ method: "eth_accounts" }).then(a=>a?.[0]);
      if (addr) {
        const resp = await getInbox(addr);
        const items = resp?.items || resp || [];
        setRealInbox(items || []);
      }
    } catch(e) {}
  };

  // Early term response — on-chain + server
  const respondEarlyTerm = async (etId, response, onChainFn) => {
    const agrId = activeContract?.agreementId;
    if (!agrId) { alert(t("err.no_agreement")); return; }
    let myAddr = null;
    try { const accs = await (getProvider()||window.ethereum)?.request({method:"eth_accounts"}); myAddr = accs?.[0]; } catch{}
    if (!myAddr) { alert(t("err.wallet_not_connected")); return; }
    try {
      await getProvider()?.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] }).catch(e=>{
        if(e.code===4902) return getProvider()?.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });
      });
      // Check agreement state before calling
      const stateHex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(agrId)));
      const stateVal = parseInt(stateHex.slice(2 + 10*64, 2 + 11*64), 16);
      const stateNames = ["Created","AwaitingLandlordDep","AwaitingTenantDep","Active","EarlyTermProposed","CheckoutProposed","DamageClaimed","DisputeOpen","Settled","LeaseEnded"];
      // Each function has specific state requirements
      const stateMap = {
        signMutualExit: [4],
        exitWithLoss: [3], // Sprint 4: from Active state directly
        counterpartyContest: [4],
        postEarlyTermBond: [4, 6],
        cancelDisputeExit: [7],
        concedeDispute: [7],
        acceptDisputeExit: [7],
      };
      const expectedState = stateMap[onChainFn] || [4];
      if (!expectedState.includes(stateVal)) {
        alert(t("err.cannot_respond", {state: stateNames[stateVal] || stateVal, expected: expectedState.map(s=>stateNames[s]).join(" or ")}));
        return;
      }
      if (onChainFn === "signMutualExit") {
        const data = SEL.signMutualExit + encUint(BigInt(agrId));
        const tx = await sendTxRaw(myAddr, ESCROW_ADDRESS, data);
        const rc = await waitReceipt(tx);
        if (!rc || rc.status === "0x0") throw new Error("signMutualExit reverted");
      } else if (onChainFn === "exitWithLoss") {
        // Sprint 4: atomic exit with loss — single tx
        const data = SEL.exitWithLoss + encUint(BigInt(agrId));
        const tx = await sendTxRaw(myAddr, ESCROW_ADDRESS, data);
        const rc = await waitReceipt(tx);
        if (!rc || rc.status === "0x0") throw new Error("exitWithLoss reverted");
      } else if (onChainFn === "counterpartyContest") {
        // Sign contest intent
        const contestSigMsg = `pi2pi: Contest early termination ${agrId}`;
        const contestSig = await (getProvider()||window.ethereum).request({ method: "personal_sign", params: [contestSigMsg, myAddr] });
        logEvent("UI_ACTION", { user: myAddr, action: "counterparty_contest", contractId: agrId, data: { signature: contestSig.slice(0,20)+"..." } });
        const preHex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(agrId)));
        const preWord = (i) => parseInt(preHex.slice(2+i*64, 2+(i+1)*64), 16);
        const preAddr = (i) => "0x" + preHex.slice(2+i*64+24, 2+(i+1)*64);
        const preState = preWord(10), preTT = preWord(28), preInit = preAddr(29).toLowerCase();
        if (preState !== 4) { alert(t("err.wrong_state_et")); return; }
        if (preTT !== 1) { alert(t("err.wrong_term_type")); return; }
        if (myAddr.toLowerCase() === preInit) { alert(t("err.initiator_cannot_contest")); return; }
        // No approve needed — no bond posting (Sprint 4)
        const data = SEL.counterpartyContest + encUint(BigInt(agrId));
        const tx = await sendTxRaw(myAddr, ESCROW_ADDRESS, data);
        const rc = await waitReceipt(tx);
        if (!rc || rc.status === "0x0") throw new Error("counterpartyContest reverted");
      } else if (onChainFn === "cancelDisputeExit") {
        const data = SEL.cancelDisputeExit + encUint(BigInt(agrId));
        const tx = await sendTxRaw(myAddr, ESCROW_ADDRESS, data);
        const rc = await waitReceipt(tx);
        if (!rc || rc.status === "0x0") throw new Error("cancelDisputeExit reverted");
      } else if (onChainFn === "concedeDispute") {
        const data = SEL.concedeDispute + encUint(BigInt(agrId));
        const tx = await sendTxRaw(myAddr, ESCROW_ADDRESS, data);
        const rc = await waitReceipt(tx);
        if (!rc || rc.status === "0x0") throw new Error("concedeDispute reverted");
      } else if (onChainFn === "acceptDisputeExit") {
        const data = SEL.acceptDisputeExit + encUint(BigInt(agrId));
        const tx = await sendTxRaw(myAddr, ESCROW_ADDRESS, data);
        const rc = await waitReceipt(tx);
        if (!rc || rc.status === "0x0") throw new Error("acceptDisputeExit reverted");
      } else if (onChainFn === "acceptInitiatorLoss") {
        const data = SEL.acceptInitiatorLoss + encUint(BigInt(agrId));
        const tx = await sendTxRaw(myAddr, ESCROW_ADDRESS, data);
        const rc = await waitReceipt(tx);
        if (!rc || rc.status === "0x0") throw new Error("acceptInitiatorLoss reverted");
      } else if (onChainFn === "waiveInitiatorLoss") {
        const data = SEL.waiveInitiatorLoss + encUint(BigInt(agrId));
        const tx = await sendTxRaw(myAddr, ESCROW_ADDRESS, data);
        const rc = await waitReceipt(tx);
        if (!rc || rc.status === "0x0") throw new Error("waiveInitiatorLoss reverted");
      } else if (onChainFn === "postEarlyTermBond") {
        const rentMR = Number(activeContract?.onChainRent || activeContract?.listing?.price || 2);
        if (!await checkUsdcBalance(rentMR, "early termination dispute (1× monthly rent)")) return;
        // Approve bond first
        const rentWei = BigInt(rentMR) * BigInt(10 ** USDC_DECIMALS);
        const approveData = SEL.approve + encAddr(ESCROW_ADDRESS) + encUint(rentWei);
        const approveTx = await sendTxRaw(myAddr, USDC_ADDRESS, approveData);
        const approveRc = await waitReceipt(approveTx);
        if (!approveRc || approveRc.status === "0x0") throw new Error("USDC approve reverted");
        const data = SEL.postEarlyTermBond + encUint(BigInt(agrId));
        const tx = await sendTxRaw(myAddr, ESCROW_ADDRESS, data);
        const rc = await waitReceipt(tx);
        if (!rc || rc.status === "0x0") throw new Error("postEarlyTermBond reverted");
      }
      // Send chat message for the action
      const peerAddr = activeContract?.listing?.contract || activeContract?.peerAddr || "";
      const chatMsgMap = {
        signMutualExit: {text:t("chat.mutual_exit_signed"),ev:"bond_withdrawn"},
        exitWithLoss: {text:t("chat.deposit_transferred"),ev:"damage_accepted"},
        counterpartyContest: {text:t("chat.deposits_frozen"),ev:"dispute_opened"},
        cancelDisputeExit: {text:t("chat.dispute_cancelled"),ev:"bond_withdrawn"},
        concedeDispute: {text:t("chat.dispute_conceded"),ev:"dispute_conceded"},
        acceptDisputeExit: {text:t("chat.dispute_accepted"),ev:"damage_accepted"},
        postEarlyTermBond: {text:t("chat.bond_posted"),ev:"bond_posted"},
      };
      if (peerAddr) {
        let cm = chatMsgMap[onChainFn];
        // Differentiate refuse_freeze vs counter_claim — same on-chain function, different legal position
        if (onChainFn === "counterpartyContest" && response === "refuse_freeze") {
          cm = {text:t("chat.refuse_freeze"), ev:"dispute_opened"};
        } else if (onChainFn === "counterpartyContest" && response === "counter_claim") {
          cm = {text:t("chat.counter_claim"), ev:"dispute_opened"};
        }
        if (cm) {
          await sysMsg(myAddr, peerAddr, cm.text, isLL?"landlord":"tenant", cm.ev);
        }
      }
      // Update server (use apiPatch directly — local respondEarlyTerm shadows the import)
      await apiPatch("/api/early-term/" + etId, { response, status: onChainFn === "postEarlyTermBond" || onChainFn === "counterpartyContest" ? "freeze" : "settled" });
      // Refresh on-chain state immediately
      await refreshDashState();
    } catch(e) {
      if (e.code === 4001) return;
      alert(t("err.error") + ": " + (e.message || e));
    }
  };

  // Inject chat_active into inbox when TN opened chat with a landlord
  useEffect(() => {
    if (!isLL && chatOpenedListing) {
      const l = chatOpenedListing;
      // Don't add if already have chat_active for this listing
      setMsgs(ms => {
        if (ms.some(m => m.type === "chat_active" && m.listingId === l.id)) return ms;
        const newMsg = {
          id: Date.now(),
          type: "chat_active",
          from: l.host || "Landlord",
          avatar: l.hostAvatar || "alex",
          listingId: l.id,
          text: `Active chat with ${l.host} · ${l.title}`,
          time: "just now",
          read: false,
          status: null,
        };
        return [newMsg, ...ms];
      });
      setExpanded(null);
      onClearChatOpened?.();
    }
  }, [chatOpenedListing]);

  // Inject viewing request confirmation into inbox when TN requested a viewing
  useEffect(() => {
    if (!isLL && viewingRequestedListing) {
      const l = viewingRequestedListing;
      const newMsg = {
        id: Date.now(),
        type: "viewing_sent",
        from: l.host || "Landlord",
        avatar: l.hostAvatar || "alex",
        listingId: l.id,
        text: `Viewing requested for ${l.title} · ${l.price.toLocaleString()} USDC/mo`,
        time: "just now",
        read: false,
        status: null,
      };
      setMsgs(ms => [newMsg, ...ms.filter(m => m.type !== "viewing_sent")]);
      setExpanded(newMsg.id);
      onClearViewingRequest?.();
    }
  }, [viewingRequestedListing]);

  useEffect(() => { onUnreadChange?.(unread); }, [unread]);

  const open = (id) => {
    setExpanded(ex => ex===id ? null : id);
    setMsgs(ms => ms.map(m => m.id===id ? {...m, read:true} : m));
  };
  const respond = (id, status, replyMsg) => setMsgs(ms => ms.map(m => m.id===id ? {...m, status, read:true, replyMsg:replyMsg||undefined} : m));
  const markAllRead = () => setMsgs(ms => ms.map(m => ({...m, read:true})));

  // Labels & icons per type
  const META = {
    viewing_req:       { icon:"", label:"Viewing Request",         color:"#0ea5e9" },
    viewing_sent:      { icon:"", label:"Viewing Requested",        color:"var(--color-primary)" },
    chat_active:       { icon:"", label:"Active Chat",               color:"var(--teal)" },
    suggestion:        { icon:"", label:"Property Suggestion",      color:"var(--color-info)" },
    message:           { icon:"", label:"Message",                  color:"var(--accent)" },
    application:       { icon:"", label:"Rental Application",       color:"var(--color-primary)" },
    early_term_request:{ icon:"", label:"Early Termination Request", color:"var(--color-danger)" },
  };

  // Landlord state
  const [email, setEmail] = useState("");
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const [editMode, setEditMode] = useState(false);
  // Load listing from localStorage (saved during Proof of Intent)
  const savedUser = (() => {
    const fullAddr = user?.addr;
    if (!fullAddr) return null;
    // Try full address first, then find by scanning keys
    try {
      let addr = fullAddr;
      if (addr.includes("…") || addr.length < 42) {
        // short addr — scan localStorage for matching key
        const keys = Object.keys(localStorage).filter(k => k.startsWith("pi2pi_user_"));
        if (keys.length) addr = keys[0].replace("pi2pi_user_", "");
        else return null;
      }
      const raw = localStorage.getItem("pi2pi_user_" + addr.toLowerCase());
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  })();
  const savedListing = savedUser?.listing || {};
  const [editsLeft, setEditsLeft] = useState(3);
  const [listing, setListing] = useState({
    city: savedListing.city || "Buenos Aires",
    propertyType: savedListing.propertyType || "Studio",
    rent: savedListing.rent || "2",
    date: savedListing.date || "",
    duration: savedListing.duration || "6"
  });
  const [draft, setDraft] = useState({...listing});

  const [displayName, setDisplayName] = useState(user?.name||"");

  const saveEdit = () => {
    setListing({...draft});
    setEditsLeft(n=>n-1);
    setEditMode(false);
  };

  // listing status: "active" | "just_rented" | "paused" | "deleted"
  const contractActive = !!activeContract;
  const [listingStatus, setListingStatus] = useState(contractActive ? "just_rented" : "active");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [listingDeleted, setListingDeleted] = useState(false);
  const [secondListing, setSecondListing] = useState(false);
  const hostingDepReq = Math.round((Number(listing.rent) || 500) * 1);
  const canAddSecond = !secondListing;

  if (isLL) return (
    <div className="dash">
      {/* A3: Wallet operational state indicator */}
      {!getProvider() && <div style={{background:"rgba(234,179,8,0.1)",border:"1px solid rgba(234,179,8,0.3)",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12,color:"#eab308"}}>{t("wallet.disconnected_banner")}</div>}
      {showAccount && <AccountHeader user={user} role={role} displayName={displayName} setDisplayName={setDisplayName} repStats={repStats} getIdentityBadges={getIdentityBadges} triggerWorldIDVerify={triggerWorldIDVerify}/>}
      {showAccount && <SettingsNotifications user={user}/>}

      {/* M7: real listings status — banner if 0 active, compact summary if 1+ */}
      {showDeals && !contractActive && <LandlordListingsBlock user={user} onCreate={onCreateListing} onOpenMyListings={onOpenMyListings}/>}

      {/* My listing + second listing — REMOVED from Dashboard (belongs only to /my-listings page) */}
      {false && showDeals && !contractActive && (<React.Fragment>
      <div className="sc-card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div className="sc-title" style={{marginBottom:0}}>My listing</div>
          {!editMode && (
            <div style={{position:"relative",display:"inline-block"}} className="tooltip-wrap">
              <button
                onClick={()=>editsLeft>0&&setEditMode(true)}
                style={{fontSize:11,fontWeight:700,color:editsLeft>0?"var(--teal)":"var(--dim)",background:"none",border:`1.5px solid ${editsLeft>0?"var(--teal)":"var(--border)"}`,borderRadius:8,padding:"4px 10px",cursor:editsLeft>0?"pointer":"default",fontFamily:"var(--ff)"}}
              >
                Edit <span style={{background:editsLeft>0?"var(--teal)":"var(--border)",color:"white",borderRadius:10,padding:"1px 6px",fontSize:10,marginLeft:3}}>{editsLeft}</span>
              </button>
              <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:"var(--color-bg-card)",color:"white",borderRadius:10,padding:"10px 13px",fontSize:11,lineHeight:1.7,width:220,zIndex:50,pointerEvents:"none",opacity:0}} className="tooltip-box">
                <strong>Max 3 edits per listing</strong><br/>
                To prevent price manipulation after tenants have shown interest, listings can only be edited <strong>3 times</strong> total.<br/>
                <span style={{color:"#f0c844"}}>Remaining: {editsLeft} / 3</span>
              </div>
            </div>
          )}
        </div>

        {listingDeleted ? (
          <div style={{textAlign:"center",padding:"20px 0",color:"var(--muted)"}}>
            <div style={{fontSize:32,marginBottom:8}}></div>
            <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{t("body.listing_deleted")}</div>
            <div style={{fontSize:12,marginBottom:16}}>Your listing has been removed from the platform.</div>
            {canAddSecond && (
              <button className="btn-p" onClick={()=>{setListingDeleted(false);setListingStatus("active");}}>
                + Create new listing
              </button>
            )}
          </div>
        ) : editMode ? <React.Fragment>
          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
            <div>
              <div className="field-label">{t("field.city")}</div>
              <Dropdown value={draft.city} placeholder="Select city"
                options={[{value:"Tbilisi",label:"Tbilisi"},{value:"Batumi",label:"Batumi"},{value:"Da Nang",label:"Da Nang"},{value:"Ho Chi Minh City",label:"Ho Chi Minh City"},{value:"Nha Trang",label:"Nha Trang"},{value:"Hanoi",label:"Hanoi"},{value:"Buenos Aires",label:"Buenos Aires"},{value:"São Paulo",label:"São Paulo"},{value:"Bangkok",label:"Bangkok"},{value:"Samui",label:"Samui"},{value:"Phuket",label:"Phuket"}]}
                onChange={v=>setDraft(d=>({...d,city:v}))}/>
            </div>
            <div>
              <div className="field-label">{t("field.property_type")}</div>
              <Dropdown value={draft.propertyType} placeholder="Select type"
                options={[{value:"Studio",label:"Studio"},{value:"1 Bedroom Apartment",label:"1 Bedroom Apartment"},{value:"2 Bedroom Apartment",label:"2 Bedroom Apartment"},{value:"3 Bedroom Apartment",label:"3 Bedroom Apartment"}]}
                onChange={v=>setDraft(d=>({...d,propertyType:v}))}/>
            </div>
            <div>
              <div className="field-label">{t("field.monthly_rent")}</div>
              <input className="field-inp" type="number" min="2" step="1" value={draft.rent} onChange={e=>setDraft(d=>({...d,rent:e.target.value}))}/>
            </div>
            <div>
              <div className="field-label">{t("field.available_from_short")}</div>
              <input className="field-inp" type="date" min={new Date().toISOString().split("T")[0]} value={draft.date} onChange={e=>setDraft(d=>({...d,date:e.target.value}))}/>
            </div>
            <div>
              <div className="field-label">{t("field.lease_duration")}</div>
              <Dropdown value={String(draft.duration)} placeholder="Select duration"
                options={[6,7,8,9,10,11,12].map(m=>({value:String(m),label:`${m} months`}))}
                onChange={v=>setDraft(d=>({...d,duration:v}))}/>
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn-p" style={{flex:1}} onClick={saveEdit}>{t("btn.save_changes")}</button>
            <button onClick={()=>{setDraft({...listing});setEditMode(false);}}
              style={{flex:1,padding:"12px",background:"none",border:"1.5px solid var(--border)",borderRadius:12,fontFamily:"var(--ff)",fontSize:13,cursor:"pointer"}}>
              Cancel
            </button>
          </div>
        </React.Fragment> : <React.Fragment>
          {[["City",listing.city],["Type",listing.propertyType],["Rent",`${listing.rent} USDC/mo`],["Available",listing.date||"—"],["Duration",`${listing.duration} months`]].map(([k,v])=>(
            <div key={k} className="sc-row"><span className="sc-k">{k}</span><span className="sc-v">{v}</span></div>
          ))}

          {/* Status indicator */}
          <div style={{marginTop:10,padding:"10px 0 0",borderTop:"1px solid var(--border)"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:
                listingStatus==="active"?"var(--green)":
                listingStatus==="just_rented"?"var(--color-warning)":
                listingStatus==="paused"?"var(--color-text-dim)":"var(--color-text-dim)"}}/>
              <span style={{fontSize:11,fontWeight:700,color:
                listingStatus==="active"?"var(--green)":
                listingStatus==="just_rented"?"var(--color-warning)":
                listingStatus==="paused"?"var(--color-text-dim)":"var(--color-text-dim)"}}>
                {listingStatus==="active"     ? "Active — visible in search" :
                 listingStatus==="just_rented"? "Just Rented — visible 3 days, then hidden" :
                 listingStatus==="paused"     ? "Paused — hidden from search" : ""}
              </span>
            </div>

            {/* Action buttons */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {listingStatus==="paused" ? (
                <button onClick={()=>setListingStatus("active")}
                  style={{padding:"8px 14px",borderRadius:9,background:"var(--accent)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  ▶ Resume listing
                </button>
              ) : (
                <button onClick={()=>setListingStatus("paused")}
                  style={{padding:"8px 14px",borderRadius:9,background:"var(--color-bg-card)",border:"1.5px solid var(--color-text-dim)",color:"var(--color-text-dim)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  ⏸ Pause listing
                </button>
              )}
              {!contractActive && !showDeleteConfirm && (
                <button onClick={()=>setShowDeleteConfirm(true)}
                  style={{padding:"8px 14px",borderRadius:9,background:"var(--color-bg-card)",border:"1.5px solid var(--color-danger-border)",color:"var(--color-danger)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  Delete listing
                </button>
              )}
              {contractActive && (
                <div style={{fontSize:11,color:"var(--muted)",alignSelf:"center"}}>
                  Delete available after contract ends
                </div>
              )}
            </div>

            {/* Delete confirm */}
            {showDeleteConfirm && (
              <div style={{marginTop:12,background:"var(--color-danger-surface)",border:"1.5px solid var(--color-danger-border)",borderRadius:10,padding:"12px"}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--color-danger)",marginBottom:6}}>Delete this listing?</div>
                <div style={{fontSize:11,color:"var(--color-danger-dark)",marginBottom:12,lineHeight:1.6}}>
                  This will permanently remove your listing. Your RepScore and history are preserved. You can create a new listing anytime.
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{setListingDeleted(true);setShowDeleteConfirm(false);}}
                    style={{flex:1,padding:"9px",borderRadius:9,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                    Yes, delete
                  </button>
                  <button onClick={()=>setShowDeleteConfirm(false)}
                    style={{flex:1,padding:"9px",borderRadius:9,background:"var(--color-bg-card)",border:"1.5px solid var(--border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </React.Fragment>}
      </div>

      {/* Add second listing banner */}
      {canAddSecond && !listingDeleted && (
        <div style={{background:"linear-gradient(135deg,var(--color-primary-surface),var(--color-primary-surface))",border:"1.5px solid var(--color-primary-border)",borderRadius:14,padding:"14px 16px",marginBottom:14}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--color-primary)",marginBottom:4}}>Your wallet can support a second listing</div>
          <div style={{fontSize:11,color:"var(--color-primary)",marginBottom:12,lineHeight:1.6}}>
            Hosting Deposit required: <strong>{hostingDepReq.toLocaleString()} USDC</strong><br/>
            Add a second property and grow your rental portfolio on pi2pi.
          </div>
          <button className="btn-p" style={{background:"var(--color-primary)"}} onClick={()=>setSecondListing(true)}>
            + Add second listing
          </button>
        </div>
      )}
      {secondListing && (
        <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
          <div style={{fontWeight:700,fontSize:12,color:"var(--color-primary)",marginBottom:4}}>Second listing slot activated</div>
          <div style={{fontSize:11,color:"var(--muted)"}}>Go to Explore and use "Create listing" to publish your second property.</div>
        </div>
      )}

      </React.Fragment>)}

      {/* Add listing — shown only in Deals tab */}
      {false && showDeals && canAddSecond && !listingDeleted && contractActive && (
        <div style={{background:"linear-gradient(135deg,var(--color-primary-surface),var(--color-primary-surface))",border:"1.5px solid var(--color-primary-border)",borderRadius:14,padding:"14px 16px",marginBottom:14}}>
          <div style={{fontWeight:800,fontSize:13,color:"var(--color-primary)",marginBottom:4}}>Add another listing</div>
          <div style={{fontSize:11,color:"var(--color-primary)",marginBottom:12,lineHeight:1.6}}>Your current contract is active. You can still list another property.</div>
          <button className="btn-p" style={{background:"var(--color-primary)"}} onClick={()=>setSecondListing(true)}>+ Add listing</button>
        </div>
      )}

      {/* Contract in progress — from server (landlord) */}
      {showDeals && activeProposal && !activeContract && (
        <div className="sc-card" style={{marginBottom:16,border:"1.5px solid var(--teal)"}}>
          <div className="sc-title">{t("dash.contract_in_progress")}</div>
          <div style={{fontSize:12,color:"var(--muted)",marginBottom:10,lineHeight:1.6}}>
            {t("dash.agreement_with")} {(activeProposal.type==="contract_received"?activeProposal.fromAddr:activeProposal.toAddr).slice(0,6)}…{(activeProposal.type==="contract_received"?activeProposal.fromAddr:activeProposal.toAddr).slice(-4)}
          </div>
          <div className="sc-row"><span className="sc-k">{t("field.status")}</span><span className="sc-v" style={{color:activeProposal.status==="signed-by-both"?"var(--green)":"var(--color-warning)"}}>{
            activeProposal.status==="signed-by-both"?t("chat.both_accepted"):t("chat.waiting_acceptance")
          }</span></div>
          {activeProposal.status==="signed-by-both" && (
            <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10,padding:"10px",marginTop:8,fontSize:12,color:"var(--green)",fontWeight:700}}>
              {t("dash.both_accepted_sign")}
            </div>
          )}
          <div style={{display:"flex",gap:8,marginTop:10}}>
            {activeProposal.status==="signed-by-both" && !activeContract?.agreementId && onStartRealContract && (
              <button onClick={()=>onStartRealContract(activeProposal.type==="contract_received"?activeProposal.fromAddr:activeProposal.toAddr)}
                style={{flex:1,padding:"11px",borderRadius:10,background:"var(--accent)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                {t("dash.continue_agreement")}
              </button>
            )}
            {onOpenRealChat && (
              <button onClick={()=>onOpenRealChat(activeProposal.type==="contract_received"?activeProposal.fromAddr:activeProposal.toAddr)}
                style={{flex:1,padding:"11px",borderRadius:10,background:"var(--color-bg-card)",color:"var(--text)",border:"1.5px solid var(--border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                {t("btn.chat")}
              </button>
            )}
          </div>
          {/* Delete contract */}
          <button onClick={()=>setShowDeleteContract(true)}
            style={{width:"100%",padding:"10px",borderRadius:10,background:"none",border:"1px solid var(--border)",color:"var(--color-text-dim)",fontFamily:"var(--ff)",fontWeight:600,fontSize:12,cursor:"pointer",marginTop:10}}>
            {getLang()==="ru" ? "Удалить контракт" : "Delete contract"}
          </button>
          {showDeleteContract && (
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)"}} onClick={()=>setShowDeleteContract(false)}>
              <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-bg)",borderRadius:16,padding:"24px 20px",maxWidth:360,width:"100%",boxShadow:"0 12px 40px rgba(0,0,0,0.5)",border:"1px solid var(--border)"}}>
                <div style={{fontSize:16,fontWeight:800,color:"var(--color-danger)",marginBottom:12,textAlign:"center"}}>
                  {getLang()==="ru" ? "Удалить контракт?" : "Delete contract?"}
                </div>
                <div style={{fontSize:13,color:"var(--color-text-secondary)",marginBottom:8,lineHeight:1.6,textAlign:"center"}}>
                  {getLang()==="ru"
                    ? "Контракт будет отменён для обеих сторон. Это действие нельзя отменить."
                    : "The contract will be cancelled for both parties. This action cannot be undone."}
                </div>
                <div style={{fontSize:12,color:"var(--muted)",marginBottom:20,textAlign:"center"}}>
                  {getLang()==="ru" ? "Вы уверены?" : "Are you sure?"}
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>setShowDeleteContract(false)}
                    style={{flex:1,padding:"12px",borderRadius:10,background:"var(--color-bg-card)",border:"1.5px solid var(--border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    {getLang()==="ru" ? "Отмена" : "Cancel"}
                  </button>
                  <button onClick={async ()=>{
                    const proposalId = activeProposal?.contractId || activeProposal?.id;
                    if (!proposalId) return;
                    try {
                      const delAddr = user?.addr?.toLowerCase();
                      const delSigMsg = `pi2pi: Delete contract ${proposalId}`;
                      const delProvider = getProvider() || window.ethereum;
                      const delSig = await delProvider.request({ method: "personal_sign", params: [delSigMsg, delAddr] });
                      logEvent("UI_ACTION", { user: delAddr, action: "contract_deleted", data: { proposalId, signature: delSig.slice(0,20)+"..." } });
                      setShowDeleteContract(false);
                      await cancelContractProposal(proposalId, { addr: delAddr, signature: delSig });
                      const pAddr = activeProposal.type==="contract_received" ? activeProposal.fromAddr : activeProposal.toAddr;
                      await sysMsg(user?.addr, pAddr, getLang()==="ru" ? "Контракт удалён" : "Contract deleted", role, "contract_cancelled");
                      setTimeout(() => window.location.reload(), 500);
                    } catch(e) { if(e.code!==4001) console.error("[delete-contract]", e); setShowDeleteContract(false); }
                  }}
                    style={{flex:1,padding:"12px",borderRadius:10,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    {getLang()==="ru" ? "Да, удалить" : "Yes, delete"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active Contract */}
      {showDeals && activeContract && <ActiveContractCard contract={activeContract} role={role} onContractClose={onContractClose} onOpenEarlyExitForm={(et)=>setShowEarlyTermResponse(et)} loadFinancialEvents={loadFinancialEvents}/>}
      {/* PropDepositBlock now rendered inside ActiveContractCard */}
      {showDeals && activeContract?.agreementId && <ContractDocuments agreementId={activeContract.agreementId} myAddr={user?.addr} peerAddr={activeContract?.peerAddr || activeContract?.listing?.contract} role={role} leaseTexts={LEASE_TEXTS} loadFinancialEvents={loadFinancialEvents}/>}

      {/* Archived contracts */}
      {showDeals && archivedContracts.length > 0 && (
        <div style={{marginTop:16}}>
          <button onClick={()=>setShowArchive(v=>!v)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",borderRadius:10,cursor:"pointer",fontFamily:"var(--ff)"}}>
            <span style={{fontWeight:700,fontSize:13,color:"var(--color-text-secondary)"}}>{t("dash.archive")} ({archivedContracts.length})</span>
            <span style={{fontSize:12,color:"var(--color-text-dim)",transform:showArchive?"rotate(180deg)":"none",transition:"transform 0.2s"}}>▼</span>
          </button>
          {showArchive && archivedContracts.map((ac, i) => {
            const isCancelled = ac.closedReason === "cancelled_unfunded";
            return (
            <div key={i} style={{marginTop:8,padding:"12px 14px",background:"var(--color-bg-card)",border:`1px solid ${isCancelled?"var(--color-danger-border)":"var(--color-border)"}`,borderRadius:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontWeight:700,fontSize:13}}>Agreement #{ac.agreementId ? toDecAgreementId(ac.agreementId) : "—"}</div>
                <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,background:isCancelled?"var(--color-danger-surface)":"var(--state-settled-surface)",color:isCancelled?"var(--color-danger)":"var(--state-settled)",fontWeight:700}}>
                  {isCancelled ? (getLang()==="ru"?"Отменён":"Cancelled") : t("status.settled")}
                </span>
              </div>
              <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:4}}>
                {ac.peerAddr ? (peerNames[ac.peerAddr] || ac.peerAddr.slice(0,6)+"…"+ac.peerAddr.slice(-4)) : "—"}
              </div>
              {ac.archivedAt && <div style={{fontSize:10,color:"var(--color-text-dim)",marginBottom:8}}>{t("dash.archived_on")} {new Date(ac.archivedAt).toLocaleDateString()}</div>}
              <div style={{display:"flex",gap:8}}>
                {ac.agreementId && !isCancelled && (
                  <button onClick={()=>{
                    window.dispatchEvent(new CustomEvent("pi2pi-open-print", {detail:{agreementId:ac.agreementId,myAddr:user?.addr,peerAddr:ac.peerAddr,role}}));
                  }} style={{flex:1,padding:"8px",borderRadius:8,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer"}}>
                    {t("btn.open_full_doc")}
                  </button>
                )}
                {ac.peerAddr && onOpenRealChat && (
                  <button onClick={()=>onOpenRealChat(ac.peerAddr)} style={{flex:1,padding:"8px",borderRadius:8,background:"var(--color-bg-secondary)",color:"var(--color-text-primary)",border:"1px solid var(--color-border)",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer"}}>
                    {t("btn.chat")}
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Real Inbox from server — grouped by peer */}
      {showInbox && realInbox.length > 0 && (() => {
        // Group by peer address — one entry per counterparty
        const peerMap = {};
        realInbox.filter(item=>item.type!=="contract_received"&&item.type!=="contract_sent").forEach(item => {
          const peer = (item.fromAddr === user?.addr?.toLowerCase?.() || item.type?.includes("sent")) ? item.toAddr : item.fromAddr;
          if (!peer) return;
          if (!peerMap[peer]) peerMap[peer] = { peer, items: [], latestTime: 0 };
          peerMap[peer].items.push(item);
          const t = item.updatedAt || item.createdAt || 0;
          if (t > peerMap[peer].latestTime) peerMap[peer].latestTime = t;
        });
        const peers = Object.values(peerMap).sort((a,b) => b.latestTime - a.latestTime);
        if (!peers.length) return null;
        return (
        <div className="sc-card" style={{marginBottom:16}}>
          {peers.map(({peer, items}) => {
            const shortPeer = peerNames[peer] || peer.slice(0,6)+"…"+peer.slice(-4);
            const viewing = items.find(i=>i.type==="viewing_request_received"||i.type==="viewing_request_sent");
            const message = items.find(i=>i.type==="message_received");
            const earlyTerm = items.find(i=>i.type==="early_term_received"||i.type==="early_term_sent");
            const hasChat = viewing?.status==="confirmed" || message;
            return (
            <div key={peer} style={{padding:"12px 0",borderBottom:"1px solid var(--border)"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
                <AvatarBox id={null} size={64} radius={14} walletAddr={peer}/>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:14}}>{shortPeer}</div>
                  <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>
                    {(() => {
                      // Show only the most recent status line
                      const lastEvent = message?.eventType;
                      if (lastEvent) {
                        for (const pfx of ["chat.sys_","chat.sys.","chat."]) {
                          const k = pfx + lastEvent;
                          const v = t(k, message.params || {});
                          if (v !== k && !v.includes("{")) return v;
                        }
                        // Fallback: use stored text but strip emojis
                        if (message.text) return message.text.replace(/[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}]\s*/gu, "");
                      }
                      if (viewing?.status==="confirmed") return t("inbox.viewing_confirmed") + (message ? " · "+message.messageCount+" msg" : "");
                      if (viewing?.status==="pending") return t("inbox.viewing_requested");
                      if (message) return message.messageCount+" msg";
                      return "";
                    })()}
                  </div>
                </div>
              </div>

              {/* Viewing pending — need to respond */}
              {viewing && viewing.status==="pending" && (viewing.type==="viewing_request_received") && (
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button onClick={()=>respondReal(viewing.vrId,"confirmed")} disabled={respondingVr===viewing.vrId}
                    style={{flex:1,padding:"9px",borderRadius:9,background:"var(--green)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:respondingVr===viewing.vrId?"wait":"pointer",opacity:respondingVr===viewing.vrId?.6:1}}>
                    {respondingVr===viewing.vrId ? t("body.signing") : t("inbox.confirm_viewing")}
                  </button>
                  <button onClick={()=>respondReal(viewing.vrId,"declined")} disabled={!!respondingVr}
                    style={{flex:1,padding:"9px",borderRadius:9,background:"var(--color-bg-card)",border:"1.5px solid var(--border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",color:"var(--muted)"}}>
                    {t("inbox.decline")}
                  </button>
                </div>
              )}
              {viewing && viewing.status==="pending" && (viewing.type==="viewing_request_sent") && (
                <div style={{fontSize:12,fontWeight:700,color:"var(--color-warning)",marginBottom:8}}>{role==="tenant" ? t("body.waiting_landlord") : t("body.waiting_tenant")}</div>
              )}

              {/* Early termination */}
              {earlyTerm && (() => {
                const st = dashOnChainState;
                if (st === 8) return <div style={{fontSize:12,fontWeight:700,color:"var(--green)",marginBottom:8}}>{t("title.contract_settled")}</div>;
                if (st === 7) return (
                  <div style={{background:"var(--color-danger-surface)",border:"1px solid var(--color-danger-border)",borderRadius:10,padding:"10px",marginBottom:8}}>
                    <div style={{fontWeight:700,fontSize:12,color:"var(--color-danger)"}}>{t("title.dispute_in_progress")}</div>
                  </div>
                );
                if (st === 4) return (
                  <div style={{background:"var(--color-danger-surface)",border:"1px solid var(--color-danger-border)",borderRadius:10,padding:"10px",marginBottom:8}}>
                    <div style={{fontWeight:700,fontSize:12,color:"var(--color-danger)"}}>{t("title.terminate_early_request")}</div>
                    {earlyTerm.reason && <div style={{fontSize:11,color:"var(--muted)",fontStyle:"italic",marginTop:4}}>Reason: "{earlyTerm.reason}"</div>}
                  </div>
                );
                if (st === 3) return <div style={{fontSize:11,color:"var(--muted)",marginBottom:8}}>{t("body.active_contract")}</div>;
                return null;
              })()}

              {/* One chat button per peer */}
              {onOpenRealChat && (
                <button onClick={()=>onOpenRealChat(peer)}
                  style={{width:"100%",padding:"9px",borderRadius:9,background:"var(--teal)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  {t("inbox.open_chat")}
                </button>
              )}
            </div>
          );})
          }
        </div>
        );
      })()}

      {/* Mock Inbox — hidden for real MetaMask users */}
      {showInbox && !(user?.addr?.length >= 42) && <InboxBlock msgs={msgs} unread={unread} isLL={isLL} expanded={expanded} open={open} respond={respond} markAllRead={markAllRead} META={META} onViewListing={onViewListing} onOpenChat={onOpenChat} onStartContract={onStartContract} earlyTermState={earlyTermState} onEarlyTermStateChange={onEarlyTermStateChange} onContractClose={onContractClose}/>}

      {/* Early Term Response Form — modal (landlord) */}
      {showEarlyTermResponse && (
        <EarlyTermResponseForm
          earlyTerm={showEarlyTermResponse}
          agreementId={activeContract?.agreementId}
          onClose={()=>setShowEarlyTermResponse(null)}
          onRespond={async (etId, response, onChainFn)=>{
            setShowEarlyTermResponse(null);
            await respondEarlyTerm(etId, response, onChainFn);
          }}
        />
      )}
    </div>
  );

  // Tenant dashboard
  const [tEmail, setTEmail] = useState("");
  const [tEmailConfirmed, setTEmailConfirmed] = useState(false);
  const [tEmailSent, setTEmailSent] = useState(false);
  const [tPhone, setTPhone] = useState("");
  const [tPhoneConfirmed, setTPhoneConfirmed] = useState(false);
  const [tEditMode, setTEditMode] = useState(false);
  const [tEditsLeft, setTEditsLeft] = useState(3);
  const [tRequest, setTRequest] = useState({
    city: savedListing.city || "Buenos Aires",
    propertyType: savedListing.propertyType || "Studio",
    budget: savedListing.rent || "2",
    date: savedListing.date || "",
    duration: savedListing.duration || "6"
  });
  const [tDraft, setTDraft] = useState({...tRequest});

  const saveTEdit = () => { setTRequest({...tDraft}); setTEditsLeft(n=>n-1); setTEditMode(false); };

  return (
    <div className="dash">
      {/* A3: Wallet operational state indicator */}
      {!getProvider() && <div style={{background:"rgba(234,179,8,0.1)",border:"1px solid rgba(234,179,8,0.3)",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12,color:"#eab308"}}>{t("wallet.disconnected_banner")}</div>}
      {showAccount && <AccountHeader user={user} role={role} displayName={displayName} setDisplayName={setDisplayName} repStats={repStats} getIdentityBadges={getIdentityBadges} triggerWorldIDVerify={triggerWorldIDVerify}/>}
      {showAccount && <SettingsNotifications user={user}/>}

      {/* M7: tenant intent compact summary */}
      {showDeals && !activeContract && <TenantIntentBlock user={user} onOpenMyIntent={onOpenMyIntent}/>}

      {/* My rental request — hidden from all tabs (duplicates TenantIntentBlock + MyIntentPage) */}
      {false && !activeContract && <div className="sc-card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div className="sc-title" style={{marginBottom:0}}>My rental request</div>
          {!tEditMode&&(
            <div style={{position:"relative",display:"inline-block"}} className="tooltip-wrap">
              <button
                onClick={()=>tEditsLeft>0&&setTEditMode(true)}
                style={{fontSize:11,fontWeight:700,color:tEditsLeft>0?"var(--teal)":"var(--dim)",background:"none",border:`1.5px solid ${tEditsLeft>0?"var(--teal)":"var(--border)"}`,borderRadius:8,padding:"4px 10px",cursor:tEditsLeft>0?"pointer":"default",fontFamily:"var(--ff)"}}>
                Edit <span style={{background:tEditsLeft>0?"var(--teal)":"var(--border)",color:"white",borderRadius:10,padding:"1px 6px",fontSize:10,marginLeft:3}}>{tEditsLeft}</span>
              </button>
              <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:"var(--color-bg-card)",color:"white",borderRadius:10,padding:"10px 13px",fontSize:11,lineHeight:1.7,width:220,zIndex:50,pointerEvents:"none",opacity:0}} className="tooltip-box">
                <strong>Max 3 edits per request</strong><br/>
                To prevent manipulation after landlords have seen your request, it can only be edited <strong>3 times</strong> total.<br/>
                <span style={{color:"#f0c844"}}>Remaining: {tEditsLeft} / 3</span>
              </div>
            </div>
          )}
        </div>
        {tEditMode ? <React.Fragment>
          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
            <div>
              <div className="field-label">{t("field.city")}</div>
              <Dropdown value={tDraft.city} placeholder="Select city"
                options={[{value:"Tbilisi",label:"Tbilisi"},{value:"Batumi",label:"Batumi"},{value:"Da Nang",label:"Da Nang"},{value:"Ho Chi Minh City",label:"Ho Chi Minh City"},{value:"Nha Trang",label:"Nha Trang"},{value:"Hanoi",label:"Hanoi"},{value:"Buenos Aires",label:"Buenos Aires"},{value:"São Paulo",label:"São Paulo"},{value:"Bangkok",label:"Bangkok"},{value:"Samui",label:"Samui"},{value:"Phuket",label:"Phuket"}]}
                onChange={v=>setTDraft(d=>({...d,city:v}))}/>
            </div>
            <div>
              <div className="field-label">{t("field.property_type")}</div>
              <Dropdown value={tDraft.propertyType} placeholder="Select type"
                options={[{value:"Studio",label:"Studio"},{value:"1 Bedroom Apartment",label:"1 Bedroom Apartment"},{value:"2 Bedroom Apartment",label:"2 Bedroom Apartment"},{value:"3 Bedroom Apartment",label:"3 Bedroom Apartment"}]}
                onChange={v=>setTDraft(d=>({...d,propertyType:v}))}/>
            </div>
            <div>
              <div className="field-label">{t("field.monthly_rent")}</div>
              <input className="field-inp" type="number" min="2" step="1" value={tDraft.budget} onChange={e=>setTDraft(d=>({...d,budget:e.target.value}))}/>
            </div>
            <div>
              <div className="field-label">{t("field.move_in_date")}</div>
              <input className="field-inp" type="date" min={new Date().toISOString().split("T")[0]} value={tDraft.date} onChange={e=>setTDraft(d=>({...d,date:e.target.value}))}/>
            </div>
            <div>
              <div className="field-label">{t("field.lease_duration")}</div>
              <Dropdown value={String(tDraft.duration)} placeholder="Select duration"
                options={[6,7,8,9,10,11,12].map(m=>({value:String(m),label:`${m} months`}))}
                onChange={v=>setTDraft(d=>({...d,duration:v}))}/>
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn-p" style={{flex:1}} onClick={saveTEdit}>{t("btn.save")}</button>
            <button onClick={()=>{setTDraft({...tRequest});setTEditMode(false);}}
              style={{flex:1,padding:"12px",background:"none",border:"1.5px solid var(--border)",borderRadius:12,fontFamily:"var(--ff)",fontSize:13,cursor:"pointer"}}>{t("btn.cancel")}</button>
          </div>
        </React.Fragment> : <React.Fragment>
          {[["City",tRequest.city],["Type",tRequest.propertyType],["Budget",`${tRequest.budget} USDC/mo`],["Move-in",tRequest.date||"—"],["Duration",`${tRequest.duration} months`]].map(([k,v])=>(
            <div key={k} className="sc-row"><span className="sc-k">{k}</span><span className="sc-v">{v}</span></div>
          ))}
          <div style={{marginTop:10,padding:"8px 0 0",borderTop:"1px solid var(--border)",display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"var(--green)"}}/>
            <span style={{fontSize:11,color:"var(--green)",fontWeight:700}}>{t("status.active")}</span>
            <span style={{fontSize:11,color:"var(--muted)",marginLeft:4}}>· Signed onchain</span>
          </div>
        </React.Fragment>}
      </div>}

      {/* Create new rental request — REMOVED per user request (Sprint 9) */}
      {false && activeContract && dashOnChainState === 8 && (
        <div style={{background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)",border:"1.5px solid #7dd3fc",borderRadius:14,padding:"14px 16px",marginBottom:14}}>
          <div style={{fontWeight:800,fontSize:13,color:"#0369a1",marginBottom:4}}>Ready for a new place?</div>
          <div style={{fontSize:11,color:"#0369a1",marginBottom:12,lineHeight:1.6}}>Your previous contract is settled. Create a new rental request to find your next home.</div>
          <button className="btn-p" style={{background:"#0ea5e9"}} onClick={()=>{/* TODO: open create listing */}}>+ Create new request</button>
        </div>
      )}

      {/* Contract in progress — from server (tenant) — Deals tab only */}
      {showDeals && activeProposal && !activeContract && (
        <div className="sc-card" style={{marginBottom:16,border:"1.5px solid var(--teal)"}}>
          <div className="sc-title">{t("dash.contract_in_progress")}</div>
          <div style={{fontSize:12,color:"var(--muted)",marginBottom:10,lineHeight:1.6}}>
            {t("dash.agreement_with")} {(activeProposal.type==="contract_received"?activeProposal.fromAddr:activeProposal.toAddr).slice(0,6)}…{(activeProposal.type==="contract_received"?activeProposal.fromAddr:activeProposal.toAddr).slice(-4)}
          </div>
          <div className="sc-row"><span className="sc-k">{t("field.status")}</span><span className="sc-v" style={{color:activeProposal.status==="signed-by-both"?"var(--green)":"var(--color-warning)"}}>{
            activeProposal.status==="signed-by-both"?t("chat.both_accepted"):t("chat.waiting_acceptance")
          }</span></div>
          {activeProposal.status==="signed-by-both" && (
            <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10,padding:"10px",marginTop:8,fontSize:12,color:"var(--green)",fontWeight:700}}>
              {t("dash.both_accepted_sign")}
            </div>
          )}
          <div style={{display:"flex",gap:8,marginTop:10}}>
            {activeProposal.status==="signed-by-both" && !activeContract?.agreementId && onStartRealContract && (
              <button onClick={()=>onStartRealContract(activeProposal.type==="contract_received"?activeProposal.fromAddr:activeProposal.toAddr)}
                style={{flex:1,padding:"11px",borderRadius:10,background:"var(--accent)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                {t("dash.continue_agreement")}
              </button>
            )}
            {onOpenRealChat && (
              <button onClick={()=>onOpenRealChat(activeProposal.type==="contract_received"?activeProposal.fromAddr:activeProposal.toAddr)}
                style={{flex:1,padding:"11px",borderRadius:10,background:"var(--color-bg-card)",color:"var(--text)",border:"1.5px solid var(--border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                {t("btn.chat")}
              </button>
            )}
          </div>
          {/* Delete contract */}
          <button onClick={()=>setShowDeleteContract(true)}
            style={{width:"100%",padding:"10px",borderRadius:10,background:"none",border:"1px solid var(--border)",color:"var(--color-text-dim)",fontFamily:"var(--ff)",fontWeight:600,fontSize:12,cursor:"pointer",marginTop:10}}>
            {getLang()==="ru" ? "Удалить контракт" : "Delete contract"}
          </button>
          {showDeleteContract && (
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)"}} onClick={()=>setShowDeleteContract(false)}>
              <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-bg)",borderRadius:16,padding:"24px 20px",maxWidth:360,width:"100%",boxShadow:"0 12px 40px rgba(0,0,0,0.5)",border:"1px solid var(--border)"}}>
                <div style={{fontSize:16,fontWeight:800,color:"var(--color-danger)",marginBottom:12,textAlign:"center"}}>
                  {getLang()==="ru" ? "Удалить контракт?" : "Delete contract?"}
                </div>
                <div style={{fontSize:13,color:"var(--color-text-secondary)",marginBottom:8,lineHeight:1.6,textAlign:"center"}}>
                  {getLang()==="ru"
                    ? "Контракт будет отменён для обеих сторон. Это действие нельзя отменить."
                    : "The contract will be cancelled for both parties. This action cannot be undone."}
                </div>
                <div style={{fontSize:12,color:"var(--muted)",marginBottom:20,textAlign:"center"}}>
                  {getLang()==="ru" ? "Вы уверены?" : "Are you sure?"}
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>setShowDeleteContract(false)}
                    style={{flex:1,padding:"12px",borderRadius:10,background:"var(--color-bg-card)",border:"1.5px solid var(--border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    {getLang()==="ru" ? "Отмена" : "Cancel"}
                  </button>
                  <button onClick={async ()=>{
                    const proposalId = activeProposal?.contractId || activeProposal?.id;
                    if (!proposalId) return;
                    try {
                      const delAddr = user?.addr?.toLowerCase();
                      const delSigMsg = `pi2pi: Delete contract ${proposalId}`;
                      const delProvider = getProvider() || window.ethereum;
                      const delSig = await delProvider.request({ method: "personal_sign", params: [delSigMsg, delAddr] });
                      logEvent("UI_ACTION", { user: delAddr, action: "contract_deleted", data: { proposalId, signature: delSig.slice(0,20)+"..." } });
                      setShowDeleteContract(false);
                      await cancelContractProposal(proposalId, { addr: delAddr, signature: delSig });
                      const pAddr = activeProposal.type==="contract_received" ? activeProposal.fromAddr : activeProposal.toAddr;
                      await sysMsg(user?.addr, pAddr, getLang()==="ru" ? "Контракт удалён" : "Contract deleted", role, "contract_cancelled");
                      setTimeout(() => window.location.reload(), 500);
                    } catch(e) { if(e.code!==4001) console.error("[delete-contract]", e); setShowDeleteContract(false); }
                  }}
                    style={{flex:1,padding:"12px",borderRadius:10,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    {getLang()==="ru" ? "Да, удалить" : "Yes, delete"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active Contract */}
      {showDeals && activeContract && <ActiveContractCard contract={activeContract} role={role} onContractClose={onContractClose} onOpenEarlyExitForm={(et)=>setShowEarlyTermResponse(et)} loadFinancialEvents={loadFinancialEvents}/>}
      {/* PropDepositBlock now rendered inside ActiveContractCard */}
      {showDeals && activeContract?.agreementId && <ContractDocuments agreementId={activeContract.agreementId} myAddr={user?.addr} peerAddr={activeContract?.peerAddr || activeContract?.listing?.contract} role={role} leaseTexts={LEASE_TEXTS} loadFinancialEvents={loadFinancialEvents}/>}

      {/* Archived contracts */}
      {showDeals && archivedContracts.length > 0 && (
        <div style={{marginTop:16}}>
          <button onClick={()=>setShowArchive(v=>!v)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",borderRadius:10,cursor:"pointer",fontFamily:"var(--ff)"}}>
            <span style={{fontWeight:700,fontSize:13,color:"var(--color-text-secondary)"}}>{t("dash.archive")} ({archivedContracts.length})</span>
            <span style={{fontSize:12,color:"var(--color-text-dim)",transform:showArchive?"rotate(180deg)":"none",transition:"transform 0.2s"}}>▼</span>
          </button>
          {showArchive && archivedContracts.map((ac, i) => {
            const isCancelled = ac.closedReason === "cancelled_unfunded";
            return (
            <div key={i} style={{marginTop:8,padding:"12px 14px",background:"var(--color-bg-card)",border:`1px solid ${isCancelled?"var(--color-danger-border)":"var(--color-border)"}`,borderRadius:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontWeight:700,fontSize:13}}>Agreement #{ac.agreementId ? toDecAgreementId(ac.agreementId) : "—"}</div>
                <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,background:isCancelled?"var(--color-danger-surface)":"var(--state-settled-surface)",color:isCancelled?"var(--color-danger)":"var(--state-settled)",fontWeight:700}}>
                  {isCancelled ? (getLang()==="ru"?"Отменён":"Cancelled") : t("status.settled")}
                </span>
              </div>
              <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:4}}>
                {ac.peerAddr ? (peerNames[ac.peerAddr] || ac.peerAddr.slice(0,6)+"…"+ac.peerAddr.slice(-4)) : "—"}
              </div>
              {ac.archivedAt && <div style={{fontSize:10,color:"var(--color-text-dim)",marginBottom:8}}>{t("dash.archived_on")} {new Date(ac.archivedAt).toLocaleDateString()}</div>}
              <div style={{display:"flex",gap:8}}>
                {ac.agreementId && !isCancelled && (
                  <button onClick={()=>{
                    window.dispatchEvent(new CustomEvent("pi2pi-open-print", {detail:{agreementId:ac.agreementId,myAddr:user?.addr,peerAddr:ac.peerAddr,role}}));
                  }} style={{flex:1,padding:"8px",borderRadius:8,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer"}}>
                    {t("btn.open_full_doc")}
                  </button>
                )}
                {ac.peerAddr && onOpenRealChat && (
                  <button onClick={()=>onOpenRealChat(ac.peerAddr)} style={{flex:1,padding:"8px",borderRadius:8,background:"var(--color-bg-secondary)",color:"var(--color-text-primary)",border:"1px solid var(--color-border)",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer"}}>
                    {t("btn.chat")}
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Real Inbox from server — grouped by peer */}
      {showInbox && realInbox.length > 0 && (() => {
        // Group by peer address — one entry per counterparty
        const peerMap = {};
        realInbox.filter(item=>item.type!=="contract_received"&&item.type!=="contract_sent").forEach(item => {
          const peer = (item.fromAddr === user?.addr?.toLowerCase?.() || item.type?.includes("sent")) ? item.toAddr : item.fromAddr;
          if (!peer) return;
          if (!peerMap[peer]) peerMap[peer] = { peer, items: [], latestTime: 0 };
          peerMap[peer].items.push(item);
          const t = item.updatedAt || item.createdAt || 0;
          if (t > peerMap[peer].latestTime) peerMap[peer].latestTime = t;
        });
        const peers = Object.values(peerMap).sort((a,b) => b.latestTime - a.latestTime);
        if (!peers.length) return null;
        return (
        <div className="sc-card" style={{marginBottom:16}}>
          {peers.map(({peer, items}) => {
            const shortPeer = peerNames[peer] || peer.slice(0,6)+"…"+peer.slice(-4);
            const viewing = items.find(i=>i.type==="viewing_request_received"||i.type==="viewing_request_sent");
            const message = items.find(i=>i.type==="message_received");
            const earlyTerm = items.find(i=>i.type==="early_term_received"||i.type==="early_term_sent");
            const hasChat = viewing?.status==="confirmed" || message;
            return (
            <div key={peer} style={{padding:"12px 0",borderBottom:"1px solid var(--border)"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
                <AvatarBox id={null} size={64} radius={14} walletAddr={peer}/>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:14}}>{shortPeer}</div>
                  <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>
                    {(() => {
                      const lastEvent = message?.eventType;
                      if (lastEvent) {
                        for (const pfx of ["chat.sys_","chat.sys.","chat."]) {
                          const k = pfx + lastEvent;
                          const v = t(k, message.params || {});
                          if (v !== k && !v.includes("{")) return v;
                        }
                        if (message.text) return message.text.replace(/[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}]\s*/gu, "");
                      }
                      if (viewing?.status==="confirmed") return t("inbox.viewing_confirmed") + (message ? " · "+message.messageCount+" msg" : "");
                      if (viewing?.status==="pending") return t("inbox.viewing_requested");
                      if (message) return message.messageCount+" msg";
                      return "";
                    })()}
                  </div>
                </div>
              </div>
              {viewing && viewing.status==="pending" && viewing.type==="viewing_request_received" && (
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <button onClick={()=>respondReal(viewing.vrId,"confirmed")} disabled={respondingVr===viewing.vrId}
                    style={{flex:1,padding:"9px",borderRadius:9,background:"var(--green)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                    {respondingVr===viewing.vrId ? t("body.signing") : t("inbox.confirm_viewing")}
                  </button>
                  <button onClick={()=>respondReal(viewing.vrId,"declined")} disabled={!!respondingVr}
                    style={{flex:1,padding:"9px",borderRadius:9,background:"var(--color-bg-card)",border:"1.5px solid var(--border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",color:"var(--muted)"}}>{t("inbox.decline")}</button>
                </div>
              )}
              {viewing && viewing.status==="pending" && viewing.type==="viewing_request_sent" && (
                <div style={{fontSize:12,fontWeight:700,color:"var(--color-warning)",marginBottom:8}}>{role==="tenant" ? t("body.waiting_landlord") : t("body.waiting_tenant")}</div>
              )}
              {onOpenRealChat && (
                <button onClick={()=>onOpenRealChat(peer)}
                  style={{width:"100%",padding:"9px",borderRadius:9,background:"var(--teal)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  {t("inbox.open_chat")}
                </button>
              )}
            </div>
          );})
          }
        </div>
        );
      })()}

      {/* Mock Inbox — hidden for real MetaMask users */}
      {showInbox && !(user?.addr?.length >= 42) && <InboxBlock msgs={msgs} unread={unread} isLL={isLL} expanded={expanded} open={open} respond={respond} markAllRead={markAllRead} META={META} onViewListing={onViewListing} onOpenChat={onOpenChat} onStartContract={onStartContract} earlyTermState={earlyTermState} onEarlyTermStateChange={onEarlyTermStateChange} onContractClose={onContractClose}/>}

      {/* Early Term Response Form — modal */}
      {showEarlyTermResponse && (
        <EarlyTermResponseForm
          earlyTerm={showEarlyTermResponse}
          agreementId={activeContract?.agreementId}
          onClose={()=>setShowEarlyTermResponse(null)}
          onRespond={async (etId, response, onChainFn)=>{
            setShowEarlyTermResponse(null);
            await respondEarlyTerm(etId, response, onChainFn);
          }}
        />
      )}
    </div>
  );
}

export default Dashboard;
