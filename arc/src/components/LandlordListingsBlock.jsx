import React, { useState, useEffect } from 'react';
import { t } from '../i18n/index.js';
import { readUsdcBalance } from '../wallet.js';
import { getOwnerListings } from '../api/client.js';

export default function LandlordListingsBlock({ user, onCreate, onOpenMyListings }) {
  const addr = (user?.addr || "").toLowerCase();
  const [listings, setListings] = useState(null);
  const [walletBalance, setWalletBalance] = useState(null);

  useEffect(() => {
    if (!addr) return;
    let cancelled = false;
    Promise.all([
      getOwnerListings(addr).catch(() => []),
      readUsdcBalance(addr).catch(() => -1),
    ]).then(([rows, bal]) => {
      if (cancelled) return;
      setListings(Array.isArray(rows) ? rows : []);
      setWalletBalance(bal);
    });
    return () => { cancelled = true; };
  }, [addr]);

  if (listings === null) return null; // loading — don't flash

  const active = listings.filter(l => l.status === "active");
  const suspended = listings.filter(l => l.status === "suspended");
  const draftsCount = listings.filter(l => l.status === "draft").length;
  const requiredSum = [...active, ...suspended].reduce((s, l) => s + Number(l.monthlyRent || 0), 0);

  // Empty state — banner with CTA
  if (active.length === 0 && suspended.length === 0) {
    return (
      <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:12,padding:"14px 16px",marginBottom:12,display:"flex",alignItems:"center",gap:12}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,color:"var(--color-text-primary)",marginBottom:3}}>{t("ll.publish")}</div>
          <div style={{fontSize:12,color:"var(--color-text-secondary)",lineHeight:1.4}}>
            {draftsCount > 0 ? t("ll.have_drafts", {count: draftsCount}) : t("ll.no_feed")}
          </div>
        </div>
        <button onClick={draftsCount > 0 ? onOpenMyListings : onCreate} style={{background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",borderRadius:10,padding:"9px 16px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"var(--ff)",whiteSpace:"nowrap",flexShrink:0,letterSpacing:"-0.1px"}}>
          {draftsCount > 0 ? t("ll.open") : t("ll.create")}
        </button>
      </div>
    );
  }

  // Has active or suspended — compact 1-line summary
  const balOk = walletBalance != null && walletBalance >= requiredSum;
  const balText = walletBalance != null && walletBalance >= 0
    ? `${balOk ? "" : ""} ${walletBalance.toFixed(0)} USDC in wallet`
    : "—";
  return (
    <div onClick={onOpenMyListings} style={{background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",borderRadius:12,padding:"10px 14px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",gap:10}}>
      <div style={{minWidth:0,flex:1}}>
        <div style={{fontSize:14,fontWeight:700,color:"var(--color-text-primary)"}}>{t("menu.my_listings")}</div>
        <div style={{fontSize:11,color:"var(--color-text-secondary)",marginTop:2}}>
          {t("ll.x_active", {count: active.length})}{suspended.length > 0 && ` · ${t("ll.x_paused", {count: suspended.length})}`}{draftsCount > 0 && ` · ${t("ll.x_drafts", {count: draftsCount})}`}
        </div>
        <div style={{fontSize:11,color: balOk ? "var(--color-primary)" : "var(--color-danger)",marginTop:2,fontWeight:600}}>
          {t("ll.required_in_wallet", {amount: requiredSum, balance: (walletBalance != null && walletBalance >= 0 ? walletBalance.toFixed(0) + " USDC " + t("ll.in_wallet") : "—")})}
        </div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" strokeWidth="1.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
    </div>
  );
}
