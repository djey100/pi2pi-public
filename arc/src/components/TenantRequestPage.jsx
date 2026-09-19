import React, { useState, useEffect } from 'react';
import { t, getLang } from '../i18n/index.js';
import { apiGet, createViewingRequest } from '../api/client.js';
import { getProvider } from '../wallet.js';
import { IcBack } from './ui/Icons.jsx';
import AvatarBox from './AvatarBox.jsx';

export default function TenantRequestPage({ addr, user, role, onBack, onNeedAuth }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [offerSent, setOfferSent] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!addr) return;
    apiGet(`/api/tenant/${addr.toLowerCase()}`).then(d => {
      setData(d);
      setLoading(false);
    }).catch(e => {
      setError(e.message || "Not found");
      setLoading(false);
    });
  }, [addr]);

  const handleOfferViewing = async () => {
    if (!user?.addr) { onNeedAuth?.(); return; }
    if (role !== "landlord") return;
    setSending(true);
    try {
      const sigMsg = `pi2pi: Offer viewing to ${addr}`;
      const provider = getProvider() || window.ethereum;
      await provider.request({ method: "personal_sign", params: [sigMsg, user.addr] });
      await createViewingRequest({
        fromAddr: user.addr,
        toAddr: addr,
        listingTitle: "Viewing offer",
        message: "I'd like to offer you a viewing of my property"
      });
      setOfferSent(true);
    } catch (e) {
      if (e.code !== 4001) alert(e.message || "Failed");
    }
    setSending(false);
  };

  const isRu = getLang() === "ru";

  if (loading) return (
    <div style={{padding:40,textAlign:"center",color:"var(--muted)",fontSize:13}}>
      {t("body.loading") || "Loading..."}
    </div>
  );

  if (error || !data) return (
    <div className="page" style={{padding:20}}>
      <button className="prop-back" onClick={onBack}><IcBack/></button>
      <div style={{padding:40,textAlign:"center"}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>{isRu ? "Запрос не найден" : "Request not found"}</div>
        <div style={{fontSize:13,color:"var(--muted)"}}>{isRu ? "Арендатор не найден или его запрос приостановлен" : "Tenant not found or their request is paused"}</div>
      </div>
    </div>
  );

  const durationLabel = data.duration === "12" ? (isRu ? "1 год" : "1 year")
    : data.duration === "24" ? (isRu ? "2 года" : "2 years")
    : `${data.duration || "6"} ${isRu ? "мес" : "months"}`;

  return (
    <div className="page" style={{paddingBottom:80}}>
      <div style={{padding:"16px 16px 0"}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:6,color:"var(--text)",fontFamily:"var(--ff)",fontSize:13,fontWeight:600,marginBottom:16}}>
{t("btn.back") || "← Back"}
        </button>
      </div>

      <div style={{padding:"0 16px"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
          <AvatarBox id={null} size={64} radius={14} walletAddr={addr}/>
          <div>
            <div style={{fontSize:18,fontWeight:800}}>{data.displayName || addr.slice(0,6)+"…"+addr.slice(-4)}</div>
            <div style={{fontSize:12,color:"var(--color-primary)",fontWeight:600,marginTop:2}}>{isRu ? "Ищет квартиру" : "Looking for apartment"}</div>
          </div>
        </div>

        {/* Details card */}
        <div style={{background:"var(--color-bg-secondary)",border:"1px solid var(--border)",borderRadius:14,padding:"16px 18px",marginBottom:16}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>{isRu ? "Город" : "City"}</div>
              <div style={{fontSize:15,fontWeight:700}}>{data.city || "—"}</div>
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>{isRu ? "Тип жилья" : "Property type"}</div>
              <div style={{fontSize:15,fontWeight:700}}>{data.propType || "—"}</div>
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>{isRu ? "Бюджет" : "Budget"}</div>
              <div style={{fontSize:15,fontWeight:700}}>{data.budget ? `$${data.budget}/${isRu ? "мес" : "mo"}` : "—"}</div>
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>{isRu ? "Срок аренды" : "Duration"}</div>
              <div style={{fontSize:15,fontWeight:700}}>{durationLabel}</div>
            </div>
          </div>
        </div>

        {/* Info */}
        <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
          <div style={{fontSize:12,color:"var(--color-primary)",lineHeight:1.6}}>
            {isRu
              ? "Этот арендатор ищет квартиру через pi2pi. Все расчёты в USDC, депозиты защищены смарт-контрактом. Без комиссий."
              : "This tenant is looking for an apartment through pi2pi. All payments in USDC, deposits secured by smart contract. No fees."}
          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="book-bar" style={{padding:"11px 16px"}}>
        {!user ? (
          <button className="bb-btn" style={{width:"100%"}} onClick={onNeedAuth}>
            {isRu ? "Войти чтобы предложить просмотр" : "Sign in to offer viewing"}
          </button>
        ) : role !== "landlord" ? (
          <div style={{padding:"10px 14px",fontSize:12,color:"var(--muted)",textAlign:"center",width:"100%"}}>
            {isRu ? "Только арендодатели могут предлагать просмотр" : "Only landlords can offer viewings"}
          </div>
        ) : offerSent ? (
          <div style={{padding:"10px 14px",fontSize:13,color:"var(--color-primary)",textAlign:"center",fontWeight:700,width:"100%"}}>
            {isRu ? "Предложение отправлено ✓" : "Viewing offer sent ✓"}
          </div>
        ) : (
          <button className="bb-btn" style={{width:"100%",background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontSize:14,fontWeight:800}} onClick={handleOfferViewing} disabled={sending}>
            {sending ? "..." : (isRu ? "Предложить просмотр квартиры" : "Offer property viewing")}
          </button>
        )}
      </div>
    </div>
  );
}
