import React, { useState, useCallback } from 'react';
import { t } from '../i18n/index.js';

export default function ClosureDetailsBlock({ st, agrData, agrId, loadFinancialEvents }) {
  const [events, setEvents] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadEvents = useCallback(async () => {
    if (!agrId || events) return;
    setLoading(true);
    try {
      const evs = await loadFinancialEvents(agrId);
      setEvents(evs || []);
    } catch (e) { setEvents([]); }
    finally { setLoading(false); }
  }, [agrId, events]);

  // Lazy-load events the first time the section expands
  const onToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !events) loadEvents();
  };

  // Inference from on-chain struct (same logic as before, inlined here)
  const a = agrData || {};
  const tLow = (a.tenant || "").toLowerCase();
  const initLow = (a.earlyTermInitiator || "").toLowerCase();
  const initIsTenant = initLow && initLow === tLow;
  const initRole = initLow && initLow !== "0x0000000000000000000000000000000000000000"
    ? (initIsTenant ? "Tenant" : "Landlord") : null;

  const settledEvent = (events || []).find(e => e.kind === "settled");
  const rawReason = settledEvent ? (settledEvent.description.replace("Agreement settled — ", "")) : null;

  // Human-readable summary based on reason OR struct fallback
  const ir = initRole ? t("role."+initRole.toLowerCase()) : t("misc.counterparty");
  const summary = (() => {
    if (st === 9) return { icon: "●", headline: t("closure.h.lease_ended"), sub: t("closure.s.lease_ended"), color: "var(--color-primary)" };
    if (rawReason === "clean_checkout" || rawReason === "lease_ended") return { icon: "●", headline: t("closure.h.clean"), sub: t("closure.s.clean"), color: "var(--color-primary)" };
    if (rawReason === "early_term_mutual") return { icon: "●", headline: t("closure.h.mutual", {who:ir}), sub: t("closure.s.mutual"), color: "var(--color-primary)" };
    if (rawReason === "exit_with_loss") return { icon: "▲", headline: t("closure.h.exit_loss", {who:ir}), sub: t("closure.s.exit_loss"), color: "var(--color-warning)" };
    if (rawReason === "early_term_expired") return { icon: "○", headline: t("closure.h.et_expired"), sub: t("closure.s.et_expired"), color: "#6b7280" };
    if (rawReason === "initiator_conceded") return { icon: "▼", headline: t("closure.h.conceded"), sub: t("closure.s.conceded"), color: "var(--color-danger)" };
    if (rawReason === "dispute_exit_accepted") return { icon: "", headline: t("closure.h.dispute_accepted"), sub: t("closure.s.dispute_accepted"), color: "var(--color-primary)" };
    if (rawReason === "dispute_cancelled") return { icon: "", headline: t("closure.h.dispute_cancelled"), sub: t("closure.s.dispute_cancelled"), color: "var(--color-danger)" };
    if (rawReason === "freeze_expired") return { icon: "○", headline: t("closure.h.freeze_expired"), sub: t("closure.s.freeze_expired"), color: "#6366f1" };
    if (rawReason === "early_settlement_all_funds") return { icon: "●", headline: t("closure.h.settlement"), sub: t("closure.s.settlement"), color: "var(--color-primary)" };
    if (rawReason === "rent_missed") return { icon: "▲", headline: t("closure.h.rent_missed"), sub: t("closure.s.rent_missed"), color: "var(--color-danger)" };
    if (rawReason === "cancelled_created") return { icon: "", headline: t("closure.h.cancelled"), sub: t("closure.s.cancelled"), color: "#6b7280" };
    if (rawReason === "cancelled_unfunded") return { icon: "", headline: t("closure.h.cancelled_unfunded"), sub: t("closure.s.cancelled_unfunded"), color: "#6b7280" };
    if (rawReason === "emergency_settled_expired") return { icon: "", headline: t("closure.h.emergency"), sub: t("closure.s.emergency"), color: "var(--color-warning)" };
    if (a.earlyTermType === 1) return { icon: "●", headline: t("closure.h.mutual", {who:ir}), sub: t("closure.s.mutual"), color: "var(--color-primary)" };
    if (a.earlyTermType === 2) return { icon: "▲", headline: t("closure.h.exit_loss", {who:ir}), sub: t("closure.s.exit_loss"), color: "var(--color-warning)" };
    if (a.earlyTermType === 3) return { icon: "", headline: t("closure.h.dispute_resolved"), sub: t("closure.s.dispute_resolved"), color: "#6366f1" };
    return { icon: "", headline: t("closure.h.closed"), sub: t("closure.s.closed"), color: "var(--color-primary)" };
  })();

  // Initiator sub-info
  const initiatorInfo = initRole && a.earlyTermType > 0 ? (
    <div style={{fontSize:10,color:"var(--color-text-secondary)",marginTop:4}}>
      {t("misc.initiator")}: <strong style={{color:"var(--color-text-primary)"}}>{initRole}</strong>
      <span className="mono" style={{marginLeft:6,color:"var(--color-text-primary)",fontFamily:"var(--ffm)"}}>{a.earlyTermInitiator?.slice(0,6)}…{a.earlyTermInitiator?.slice(-4)}</span>
    </div>
  ) : null;

  const fmtDateTime = (ts) => ts > 0 ? new Date(ts * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  // Timeline entries — filter to relevant lifecycle events, sort chronologically
  const timeline = (events || [])
    .slice()
    .sort((a, b) => (a.blockNumber || 0) - (b.blockNumber || 0));

  const eventIcon = (kind) => {
    const m = {
      activated: "●", deposit: "◆", rent: "◆", renewed: "↻",
      bond: "◆", claim_filed: "▲", claim_accepted: "", claim_disputed: "▲",
      claim_dropped: "←", claim_withdrawn: "←", claim_auto_executed: "→",
      dispute_started: "■", dispute_cancelled: "", freeze_expired: "○",
      propdep_window_expired: "○", propdep_settled: "●", mutual_settled: "●",
      early_term_proposed: "▲", early_term_mutual: "●", early_term_executed: "→", settled: "●",
    };
    return m[kind] || "·";
  };

  return (
    <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:10,padding:"14px",marginBottom:10}}>
      {/* Headline */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
        <span style={{fontSize:18}}>{summary.icon}</span>
        <span style={{fontWeight:700,fontSize:13,color:summary.color}}>{summary.headline}</span>
      </div>
      <div style={{fontSize:11,color:"var(--color-text-secondary)",lineHeight:1.5}}>{summary.sub}</div>
      {initiatorInfo}

      {/* Quick facts row from struct */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10,paddingTop:10,borderTop:"1px solid var(--color-primary-border)",fontSize:10}}>
        <div>
          <div style={{color:"var(--color-text-secondary)"}}>{t("closure.type")}</div>
          <div style={{fontWeight:700,color:"var(--color-text-primary)"}}>{st === 9 ? t("closure.natural_end") : (a.earlyTermType > 0 ? t("closure.early_term") : t("closure.terminated"))}</div>
        </div>
        <div>
          <div style={{color:"var(--color-text-secondary)"}}>{t("closure.method")}</div>
          <div style={{fontWeight:700,color:"var(--color-text-primary)"}}>
            {a.earlyTermType === 1 ? t("closure.mutual_exit") : a.earlyTermType === 2 ? t("closure.exit_with_loss") : a.earlyTermType === 3 ? t("closure.disputed") : st === 9 ? t("closure.on_term") : "—"}
          </div>
        </div>
        <div>
          <div style={{color:"var(--color-text-secondary)"}}>{t("closure.rent_paid_before")}</div>
          <div style={{fontWeight:700,color:"var(--color-text-primary)"}}>{(a.rentPayments || 0) + (a.firstRentPaid ? 1 : 0)} of {a.leaseDurationMonths || "?"} months</div>
        </div>
        <div>
          <div style={{color:"var(--color-text-secondary)"}}>{t("closure.went_through_dispute")}</div>
          <div style={{fontWeight:700,color:"var(--color-text-primary)"}}>{(a.freezeStart > 0) ? t("closure.yes_freeze") : t("closure.no")}</div>
        </div>
      </div>

      {/* Timeline toggle */}
      <button onClick={onToggle} style={{marginTop:12,width:"100%",padding:"8px 12px",background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",borderRadius:6,fontSize:11,color:"var(--color-text-primary)",cursor:"pointer",fontWeight:600}}>
        {expanded ? t("closure.hide_timeline") : t("closure.show_timeline")} {loading && t("closure.loading")}
      </button>

      {/* Timeline content */}
      {expanded && (
        <div style={{marginTop:10,padding:"8px 0",borderTop:"1px dashed var(--color-primary-border)"}}>
          {!events && !loading && <div style={{fontSize:11,color:"var(--color-text-secondary)"}}>{t("closure.not_loaded")}</div>}
          {loading && <div style={{fontSize:11,color:"var(--color-text-secondary)"}}>{t("closure.reading")}</div>}
          {events && events.length === 0 && <div style={{fontSize:11,color:"var(--color-text-secondary)"}}>{t("closure.no_events")}</div>}
          {events && events.length > 0 && (
            <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:360,overflowY:"auto"}}>
              {timeline.map((e, i) => (
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:11,padding:"4px 0",borderBottom:i < timeline.length - 1 ? "1px solid var(--color-border)" : "none"}}>
                  <span style={{fontSize:14,lineHeight:1}}>{eventIcon(e.kind)}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:"var(--color-text-primary)",fontWeight:500}}>{e.description}</div>
                    <div style={{fontSize:10,color:"var(--color-text-secondary)",marginTop:1,fontFamily:"var(--ffm)"}}>
                      {e.timestamp ? fmtDateTime(e.timestamp) : ("block " + e.blockNumber)}
                      {e.amount != null ? ` · ${e.amount} USDC` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Archive note */}
      <div style={{fontSize:10,color:"var(--color-text-secondary)",marginTop:10,paddingTop:8,borderTop:"1px solid var(--color-primary-border)"}}>
        {t("closure.archive_note")}
      </div>
    </div>
  );
}
