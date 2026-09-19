import React, { useState, useEffect } from 'react';
import { t } from '../i18n/index.js';
import { apiGet, apiPost, getOwnerListings } from '../api/client.js';

export default function OfferViewingButton({ myAddr, peerAddr, onNeedAuth, user }) {
  const [offered, setOffered] = useState(false);
  const [sending, setSending] = useState(false);
  const [noListingModal, setNoListingModal] = useState(false);

  useEffect(() => {
    if (!myAddr || !peerAddr) return;
    apiGet(`/api/offer-viewing/check?from=${myAddr.toLowerCase()}&to=${peerAddr.toLowerCase()}`).then(d=>{ if(d.offered) setOffered(true); }).catch(()=>{});
  }, [myAddr, peerAddr]);

  const send = async () => {
    if (!user) { onNeedAuth(); return; }
    if (offered || sending) return;
    setSending(true);
    // Check landlord has at least one active listing
    try {
      const listings = await getOwnerListings(myAddr);
      const hasActive = (Array.isArray(listings) ? listings : []).some(l => l.status === "active");
      if (!hasActive) { setNoListingModal(true); setSending(false); return; }
    } catch { setSending(false); return; }
    try {
      const resp = await apiPost("/api/offer-viewing", { fromAddr: myAddr, toAddr: peerAddr });
      if (resp?.error === "no_active_listing") { setNoListingModal(true); setSending(false); return; }
      setOffered(true);
    } catch {}
    setSending(false);
  };

  return (
    <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid var(--border)"}}>
      <button className="ca-btn accent" disabled={offered||sending}
        style={{width:"100%",textAlign:"center",opacity:offered?0.5:1,cursor:offered?"default":"pointer"}}
        onClick={send}>
        {offered ? t("btn.offered") : sending ? "..." : t("btn.offer_place")}
      </button>
      {noListingModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setNoListingModal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-bg-card)",borderRadius:16,padding:"24px 20px",maxWidth:380,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.3)"}}>
            <div style={{textAlign:"center",marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>{t("listing.gate_title")}</div>
            </div>
            <div style={{background:"var(--color-warning-surface)",border:"1px solid var(--color-warning-border)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
              <div style={{fontSize:13,color:"var(--color-warning)",lineHeight:1.6}}>{t("listing.gate_body")}</div>
            </div>
            <button onClick={()=>setNoListingModal(false)} style={{width:"100%",padding:"12px",borderRadius:10,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:14,cursor:"pointer"}}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
