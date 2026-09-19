import React, { useState, useEffect } from 'react';
import { t } from '../i18n/index.js';
import { getOwnerListings, getActiveContract, saveUser } from '../api/client.js';

export default function SwitchRoleSection({ user }) {
  const addr = (user?.addr || "").toLowerCase();
  const currentRole = user?.role || "tenant";
  const targetRole = currentRole === "tenant" ? "landlord" : "tenant";
  const [blocked, setBlocked] = useState(null); // null=loading, string=reason, false=allowed
  const [confirming, setConfirming] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!addr || addr.length < 42) return;
    let cancelled = false;
    (async () => {
      try {
        const [listings, contracts] = await Promise.all([
          getOwnerListings(addr).catch(()=>[]),
          getActiveContract(addr).catch(()=>null),
        ]);
        if (cancelled) return;
        const activeListings = (Array.isArray(listings) ? listings : []).filter(l=>l.status==="active"||l.status==="suspended");
        if (contracts) { setBlocked("You have an active contract. Settle it before switching."); return; }
        if (activeListings.length > 0) { setBlocked("You have active listings. Archive them before switching."); return; }
        setBlocked(false);
      } catch { setBlocked(false); }
    })();
    return () => { cancelled = true; };
  }, [addr]);

  const doSwitch = async () => {
    setSwitching(true);
    try {
      const prev = JSON.parse(localStorage.getItem("pi2pi_user_" + addr) || "{}");
      const updated = { ...prev, role: targetRole, listing: null, addr };
      localStorage.setItem("pi2pi_user_" + addr, JSON.stringify(updated));
      await saveUser(updated);
      window.location.reload();
    } catch(e) { alert(e.message || t("err.switch_failed")); }
    setSwitching(false);
  };

  if (blocked === null) return null;

  return (
    <div style={{marginTop:22,paddingTop:16,borderTop:"1px solid var(--border)"}}>
      <div className="field-label">{t("title.switch_role")}</div>
      <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.6,marginBottom:10}}>
        {t("body.switch_desc", {role: currentRole === "tenant" ? t("role.tenant") : t("role.landlord"), target: targetRole === "tenant" ? t("role.looking") : t("role.offering")})}
      </div>
      {blocked ? (
        <div style={{fontSize:12,color:"var(--color-warning)",background:"var(--color-warning-surface)",border:"1px solid var(--color-warning-border)",borderRadius:8,padding:"8px 12px",lineHeight:1.5}}>
          {blocked}
        </div>
      ) : confirming ? (
        <div style={{background:"var(--color-warning-surface)",border:"1px solid var(--color-warning-border)",borderRadius:10,padding:"12px 14px"}}>
          <div style={{fontSize:13,fontWeight:700,color:"var(--color-warning)",marginBottom:6}}>{targetRole==="tenant"?t("btn.switch_to_tenant"):t("btn.switch_to_landlord")}?</div>
          <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:10,lineHeight:1.5}}>{t("body.switch_warning")}</div>
          <div style={{display:"flex",gap:8}}>
            <button disabled={switching} onClick={doSwitch}
              style={{flex:1,padding:"10px",borderRadius:10,background:"var(--color-warning)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
              {switching ? t("body.switching") : t("btn.yes_switch")}
            </button>
            <button onClick={()=>setConfirming(false)}
              style={{flex:1,padding:"10px",borderRadius:10,background:"var(--color-bg-card)",border:"1px solid var(--color-border)",color:"var(--color-text-secondary)",fontFamily:"var(--ff)",fontWeight:600,fontSize:12,cursor:"pointer"}}>
              {t("btn.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={()=>setConfirming(true)}
          style={{width:"100%",padding:"10px",borderRadius:10,background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",color:"var(--color-text-primary)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
          {targetRole === "tenant" ? t("btn.switch_to_tenant") : t("btn.switch_to_landlord")}
        </button>
      )}
    </div>
  );
}
