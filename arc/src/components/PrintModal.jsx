import React, { useState, useEffect, useRef } from 'react';
import { t } from '../i18n/index.js';
import { getLang } from '../i18n/index.js';
import { parseAgreement, ESCROW_ADDRESS, SEL, encUint, toDecAgreementId } from '../helpers.js';
import { ethCallRpc } from '../wallet.js';
import { getContractForm } from '../api/client.js';
import { LEASE_EN } from '../lease-text-en.js';
import AgreementDocument from './AgreementDocument.jsx';

export default function PrintModal({ agreementId, myAddr, peerAddr, role, onClose, leaseTexts, loadFinancialEvents }) {
  // All hooks must be called before any conditional return (React rules of hooks)
  const [chainData, setChainData] = useState(null);
  const [chainEvents, setChainEvents] = useState(null);
  const [serverForm, setServerForm] = useState(null);
  const [docHash, setDocHash] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [secondLang, setSecondLang] = useState("none");
  const printAreaRef = useRef(null);

  useEffect(() => {
    if (!previewImage) return;
    const onKey = (e) => { if (e.key === "Escape") setPreviewImage(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewImage]);

  useEffect(() => {
    if (agreementId === undefined || agreementId === null) return;
    let mounted = true;
    (async () => {
      try {
        const hex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(agreementId)));
        if (mounted) setChainData(parseAgreement(hex));
      } catch(e) { console.error("[print] load agreement:", e); }
    })();
    loadFinancialEvents(agreementId).then(evs => { if (mounted) setChainEvents(evs); }).catch(() => { if (mounted) setChainEvents([]); });
    return () => { mounted = false; };
  }, [agreementId]);

  useEffect(() => {
    if (!myAddr || !peerAddr) return;
    getContractForm(myAddr, peerAddr).then(cf => setServerForm(cf||{})).catch(()=>{});
  }, [myAddr, peerAddr]);

  useEffect(() => {
    if (!chainData || !serverForm || agreementId === undefined || agreementId === null) return;
    (async () => {
      try {
        const docPayload = JSON.stringify({chainData, serverForm, agreementId});
        const buf = new TextEncoder().encode(docPayload);
        const hashBuf = await crypto.subtle.digest("SHA-256", buf);
        const hashHex = Array.from(new Uint8Array(hashBuf)).map(b=>b.toString(16).padStart(2,"0")).join("");
        setDocHash(hashHex);
      } catch(e){}
    })();
  }, [chainData, serverForm, agreementId]);

  if (agreementId === undefined || agreementId === null) return null;

  const LEASE_TEXTS = leaseTexts;

  if (!chainData) {
    return (
      <div data-print-root style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{background:"var(--color-bg-card)",padding:"32px",borderRadius:12,fontSize:14,color:"var(--muted)"}}>Loading agreement…</div>
      </div>
    );
  }

  // Build normalized data for AgreementDocument
  const terms = serverForm?.steps?.terms || {};
  const inventory = serverForm?.steps?.inventory || [];
  const photos = serverForm?.photos || [];
  const documents = serverForm?.documents || [];
  const docByLabel = (label) => documents.find(d => d.label === label);
  const llDocCid = docByLabel("landlordId")?.cid;
  const tnDocCid = docByLabel("tenantId")?.cid;
  const ownDocCid = docByLabel("ownership")?.cid;

  const llAddr = chainData.landlord;
  const tnAddr = chainData.tenant;
  const llName = terms.landlordName || "—";
  const tnName = terms.tenantName || "—";
  const propAddress = terms.propertyAddress || "—";
  const MR = chainData.rent || terms.monthlyRent || 0;

  const startDate = chainData.activatedAt > 0 ? new Date(chainData.activatedAt * 1000) : (terms.leaseStartDate ? new Date(terms.leaseStartDate) : new Date(chainData.createdAt * 1000));
  const endDate = chainData.leaseEnd > 0 ? new Date(chainData.leaseEnd * 1000) : (() => { const d = new Date(startDate); d.setMonth(d.getMonth() + (chainData.duration || 6)); return d; })();
  const fmtLong = d => new Date(d).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});

  const contractNo = "PI2PI-" + toDecAgreementId(agreementId).padStart(4, "0");
  const scAddress = ESCROW_ADDRESS;

  const rentPayments = (chainEvents || []).filter(e => e.kind === "rent");
  const totalPaid = rentPayments.reduce((s, e) => s + (e.amount || 0), 0);

  const primaryLang = getLang();
  const L = LEASE_TEXTS[primaryLang] || LEASE_EN;
  const secondL = secondLang !== "none" && secondLang !== primaryLang && LEASE_TEXTS[secondLang] ? LEASE_TEXTS[secondLang] : null;
  const LANG_LABELS = {en:"English",ru:"Russian",ka:"Georgian",vi:"Vietnamese",es:"Spanish",uk:"Ukrainian",pt:"Portuguese (BR)",th:"Thai"};

  const documentData = {
    contractNo, llName, tnName, llAddr, tnAddr, propAddress, MR,
    commitDep: chainData.commitDep, hostDep: chainData.hostDep, propDep: chainData.propDep,
    startDate, endDate, duration: chainData.duration || 6, scAddress,
    llDocCid, tnDocCid, ownDocCid,
    photos, inventory,
    signatures: {
      landlord: serverForm?.signatures?.[llAddr.toLowerCase()] || null,
      tenant: serverForm?.signatures?.[tnAddr.toLowerCase()] || null,
    },
    agreementId: toDecAgreementId(agreementId),
    chainEvents, docHash,
    createdAt: new Date(chainData.createdAt * 1000),
    rentPayments, totalPaid,
  };

  const printDoc = () => {
    const content = printAreaRef.current;
    if (!content) return;
    // Clone DOM and strip inline flex/overflow styles that prevent pagination
    const clone = content.cloneNode(true);
    clone.style.display = "block";
    clone.style.position = "static";
    clone.style.height = "auto";
    clone.style.maxHeight = "none";
    clone.style.overflow = "visible";
    clone.style.background = "white";
    clone.style.padding = "0";
    clone.style.flex = "none";
    clone.querySelectorAll(".print-doc-wrap").forEach(el => {
      el.style.display = "block";
      el.style.flex = "none";
      el.style.gap = "0";
      el.style.width = "100%";
      el.style.maxWidth = "100%";
      el.style.height = "auto";
      el.style.maxHeight = "none";
      el.style.overflow = "visible";
    });
    clone.querySelectorAll(".print-card").forEach(el => {
      el.style.display = "block";
      el.style.height = "auto";
      el.style.maxHeight = "none";
      el.style.overflow = "visible";
      el.style.breakInside = "auto";
      el.style.pageBreakInside = "auto";
      el.style.marginBottom = "16px";
      el.style.boxShadow = "none";
    });
    clone.querySelectorAll("img").forEach(img => {
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      img.style.breakInside = "avoid";
      img.style.pageBreakInside = "avoid";
    });
    console.log("[print] cloned height", clone.scrollHeight, "cards", clone.querySelectorAll(".print-card").length);
    const printWindow = window.open("", "_blank", "width=800,height=1000");
    if (!printWindow) { alert("Please allow popups to print the document."); return; }
    printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>pi2pi — Lease Agreement</title><style>
      @page { size: A4; margin: 14mm; }
      body { margin: 0; padding: 16px 10px; background: white; color: #111; font-family: -apple-system, system-ui, sans-serif; font-size: 12px; line-height: 1.6; }
      .print-doc-wrap { display: block !important; flex: none !important; gap: 0 !important; width: 100% !important; max-width: 680px !important; margin: 0 auto !important; height: auto !important; max-height: none !important; overflow: visible !important; }
      .print-card { display: block !important; height: auto !important; max-height: none !important; overflow: visible !important; break-inside: auto !important; page-break-inside: auto !important; margin-bottom: 16px !important; box-shadow: none !important; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px 16px; background: white; box-sizing: border-box; word-break: break-word; overflow-wrap: break-word; }
      img { max-width: 100% !important; height: auto !important; page-break-inside: avoid; }
      table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      div[style] { max-height: none !important; overflow: visible !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
      .no-print { display: none !important; }
    </style></head><body>${clone.innerHTML}</body></html>`);
    printWindow.document.close();
    // Wait for images to load before printing
    const images = printWindow.document.querySelectorAll("img");
    let loaded = 0;
    const total = images.length;
    const tryPrint = () => { printWindow.focus(); printWindow.print(); };
    if (total === 0) { setTimeout(tryPrint, 100); return; }
    images.forEach(img => {
      if (img.complete) { loaded++; if (loaded >= total) setTimeout(tryPrint, 100); }
      else { img.onload = img.onerror = () => { loaded++; if (loaded >= total) setTimeout(tryPrint, 100); }; }
    });
    // Fallback: print after 3s even if images haven't loaded
    setTimeout(tryPrint, 3000);
  };

  return (
    <div data-print-root style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header bar */}
      <div className="no-print print-header" style={{background:"var(--color-bg-card)",borderBottom:"1px solid var(--color-border)",padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,gap:8}}>
        <div style={{fontWeight:700,fontSize:14,color:"var(--color-text-primary)",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",letterSpacing:"-0.3px"}}>pi2pi<span style={{color:"var(--color-primary)"}}>.io</span></div>
        <div style={{display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
          <select value={secondLang} onChange={e=>setSecondLang(e.target.value)}
            style={{padding:"6px 8px",borderRadius:6,border:"1px solid var(--color-border)",background:"var(--color-bg-secondary)",color:"var(--color-text-primary)",fontFamily:"var(--ff)",fontSize:10,fontWeight:600,cursor:"pointer"}}>
            <option value="none">Single language</option>
            {Object.keys(LEASE_TEXTS).filter(c=>c!==getLang()).map(c=>(
              <option key={c} value={c}>+ {({en:"English",ru:"Russian",ka:"Georgian",vi:"Vietnamese",es:"Spanish",uk:"Ukrainian",pt:"Portuguese (BR)",th:"Thai"})[c]||c.toUpperCase()}</option>
            ))}
          </select>
          <button onClick={printDoc}
            style={{padding:"8px 14px",borderRadius:8,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",letterSpacing:"-0.1px"}}>
            Print
          </button>
          <button onClick={onClose} aria-label={t("a11y.close")}
            style={{padding:"8px 12px",borderRadius:8,background:"var(--color-bg-secondary)",color:"var(--color-text-primary)",border:"1px solid var(--color-border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:6,letterSpacing:"-0.1px"}}>
            Close
          </button>
        </div>
      </div>

      {/* Scrollable document area — always light-theme (paper-style document) */}
      <div id="print-area" ref={printAreaRef} data-theme="light" style={{flex:1,overflowY:"auto",overflowX:"hidden",background:"#f8fafc",padding:"16px 10px",boxSizing:"border-box",color:"#111"}}>
        <div className="print-doc-wrap" style={{maxWidth:680,margin:"0 auto",display:"flex",flexDirection:"column",gap:16,width:"100%",boxSizing:"border-box"}}>
          <AgreementDocument
            data={documentData}
            L={L}
            secondL={secondL}
            primaryLangLabel={secondL ? LANG_LABELS[primaryLang] || primaryLang.toUpperCase() : null}
            secondLangLabel={secondL ? LANG_LABELS[secondLang] || secondLang.toUpperCase() : null}
            onPreviewImage={setPreviewImage}
          />
        </div>
      </div>

      {/* Print styles + mobile responsive */}
      <style>{`
        /* Mobile fixes — stop overflow */
        .print-doc-wrap, .print-card {
          box-sizing: border-box !important;
          max-width: 100% !important;
        }
        .print-card * {
          max-width: 100%;
          box-sizing: border-box;
        }
        /* Stack 2-column grids on narrow screens */
        @media (max-width: 560px) {
          .print-card [style*="grid-template-columns: 1fr 1fr"],
          .print-card [style*="gridTemplateColumns:\"1fr 1fr\""],
          .print-card div[style*="grid"] {
            grid-template-columns: 1fr !important;
          }
          .print-card {
            padding: 14px 12px !important;
          }
          .print-header > div:first-child {
            font-size: 12px !important;
          }
        }
        /* Tables must scroll on small screens */
        .print-card table {
          display: block;
          overflow-x: auto;
          white-space: nowrap;
        }
        /* Print is handled via isolated window — hide this modal if browser print is triggered directly */
        @media print {
          [data-print-root] { display: none !important; }
        }
      `}</style>
      {/* Fullscreen image preview */}
      {previewImage && (
        <div onClick={()=>setPreviewImage(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:99999,display:"flex",alignItems:"center",justifyContent:"center",cursor:"zoom-out"}}>
          <button onClick={()=>setPreviewImage(null)} aria-label="Close preview" style={{position:"absolute",top:16,right:16,background:"rgba(255,255,255,0.15)",border:"none",borderRadius:"50%",width:36,height:36,fontSize:20,color:"white",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>&times;</button>
          {previewImage.title && <div style={{position:"absolute",bottom:20,left:"50%",transform:"translateX(-50%)",color:"rgba(255,255,255,0.7)",fontSize:12,fontWeight:600,textAlign:"center",maxWidth:"80%",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{previewImage.title}</div>}
          <img src={previewImage.src} alt={previewImage.title||""} onClick={e=>e.stopPropagation()} style={{maxWidth:"95vw",maxHeight:"90vh",objectFit:"contain",borderRadius:8,cursor:"default"}} onError={e=>{e.target.style.display="none"}}/>
        </div>
      )}
    </div>
  );
}
