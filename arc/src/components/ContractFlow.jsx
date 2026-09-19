import React, { useState, useEffect, useRef, Fragment } from 'react';
import { t, getLang } from '../i18n/index.js';
import {
  ESCROW_ADDRESS, USDC_ADDRESS, ARC_TESTNET_CHAIN, USDC_DECIMALS,
  SEL, encAddr, encUint, ACTIVE_NETWORK_NAME,
} from '../helpers.js';
import {
  getProvider, encBytes32, checkUsdcBalance, ethCallRpc, rpcCall,
  sysMsg, sendTxRaw, waitReceipt,
} from '../wallet.js';
import {
  logEventApi, getContractForm, saveContractForm,
  signContract, uploadFile,
} from '../api/client.js';
import { encryptAndUploadContract } from '../services/encryption.js';
import BlockchainModal from './BlockchainModal.jsx';
import AgreementDocument from './AgreementDocument.jsx';
import LightboxViewer from './LightboxViewer.jsx';
import PrintModal from './PrintModal.jsx';
import { LEASE_EN } from '../lease-text-en.js';
import { LEASE_RU } from '../lease-text-ru.js';
import { LEASE_KA } from '../lease-text-ka.js';
import { LEASE_VI } from '../lease-text-vi.js';
import { LEASE_ES } from '../lease-text-es.js';
import { LEASE_UK } from '../lease-text-uk.js';
import { LEASE_PT } from '../lease-text-pt.js';
import { LEASE_TH } from '../lease-text-th.js';

export const LEASE_TEXTS = { en: LEASE_EN, ru: LEASE_RU, ka: LEASE_KA, vi: LEASE_VI, es: LEASE_ES, uk: LEASE_UK, pt: LEASE_PT, th: LEASE_TH };

function logEvent(type, payload = {}) {
  const log = { time: new Date().toISOString(), type, ...payload };
  console.log("[pi2pi-log]", log);
  logEventApi(log);
}

