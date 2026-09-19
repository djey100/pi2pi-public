import React, { useState, useEffect } from 'react';
import { t, getLang } from '../i18n/index.js';
import { readUsdcBalance } from '../wallet.js';
import { getOwnerListings, deleteListing, listingAction } from '../api/client.js';
import { ACTIVE_NETWORK_APP_URL } from '../helpers.js';
import { IcBack } from './ui/Icons.jsx';
import QRShareBlock from './QRShareBlock.jsx';

const ML_STATUS_COLORS = {
  active:    { bg: "var(--color-primary-surface)", text: "var(--color-primary)", labelKey: "ml.status_active" },
  paused:    { bg: "var(--color-warning-surface)", text: "var(--color-warning)", labelKey: "ml.status_paused" },
  suspended: { bg: "var(--color-danger-surface)", text: "var(--color-danger-dark)", labelKey: "ml.status_suspended" },
  draft:     { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)", labelKey: "ml.status_draft" },
  archived:  { bg: "var(--color-bg-secondary)", text: "var(--color-text-dim)", labelKey: "ml.status_archived" },
};

export default function MyListingsPage({ user, onBack, onCreate, onEdit }) {
  const addr = (user?.addr || "").toLowerCase();
  const [listings, setListings] = useState(null);
  const [walletBalance, setWalletBalance] = useState(null);
  const [busy, setBusy] = useState({});
  const [error, setError] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);

  const reload = async () => {
    if (!addr) return;
    try {
      const [r, bal] = await Promise.all([
        getOwnerListings(addr),
        readUsdcBalance(addr).catch(() => -1),
      ]);
      setListings(Array.isArray(r) ? r : []);
      setWalletBalance(bal);
    } catch {
      setListings([]);
    }
  };
  useEffect(() => { reload(); }, [addr]);

  const counted = listings || [];
  const requiredSum = counted.filter(l => ["active","suspended"].includes(l.status))
    .reduce((s, l) => s + Number(l.monthlyRent || 0), 0);
  const buffer = walletBalance != null && walletBalance >= 0 ? walletBalance - requiredSum : null;
  const balShort = buffer != null && buffer < 0;

  const act = async (id, action) => {
    setError("");
    setBusy(b => ({ ...b, [id]: action }));
    try {
      const r = await listingAction(id, action, addr);
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || `${action} failed`);
      }
    } catch (e) {
      setError(e.message || `${action} failed`);
    } finally {
      setBusy(b => ({ ...b, [id]: null }));
      reload();
    }
  };

  const remove = (id) => {
    setConfirmAction({
      message: t("ml.delete_confirm"),
      onOk: async () => {
        setConfirmAction(null);
        setError("");
        try {
          const r = await deleteListing(id, addr);
          const data = await r.json().catch(() => ({}));
          if (!r.ok) setError(data.error || "Delete failed");
        } catch (e) { setError(e.message); }
        reload();
      },
    });
  };

  return (
    <div className="cf-wrap">
      <button className="cf-back" onClick={onBack}><IcBack/> {t("cf.back")}</button>
      <div className="cf-title">{t("title.my_listings")}</div>
      <div className="cf-sub" style={{marginBottom:18}}>{t("ml.manage_sub")}</div>

      {counted.length > 0 && walletBalance != null && walletBalance >= 0 && (
        <div style={{background: balShort ? "var(--color-danger-surface)" : "var(--color-bg-secondary)", border: balShort ? "1px solid var(--color-danger-border)" : "1px solid var(--color-border)", borderRadius:12, padding:"12px 14px", marginBottom:16, fontSize:13}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontWeight:600,color:"var(--color-text-primary)"}}>{t("ml.wallet")}</span>
            <span style={{fontWeight:700,color: balShort ? "var(--color-danger-dark)" : "var(--color-text-primary)"}}>{walletBalance.toFixed(2)} USDC</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,color:"var(--color-text-secondary)"}}>
            <span>{t("ml.required_active")}</span>
            <span>{requiredSum} USDC</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontWeight:600,color: balShort ? "var(--color-danger-dark)" : "var(--color-primary)"}}>
            <span>{t("ml.buffer")}</span>
            <span>{buffer >= 0 ? "+" : ""}{buffer?.toFixed(2)} USDC{balShort ? " · "+t("ml.top_up") : " "}</span>
          </div>
        </div>
      )}

      {error && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setError("")}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-bg-card)",borderRadius:16,padding:"24px 20px",maxWidth:380,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.3)"}}>
            <div style={{textAlign:"center",marginBottom:16}}>
              <div style={{fontSize:36,marginBottom:8}}>⚠️</div>
              <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>{t("balance.gate_title")}</div>
            </div>
            <div style={{background:"var(--color-danger-surface)",border:"1px solid var(--color-danger-border)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
              <div style={{fontSize:13,color:"var(--color-danger)",lineHeight:1.6}}>{error}</div>
            </div>
            <div style={{fontSize:11,color:"var(--muted)",marginBottom:16,lineHeight:1.5}}>{t("balance.gate_topup")}</div>
            <button onClick={()=>setError("")} style={{width:"100%",padding:"12px",borderRadius:10,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:14,cursor:"pointer"}}>OK</button>
          </div>
        </div>
      )}

      {listings === null && (
        <div style={{textAlign:"center",padding:40,color:"var(--color-text-secondary)",fontSize:13}}>{t("body.loading")}</div>
      )}

      {listings !== null && listings.length === 0 && (
        <div style={{textAlign:"center",padding:"30px 20px",border:"1.5px dashed var(--color-border)",borderRadius:12}}>
          <div style={{fontSize:14,color:"var(--color-text-secondary)",marginBottom:14}}>{t("body.no_listings")}</div>
          <button className="lw-cta" onClick={onCreate}>{t("btn.create_first_listing")}</button>
        </div>
      )}

      {listings && listings.length > 0 && listings.map(l => {
        const fp = l.photos && l.photos[0];
        const cover = fp ? (fp.url || (fp.cid ? `/api/ipfs/file/${fp.cid}` : null)) : null;
        const sc = ML_STATUS_COLORS[l.status] || ML_STATUS_COLORS.draft;
        const isBusy = !!busy[l.id];
        return (
          <div key={l.id} style={{border:"1px solid var(--color-border)",borderRadius:12,marginBottom:12,overflow:"hidden",background:"var(--color-bg-card)"}}>
            <div style={{display:"flex",gap:12,padding:12}}>
              <div style={{width:80,height:60,borderRadius:8,background:"var(--color-bg-secondary)",overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {cover ? <img src={cover} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <span style={{color:"#aaa",fontSize:11}}>{t("ml.no_photo")}</span>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                  <div style={{fontSize:14,fontWeight:700,color:"var(--color-text-primary)"}}>{t("lw.type_in_district", {type: l.propertyType, district: (l.city || l.district || "").split(",")[0]})}</div>
                  <span style={{background:sc.bg,color:sc.text,fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:50,whiteSpace:"nowrap"}}>{t(sc.labelKey)}</span>
                </div>
                <div style={{fontSize:12,color:"var(--color-text-secondary)",marginTop:2}}>{l.monthlyRent} USDC/mo · Min {l.minStayMonths} mo</div>
                {l.status === "suspended" && (
                  <div style={{fontSize:11,color:"var(--color-danger-dark)",marginTop:4}}>{t("ml.auto_paused")}</div>
                )}
              </div>
            </div>
            <div style={{borderTop:"1px solid var(--color-bg-secondary)",padding:"8px 12px",display:"flex",gap:8,flexWrap:"wrap"}}>
              {l.status === "draft" && (
                <>
                  <button onClick={() => remove(l.id)} disabled={isBusy} style={{fontSize:12,padding:"6px 12px",borderRadius:8,background:"var(--color-danger-surface)",color:"var(--color-danger-dark)",border:"none",cursor:"pointer",fontWeight:600}}>{t("btn.delete")}</button>
                  <button onClick={() => act(l.id, "publish")} disabled={isBusy} style={{fontSize:12,padding:"6px 12px",borderRadius:8,background:"var(--color-primary)",color:"#fff",border:"none",cursor:"pointer",fontWeight:600}}>{isBusy === "publish" ? t("ml.publishing") : t("btn.publish")}</button>
                </>
              )}
              {l.status === "active" && (
                <button onClick={() => act(l.id, "pause")} disabled={isBusy} style={{fontSize:12,padding:"6px 12px",borderRadius:8,background:"var(--color-bg-secondary)",color:"var(--color-text-primary)",border:"none",cursor:"pointer",fontWeight:600}}>{isBusy === "pause" ? t("ml.pausing") : t("btn.pause")}</button>
              )}
              {l.status === "paused" && (
                <button onClick={() => act(l.id, "resume")} disabled={isBusy} style={{fontSize:12,padding:"6px 12px",borderRadius:8,background:"var(--color-primary)",color:"#fff",border:"none",cursor:"pointer",fontWeight:600}}>{isBusy === "resume" ? t("ml.resuming") : t("btn.resume")}</button>
              )}
              {l.status === "suspended" && (
                <button onClick={() => act(l.id, "resume")} disabled={isBusy} style={{fontSize:12,padding:"6px 12px",borderRadius:8,background:"var(--color-primary)",color:"#fff",border:"none",cursor:"pointer",fontWeight:600}}>{isBusy === "resume" ? t("ml.trying") : t("btn.resume_recheck")}</button>
              )}
              {l.status !== "archived" && onEdit && (
                <button onClick={() => onEdit(l)} disabled={isBusy} style={{fontSize:12,padding:"6px 12px",borderRadius:8,background:"var(--color-info-surface)",color:"var(--color-info)",border:"none",cursor:"pointer",fontWeight:600}}>{t("btn.edit")}</button>
              )}
              {l.status !== "draft" && l.status !== "archived" && (
                <button onClick={() => setConfirmAction({ message: t("ml.archive_confirm"), onOk: () => { setConfirmAction(null); act(l.id, "archive"); } })} disabled={isBusy} style={{fontSize:12,padding:"6px 12px",borderRadius:8,background:"var(--color-bg-secondary)",color:"var(--color-text-secondary)",border:"none",cursor:"pointer",fontWeight:600}}>{t("btn.archive")}</button>
              )}
              {l.status === "draft" && <button onClick={() => setConfirmAction({ message: getLang()==="ru" ? "Удалить объявление? Это действие необратимо." : "Delete listing? This cannot be undone.", onOk: async () => { setConfirmAction(null); try { await deleteListing(l.id, addr); reload(); } catch {} } })} disabled={isBusy} style={{fontSize:12,padding:"6px 12px",borderRadius:8,background:"none",color:"var(--color-danger)",border:"1px solid var(--color-danger-border)",cursor:"pointer",fontWeight:600}}>{t("btn.delete") || "Delete"}</button>}
            </div>
            {l.status === "active" && <div style={{padding:"0 12px 10px"}}>
              <QRShareBlock
                url={`${ACTIVE_NETWORK_APP_URL}/#/listing/real-${l.id}`}
                type="listing"
                title={`${l.propertyType} in ${(l.city || l.district || "").split(",")[0]} · $${l.monthlyRent}/${t("qr.month") || "mo"}`}
              />
            </div>}
          </div>
        );
      })}

      {listings && listings.length > 0 && listings.filter(l => l.status !== "archived").length < 3 && (
        <div style={{marginTop:16,textAlign:"center"}}>
          <button className="lw-cta" onClick={onCreate}>{t("btn.create_another")}</button>
        </div>
      )}

      {confirmAction && (
        <div className="modal-ov" onClick={e => { if (e.target === e.currentTarget) setConfirmAction(null); }}>
          <div className="modal" style={{maxWidth:340,padding:"28px 24px 20px",textAlign:"center"}}>
            <div className="modal-handle"/>
            <div style={{fontSize:15,fontWeight:600,color:"var(--color-text-primary)",marginBottom:20,lineHeight:1.4}}>{confirmAction.message}</div>
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <button onClick={() => setConfirmAction(null)} style={{flex:1,padding:"10px 0",borderRadius:10,background:"var(--color-bg-secondary)",color:"var(--color-text-secondary)",border:"none",fontSize:14,fontWeight:600,cursor:"pointer"}}>{t("btn.cancel")}</button>
              <button onClick={confirmAction.onOk} style={{flex:1,padding:"10px 0",borderRadius:10,background:"var(--color-danger)",color:"white",border:"none",fontSize:14,fontWeight:600,cursor:"pointer"}}>{t("btn.confirm")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
