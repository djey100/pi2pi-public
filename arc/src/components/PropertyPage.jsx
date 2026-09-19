import React, { useState, useRef } from 'react';
import { t } from '../i18n/index.js';
import { readUsdcBalance, getProvider } from '../wallet.js';
import { createViewingRequest, getCitySettings, getUser } from '../api/client.js';
import { IcBack, IcStar } from './ui/Icons.jsx';
import { SVGS } from '../data/svgs.jsx';
import { getIdentityBadges } from '../services/identity.js';
import AvatarBox from './AvatarBox.jsx';
import ListingMap from './ListingMap.jsx';
import RepScore from './ui/RepScore.jsx';
import UserBadges from './UserBadges.jsx';

function logEvent(type, payload = {}) {
  const log = { time: new Date().toISOString(), type, ...payload };
  console.log("[pi2pi-log]", log);
  import('../api/client.js').then(m => m.logEventApi(log));
}

export default function PropertyPage({ listing, role, user, activeContract, suspended, onBack, onChat, onApply, onNeedAuth, onViewingRequested, toggleBookmark, isBookmarked, onOpenMyIntent }) {
  const [liked, setLiked] = useState(false);
  const [viewingRequested, setViewingRequested] = useState(false);
  const [viewingSending, setViewingSending] = useState(false);
  const [showApplyWarn, setShowApplyWarn] = useState(false);
  const [contactBalanceError, setContactBalanceError] = useState(null);
  const [contactBalanceChecking, setContactBalanceChecking] = useState(false);
  const [noIntentModal, setNoIntentModal] = useState(false);
  const myMR = 4200;
  const chatOK = listing.price <= myMR * 1.2;
  const isGuest = !user;
  const isRented = !!(activeContract && activeContract.listing && activeContract.listing.id === listing.id);
  const isRealListing = !!listing._realUser;

  const guard = (fn) => () => { if (isGuest) { onNeedAuth(); return; } fn(); };

  const checkContactBalance = async (onPass) => {
    if (role !== "tenant" || !user?.addr) { onPass(); return; }
    setContactBalanceChecking(true);
    try {
      const listingCity = listing.city || listing.location || listing.district || "";
      const cs = await getCitySettings().catch(() => []);
      const cm = (cs || []).find(c => listingCity && (listingCity.toLowerCase().includes(c.city.toLowerCase()) || c.city.toLowerCase().includes(listingCity.toLowerCase())));
      const cityMin = cm?.min_balance || 0;
      const required = Math.max(cityMin, Number(listing.price || 0) * 0.7);
      if (required > 0) {
        const bal = await readUsdcBalance(user.addr);
        if (bal < required) {
          setContactBalanceError({ required, balance: bal });
          setContactBalanceChecking(false);
          return;
        }
      }
    } catch (e) {}
    setContactBalanceChecking(false);
    try {
      const serverProfile = await getUser(user.addr);
      const intent = serverProfile?.intent || null;
      if (!intent || intent.paused || intent.suspended || serverProfile?.account_suspended) {
        setNoIntentModal(true);
        return;
      }
    } catch (e) {
      setNoIntentModal(true);
      return;
    }
    onPass();
  };

  const sendViewingRequest = async () => {
    if (viewingRequested || viewingSending) return;
    if (isRealListing && user?.addr) {
      setViewingSending(true);
      try {
        const viewSigMsg = `pi2pi: Request viewing ${listing.id}`;
        const viewProvider = getProvider() || window.ethereum;
        const viewSig = await viewProvider.request({ method: "personal_sign", params: [viewSigMsg, user.addr] });
        logEvent("UI_ACTION", { user: user.addr, action: "viewing_requested", data: { listingId: listing.id, landlord: listing.contract, signature: viewSig.slice(0,20)+"..." } });
      } catch(e) { setViewingSending(false); return; }
      try {
        const vrResp = await createViewingRequest({
            fromAddr: user.addr,
            toAddr: listing.contract,
            listingId: listing.id,
            listingTitle: listing.title + " · " + listing.location,
            message: "I'd like to view this property"
          });
        if (vrResp?.status === 403) { try { const d = await vrResp.json(); if (d?.error === "no_active_intent") { setViewingSending(false); setNoIntentModal(true); return; } } catch(_){} }
      } catch(e) {}
      setViewingSending(false);
    }
    setViewingRequested(true);
    onViewingRequested && onViewingRequested(listing);
  };

  const handleApply = () => {
    if (!viewingRequested) { setShowApplyWarn(true); return; }
    onApply();
  };

  const photos = (listing._photos || []).filter(p=>p.cid || p.url);
  const hasMultiple = photos.length > 1;
  const [photoIdx, setPhotoIdx] = useState(0);
  const touchRef = useRef(null);
  const handleTouchStart = (e) => { touchRef.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchRef.current === null || !hasMultiple) return;
    const dx = e.changedTouches[0].clientX - touchRef.current;
    if (dx < -40) setPhotoIdx(i => Math.min(i+1, photos.length-1));
    else if (dx > 40) setPhotoIdx(i => Math.max(i-1, 0));
    touchRef.current = null;
  };

  const photoUrl = photos.length > 0
    ? (photos[photoIdx].url || `/api/ipfs/file/${photos[photoIdx].cid}`)
    : listing.image;
  const photoCaption = photos.length > 0 ? photos[photoIdx].caption : "";

  return (
    <div className="page" style={{paddingBottom:80}}>
      <div className="prop-img-wrap" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <div className="prop-img" style={{background:"var(--color-bg-secondary)",overflow:"hidden"}}>
          {photoUrl ? <img key={photoIdx} src={photoUrl} alt={photoCaption} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center",display:"block"}}/> : isRealListing ? <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",fontSize:64}}></div> : SVGS[listing.id]}
        </div>
        {hasMultiple && photoIdx > 0 && (
          <button onClick={()=>setPhotoIdx(i=>i-1)} style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",width:32,height:32,borderRadius:"50%",background:"rgba(0,0,0,0.45)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:16,fontWeight:700}}>‹</button>
        )}
        {hasMultiple && photoIdx < photos.length-1 && (
          <button onClick={()=>setPhotoIdx(i=>i+1)} style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",width:32,height:32,borderRadius:"50%",background:"rgba(0,0,0,0.45)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontSize:16,fontWeight:700}}>›</button>
        )}
        {hasMultiple && (
          <div style={{position:"absolute",bottom:10,left:"50%",transform:"translateX(-50%)",display:"flex",gap:5}}>
            {photos.map((_,i) => (
              <div key={i} onClick={()=>setPhotoIdx(i)} style={{width:i===photoIdx?16:6,height:6,borderRadius:3,background:i===photoIdx?"white":"rgba(255,255,255,0.5)",transition:"all 0.2s",cursor:"pointer"}}/>
            ))}
          </div>
        )}
        {hasMultiple && (
          <div style={{position:"absolute",bottom:10,right:12,fontSize:10,fontWeight:700,color:"white",background:"rgba(0,0,0,0.5)",borderRadius:10,padding:"2px 8px"}}>{photoIdx+1}/{photos.length}</div>
        )}
        {photoCaption && (
          <div style={{position:"absolute",bottom:hasMultiple?24:10,left:12,right:12,fontSize:11,fontWeight:600,color:"white",textShadow:"0 1px 4px rgba(0,0,0,0.7)"}}>{photoCaption}</div>
        )}
        <button className="prop-back" onClick={onBack}><IcBack/></button>
        {user && role==="tenant" && toggleBookmark && <button onClick={()=>toggleBookmark(listing)} style={{position:"absolute",top:12,right:12,display:"flex",alignItems:"center",gap:6,background:"rgba(0,0,0,0.5)",border:"none",borderRadius:8,padding:"7px 12px",cursor:"pointer",backdropFilter:"blur(6px)",zIndex:2}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={isBookmarked?.(listing.id,"listing")?"white":"none"} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
          <span style={{color:"white",fontSize:12,fontWeight:600}}>{isBookmarked?.(listing.id,"listing") ? t("btn.saved") : t("btn.save_bookmark")}</span>
        </button>}
      </div>
      <div className="prop-body">
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:4}}>
          <div>
            <div style={{fontSize:26,fontWeight:800,letterSpacing:"-0.5px"}}>
              {listing.price.toLocaleString()} <span style={{fontSize:14,fontWeight:400,color:"var(--muted)"}}>{t("misc.usdc_month")}</span>
            </div>
            <div style={{fontSize:11,color:"var(--muted)",marginTop:1}}>+{listing.price.toLocaleString()} USDC {t("body.security_deposit_escrow")}</div>
          </div>
          <div className="prop-rating" style={{marginTop:4}}><IcStar/>{listing.rating}</div>
        </div>
        <h1 className="prop-title" style={{marginTop:6,marginBottom:4}}>{listing.title}</h1>
        <div className="prop-loc">{listing.location} · {listing.reviews} {t("misc.reviews")}</div>
        <div className="prop-badges">
          {isRented
            ? <span className="pbadge" style={{background:"var(--color-warning-surface)",color:"var(--color-warning)",border:"1px solid var(--color-warning-border)"}}>Just Rented</span>
            : <span className="pbadge pbadge-teal">{listing.tag}</span>}
          <span className="pbadge pbadge-teal">{t("body.on_chain_verified")}</span>
        </div>
        <div className="divider"/>
        <div className="prop-specs">
          <div className="prop-spec"><div className="prop-spec-val">{listing.beds}</div><div className="prop-spec-lbl">{t("misc.bedrooms")}</div></div>
          <div className="prop-spec"><div className="prop-spec-val">{listing.sqm}</div><div className="prop-spec-lbl">m²</div></div>
          <div className="prop-spec"><div className="prop-spec-val">{listing.baths}</div><div className="prop-spec-lbl">{t("misc.bathrooms")}</div></div>
        </div>
        <div className="divider"/>
        {!isRented && (
          <div style={{display:"flex",gap:14,alignItems:"stretch",padding:"4px 0"}}>
            <AvatarBox id={listing.hostAvatar} size={80} radius={14} walletAddr={listing.contract}/>
            <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",gap:4}}>
              <div className="host-name">Hosted by {listing.host}</div>
              <div className="host-sub"><span className="vdot"/>{t("body.identity_verified_onchain")}</div>
              {listing._realUser && listing.contract && (
                <div style={{marginTop:2}}>
                  <UserBadges address={listing.contract} size="xs" getIdentityBadges={getIdentityBadges}/>
                </div>
              )}
              <div style={{marginTop:2}}>
                <RepScore role="landlord" viewings={listing.viewingsHosted} rentals={listing.rented}/>
              </div>
            </div>
          </div>
        )}
        {isRented && (
          <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:14,padding:"14px 16px",textAlign:"center"}}>
            <div style={{fontSize:22,marginBottom:6}}></div>
            <div style={{fontWeight:800,fontSize:14,color:"var(--color-primary)",marginBottom:4}}>Currently rented via pi2pi.io</div>
            <div style={{fontSize:12,color:"var(--color-primary)",lineHeight:1.7}}>This property was secured through a blockchain-based smart contract — zero intermediaries, zero platform fee.</div>
          </div>
        )}
        <div className="divider"/>
        <div className="sec-title">{t("title.about_property")}</div>
        <p className="prop-desc">{listing.desc}</p>
        <div className="divider"/>
        <div className="sec-title">{t("title.amenities")}</div>
        <div className="amenity-wrap">{listing.amenities.map(a=><div key={a} className="amenity">{a}</div>)}</div>
        {(listing.lat || listing.zoneLat) && (listing.lng || listing.zoneLng) && (
          <ListingMap lat={listing.lat || listing.zoneLat} lng={listing.lng || listing.zoneLng} label={listing.location || listing.district}/>
        )}
        <div style={{height:16}}/>
      </div>

      <div className="book-bar" style={{padding:"11px 16px"}}>
        {isRented ? (
          <div style={{width:"100%",textAlign:"center"}}>
            <div style={{fontSize:11,color:"var(--muted)",marginBottom:6}}>This property is not available — but yours could be next</div>
            <button className="bb-btn" style={{width:"100%",background:"linear-gradient(135deg,var(--teal),#0ea5e9)",color:"white",border:"none",fontSize:13,fontWeight:800}}>
              Find available properties on pi2pi.io →
            </button>
          </div>
        ) : suspended ? (
          <div style={{padding:"10px 14px",fontSize:12,color:"var(--color-danger)",textAlign:"center",background:"var(--color-danger-surface)",borderRadius:10,fontWeight:600,width:"100%"}}>
            {t("susp.contacts_blocked")}
          </div>
        ) : role==="tenant" ? (
          <div style={{display:"flex",gap:8,width:"100%"}}>
            <button className="bb-btn" style={{flex:1,fontSize:13,padding:"11px 8px",background:"var(--color-bg-card)",color:"var(--text)",border:"1.5px solid var(--border)"}}
              onClick={guard(() => checkContactBalance(onChat))} disabled={contactBalanceChecking}>
              {contactBalanceChecking ? t("balance.gate_check") : t("btn.ask_host")}
            </button>
            <button className="bb-btn" style={{flex:1,fontSize:13,padding:"11px 8px",background:"var(--color-bg-card)",color:viewingRequested?"var(--muted)":"var(--text)",border:"1.5px solid var(--border)",opacity:viewingRequested?.6:1}}
              onClick={isGuest ? onNeedAuth : () => checkContactBalance(sendViewingRequest)} disabled={!isGuest&&(viewingRequested||viewingSending||contactBalanceChecking)}>
              {contactBalanceChecking?t("balance.gate_check"):viewingSending?"Sending…":viewingRequested?`${t("btn.viewing_requested")}`:`${t("btn.request_viewing")}`}
            </button>
          </div>
        ) : (
          isRealListing ? null : <button className="bb-btn" style={{width:"100%"}} onClick={onChat}>{t("btn.offer_viewing")}</button>
        )}
      </div>

      {contactBalanceError && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setContactBalanceError(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-bg-card)",borderRadius:16,padding:"24px 20px",maxWidth:380,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.3)"}}>
            <div style={{textAlign:"center",marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>{t("contact.gate_title")}</div>
            </div>
            <div style={{background:"var(--color-danger-surface)",border:"1px solid var(--color-danger-border)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
              <div style={{fontSize:13,color:"var(--color-danger)",lineHeight:1.6}}>{t("contact.gate_body")}</div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
              <span style={{color:"var(--muted)"}}>{t("contact.gate_required", {amount: contactBalanceError.required.toFixed(2)})}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 0",marginBottom:14}}>
              <span style={{color:"var(--muted)"}}>{t("contact.gate_your", {balance: contactBalanceError.balance.toFixed(2)})}</span>
            </div>
            <div style={{fontSize:11,color:"var(--muted)",marginBottom:16,lineHeight:1.5}}>{t("contact.gate_rule")}</div>
            <button onClick={()=>setContactBalanceError(null)} style={{width:"100%",padding:"12px",borderRadius:10,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:14,cursor:"pointer"}}>OK</button>
          </div>
        </div>
      )}

      {noIntentModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setNoIntentModal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-bg-card)",borderRadius:16,padding:"24px 20px",maxWidth:380,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.3)"}}>
            <div style={{textAlign:"center",marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>{t("intent.gate_title")}</div>
            </div>
            <div style={{background:"var(--color-warning-surface)",border:"1px solid var(--color-warning-border)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
              <div style={{fontSize:13,color:"var(--color-warning)",lineHeight:1.6}}>{t("intent.gate_body")}</div>
            </div>
            <button onClick={()=>{setNoIntentModal(false); if(onOpenMyIntent) onOpenMyIntent();}} style={{width:"100%",padding:"12px",borderRadius:10,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:14,cursor:"pointer",marginBottom:8}}>{t("intent.gate_cta")}</button>
            <button onClick={()=>setNoIntentModal(false)} style={{width:"100%",padding:"10px",background:"none",border:"none",fontFamily:"var(--ff)",fontSize:13,color:"var(--muted)",cursor:"pointer"}}>{t("btn.cancel")}</button>
          </div>
        </div>
      )}

      {showApplyWarn&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div style={{background:"var(--color-bg-card)",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480}}>
            <div style={{fontSize:28,textAlign:"center",marginBottom:10}}></div>
            <div style={{fontWeight:800,fontSize:17,textAlign:"center",marginBottom:10}}>{t("title.skip_viewing")}</div>
            <div style={{fontSize:13,color:"var(--muted)",lineHeight:1.7,textAlign:"center",marginBottom:22}}>
              {t("prop.skip_body")}<br/><br/>
              <strong style={{color:"var(--text)"}}>{t("prop.viewing_protects")}</strong>
            </div>
            <button className="btn-p" style={{marginBottom:10}} onClick={()=>{setShowApplyWarn(false);checkContactBalance(sendViewingRequest);}}>
              {t("prop.request_first")}
            </button>
            <button onClick={()=>{setShowApplyWarn(false);onApply();}}
              style={{width:"100%",padding:"12px",background:"none",border:"1.5px solid var(--border)",borderRadius:12,fontFamily:"var(--ff)",fontSize:13,color:"var(--muted)",cursor:"pointer"}}>
              {t("prop.continue_without")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