function ContractFlow({ listing, role, onBack, onComplete, myAddr, peerAddr }) {
  const isLL = role === "landlord";
  const isReal = !!listing._realUser;
  // Refetch contract form from server and resync all local state
  const reloadFormFromServer = async () => {
    if (!isReal || !fullAddr || !peerAddr) return;
    try {
      const cf = await getContractForm(fullAddr, peerAddr);
      if (!cf) return;
      setServerForm(cf);
      // Resync deposit
      if (cf.deposit) {
        if (cf.deposit.type === "skip") { setPdLLskip(true); setPdLLproposed(false); setPdLLamount(""); }
        else if (cf.deposit.type === "set") { setPdLLproposed(true); setPdLLamount(String(cf.deposit.amount)); setPdLLskip(false); }
        if (cf.deposit.confirmed) setPdTNconfirmed(true);
      }
      // Resync terms
      if (cf.steps?.terms) _setTerms(prev => ({...prev, ...cf.steps.terms}));
      // Resync photos
      if (cf.photos) setPhotos(cf.photos);
      // Resync inventory
      if (cf.steps?.inventory) _setItems(cf.steps.inventory);
      // Resync documents — rebuild uploadedDocs and boolean flags from server only
      const docs = cf.documents || [];
      const docMap = {};
      let hasTenantId = false, hasLandlordId = false, hasOwnership = false;
      for (const d of docs) {
        if (d.label && d.cid) docMap[d.label] = d;
        if (d.label === "tenantId") hasTenantId = true;
        if (d.label === "landlordId") hasLandlordId = true;
        if (d.label === "ownership") hasOwnership = true;
      }
      setUploadedDocs(docMap);
      setTenantId(hasTenantId);
      setLandlordId(hasLandlordId);
      setOwnershipDoc(hasOwnership);
    } catch {}
  };

  // Inline error for locked-section 409 (replaces native alert)
  const [formLockError, setFormLockError] = useState("");

  // Helper: save contract form with lock-error surfacing + rollback on 409
  // Returns { ok, data } or { ok:false, status, error }
  const saveForm = async (payload) => {
    try {
      const r = await saveContractForm(payload);
      if (r && r.status === 409) {
        const body = await r.json().catch(() => ({}));
        setFormLockError(body.error || t("cf.section_locked") || "This section is locked. Reset the form to renegotiate.");
        setTimeout(() => setFormLockError(""), 6000);
        await reloadFormFromServer();
        return { ok: false, status: 409, error: body.error };
      }
      if (r && !r.ok) {
        return { ok: false, status: r.status, error: "Save failed" };
      }
      return { ok: true, data: r };
    } catch (e) {
      return { ok: false, status: 0, error: e.message };
    }
  };
  // Step persists per peer pair so refresh keeps you on the same page,
  // but switching to a different counterparty starts fresh
  const stepKey = "pi2pi_cf_step_" + (peerAddr||"none").toLowerCase();
  const [step, _setStep] = useState(() => { try { return parseInt(sessionStorage.getItem(stepKey))||0; } catch(e) { return 0; } });
  const setStep = (v) => { const val = typeof v === "function" ? v(step) : v; _setStep(val); try { sessionStorage.setItem(stepKey, String(val)); } catch(e){} };
  const [showSign, setShowSign] = useState(false);
  const [showFullAgreement, setShowFullAgreement] = useState(false);
  const [preSignLang, setPreSignLang] = useState("none");
  const preSignPrintRef = useRef(null);

  // Get full address — try Circle wallet first, then MetaMask/WC
  const [fullAddr, setFullAddr] = useState(myAddr||"");
  useEffect(() => {
    if (fullAddr && !fullAddr.includes("…") && fullAddr.length >= 42) return;
    // Circle wallet stores address directly
    const circleAddr = window.pi2piWallet?._circleAddress;
    if (circleAddr && circleAddr.length >= 42) { setFullAddr(circleAddr); return; }
    // MetaMask / WalletConnect
    const provider = window.pi2piWallet?.provider || window.ethereum;
    provider?.request({method:"eth_accounts"}).then(a=>{if(a?.[0])setFullAddr(a[0]);}).catch(()=>{});
  }, [myAddr]);
  // Also update when myAddr prop changes (e.g. after async restore)
  useEffect(() => {
    if (myAddr && myAddr.length >= 42 && !myAddr.includes("…")) setFullAddr(myAddr);
  }, [myAddr]);

  // Step 0 — IDs (real uploads, not auto-filled even in DEV_MODE)
  const [tenantId, setTenantId] = useState(false);
  const [landlordId, setLandlordId] = useState(false);
  const [tenantAckLandlordId, setTenantAckLandlordId] = useState(false);
  const [landlordAckTenantId, setLandlordAckTenantId] = useState(false);

  // Step 1 — Ownership (real upload)
  const [ownershipDoc, setOwnershipDoc] = useState(false);
  const [tenantAckOwnership, setTenantAckOwnership] = useState(false);

  // Step 2 — Photos (real file uploads to IPFS, synced via serverForm)
  const [photos, setPhotos] = useState([]);
  const [tenantAckPhotos, setTenantAckPhotos] = useState(false);
  const [landlordAckPhotos, setLandlordAckPhotos] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState(null); // {url, name} for fullscreen view
  const MAX_PHOTOS = 10;
  const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — high-res property photos
  const PINATA_GW = "/api/ipfs/file/"; // Proxy through our server — no CORS, cached

  // Step 3 — Inventory (synced via serverForm)
  const defaultItems = [{id:1, name:"Sofa", important:false, photo:false},{id:2, name:"Washing machine", important:true, photo:false},{id:3, name:"Air conditioner", important:true, photo:false}];
  const [items, _setItems] = useState(defaultItems);
  const [itemsSynced, setItemsSynced] = useState(false);
  const itemsRef = React.useRef(defaultItems);
  const setItems = (v) => {
    _setItems(prev => {
      const newItems = typeof v === "function" ? v(prev) : v;
      itemsRef.current = newItems;
      // Sync to server when landlord changes inventory — on 409, saveForm triggers reloadFormFromServer which restores items
      if (isLL && isReal && fullAddr && peerAddr) {
        saveForm({addr:fullAddr,peerAddr,field:"steps",value:{inventory:newItems}});
        // Reset landlord confirmation when inventory changes — prevents stale ack
        if (landlordAckInventory) {
          setLandlordAckInventory(false);
          saveContractForm({addr:fullAddr,peerAddr,field:"steps",value:{landlordAckInventory:false}}).catch(()=>{});
        }
      }
      return newItems;
    });
  };
  const [newItem, setNewItem] = useState("");
  const [tenantAckInventory, setTenantAckInventory] = useState(false);
  const [landlordAckInventory, setLandlordAckInventory] = useState(false);

  // Step 4 — Wear & Tear
  const [llAckWear, setLlAckWear] = useState(false);
  const [tnAckWear, setTnAckWear] = useState(false);

  // Step 0 — Contract Terms (negotiated, not from listing)
  const [terms, _setTerms] = useState({
    landlordName: "",
    tenantName: "",
    propertyAddress: listing.location || "",
    leaseStartDate: "", // YYYY-MM-DD
    leaseDurationMonths: 6,
    monthlyRent: listing.price || 2,
  });
  const setTerms = (updates) => {
    termsEditingRef.current = Date.now();
    _setTerms(prev => {
      const newTerms = {...prev, ...updates};
      if (isReal && (fullAddr||myAddr) && peerAddr) {
        saveForm({addr:fullAddr||myAddr,peerAddr,field:"steps",value:{terms:newTerms}});
      }
      return newTerms;
    });
  };
  const termsEditingRef = React.useRef(0); // timestamp of last edit
  // Tenant ack of terms
  const [tenantAckTerms, setTenantAckTerms] = useState(false);

  const STEPS = [t("cf.step_terms"), t("cf.step_ids"), t("cf.step_ownership"), t("cf.step_photos"), t("cf.step_inventory"), t("cf.step_propdep"), t("cf.step_sign")];

  // MR comes from negotiated terms, not listing
  const MR = Number(terms.monthlyRent) || listing.price || 2;

  // Step 4 — Property Security Deposit (landlord initiates, tenant confirms)
  const [pdLLskip, setPdLLskip] = useState(false);
  const [pdLLproposed, setPdLLproposed] = useState(false);
  const [pdLLamount, setPdLLamount] = useState(String(MR*2));
  const [pdTNconfirmed, setPdTNconfirmed] = useState(false);

  // Server sync for deposit (real contracts only)
  const [serverForm, setServerForm] = useState(null);
  const [mySig, setMySig] = useState(null);
  const [peerSig, setPeerSig] = useState(null);
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState("");

  // Sync deposit to server — returns true on success, false on 409/failure (UI already rolled back by saveForm)
  const syncDeposit = async (type, amount) => {
    if (!isReal || !fullAddr || !peerAddr) return false;
    const r = await saveForm({ addr: fullAddr, peerAddr, field: "deposit", value: { type, amount: amount||0 } });
    return r.ok;
  };

  // Tenant confirms deposit on server
  const syncDepositConfirm = async () => {
    if (!isReal || !fullAddr || !peerAddr) return;
    try {
      await saveContractForm({ addr: fullAddr, peerAddr, field: "depositConfirm" });
    } catch(e){}
  };

  // Poll server for counterparty state (real contracts) — no auto-reset, form persists between mounts
  useEffect(() => {
    if (!isReal || !fullAddr || !peerAddr) return;
    let cancelled = false;
    const poll = () => {
      if (cancelled) return;
      getContractForm(fullAddr, peerAddr).then(cf=>{
          if (cancelled) return;
          if (!cf) { setServerForm(null); return; }
          setServerForm(cf);
          // Sync deposit from server
          if (cf.deposit) {
            if (cf.deposit.type === "skip" && !isLL) { setPdLLskip(true); setPdLLproposed(false); setPdLLamount(""); }
            if (cf.deposit.type === "set" && !isLL) { setPdLLproposed(true); setPdLLamount(String(cf.deposit.amount)); setPdLLskip(false); }
            if (cf.deposit.confirmed && isLL) { setPdTNconfirmed(true); }
          }
          // Sync photos and documents from server — always rebuild from server truth
          if (cf.photos?.length) setPhotos(cf.photos);
          {
            const docs = cf.documents || [];
            const docMap = {};
            let hasTenantId = false, hasLandlordId = false, hasOwnership = false;
            for (const d of docs) {
              if (d.label && d.cid) docMap[d.label] = d;
              if (d.label === "tenantId") hasTenantId = true;
              if (d.label === "landlordId") hasLandlordId = true;
              if (d.label === "ownership") hasOwnership = true;
            }
            setUploadedDocs(docMap);
            setTenantId(hasTenantId);
            setLandlordId(hasLandlordId);
            setOwnershipDoc(hasOwnership);
          }
          // Sync inventory from server:
          // - Tenant always mirrors landlord's inventory
          // - Landlord only takes server version if local is empty (e.g. after refresh)
          // - Merge photoCid from documents (inv-{id} labels)
          {
            const docs = cf.documents || [];
            const mergePhotos = (inv) => (inv||[]).map(item => {
              const doc = docs.find(d => d.label === "inv-"+item.id);
              if (doc?.cid && !item.photoCid) return {...item, photo: true, photoCid: doc.cid};
              return item;
            });
            if (!isLL) {
              // Tenant always mirrors server inventory
              if (cf.steps?.inventory) _setItems(mergePhotos(cf.steps.inventory));
            } else if (!itemsSynced) {
              // Landlord: on first load, take server version if exists
              if (cf.steps?.inventory) {
                _setItems(mergePhotos(cf.steps.inventory));
              }
              setItemsSynced(true);
            }
          }
          // Sync contract terms — skip if user is actively typing (last 3 sec)
          if (cf.steps?.terms && Date.now() - termsEditingRef.current > 3000) {
            _setTerms(prev => ({...prev, ...cf.steps.terms}));
          }
          // Sync ack states from server
          if (cf.steps?.tenantAckTerms) setTenantAckTerms(true);
          if (cf.steps?.tenantAckPhotos) setTenantAckPhotos(true);
          setLandlordAckPhotos(cf.steps?.landlordAckPhotos === true);
          if (cf.steps?.tenantAckInventory) setTenantAckInventory(true);
          setLandlordAckInventory(cf.steps?.landlordAckInventory === true);
          if (cf.steps?.tenantAckOwnership) setTenantAckOwnership(true);
          if (cf.steps?.landlordAckTenantId) setLandlordAckTenantId(true);
          if (cf.steps?.tenantAckLandlordId) setTenantAckLandlordId(true);
          // Sync signatures
          const myKey = fullAddr.toLowerCase();
          const peerKey = peerAddr.toLowerCase();
          if (cf.signatures?.[myKey]) setMySig(cf.signatures[myKey].sig);
          if (cf.signatures?.[peerKey]) setPeerSig(cf.signatures[peerKey].sig);
        }).catch(()=>{});
    };
    poll();
    const t = setInterval(poll, 3000);
    // iPhone PWA standalone throttles setInterval and may not fire visibilitychange reliably.
    // Listen to focus + pageshow as additional resume triggers.
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    const onFocus = () => poll();
    const onPageShow = () => poll();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => { cancelled=true; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onPageShow); };
  }, [fullAddr, peerAddr, isReal]);

  // Auto-advance step on restore ONLY — skip if form was just reset (fresh contract)
  const [didAutoAdvance, setDidAutoAdvance] = useState(false);
  useEffect(() => {
    if (!serverForm || didAutoAdvance || !isReal) return;
    if (!serverForm.deployed?.agreementId) {
      // Fresh contract — only reset step if there's no form data at all (truly new)
      // If form has steps data (terms, etc), keep user on their current step
      if (step > 0 && !serverForm.steps?.terms) {
        setStep(0);
      }
      setDidAutoAdvance(true);
      return;
    }
    // Resume: deployed contract exists → go to final step
    // But first check if contract was cancelled on-chain
    const agrId = serverForm.deployed.agreementId;
    if (agrId) {
      ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(agrId))).then(hex => {
        if (hex) {
          const state = Number(BigInt("0x" + hex.slice(2 + 10*64, 2 + 11*64)));
          const activated = Number(BigInt("0x" + hex.slice(2 + 8*64, 2 + 9*64)));
          if (state === 8 && !activated) setDeployStatus("__cancelled");
        }
      }).catch(() => {});
    }
    setStep(6); setDidAutoAdvance(true); return;
  }, [serverForm, didAutoAdvance, isReal]);

  // Sign contract with MetaMask or Circle wallet
  const signContract = async () => {
    const provider = getProvider();
    if (!provider || !fullAddr) return;
    // Pre-flight balance check: tenant needs 2×MR (commitment + first rent), landlord needs 1×MR (hosting)
    const requiredAmount = isLL ? MR : MR * 2 + (pdLLproposed ? Number(pdLLamount) : 0);
    const requiredLabel = isLL ? "hosting deposit (1× monthly rent)" : "tenant deposit (commitment + first rent" + (pdLLproposed ? " + property deposit)" : ")");
    if (!await checkUsdcBalance(requiredAmount, requiredLabel)) return;
    try {
      const payload = JSON.stringify({ action: "sign_contract", addr: fullAddr, peer: peerAddr, deposit: pdLLamount, ts: Date.now() });
      const sig = await provider.request({ method: "personal_sign", params: [payload, fullAddr] });
      try { window.focus(); } catch {}
      // Save to server
      await saveContractForm({ addr: fullAddr, peerAddr, field: "signature", value: sig });
      setMySig(sig);
      // Log signature to chat
      if (isReal && fullAddr && peerAddr) {
        try { await sysMsg(fullAddr, peerAddr, t("chat.signed_agreement", {role: isLL ? t("role.landlord") : t("role.tenant")}), isLL ? "landlord" : "tenant", "contract_signed"); } catch(e){}
      }
    } catch(e) {}
  };

  // Deploy on-chain (after both signed)
  // Deploy: Tenant creates agreement + deposits. Landlord deposits later from dashboard.
  const deployOnChain = async () => {
    if (deploying) return;
    if (isLL) {
      // Landlord cannot initiate — only tenant
      alert(t("cf.only_tenant_deploy"));
      return;
    }
    setDeploying(true);
    try {
      const _prov = window.pi2piWallet?.provider || window.ethereum;
      if (_prov) {
        await _prov.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] }).catch(e=>{
          if(e.code===4902) return _prov.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });
        });
      }

      const tenantAddr = fullAddr;
      const landlordAddr = peerAddr;
      const rentWei = BigInt(MR) * BigInt(10 ** USDC_DECIMALS);
      const propDepWei = pdLLproposed ? BigInt(Number(pdLLamount)) * BigInt(10 ** USDC_DECIMALS) : 0n;
      const totalUsdc = rentWei + rentWei + propDepWei;
      // Pre-flight balance check
      const totalRequired = MR + MR + (pdLLproposed ? Number(pdLLamount) : 0);
      if (!await checkUsdcBalance(totalRequired, "tenant deposit (rent + commitment + property deposit)")) {
        setDeploying(false);
        return;
      }
      const contentHash = "0x" + "0".repeat(64);
      const durationMonths = BigInt(terms.leaseDurationMonths || 6);
      const createData = SEL.createAgreement + encAddr(tenantAddr) + encAddr(landlordAddr) + encUint(rentWei) + encUint(propDepWei) + encUint(durationMonths) + encBytes32(contentHash);
      const approveData = SEL.approve + encAddr(ESCROW_ADDRESS) + encUint(totalUsdc);

      let createTx, agreementId;
      const isCircle = window.pi2piWallet && window.pi2piWallet.type === "circle" && typeof window.pi2piWallet.executeBatch === "function";

      if (isCircle) {
        // === ONE FaceID FOR THE WHOLE RENTAL FLOW ===
        // Predict the next agreement ID via eth_call (read nextAgreementId
        // public state). Then batch [approve, createAgreement, tenantDeposit]
        // into a single userOp = single passkey prompt. The risk: another user
        // creates an agreement between our read and our submission — testnet
        // traffic is low so this is acceptable. If predicted ID is wrong, the
        // tenantDeposit call inside the batch will revert and the entire
        // userOp reverts atomically — no partial state.
        setDeployStatus(t("deploy.reading_id"));
        // selector for nextAgreementId() — computed via ethers.id at runtime
        const nextIdSig = (typeof ethers !== "undefined" && ethers.id)
          ? ethers.id("nextAgreementId()").slice(0, 10)
          : null;
        if (!nextIdSig) throw new Error("ethers not available for selector computation");
        const nextIdHex = await rpcCall("eth_call", [{
          to: ESCROW_ADDRESS,
          data: nextIdSig,
        }, "latest"]);
        const predictedId = BigInt(nextIdHex || "0x0");
        console.log("[pi2pi/circle] predicted agreementId:", predictedId.toString());

        const depositData = SEL.tenantDeposit + encUint(predictedId);
        const calls = [
          { to: USDC_ADDRESS, data: approveData },
          { to: ESCROW_ADDRESS, data: createData },
          { to: ESCROW_ADDRESS, data: depositData },
        ];

        setDeployStatus(t("deploy.sign_faceid"));
        createTx = await window.pi2piWallet.executeBatch(calls);
        try { window.focus(); } catch {}
        console.log("[pi2pi/circle] batch userOp tx:", createTx);
        agreementId = "0x" + predictedId.toString(16);
        setDeployStatus(t("deploy.done_waiting"));
      } else {
        // === Legacy 3-sig flow for MetaMask / WalletConnect ===
        setDeployStatus(t("deploy.creating"));
        createTx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, createData);

        setDeployStatus(t("deploy.confirming"));
        const receipt = await waitReceipt(createTx);
        if (!receipt || receipt.status === "0x0") throw new Error("createAgreement reverted");
        agreementId = receipt.logs?.[0]?.topics?.[1] || "0x0";

        setDeployStatus(t("deploy.approving"));
        const approveTx = await sendTxRaw(fullAddr, USDC_ADDRESS, approveData);
        const approveRc = await waitReceipt(approveTx);
        if (!approveRc || approveRc.status === "0x0") throw new Error("USDC approve reverted");

        setDeployStatus(t("deploy.depositing"));
        const depositData = SEL.tenantDeposit + encUint(BigInt(agreementId));
        const depositTx = await sendTxRaw(fullAddr, ESCROW_ADDRESS, depositData);
        const depositRc = await waitReceipt(depositTx);
        if (!depositRc || depositRc.status === "0x0") throw new Error("tenantDeposit reverted");
      }

      // Encrypt + upload contract data to IPFS via Lit Protocol
      // Only tenant and landlord wallets can decrypt
      let ipfsCid = null;
      try {
        setDeployStatus(t("deploy.encrypting"));
        const contractData = {
          version: 1,
          agreementId: agreementId.toString(),
          tenant: tenantAddr,
          landlord: landlordAddr,
          monthlyRent: MR,
          propSecurityDeposit: Number(pdLLamount) || 0,
          leaseDurationMonths: terms.leaseDurationMonths || 6,
          leaseStartDate: terms.leaseStartDate || null,
          contractTerms: {
            landlordName: terms.landlordName,
            tenantName: terms.tenantName,
            propertyAddress: terms.propertyAddress,
            leaseStartDate: terms.leaseStartDate,
            leaseDurationMonths: terms.leaseDurationMonths,
            monthlyRent: terms.monthlyRent,
            standardClauses: {
              terminationProtocol: "pi2pi on-chain (mutual / loss / disputed)",
              vacateAfterTermination: { tenant: "3 days", landlord: "7 days" },
              disputeFreeze: "60 days, wash settlement if unresolved",
              propDepInspectionWindow: "7 days after lease end",
              rentGrace: "standard, extendable up to 14 days by landlord",
            },
          },
          createdAt: Date.now(),
          chain: ACTIVE_NETWORK_NAME,
          escrowAddress: ESCROW_ADDRESS,
          terms: {
            tenantId, landlordId, ownershipDoc, photos, items,
            wearAcknowledged: { landlord: llAckWear, tenant: tnAckWear },
          },
          signatures: { tenant: mySig, landlord: peerSig },
        };
        const result = await encryptAndUploadContract(contractData, tenantAddr, landlordAddr);
        ipfsCid = result.cid;
        console.log("[lit] contract encrypted and uploaded:", ipfsCid);
      } catch (e) {
        console.error("[lit] encryption failed (non-fatal):", e.message);
        // Don't fail the whole flow if encryption fails — contract is already on chain
      }

      // Save to server (with optional CID)
      try {
        await saveContractForm({ addr: fullAddr, peerAddr, field: "deployed", value: { txHash: createTx, agreementId: agreementId.toString(), ipfsCid } });
      } catch(e){}

      setDeployStatus("Done! Waiting for Landlord deposit…");
      await sysMsg(fullAddr, peerAddr, t("chat.agreement_created", {amount: MR*2})+(ipfsCid?t("chat.doc_encrypted"):""), "tenant", "rental_agreement_created");
      if (onComplete) onComplete({ txHash: createTx, agreementId, propDepAgreed: pdLLproposed, propDepAmount: Number(pdLLamount)||0, ipfsCid });
    } catch(err) {
      setDeployStatus(err.code === 4001 ? t("deploy.cancelled") : (err.message || t("err.failed")));
      setDeploying(false);
    }
  };

  const pdFinalAmt = (pdLLproposed && pdTNconfirmed) ? Number(pdLLamount) : 0;
  const pdAgreed = pdLLskip || (pdLLproposed && pdTNconfirmed);

  const termsFilled = !!(terms.landlordName && terms.tenantName && terms.propertyAddress && terms.leaseStartDate && Number(terms.leaseDurationMonths) >= 6 && Number(terms.monthlyRent) > 0);
  const canNext = [
    // Step 0: contract terms agreed
    isLL ? termsFilled : (termsFilled && tenantAckTerms),
    // Step 1: each side uploads own ID + reviews counterparty's
    isLL ? (landlordId && tenantId && landlordAckTenantId) : (tenantId && landlordId && tenantAckLandlordId),
    // Step 2: landlord uploads ownership, tenant reviews
    isLL ? ownershipDoc : (ownershipDoc && tenantAckOwnership),
    // Step 3: landlord uploads photos + confirms, then tenant confirms
    isLL ? (photos.length > 0 && landlordAckPhotos && !photoUploading) : (photos.length > 0 && serverForm?.steps?.landlordAckPhotos === true && tenantAckPhotos),
    // Step 4: inventory — landlord prepares + confirms, then tenant confirms
    isLL ? (items.length > 0 && landlordAckInventory) : (items.length > 0 && landlordAckInventory && tenantAckInventory),
    // Step 5: property deposit agreed
    pdAgreed,
    // Step 6: both signed
    mySig && peerSig,
  ][step];

  const warn = (txt) => (
    <div style={{background:"var(--color-warning-surface)",border:"1.5px solid var(--color-warning-border)",borderRadius:10,padding:"10px 13px",fontSize:12,color:"var(--color-warning)",lineHeight:1.6,marginBottom:14}}>
      {txt}
    </div>
  );

  const [docUploading, setDocUploading] = useState(null);
  const [uploadedDocs, setUploadedDocs] = useState({});
  const docInputRef = React.useRef(null);
  const docInputKeyRef = React.useRef(null);
  const docInputCallbackRef = React.useRef(null);
  const docLastCidRef = React.useRef(null);
  const handleDocFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const key = docInputKeyRef.current;
    const onToggle = docInputCallbackRef.current;
    if (!key || !onToggle) return;
    setDocUploading(key);
    try {
      // Upload document — server encrypts with AES-256 before storing in IPFS
      let cid;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("pinataMetadata", JSON.stringify({name: "pi2pi-" + key + "-" + Date.now()}));
      const data = await uploadFile(formData, true);
      if (!data.cid) throw new Error(data.error || "Upload failed");
      cid = data.cid;
      const encrypted = !!data.encrypted;
      // Save to server first — only commit local state if accepted
      if (isReal && fullAddr && peerAddr) {
        const r = await saveForm({addr:fullAddr,peerAddr,field:"document",value:{label:key,cid,name:file.name,encrypted}});
        if (!r.ok) { setDocUploading(null); return; } // 409 already handled by saveForm (alert + reload)
      }
      setUploadedDocs(d => ({...d, [key]: {cid, name: file.name, encrypted}}));
      docLastCidRef.current = cid;
      onToggle(cid);
    } catch(err) { alert(t("err.upload_failed", {error: err.message})); }
    setDocUploading(null);
    e.target.value = "";
  };
  const UploadSim = ({done, onToggle, icon, label, sub, accept, docKey}) => {
    const key = docKey || label;
    const uploading = docUploading === key;
    const doc = uploadedDocs[key];
    return (
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",border:`1.5px solid ${done?"var(--green)":"var(--border)"}`,borderRadius:12,background:done?"var(--color-primary-surface)":"var(--color-bg-card)",marginBottom:10}}>
        <span style={{fontSize:22}}>{uploading?"":(done?"":icon)}</span>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:13}}>{label}</div>
          <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>
            {uploading ? t("cf.uploading_ipfs") : (done && doc?.cid ? t("cf.ipfs_prefix", {cid: doc.cid.slice(0,12)}) : (done ? t("cf.uploaded") : sub))}
          </div>
        </div>
        {done && doc?.cid && doc.cid !== "dev" && (
          <button type="button" onClick={()=>setLightboxPhoto({name:label,cid:doc.cid})} style={{fontSize:11,color:"var(--accent)",fontWeight:700,cursor:"pointer",padding:"4px 8px",background:"none",border:"none",fontFamily:"var(--ff)"}}>{t("cf.view")}</button>
        )}
        {!done && (
          <button type="button" onClick={()=>{
            docInputKeyRef.current = key;
            docInputCallbackRef.current = onToggle;
            if (docInputRef.current) { docInputRef.current.accept = accept || "image/*,.pdf"; docInputRef.current.click(); }
          }} style={{fontSize:11,color:"white",fontWeight:700,cursor:"pointer",padding:"6px 12px",background:"var(--teal)",border:"none",borderRadius:6,fontFamily:"var(--ff)"}}>
            Upload
          </button>
        )}
      </div>
    );
  };

  const Ack = ({checked, onToggle, text}) => (
    <div onClick={onToggle} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"10px 0",cursor:"pointer"}}>
      <div style={{width:22,height:22,borderRadius:4,border:`2px solid ${checked?"var(--accent)":"var(--border)"}`,background:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1,transition:"all 0.15s"}}>
        {checked&&<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
      </div>
      <div style={{fontSize:13,lineHeight:1.5,color:"var(--text)"}}>{text}</div>
    </div>
  );

  return (
    <div className="cf-wrap">
      {/* Hidden file input for document uploads — triggered by UploadSim button click */}
      <input ref={docInputRef} type="file" style={{display:"none"}} onChange={handleDocFileSelected}/>
      <div className="cf-title">{t("title.rental_agreement")}</div>

      {/* Step bar */}
      <div className="step-bar">
        {STEPS.map((s,i)=>(
          <div key={i} className="step-item">
            <div className="step-line-wrap">
              {i>0&&<div className={`step-conn ${i<=step?"done":""}`}/>}
              <div className={`step-dot ${i<step?"sd-done":i===step?"sd-active":"sd-future"}`}>{i<step?<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>:i+1}</div>
              {i<STEPS.length-1&&<div className={`step-conn ${i<step?"done":""}`}/>}
            </div>
            {i===step && <div className="step-lbl">{s}</div>}
          </div>
        ))}
      </div>

      {/* Inline lock error (replaces native alert) */}
      {formLockError && (
        <div style={{background:"var(--color-danger-surface)",border:"1.5px solid var(--color-danger-border)",borderRadius:10,padding:"10px 13px",fontSize:12,color:"var(--color-danger)",lineHeight:1.6,marginBottom:12}}>
          {formLockError}
        </div>
      )}

      {/* ── Step 0: Contract Terms ── */}
      {step===0&&<React.Fragment>
        <div className="fsec-title">{t("title.contract_terms")}</div>
        <div style={{fontSize:13,color:"var(--muted)",marginBottom:14,lineHeight:1.6}}>
          {isLL ? t("cf.set_terms_ll") : t("cf.review_terms_tn")}
        </div>

        <div style={{fontSize:12,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>{t("cf.parties")}</div>

        <div className="field-label" style={{marginTop:8}}>{t("field.landlord_name")}</div>
        <input className="field-inp" value={terms.landlordName} placeholder={t("ph.as_per_id")}
          disabled={!isLL}
          onChange={e=>setTerms({landlordName: e.target.value})}/>
        <div style={{fontSize:11,color:"var(--muted)",marginTop:4,fontFamily:"monospace"}}>
          {t("cf.wallet_label")} {isLL ? (fullAddr || myAddr || "—") : (peerAddr || "—")}
          <div style={{fontSize:10,color:"var(--dim)",fontFamily:"var(--ff)",marginTop:2}}>
            {t("cf.wallet_info")}
          </div>
        </div>

        <div className="field-label" style={{marginTop:12}}>{t("field.tenant_name")}</div>
        <input className="field-inp" value={terms.tenantName} placeholder={t("ph.as_per_id")}
          disabled={isLL}
          onChange={e=>setTerms({tenantName: e.target.value})}/>
        <div style={{fontSize:11,color:"var(--muted)",marginTop:4,fontFamily:"monospace"}}>
          {t("cf.wallet_label")} {!isLL ? (fullAddr || myAddr || "—") : (peerAddr || "—")}
          <div style={{fontSize:10,color:"var(--dim)",fontFamily:"var(--ff)",marginTop:2}}>
            {t("cf.wallet_info")}
          </div>
        </div>

        <div style={{height:1,background:"var(--border)",margin:"14px 0"}}/>

        <div style={{fontSize:12,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>{t("cf.property_term")}</div>

        <div className="field-label" style={{marginTop:8}}>{t("field.property_address")}</div>
        <input className="field-inp" value={terms.propertyAddress} placeholder={t("ph.street_city")}
          disabled={!isLL}
          onChange={e=>setTerms({propertyAddress: e.target.value})}/>

        <div className="field-label" style={{marginTop:8}}>{t("field.lease_start")}</div>
        <input className="field-inp" type="date" value={terms.leaseStartDate}
          disabled={!isLL}
          onChange={e=>setTerms({leaseStartDate: e.target.value})}/>

        <div className="field-label" style={{marginTop:8}}>{t("field.lease_duration")}</div>
        <input className="field-inp" type="text" inputMode="numeric" value={terms.leaseDurationMonths || ""} placeholder="6"
          disabled={!isLL}
          onChange={e=>setTerms({leaseDurationMonths: e.target.value.replace(/\D/g,"")})}/>
        <div style={{fontSize:11,color: Number(terms.leaseDurationMonths) > 0 && Number(terms.leaseDurationMonths) < 6 ? "var(--color-danger)" : "var(--muted)", marginTop:4}}>
          {Number(terms.leaseDurationMonths) > 0 && Number(terms.leaseDurationMonths) < 6
            ? (getLang()==="ru" ? "Минимальный срок — 6 месяцев" : "Minimum duration — 6 months")
            : (getLang()==="ru" ? "Минимум 6 месяцев" : "Minimum 6 months")}
        </div>
        {terms.leaseStartDate && Number(terms.leaseDurationMonths) >= 6 && (
          <div style={{fontSize:11,color:"var(--muted)",marginTop:4}}>
            {t("cf.lease_ends", {date: new Date(new Date(terms.leaseStartDate).setMonth(new Date(terms.leaseStartDate).getMonth()+Number(terms.leaseDurationMonths))).toISOString().slice(0,10)})}
          </div>
        )}

        <div className="field-label" style={{marginTop:8}}>{t("field.monthly_rent")}</div>
        <input className="field-inp" type="text" inputMode="decimal" value={terms.monthlyRent || ""}
          disabled={!isLL} placeholder="0"
          onChange={e=>setTerms({monthlyRent: e.target.value.replace(/[^\d.]/g,"")})}/>
        <div style={{fontSize:11,color:"var(--muted)",marginTop:4,lineHeight:1.5}}>
          {t("cf.commitment_dep", {amount: MR})}<br/>
          {t("cf.hosting_dep", {amount: MR})}<br/>
          {t("cf.both_equal")}
        </div>

        <div style={{height:1,background:"var(--border)",margin:"14px 0"}}/>

        <div style={{fontSize:12,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>{t("cf.protocol_terms")}</div>
        <div style={{background:"var(--bg2)",borderRadius:10,padding:"12px",fontSize:12,lineHeight:1.7,color:"var(--text)"}}>
          <strong>{t("cf.term_termination")}</strong> {t("cf.term_termination_desc")}<br/>
          <strong>{t("cf.term_vacate")}</strong> {t("cf.term_vacate_desc")}<br/>
          <strong>{t("cf.term_disputes")}</strong> {t("cf.term_disputes_desc")}<br/>
          <strong>{t("cf.term_propdep")}</strong> {t("cf.term_propdep_desc")}<br/>
          <strong>{t("cf.term_grace")}</strong> {t("cf.term_grace_desc")}
        </div>

        {isLL && (
          <div style={{fontSize:12,color:serverForm?.steps?.tenantAckTerms?"var(--green)":"var(--muted)",padding:"10px 0 0"}}>
            {serverForm?.steps?.tenantAckTerms?t("cf.tenant_confirmed_terms"):t("cf.waiting_tenant_terms")}
          </div>
        )}
        {!isLL && termsFilled && (
          <div style={{marginTop:14}}>
            <Ack checked={tenantAckTerms} onToggle={()=>{
              const next = !tenantAckTerms;
              setTenantAckTerms(next);
              if (isReal && (fullAddr||myAddr) && peerAddr) saveContractForm({addr:fullAddr||myAddr,peerAddr,field:"steps",value:{tenantAckTerms:next}}).catch(()=>{});
            }} text={t("cf.ack_tenant_terms")}/>
          </div>
        )}
        {!isLL && !termsFilled && (
          <div style={{fontSize:12,color:"var(--muted)",padding:"10px 0 0"}}>{t("cf.waiting_ll_terms")}</div>
        )}
      </React.Fragment>}

      {/* ── Step 1: IDs ── */}
      {step===1&&<React.Fragment>
        <div className="fsec-title">{t("title.national_id")}</div>
        {warn(t("cf.id_warning"))}

        <div style={{fontSize:12,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>{t("cf.upload_your_id")}</div>
        {isLL ? (
          <React.Fragment>
            <UploadSim done={landlordId} onToggle={()=>setLandlordId(v=>!v)} icon="" label={t("cf.landlord_national_id")} docKey="landlordId" sub={t("cf.upload_national_id")}/>
            {tenantId && uploadedDocs["tenantId"]?.cid ? (
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",border:"1.5px solid var(--green)",borderRadius:12,background:"var(--color-primary-surface)",marginBottom:10}}>
                <span style={{fontSize:22}}></span>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13}}>{t("cf.tenant_national_id")}</div><div style={{fontSize:11,color:"var(--muted)"}}>{t("cf.uploaded")}</div></div>
                <span onClick={()=>setLightboxPhoto({name:"Tenant ID",cid:uploadedDocs["tenantId"].cid})} style={{fontSize:11,color:"var(--accent)",fontWeight:700,cursor:"pointer",padding:"4px 8px"}}>{t("prop.view_id")}</span>
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",border:"1.5px solid var(--border)",borderRadius:12,background:"var(--color-bg-card)",marginBottom:10}}>
                <span style={{fontSize:22}}></span>
                <div><div style={{fontWeight:700,fontSize:13,color:"var(--muted)"}}>{t("cf.waiting_tenant_id")}</div></div>
              </div>
            )}
          </React.Fragment>
        ) : (
          <React.Fragment>
            <UploadSim done={tenantId} onToggle={()=>setTenantId(v=>!v)} icon="" label={t("cf.tenant_national_id")} docKey="tenantId" sub={t("cf.upload_national_id")}/>
            {landlordId && uploadedDocs["landlordId"]?.cid ? (
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",border:"1.5px solid var(--green)",borderRadius:12,background:"var(--color-primary-surface)",marginBottom:10}}>
                <span style={{fontSize:22}}></span>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13}}>{t("cf.landlord_national_id")}</div><div style={{fontSize:11,color:"var(--muted)"}}>{t("cf.uploaded")}</div></div>
                <span onClick={()=>setLightboxPhoto({name:"Landlord ID",cid:uploadedDocs["landlordId"].cid})} style={{fontSize:11,color:"var(--accent)",fontWeight:700,cursor:"pointer",padding:"4px 8px"}}>{t("prop.view_id")}</span>
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",border:"1.5px solid var(--border)",borderRadius:12,background:"var(--color-bg-card)",marginBottom:10}}>
                <span style={{fontSize:22}}></span>
                <div><div style={{fontWeight:700,fontSize:13,color:"var(--muted)"}}>{t("cf.waiting_landlord_id")}</div></div>
              </div>
            )}
          </React.Fragment>
        )}

        <div style={{height:1,background:"var(--border)",margin:"14px 0"}}/>
        <div style={{fontSize:12,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>{t("cf.ack_by_party")}</div>

        {isLL && tenantId && <Ack checked={landlordAckTenantId} onToggle={()=>{
          setLandlordAckTenantId(v=>!v);
          if (isReal && (fullAddr||myAddr) && peerAddr) saveContractForm({addr:fullAddr||myAddr,peerAddr,field:"steps",value:{landlordAckTenantId:true}}).catch(()=>{});
        }} text={t("cf.ll_ack_tenant_id")}/>}
        {!isLL && landlordId && <Ack checked={tenantAckLandlordId} onToggle={()=>{
          setTenantAckLandlordId(v=>!v);
          if (isReal && (fullAddr||myAddr) && peerAddr) saveContractForm({addr:fullAddr||myAddr,peerAddr,field:"steps",value:{tenantAckLandlordId:true}}).catch(()=>{});
        }} text={t("cf.tn_ack_landlord_id")}/>}
        {isLL && !tenantId && <div style={{fontSize:12,color:"var(--muted)",padding:"6px 0"}}>{t("cf.waiting_tenant_upload")}</div>}
        {isLL && tenantId && landlordAckTenantId && <div style={{fontSize:12,color:serverForm?.steps?.tenantAckLandlordId?"var(--green)":"var(--muted)",padding:"6px 0"}}>{serverForm?.steps?.tenantAckLandlordId?t("cf.tenant_confirmed_id"):t("cf.waiting_tenant_review_id")}</div>}
        {!isLL && !landlordId && <div style={{fontSize:12,color:"var(--muted)",padding:"6px 0"}}>{t("cf.waiting_landlord_upload")}</div>}
        {!isLL && landlordId && tenantAckLandlordId && <div style={{fontSize:12,color:serverForm?.steps?.landlordAckTenantId?"var(--green)":"var(--muted)",padding:"6px 0"}}>{serverForm?.steps?.landlordAckTenantId?t("cf.landlord_confirmed_id"):t("cf.waiting_landlord_review_id")}</div>}
      </React.Fragment>}

      {/* ── Step 1: Ownership ── */}
      {step===2&&<React.Fragment>
        <div className="fsec-title">{t("title.proof_of_ownership")}</div>
        {warn(t("cf.ownership_warning"))}

        {isLL ? (
          <UploadSim done={ownershipDoc} onToggle={()=>setOwnershipDoc(v=>!v)} icon="" label={t("cf.ownership_cert")} docKey="ownership" sub={t("cf.upload_ownership")}/>
        ) : (
          ownershipDoc && uploadedDocs["ownership"]?.cid ? (
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",border:"1.5px solid var(--green)",borderRadius:12,background:"var(--color-primary-surface)",marginBottom:10}}>
              <span style={{fontSize:22}}></span>
              <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13}}>{t("cf.ownership_cert")}</div><div style={{fontSize:11,color:"var(--muted)"}}>{t("cf.uploaded_by_ll")}</div></div>
              <span onClick={()=>setLightboxPhoto({name:"Property Ownership",cid:uploadedDocs["ownership"].cid})} style={{fontSize:11,color:"var(--accent)",fontWeight:700,cursor:"pointer",padding:"4px 8px"}}>{t("cf.view")}</span>
            </div>
          ) : (
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",border:"1.5px solid var(--border)",borderRadius:12,background:"var(--color-bg-card)",marginBottom:10}}>
              <span style={{fontSize:22}}></span>
              <div><div style={{fontWeight:700,fontSize:13,color:"var(--muted)"}}>{t("cf.waiting_ll_ownership")}</div></div>
            </div>
          )
        )}

        {ownershipDoc && !isLL && <React.Fragment>
          <div style={{height:1,background:"var(--border)",margin:"14px 0"}}/>
          <Ack checked={tenantAckOwnership} onToggle={()=>{
            setTenantAckOwnership(v=>!v);
            if (isReal && (fullAddr||myAddr) && peerAddr) saveContractForm({addr:fullAddr||myAddr,peerAddr,field:"steps",value:{tenantAckOwnership:true}}).catch(()=>{});
          }} text={t("cf.tn_ack_ownership")}/>
        </React.Fragment>}
        {ownershipDoc && isLL && <div style={{fontSize:12,color:serverForm?.steps?.tenantAckOwnership?"var(--green)":"var(--muted)",padding:"6px 0"}}>{serverForm?.steps?.tenantAckOwnership?t("cf.tenant_confirmed_ownership"):t("cf.waiting_tenant_review")}</div>}
      </React.Fragment>}

      {/* ── Step 2: Photos ── */}
      {step===3&&<React.Fragment>
        <div className="fsec-title">{t("title.property_photos")}</div>
        <div style={{fontSize:13,color:"var(--muted)",marginBottom:14,lineHeight:1.6}}>
          {isLL ? t("cf.photos_ll") : t("cf.photos_tn")}
        </div>

        <div style={{fontSize:12,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>
          {t("cf.property_photos_count", {count: photos.length, max: MAX_PHOTOS})}
        </div>

        {/* Photo grid — clickable for fullscreen */}
        {photos.length > 0 && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:6,marginBottom:10}}>
            {photos.map((p, idx) => (
              <div key={idx} onClick={()=>setLightboxPhoto(p)} style={{position:"relative",aspectRatio:"1",borderRadius:8,overflow:"hidden",border:"1.5px solid var(--green)",cursor:"pointer",background:"var(--bg2)"}}>
                <img src={p.url || (p.cid && p.cid !== "dev" ? PINATA_GW + p.cid : "")} alt={p.name}
                  style={{width:"100%",height:"100%",objectFit:"cover"}}
                  onError={e=>{e.target.style.display="none"}}/>
                {(!p.url && (!p.cid || p.cid === "dev")) && (
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}></div>
                )}
                {isLL && (
                  <button onClick={(e)=>{e.stopPropagation();
                    setPhotos(ps=>ps.filter((_,i)=>i!==idx));
                    if (landlordAckPhotos) { setLandlordAckPhotos(false); const a=fullAddr||myAddr||window.pi2piWallet?._circleAddress; if (isReal && a && peerAddr) saveContractForm({addr:a,peerAddr,field:"steps",value:{landlordAckPhotos:false}}).catch(()=>{}); }
                    if (isReal && fullAddr && peerAddr) saveForm({addr:fullAddr,peerAddr,field:"removePhoto",value:{index:idx}});
                  }} style={{position:"absolute",top:4,right:4,background:"rgba(0,0,0,0.6)",color:"white",border:"none",borderRadius:"50%",width:22,height:22,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>✕</button>
                )}
                <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,0.5)",color:"white",fontSize:9,padding:"2px 4px",textOverflow:"ellipsis",overflow:"hidden",whiteSpace:"nowrap"}}>{p.name || `Photo ${idx+1}`}</div>
              </div>
            ))}
          </div>
        )}

        {/* Upload button — landlord only */}
        {isLL && photos.length < MAX_PHOTOS && (
          <label style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"14px",border:"2px dashed var(--border)",borderRadius:10,cursor:photoUploading?"wait":"pointer",marginBottom:8,fontSize:13,fontWeight:700,color:"var(--teal)"}}>
            <span style={{fontSize:18}}></span>
            {photoUploading ? t("cf.uploading_ipfs") : t("cf.tap_add_photo")}
            <input type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp,image/*" multiple style={{display:"none"}} disabled={photoUploading} onChange={async(e)=>{
              const files = Array.from(e.target.files || []);
              if (!files.length) return;
              setPhotoUploading(true);
              for (const file of files) {
                if (file.size > MAX_FILE_SIZE) { alert(t("err.file_too_large", {size: MAX_FILE_SIZE/1024/1024}) + ": " + file.name); continue; }
                if (photos.length >= MAX_PHOTOS) { alert(t("err.max_photos", {count: MAX_PHOTOS})); break; }
                try {
                  const formData = new FormData();
                  formData.append("file", file);
                  formData.append("pinataMetadata", JSON.stringify({name: "pi2pi-photo-" + Date.now()}));
                  const data = await uploadFile(formData, false);
                  if (data.cid) {
                    const photoObj = { name: file.name, cid: data.cid, url: URL.createObjectURL(file), size: file.size };
                    setPhotos(ps => [...ps, photoObj]);
                    if (landlordAckPhotos) { setLandlordAckPhotos(false); const a=fullAddr||myAddr||window.pi2piWallet?._circleAddress; if (isReal && a && peerAddr) saveContractForm({addr:a,peerAddr,field:"steps",value:{landlordAckPhotos:false}}).catch(()=>{}); }
                    if (isReal && fullAddr && peerAddr) {
                      saveForm({addr:fullAddr,peerAddr,field:"photo",value:{name:file.name,cid:data.cid}});
                    }
                  } else { alert(t("err.upload_failed", {error: data.error || "unknown"}) + ": " + file.name); }
                } catch(err) { alert(t("err.upload_failed", {error: err.message})); }
              }
              setPhotoUploading(false);
              e.target.value = "";
            }}/>
          </label>
        )}
        {isLL && photos.length >= MAX_PHOTOS && <div style={{fontSize:11,color:"var(--color-warning)",marginBottom:8}}>{t("cf.max_photos_reached", {max: MAX_PHOTOS})}</div>}
        {!isLL && photos.length === 0 && <div style={{fontSize:12,color:"var(--muted)",padding:"12px",textAlign:"center"}}>{t("body.waiting_photos")}</div>}

        {photos.length>0&&<React.Fragment>
          <div style={{height:1,background:"var(--border)",margin:"14px 0"}}/>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:6}}>{t("cf.tap_fullscreen")}</div>
          {/* Landlord: confirm photos are complete */}
          {isLL && <Ack checked={landlordAckPhotos} onToggle={()=>{
            const next = !landlordAckPhotos;
            setLandlordAckPhotos(next);
            const addr = fullAddr || myAddr || window.pi2piWallet?._circleAddress;
            const peer = peerAddr;
            if (isReal && addr && peer) saveContractForm({addr,peerAddr:peer,field:"steps",value:{landlordAckPhotos:next}}).catch(()=>{});
          }} text={t("cf.ll_ack_photos")}/>}
          {isLL && <div style={{fontSize:12,color:serverForm?.steps?.tenantAckPhotos?"var(--green)":"var(--muted)",padding:"6px 0"}}>{serverForm?.steps?.tenantAckPhotos?t("cf.tenant_confirmed_photos"):t("cf.waiting_tenant_photos")}</div>}
          {/* Tenant: gated by landlord confirmation */}
          {!isLL && !serverForm?.steps?.landlordAckPhotos && (
            <div style={{background:"var(--color-warning-surface)",border:"1.5px solid var(--color-warning-border)",borderRadius:10,padding:"10px 13px",fontSize:12,color:"var(--color-warning)",lineHeight:1.6}}>
              {t("cf.waiting_landlord_photos")}
            </div>
          )}
          {!isLL && serverForm?.steps?.landlordAckPhotos === true && <Ack checked={tenantAckPhotos} onToggle={()=>{
            setTenantAckPhotos(v=>!v);
            if (isReal && (fullAddr||myAddr) && peerAddr) saveContractForm({addr:fullAddr||myAddr,peerAddr,field:"steps",value:{tenantAckPhotos:true}}).catch(()=>{});
          }} text={t("cf.tn_ack_photos", {count: photos.length})}/>}
        </React.Fragment>}

      </React.Fragment>}

      {/* ── Step 3: Inventory ── */}
      {step===4&&isLL&&isReal&&fullAddr&&peerAddr&&!serverForm?.steps?.inventory&&(() => {
        // First time landlord enters inventory step — sync current items to server
        saveForm({addr:fullAddr,peerAddr,field:"steps",value:{inventory:items}});
        return null;
      })()}
      {step===4&&<React.Fragment>
        <div className="fsec-title">{t("title.property_inventory")}</div>
        <div style={{fontSize:13,color:"var(--muted)",marginBottom:14,lineHeight:1.6}}>
          {isLL ? t("cf.inventory_ll") : t("cf.inventory_tn")}
        </div>

        {items.map(item=>(
          <div key={item.id} style={{padding:"10px 12px",border:"1.5px solid var(--border)",borderRadius:10,marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>{item.important?"":""}</span>
              <span style={{flex:1,fontWeight:600,fontSize:13}}>{item.name}</span>
              {isLL && (
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>setItems(it=>it.map(i=>i.id===item.id?{...i,important:!i.important}:i))}
                    style={{fontSize:10,padding:"2px 8px",borderRadius:6,border:`1.5px solid ${item.important?"var(--color-warning)":"var(--border)"}`,background:item.important?"var(--color-warning-surface)":"var(--color-bg-card)",cursor:"pointer",fontFamily:"var(--ff)",fontWeight:700,color:item.important?"var(--color-warning)":"var(--muted)"}}>
                    {item.important?""+t("cf.important"):""+t("cf.mark")}
                  </button>
                  <button onClick={()=>{
                    if (item.photo && (item.photoCid || uploadedDocs["inv-"+item.id]?.cid)) {
                      setLightboxPhoto({name:item.name,cid:item.photoCid || uploadedDocs["inv-"+item.id]?.cid});
                    } else {
                      docInputKeyRef.current = "inv-"+item.id;
                      docInputCallbackRef.current = (cid)=>{
                        const finalCid = cid || docLastCidRef.current;
                        setItems(it=>it.map(i=>i.id===item.id?{...i,photo:true,photoCid:finalCid}:i));
                      };
                      if(docInputRef.current){docInputRef.current.accept="image/*";docInputRef.current.click();}
                    }
                  }} style={{fontSize:10,padding:"2px 8px",borderRadius:6,border:`1.5px solid ${item.photo?"var(--teal)":"var(--border)"}`,background:item.photo?"var(--color-primary-surface)":"var(--color-bg-card)",cursor:"pointer",fontFamily:"var(--ff)",fontWeight:700,color:item.photo?"var(--teal)":"var(--muted)"}}>
                    {docUploading===("inv-"+item.id)?"...":<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>}
                  </button>
                  <button onClick={()=>setItems(it=>it.filter(i=>i.id!==item.id))}
                    style={{fontSize:14,padding:"2px 8px",borderRadius:6,border:"1px solid var(--color-danger-border)",background:"var(--color-danger-surface)",cursor:"pointer",color:"var(--color-danger)",fontWeight:700}}>✕</button>
                </div>
              )}
              {!isLL && item.photo && (item.photoCid || uploadedDocs["inv-"+item.id]?.cid) && (
                <button onClick={()=>setLightboxPhoto({name:item.name,cid:item.photoCid || uploadedDocs["inv-"+item.id]?.cid})}
                  style={{fontSize:10,padding:"2px 8px",borderRadius:6,border:"1px solid var(--teal)",background:"none",cursor:"pointer",fontFamily:"var(--ff)",fontWeight:700,color:"var(--teal)"}}>{t("cf.view")}</button>
              )}
            </div>
          </div>
        ))}

        {/* Add item — landlord only */}
        {isLL && (
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            <input className="field-inp" style={{flex:1}} placeholder={t("ph.add_item")}
              value={newItem} onChange={e=>setNewItem(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&newItem.trim()){setItems(it=>[...it,{id:Date.now(),name:newItem.trim(),important:false,photo:false}]);setNewItem("");}}}/>
            <button className="bb-btn" style={{padding:"0 14px",whiteSpace:"nowrap"}}
              onClick={()=>{if(newItem.trim()){setItems(it=>[...it,{id:Date.now(),name:newItem.trim(),important:false,photo:false}]);setNewItem("");}}}>
              + {t("cf.add")}
            </button>
          </div>
        )}

        {items.length>0&&<React.Fragment>
          <div style={{height:1,background:"var(--border)",margin:"4px 0 12px"}}/>
          {/* Landlord: confirm inventory is complete */}
          {isLL && <Ack checked={landlordAckInventory} onToggle={()=>{
            const next = !landlordAckInventory;
            setLandlordAckInventory(next);
            const addr = fullAddr || myAddr || window.pi2piWallet?._circleAddress;
            const peer = peerAddr;
            if (isReal && addr && peer) saveContractForm({addr,peerAddr:peer,field:"steps",value:{landlordAckInventory:next}}).catch(()=>{});
          }} text="I confirm the inventory is complete and ready for tenant review."/>}
          {isLL && <div style={{fontSize:12,color:serverForm?.steps?.tenantAckInventory?"var(--green)":"var(--muted)",padding:"6px 0"}}>{serverForm?.steps?.tenantAckInventory?t("cf.tenant_confirmed_inventory"):t("cf.waiting_tenant_inventory")}</div>}
          {/* Tenant: gated by landlord confirmation */}
          {!isLL && !serverForm?.steps?.landlordAckInventory && (
            <div style={{background:"var(--color-warning-surface)",border:"1.5px solid var(--color-warning-border)",borderRadius:10,padding:"10px 13px",fontSize:12,color:"var(--color-warning)",lineHeight:1.6}}>
              Waiting for landlord to complete the inventory. You can discuss details in chat.
            </div>
          )}
          {!isLL && serverForm?.steps?.landlordAckInventory && <Ack checked={tenantAckInventory} onToggle={()=>{
            setTenantAckInventory(v=>!v);
            const addr = fullAddr || myAddr || window.pi2piWallet?._circleAddress;
            const peer = peerAddr;
            if (isReal && addr && peer) saveContractForm({addr,peerAddr:peer,field:"steps",value:{tenantAckInventory:true}}).catch(()=>{});
          }} text={t("cf.tn_ack_inventory")}/>}
        </React.Fragment>}
      </React.Fragment>}

      {/* ── Step 4: Property Security Deposit ── */}
      {step===5&&<React.Fragment>
        <div className="fsec-title">{t("cf.propdep_title")}</div>
        <div style={{fontSize:13,color:"var(--muted)",marginBottom:14,lineHeight:1.6}}>
          {t("cf.propdep_desc")}
        </div>

        {/* Landlord sets amount — only visible to landlord for real contracts */}
        {(!isReal || isLL) && <div style={{background:"var(--bg2)",borderRadius:12,padding:"13px 14px",marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:10}}>{t("cf.propdep_landlord")}</div>

          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <div onClick={async()=>{const ok = await syncDeposit("skip"); if(!ok){return;} setPdLLskip(v=>!v); setPdLLproposed(false); setPdLLamount(""); setPdTNconfirmed(false);}}
              style={{flex:1,padding:"9px",borderRadius:8,border:`2px solid ${pdLLskip?"var(--accent)":"var(--border)"}`,background:pdLLskip?"var(--color-primary-surface)":"var(--color-bg-card)",textAlign:"center",cursor:"pointer",fontWeight:700,fontSize:12,transition:"all 0.15s"}}>
              {pdLLskip?"":""}{t("cf.no_deposit_required")}
            </div>
          </div>

          {!pdLLskip&&<React.Fragment>
            <div style={{fontSize:12,color:"var(--muted)",marginBottom:6}}>{t("cf.set_deposit_amount")}</div>
            <div style={{display:"flex",gap:8}}>
              <input className="field-inp" style={{flex:1}} type="number"
                placeholder={t("cf.amount_max", {max: (MR*3).toLocaleString()})}
                value={pdLLamount}
                onChange={e=>{
                  const v = Math.min(MR*3, Math.max(0, Number(e.target.value)));
                  setPdLLamount(v||"");
                  setPdLLproposed(false);
                  setPdTNconfirmed(false);
                }}/>
              <button className="bb-btn" style={{padding:"0 14px",whiteSpace:"nowrap"}}
                onClick={async()=>{ if(Number(pdLLamount)>0){ const ok = await syncDeposit("set", Number(pdLLamount)); if(ok) setPdLLproposed(true); } }}>
                {pdLLproposed?""+t("cf.set"):t("cf.set")}
              </button>
            </div>
            {pdLLamount && Number(pdLLamount)>0 &&
              <div style={{fontSize:11,color:"var(--muted)",marginTop:5}}>
                {t("cf.x_monthly", {x: (Number(pdLLamount)/MR).toFixed(2), max: (MR*3).toLocaleString()})}
              </div>}
          </React.Fragment>}
        </div>}

        {/* Tenant waiting for landlord — real contracts only */}
        {isReal && !isLL && !pdLLskip && !pdLLproposed && (
          <div style={{background:"var(--bg2)",borderRadius:12,padding:"16px",marginBottom:14,textAlign:"center"}}>
            <div className="spinner" style={{margin:"0 auto 8px"}}/>
            <div style={{fontSize:13,fontWeight:700,color:"var(--muted)"}}>{t("cf.waiting_ll_deposit")}</div>
            <div style={{fontSize:11,color:"var(--dim)",marginTop:4}}>{t("cf.ll_decides")}</div>
          </div>
        )}

        {/* Tenant confirms */}
        {(pdLLskip || pdLLproposed) && (!isReal || !isLL) && (
          <div style={{background:"var(--bg2)",borderRadius:12,padding:"13px 14px",marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:10}}>{t("cf.propdep_tenant")}</div>

            {pdLLskip ? (
              <div style={{padding:"10px 12px",borderRadius:8,border:"2px solid var(--green)",background:"var(--color-primary-surface)",color:"var(--color-primary)",fontWeight:700,fontSize:12,textAlign:"center"}}>
                {t("cf.no_deposit_info")}
              </div>
            ) : (
              <React.Fragment>
                <div style={{fontSize:12,color:"var(--muted)",marginBottom:8}}>
                  {t("cf.ll_requires_deposit", {amount: Number(pdLLamount).toLocaleString()})}
                </div>
                <div style={{fontSize:11,color:"var(--color-info)",marginBottom:10}}>
                  {t("cf.yield_estimate", {tenantYield: (Number(pdLLamount)*4.2/100/12*0.70).toFixed(2), pi2piYield: (Number(pdLLamount)*4.2/100/12*0.30).toFixed(2)})}
                </div>
                <div onClick={()=>{setPdTNconfirmed(v=>!v);syncDepositConfirm();}}
                  style={{padding:"10px 12px",borderRadius:8,border:`2px solid ${pdTNconfirmed?"var(--green)":"var(--border)"}`,background:pdTNconfirmed?"var(--color-primary-surface)":"var(--color-bg-card)",color:pdTNconfirmed?"var(--color-primary)":"var(--color-text-primary)",cursor:"pointer",fontWeight:700,fontSize:12,textAlign:"center",transition:"all 0.15s"}}>
                  {pdTNconfirmed?t("cf.agreed_will_deposit", {amount: Number(pdLLamount).toLocaleString()}):t("cf.agree_provide")}
                </div>
              </React.Fragment>
            )}
          </div>
        )}

        {/* Agreed state — only show when deposit IS required and tenant confirmed */}
        {pdLLproposed && pdTNconfirmed && (
          <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10,padding:"10px 12px",fontSize:13,fontWeight:700,color:"var(--color-primary)",textAlign:"center"}}>
            {t("cf.deposit_agreed", {amount: Number(pdLLamount).toLocaleString()})}
          </div>
        )}
      </React.Fragment>}

      {/* ── Step 5: Sign & Deploy ── */}
      {step===6&&<React.Fragment>
        <div className="fsec-title">{t("title.sign_deploy")}</div>

        {/* Summary */}
        <div style={{background:"var(--bg2)",borderRadius:12,padding:"14px",marginBottom:14,fontSize:12,lineHeight:1.8}}>
          <div style={{fontWeight:700,marginBottom:6}}>{t("cf.agreement_summary")}</div>
          <div>{t("cf.monthly_rent_label")}: <strong>{MR} USDC</strong></div>
          <div>{t("cf.commitment_dep_label")}: <strong>{MR} USDC</strong></div>
          <div>{t("cf.hosting_dep_label")}: <strong>{MR} USDC</strong></div>
          {pdLLproposed && <div>{t("cf.propdep_label")}: <strong>{Number(pdLLamount).toLocaleString()} USDC</strong></div>}
          {pdLLskip && <div>{t("cf.propdep_label")}: <strong>{t("cf.none")}</strong></div>}
          <div style={{marginTop:6,color:"var(--muted)"}}>{t("cf.tenant_total")}: <strong>{(MR*2 + (pdLLproposed?Number(pdLLamount):0)).toLocaleString()} USDC</strong> {t("cf.rent_commit_propdep")}</div>
          <div style={{color:"var(--muted)"}}>{t("cf.landlord_total")}: <strong>{MR} USDC</strong> {t("cf.hosting_deposit_note")}</div>
        </div>

        {/* Review Full Agreement button */}
        <button onClick={()=>setShowFullAgreement(true)}
          style={{width:"100%",padding:"10px",borderRadius:10,background:"var(--color-bg-secondary)",color:"var(--color-text-primary)",border:"1px solid var(--color-border)",fontFamily:"var(--ff)",fontWeight:600,fontSize:12,cursor:"pointer",marginBottom:14,letterSpacing:"-0.1px"}}>
          {t("btn.review_full_agreement")}
        </button>

        {/* Signatures */}
        <div style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 0",borderBottom:"1px solid var(--border)"}}>
            <div style={{width:22,height:22,borderRadius:4,background:"transparent",border:mySig?"2px solid var(--accent)":"2px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{mySig&&<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:13}}>{t("cf.your_signature")}</div>
              <div style={{fontSize:11,color:"var(--muted)"}}>{mySig?t("cf.signed"):t("cf.not_signed")}</div>
            </div>
            {!mySig && (
              <button onClick={signContract}
                style={{padding:"8px 14px",borderRadius:8,background:"var(--accent)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {t("cf.sign")}
              </button>
            )}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 0"}}>
            <div style={{width:22,height:22,borderRadius:4,background:"transparent",border:peerSig?"2px solid var(--accent)":"2px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{peerSig?<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:13}}>{t("cf.counterparty_signature")}</div>
              <div style={{fontSize:11,color:"var(--muted)"}}>{peerSig?t("cf.signed"):t("cf.waiting_signature")}</div>
            </div>
          </div>
        </div>

        {/* Deploy on-chain */}
        {mySig && peerSig && !deploying && deployStatus !== t("deploy.done") && (
          <React.Fragment>
            {!isLL ? (
              /* TENANT: create + deposit */
              <React.Fragment>
                <div style={{background:"var(--bg2)",borderRadius:12,padding:"14px",marginBottom:14,fontSize:12,lineHeight:1.8}}>
                  <div style={{fontWeight:700,marginBottom:6}}>{t("cf.you_will_pay")}</div>
                  <div>• {t("cf.first_rent_to_ll", {mr: MR})}</div>
                  <div>• {t("cf.commitment_to_escrow", {mr: MR})}</div>
                  {pdLLproposed && <div>• {t("cf.propdep_to_escrow", {amount: Number(pdLLamount)})}</div>}
                  <div style={{marginTop:6,fontWeight:700}}>{t("cf.total_gas", {total: parseFloat((MR*2 + (pdLLproposed?Number(pdLLamount):0)).toFixed(2))})}</div>
                </div>
                <button className="btn-p" onClick={deployOnChain}>Sign & Deposit </button>
              </React.Fragment>
            ) : (
              /* LANDLORD: wait for tenant, or if tenant already deployed — show deposit button */
              serverForm?.deployed?.agreementId ? (
                deployStatus === "__cancelled" ? (
                  <div style={{background:"var(--color-danger-surface)",border:"1.5px solid var(--color-danger-border)",borderRadius:12,padding:"14px",marginBottom:14,textAlign:"center"}}>
                    <div style={{fontSize:20,marginBottom:8}}>⛔</div>
                    <div style={{fontWeight:700,color:"var(--color-danger)",fontSize:14,marginBottom:6}}>{getLang()==="ru" ? "Контракт отменён" : "Contract cancelled"}</div>
                    <div style={{fontSize:12,color:"var(--color-danger-dark)"}}>{getLang()==="ru" ? "Вы не внесли депозит в течение 24 часов. Средства арендатора возвращены." : "You did not deposit within 24 hours. Tenant funds returned."}</div>
                  </div>
                ) : <React.Fragment>
                  <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:12,padding:"14px",marginBottom:14}}>
                    <div style={{fontWeight:700,color:"var(--green)",fontSize:13,marginBottom:6}}>{t("cf.tenant_deployed")}</div>
                    <div style={{fontSize:12,color:"var(--muted)"}}>{t("cf.lock_hosting", {mr: MR})}</div>
                  </div>
                  <button className="btn-p" onClick={async ()=>{
                    setDeploying(true);
                    try {
                      const _p = getProvider();
                      if (_p) {
                        await _p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] }).catch(e=>{
                          if(e.code===4902) return _p.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });
                        });
                      }
                      const rentWei = BigInt(MR) * BigInt(10 ** USDC_DECIMALS);
                      const agrId = serverForm.deployed.agreementId;
                      // Pre-flight balance check
                      if (!await checkUsdcBalance(MR, "landlord hosting deposit")) {
                        setDeploying(false);
                        return;
                      }
                      const approveData = SEL.approve + encAddr(ESCROW_ADDRESS) + encUint(rentWei);
                      const depData = SEL.landlordDeposit + encUint(BigInt(agrId));
                      // Simple path: always use sendTxRaw (which uses getProvider() internally)
                      // After refresh, lazy reconnect happens on first sendTxRaw call automatically
                      setDeployStatus(t("deploy.approving"));
                      await sendTxRaw(fullAddr, USDC_ADDRESS, approveData).then(waitReceipt);
                      setDeployStatus(t("deploy.locking"));
                      await sendTxRaw(fullAddr, ESCROW_ADDRESS, depData).then(waitReceipt);
                      setDeployStatus(t("deploy.done"));
                      await sysMsg(fullAddr, peerAddr, t("chat.landlord_deposited", {amount: MR}), "landlord", "landlord_deposited");
                      await sysMsg(fullAddr, peerAddr, t("chat.agreement_on_chain"), "landlord", "contract_document");
                      if (onComplete) onComplete({ txHash: "deposited", agreementId: agrId });
                    } catch(err) {
                      setDeployStatus(err.code === 4001 ? t("deploy.cancelled") : (err.message || t("err.failed")));
                      setDeploying(false);
                    }
                  }}>Landlord Deposit ({MR} USDC) </button>
                </React.Fragment>
              ) : (
                <div style={{background:"var(--bg2)",borderRadius:12,padding:"16px",textAlign:"center",marginBottom:14}}>
                  <div className="spinner" style={{margin:"0 auto 8px"}}/>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--muted)",marginBottom:6}}>{t("cf.waiting_tenant_deploy")}</div>
                  <div style={{fontSize:11,color:"var(--dim)"}}>{t("cf.polling")}</div>
                </div>
              )
            )}
          </React.Fragment>
        )}
        {deploying && deployStatus && deployStatus !== t("deploy.done") && (
          <div style={{textAlign:"center",padding:"14px 0"}}>
            <div className="spinner"/>
            <div style={{fontSize:12,color:"var(--muted)",marginTop:8}}>{deployStatus}</div>
          </div>
        )}
        {deployStatus === t("deploy.done") && (
          <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:12,padding:"16px",textAlign:"center"}}>
            <div style={{fontSize:28,marginBottom:6}}></div>
            <div style={{fontWeight:800,fontSize:15,color:"var(--color-primary)"}}>{t("cf.deployed_onchain")}</div>
          </div>
        )}
      </React.Fragment>}

      {step<6&&<div className="btn-row">
        {step>0&&<button className="btn-g" style={{flex:1}} onClick={()=>setStep(s=>s-1)}>{t("btn.back")}</button>}
        <button className="btn-p" style={{flex:2,opacity:canNext?1:0.35}} onClick={()=>canNext&&setStep(s=>s+1)}>{t("btn.continue")}</button>
      </div>}
      {step===6&&!deploying&&!deployStatus&&<div style={{marginTop:8}}>
        <button className="btn-g" style={{width:"100%"}} onClick={()=>setStep(5)}>{t("btn.back_review")}</button>
      </div>}

      {showSign&&!isReal&&<BlockchainModal listing={listing} propDepAgreed={pdAgreed&&pdLLproposed} propDepAmount={pdFinalAmt} onClose={()=>setShowSign(false)} onSuccess={(contractData)=>onComplete({...contractData,propDepIncluded:pdAgreed&&pdLLproposed,propDepAmount:pdFinalAmt,propDepMultiplier:pdFinalAmt>0?(pdFinalAmt/MR).toFixed(2):0})}/>}

      {/* Lightbox — fullscreen photo/document view (renders on any step) */}
      {lightboxPhoto && (
        <LightboxViewer photo={lightboxPhoto} onClose={()=>setLightboxPhoto(null)} pinataGw={PINATA_GW}/>
      )}

      {/* Full Agreement review modal — shows AgreementDocument (same renderer as PrintModal) */}
      {showFullAgreement && (() => {
        const llA = isLL ? (fullAddr||myAddr) : peerAddr;
        const tnA = isLL ? peerAddr : (fullAddr||myAddr);
        const dur = Number(terms.leaseDurationMonths) || 6;
        const sd = terms.leaseStartDate ? new Date(terms.leaseStartDate) : new Date();
        const ed = (() => { const d = new Date(sd); d.setMonth(d.getMonth() + dur); return d; })();
        const pLang = getLang();
        const pL = LEASE_TEXTS[pLang] || LEASE_EN;
        const sL = preSignLang !== "none" && preSignLang !== pLang && LEASE_TEXTS[preSignLang] ? LEASE_TEXTS[preSignLang] : null;
        const langLabels = {en:"English",ru:"Russian",ka:"Georgian",vi:"Vietnamese",es:"Spanish",uk:"Ukrainian",pt:"Portuguese (BR)",th:"Thai"};
        const preSignData = {
          contractNo: "Pending",
          llName: terms.landlordName || "—", tnName: terms.tenantName || "—",
          llAddr: llA || "—", tnAddr: tnA || "—",
          propAddress: terms.propertyAddress || "—", MR,
          commitDep: MR, hostDep: MR,
          propDep: pdLLproposed ? Number(pdLLamount) : 0,
          startDate: sd, endDate: ed, duration: dur,
          scAddress: ESCROW_ADDRESS,
          llDocCid: uploadedDocs["landlordId"]?.cid || null,
          tnDocCid: uploadedDocs["tenantId"]?.cid || null,
          ownDocCid: uploadedDocs["ownership"]?.cid || null,
          photos, inventory: items,
          signatures: {
            landlord: serverForm?.signatures?.[llA?.toLowerCase()]  || null,
            tenant:   serverForm?.signatures?.[tnA?.toLowerCase()] || null,
          },
          agreementId: null, chainEvents: undefined, docHash: null, createdAt: null,
          rentPayments: [], totalPaid: 0,
        };
        const printPreSign = () => {
          const el = preSignPrintRef.current; if (!el) return;
          const clone = el.cloneNode(true);
          clone.style.cssText = "display:block;position:static;height:auto;max-height:none;overflow:visible;background:white;padding:0;flex:none";
          clone.querySelectorAll(".print-doc-wrap").forEach(n => { n.style.cssText = "display:block;flex:none;gap:0;width:100%;max-width:100%;height:auto;max-height:none;overflow:visible"; });
          clone.querySelectorAll(".print-card").forEach(n => { n.style.cssText = "display:block;height:auto;max-height:none;overflow:visible;break-inside:auto;page-break-inside:auto;margin-bottom:16px;box-shadow:none"; });
          clone.querySelectorAll("img").forEach(n => { n.style.maxWidth = "100%"; n.style.height = "auto"; n.style.breakInside = "avoid"; n.style.pageBreakInside = "avoid"; });
          const w = window.open("", "_blank", "width=800,height=1000");
          if (!w) { alert("Please allow popups to print the document."); return; }
          w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>pi2pi — Lease Agreement (Draft)</title><style>
            @page{size:A4;margin:14mm}body{margin:0;padding:16px 10px;background:white;color:#111;font-family:-apple-system,system-ui,sans-serif;font-size:12px;line-height:1.6}
            .print-doc-wrap{display:block!important;flex:none!important;width:100%!important;max-width:680px!important;margin:0 auto!important;height:auto!important;overflow:visible!important}
            .print-card{display:block!important;height:auto!important;overflow:visible!important;break-inside:auto!important;margin-bottom:16px!important;box-shadow:none!important;border:1px solid #e5e7eb;border-radius:12px;padding:18px 16px;background:white;box-sizing:border-box;word-break:break-word}
            img{max-width:100%!important;height:auto!important;page-break-inside:avoid}table{width:100%;border-collapse:collapse}tr{page-break-inside:avoid}
            div[style]{max-height:none!important;overflow:visible!important}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}.no-print{display:none!important}
          </style></head><body>${clone.innerHTML}</body></html>`);
          w.document.close();
          const imgs = w.document.querySelectorAll("img"); let ld = 0; const tot = imgs.length;
          const go = () => { w.focus(); w.print(); };
          if (!tot) { setTimeout(go, 100); return; }
          imgs.forEach(im => { if (im.complete) { ld++; if (ld>=tot) setTimeout(go,100); } else { im.onload=im.onerror=()=>{ld++;if(ld>=tot)setTimeout(go,100);}; } });
          setTimeout(go, 3000);
        };
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9998,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div className="no-print print-header" style={{background:"var(--color-bg-card)",borderBottom:"1px solid var(--color-border)",padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,gap:8}}>
              <div style={{fontWeight:700,fontSize:14,color:"var(--color-text-primary)",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",letterSpacing:"-0.3px"}}>pi2pi<span style={{color:"var(--color-primary)"}}>.io</span> <span style={{fontSize:11,color:"var(--muted)",fontWeight:400}}>Draft</span></div>
              <div style={{display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
                <select value={preSignLang} onChange={e=>setPreSignLang(e.target.value)}
                  style={{padding:"6px 8px",borderRadius:6,border:"1px solid var(--color-border)",background:"var(--color-bg-secondary)",color:"var(--color-text-primary)",fontFamily:"var(--ff)",fontSize:10,fontWeight:600,cursor:"pointer"}}>
                  <option value="none">Single language</option>
                  {Object.keys(LEASE_TEXTS).filter(c=>c!==pLang).map(c=>(
                    <option key={c} value={c}>+ {langLabels[c]||c.toUpperCase()}</option>
                  ))}
                </select>
                <button onClick={printPreSign}
                  style={{padding:"8px 14px",borderRadius:8,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",letterSpacing:"-0.1px"}}>
                  Print
                </button>
                <button onClick={()=>setShowFullAgreement(false)} aria-label={t("a11y.close")}
                  style={{padding:"8px 12px",borderRadius:8,background:"var(--color-bg-secondary)",color:"var(--color-text-primary)",border:"1px solid var(--color-border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",letterSpacing:"-0.1px"}}>
                  Close
                </button>
              </div>
            </div>
            <div ref={preSignPrintRef} data-theme="light" style={{flex:1,overflowY:"auto",overflowX:"hidden",background:"#f8fafc",padding:"16px 10px",boxSizing:"border-box",color:"#111"}}>
              <div className="print-doc-wrap" style={{maxWidth:680,margin:"0 auto",display:"flex",flexDirection:"column",gap:16,width:"100%",boxSizing:"border-box"}}>
                <AgreementDocument
                  data={preSignData}
                  L={pL}
                  secondL={sL}
                  primaryLangLabel={sL ? langLabels[pLang] || pLang.toUpperCase() : null}
                  secondLangLabel={sL ? langLabels[preSignLang] || preSignLang.toUpperCase() : null}
                  onPreviewImage={img => setLightboxPhoto({name:img.title,cid:null,url:img.src})}
                />
              </div>
            </div>
            <style>{`
              .print-doc-wrap,.print-card{box-sizing:border-box!important;max-width:100%!important}
              .print-card *{max-width:100%;box-sizing:border-box}
              @media(max-width:560px){.print-card div[style*="grid"]{grid-template-columns:1fr!important}.print-card{padding:14px 12px!important}.print-header>div:first-child{font-size:12px!important}}
              .print-card table{display:block;overflow-x:auto;white-space:nowrap}
              @media print{[data-print-root]{display:none!important}}
            `}</style>
          </div>
        );
      })()}
    </div>
  );
}

export default ContractFlow;
