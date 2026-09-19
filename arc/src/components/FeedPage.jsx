import React, { useState, useEffect, useRef } from 'react';
import { t } from '../i18n/index.js';
import { getListings, getTenantRequests, getActiveContracts } from '../api/client.js';
import { LISTINGS, TENANTS } from '../mocks.js';
import { ACTIVE_NETWORK_NAME } from '../helpers.js';
import { SVGS } from '../data/svgs.jsx';
import { Ic, IcSearch } from './ui/Icons.jsx';
import AvatarBox from './AvatarBox.jsx';
import Dropdown from './ui/Dropdown.jsx';
import RepScore from './ui/RepScore.jsx';
import OfferViewingButton from './OfferViewingButton.jsx';
import UserBadges from './UserBadges.jsx';

function FeedPage({ role, user, activeContract, onNeedAuth, onSelect, onCreate, bookmarks, toggleBookmark, isBookmarked, getIdentityBadges }) {
  const [tab, setTab] = useState("props");
  const [filter, setFilter] = useState("All");
  const [liked, setLiked] = useState({});
  const [duration, setDuration] = useState("");
  const [feedCity, setFeedCity] = useState("");
  const [offers, setOffers] = useState({});
  const [showDemo, setShowDemo] = useState(false);
  const [showProtocol, setShowProtocol] = useState(false);
  const [demoRect, setDemoRect] = useState(null);
  const [protoRect, setProtoRect] = useState(null);
  const demoBtnRef = React.useRef(null);
  const protoBtnRef = React.useRef(null);
  const totalOffers = Object.values(offers).filter(Boolean).length;
  const isGuest = !user;

  // Load real listings from server (new listings table) — replaces old user.data.listing approach.
  // Tenant cards in feed removed entirely (tenants don't publish, they search).
  const [realListings, setRealListings] = useState([]);
  const [realTenants, setRealTenants] = useState([]);
  useEffect(() => {
    const myAddr = user?.addr?.toLowerCase() || "";
    Promise.all([
      getListings({status:"active"}).catch(()=>[]),
      getActiveContracts().catch(()=>[]),
    ]).then(([listings, activeContracts]) => {
      const busyAddrs = new Set();
      (activeContracts || []).forEach(c => {
        if (c.addr) busyAddrs.add(c.addr.toLowerCase());
        if (c.peerAddr) busyAddrs.add(c.peerAddr.toLowerCase());
      });
      const cards = (Array.isArray(listings) ? listings : [])
        .filter(l => l.ownerAddr?.toLowerCase() !== myAddr)
        .filter(l => !busyAddrs.has((l.ownerAddr || "").toLowerCase()))
        .map(l => {
          const firstPhoto = l.photos && l.photos[0];
          const image = firstPhoto ? (firstPhoto.url || (firstPhoto.cid ? `/api/ipfs/file/${firstPhoto.cid}` : null)) : null;
          return {
            id: `real-${l.id}`,
            image,
            title: `${l.propertyType} in ${(l.city || l.district || "").split(",")[0]}`,
            location: l.city || "Tbilisi, Georgia",
            propertyType: l.propertyType,
            price: Number(l.monthlyRent),
            rating: 5.0,
            reviews: 0,
            beds: 0,
            sqm: 0,
            tag: "New",
            host: l.ownerName || l.ownerAddr?.slice(0,6)+"…"+l.ownerAddr?.slice(-4),
            hostAvatar: "alex",
            contract: l.ownerAddr,
            amenities: l.amenities || [],
            desc: l.description,
            _realListing: true,
            _listingId: l.id,
            _ownerAddr: l.ownerAddr,
            _availFrom: l.publishedAt ? new Date(l.publishedAt).toISOString().slice(0,10) : null,
            _duration: l.minStayMonths,
            _photos: (l.photos || []).map(p => ({ cid: p.cid, url: p.url, caption: p.caption || "" })),
            zoneLat: l.zoneLat || null,
            zoneLng: l.zoneLng || null,
            _realUser: true, // legacy compat for chat/contract flows
          };
        });
      setRealListings(cards);
      // Load real tenant search requests (hide tenants with active contracts)
      getTenantRequests().then(tenants=>{
        if (Array.isArray(tenants)) setRealTenants(tenants.filter(t=>t.addr !== myAddr && !busyAddrs.has((t.addr||"").toLowerCase())));
      }).catch(()=>{});
    }).catch(() => {});
  }, [user]);

  const openDemo = () => {
    setShowProtocol(false);
    if (!showDemo && demoBtnRef.current) setDemoRect(demoBtnRef.current.getBoundingClientRect());
    setShowDemo(v => !v);
  };
  const openProto = () => {
    setShowDemo(false);
    if (!showProtocol && protoBtnRef.current) setProtoRect(protoBtnRef.current.getBoundingClientRect());
    setShowProtocol(v => !v);
  };

  // Dropdown panel style — not used, panels rendered inline now
  const dropdownStyle = () => ({});

  return (
    <div className="page" onClick={()=>{setShowDemo(false);setShowProtocol(false);}}>
      <div className="search-wrap" onClick={e=>{e.stopPropagation();setShowDemo(false);setShowProtocol(false);}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:11}}>
          <div className="search-sub" style={{marginBottom:0}}>{role==="tenant"?t("feed.find_home"):t("feed.find_tenant")}</div>
          <div style={{display:"none"}} onClick={e=>e.stopPropagation()}>
            <div>
              <button ref={demoBtnRef} onClick={openDemo}
                style={{padding:"4px 10px",borderRadius:50,background:showDemo?"#0c4a6e":"linear-gradient(135deg,var(--teal),#0ea5e9)",border:"none",fontSize:11,fontWeight:800,color:"white",cursor:"pointer",fontFamily:"var(--ff)",boxShadow:"0 2px 8px var(--color-primary-border)",whiteSpace:"nowrap"}}>
                Demo FAQ
              </button>
              {showDemo&&demoRect&&(
                <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top:demoRect?demoRect.bottom+8:60,left:"50%",transform:"translateX(-50%)",width:"calc(var(--shell-w, 460px) - 32px)",maxWidth:"calc(100vw - 32px)",maxHeight:"70vh",background:"var(--color-bg-card)",borderRadius:16,boxShadow:"0 8px 40px rgba(0,0,0,0.25)",display:"flex",flexDirection:"column",overflow:"hidden",zIndex:9999}}>
                    <div style={{padding:"12px 14px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"linear-gradient(135deg,var(--teal),#0ea5e9)",flexShrink:0}}>
                      <span style={{fontWeight:800,fontSize:13,color:"white"}}>Demo Guide</span>
                      <button onClick={()=>setShowDemo(false)} style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:20,width:22,height:22,fontSize:12,cursor:"pointer",color:"white",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}></button>
                    </div>
                    <div className="guide-body demo-scroll" style={{overflowY:"auto"}}>
                      <div style={{fontSize:11,color:"#0c4a6e",background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:"8px 11px",marginBottom:14,lineHeight:1.7}}>
                        Each wallet = separate demo scenario.<br/>
                        Disconnect = full state reset.<br/>
                        Active listing in all scenarios: <strong>Da Nang City Apartment</strong> (first card, top left in Explore).
                      </div>
                      {[
                        { group:"🆕 New Registration", color:"var(--color-info)", bg:"var(--color-info-surface)", border:"var(--color-info-border)",
                          items:[
                            {icon:"",name:"Trust Wallet",   role:"Tenant",   desc:"Register as new tenant. Onboarding → verify identity → Proof of Intent (city, budget, duration)."},
                            {icon:"",name:"Rabby Wallet",   role:"Landlord", desc:"Register as new landlord. Onboarding → verify identity → create listing with Hosting Deposit."},
                          ]},
                        { group:"Sign Contract", color:"var(--color-primary)", bg:"var(--color-primary-surface)", border:"var(--color-primary-border)",
                          items:[
                            {icon:"",name:"MetaMask",        role:"Tenant",   desc:"Yuki Tanaka. Browse listings → chat → request viewing → sign rental contract end-to-end."},
                            {icon:"",name:"Coinbase Wallet", role:"Landlord", desc:"Alex Chen. Manage listing → confirm viewing request → start agreement → sign contract."},
                          ]},
                        { group:"Early Termination", color:"var(--color-danger)", bg:"var(--color-danger-surface)", border:"var(--color-danger-border)",
                          items:[
                            {icon:"",name:"Ledger",   role:"Landlord", desc:"Nino Beridze. Active contract month 2/6. Receives early termination request from tenant. Full dispute flow."},
                            {icon:"",name:"Rainbow",  role:"Tenant",   desc:"Yuki Tanaka. Active contract month 2/6. Receives 2 letters from landlord — green (LL fault) + red (violation)."},
                          ]},
                        { group:"Contract Ending", color:"var(--color-warning)", bg:"var(--color-warning-surface)", border:"var(--color-warning-border)",
                          items:[
                            {icon:"",name:"Phantom",    role:"Landlord", desc:"Marco Ricci. Contract ends in 7 days. Full checkout — 3 scenarios: no damage, claim accepted, dispute+freeze."},
                            {icon:"",name:"OKX Wallet", role:"Tenant",   desc:"Priya Shah. Contract ends in 7 days. Checkout from tenant side with all response options."},
                          ]},
                      ].map((g,gi)=>(
                        <div key={gi} style={{marginBottom:12}}>
                          <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.5px",color:g.color,marginBottom:6}}>{g.group}</div>
                          {g.items.map((w,i)=>(
                            <div key={i} style={{display:"flex",gap:10,padding:"8px 10px",background:g.bg,border:`1px solid ${g.border}`,borderRadius:10,marginBottom:6}}>
                              <span style={{fontSize:20,flexShrink:0,lineHeight:1}}>{w.icon}</span>
                              <div style={{flex:1}}>
                                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                                  <span style={{fontWeight:800,fontSize:12}}>{w.name}</span>
                                  <span style={{fontSize:9,fontWeight:700,color:"white",background:w.role==="Tenant"?"#0369a1":"var(--color-primary)",padding:"1px 6px",borderRadius:6}}>{w.role}</span>
                                </div>
                                <div style={{fontSize:11,color:"var(--color-text-secondary)",lineHeight:1.5}}>{w.desc}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                      <div style={{borderTop:"1px solid var(--border)",paddingTop:10,display:"flex",gap:10,flexWrap:"wrap"}}>
                        <div style={{fontSize:10,color:"var(--muted)"}}><span style={{fontWeight:700,color:"#0369a1"}}>■ Tenant</span> — renter</div>
                        <div style={{fontSize:10,color:"var(--muted)"}}><span style={{fontWeight:700,color:"var(--color-primary)"}}>■ Landlord</span> — property owner</div>
                        <div style={{fontSize:10,color:"var(--muted)"}}>MR = Monthly Rent</div>
                        <div style={{fontSize:10,color:"var(--muted)"}}>Dispute = deposits frozen 60 days</div>
                      </div>
                    </div>
                </div>
              )}
            </div>
            <div>
              <button ref={protoBtnRef} onClick={openProto}
                style={{padding:"4px 10px",borderRadius:50,background:showProtocol?"var(--color-info-surface)":"linear-gradient(135deg,#7c3aed,#a855f7)",border:"none",fontSize:11,fontWeight:800,color:"white",cursor:"pointer",fontFamily:"var(--ff)",boxShadow:"0 2px 8px rgba(124,58,237,0.3)",whiteSpace:"nowrap"}}>
                Why pi2pi
              </button>
              {showProtocol&&protoRect&&(
                <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top:protoRect?protoRect.bottom+8:60,left:"50%",transform:"translateX(-50%)",width:"calc(var(--shell-w, 460px) - 32px)",maxWidth:"calc(100vw - 32px)",maxHeight:"70vh",background:"var(--color-bg-card)",borderRadius:16,boxShadow:"0 8px 40px rgba(0,0,0,0.25)",display:"flex",flexDirection:"column",overflow:"hidden",zIndex:9999}}>
                    <div style={{padding:"12px 14px",borderBottom:"1px solid var(--color-info-border)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"linear-gradient(135deg,#7c3aed,#a855f7)",flexShrink:0}}>
                      <span style={{fontWeight:800,fontSize:13,color:"white"}}>Why pi2pi</span>
                      <button onClick={()=>setShowProtocol(false)} style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:20,width:22,height:22,fontSize:12,cursor:"pointer",color:"white",fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:0}}></button>
                    </div>
                    <div className="guide-body demo-scroll" style={{overflowY:"auto"}}>
                      <div style={{marginBottom:16}}>
                        <div style={{fontWeight:800,fontSize:13,color:"var(--color-info)",marginBottom:4}}>Equal Stakes Protocol</div>
                        <div style={{fontSize:12,color:"var(--color-info)",fontStyle:"italic",fontWeight:800,marginBottom:8}}>Online poker logic for the rental market</div>
                        <div style={{fontSize:12,color:"var(--color-text-secondary)",lineHeight:1.6,background:"var(--color-info-surface)",borderRadius:10,padding:"10px 13px"}}>
                          Landlord holds in his wallet what he wants to earn per month. Tenant holds what he is willing to pay. If the amounts match — they can start talking. Tenant can only respond to listings within his budget.<br/>
                          No forms. No references. No credit checks. The wallet speaks for itself.<br/>
                          When both sides sign — equal stakes go into the rental protocol. Voluntarily. Want to claim someone's money? Your deposit gets frozen too. No free shots.<br/>
                          Equal stakes make fraud unprofitable. Equal risk makes intermediaries obsolete.<br/>
                          The protocol never becomes an agency. It charges rake only on yield — like a poker room, the house earns while the game is played, not for seating the players.<br/>
                          <em style={{color:"var(--color-info)",fontWeight:700}}>The protocol is the table. The code is the dealer. The rules never change.</em>
                        </div>
                      </div>
                      <div>
                        <div style={{fontWeight:800,fontSize:13,color:"var(--color-primary)",marginBottom:8}}>Offline vs pi2pi — Tbilisi</div>
                        <div style={{fontSize:12,color:"var(--color-text-secondary)",lineHeight:1.8,background:"var(--color-primary-surface)",borderRadius:10,padding:"10px 13px"}}>
                          <strong>Offline — Tenant pays on day one:</strong><br/>
                          First month + last month (guarantee) + security deposit (1–2× MR). Total: 3–4 monthly payments. Money goes to landlord. Last month and deposit are typically spent — and at lease end, reasons are found not to return them. Property intact, contract fulfilled — money gone.<br/><br/>
                          <strong>Offline — Landlord pays:</strong><br/>
                          One monthly payment to agency. Gone. Neither side is legally protected.<br/><br/>
                          <strong style={{color:"var(--color-primary)"}}>With pi2pi:</strong><br/>
                          Tenant pays the same — but money goes into the rental protocol. Stays tenant's property, earns yield, returns in full if property is undamaged.<br/><br/>
                          Landlord deposits the same amount instead of paying the agency. Stays his property, earns yield.<br/><br/>
                          <em style={{color:"var(--color-primary)",fontWeight:700}}>Both sides pay the same as always. But now these funds work for them and come back. And one or both sides save the agency commission.</em>
                        </div>
                      </div>
                    </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{flex:1}}>
            <Dropdown value={feedCity} placeholder={t("feed.select_city")}
              options={[{value:"Tbilisi",label:"Tbilisi"},{value:"Batumi",label:"Batumi"},{value:"Da Nang",label:"Da Nang"},{value:"Ho Chi Minh City",label:"Ho Chi Minh City"},{value:"Nha Trang",label:"Nha Trang"},{value:"Hanoi",label:"Hanoi"},{value:"Buenos Aires",label:"Buenos Aires"},{value:"São Paulo",label:"São Paulo"},{value:"Bangkok",label:"Bangkok"},{value:"Samui",label:"Samui"},{value:"Phuket",label:"Phuket"}]}
              onChange={v=>setFeedCity(v)}/>
          </div>
          <button className="sp-btn" style={{flexShrink:0}}><IcSearch/></button>
        </div>
        <div style={{marginTop:10}}>
          <Dropdown value={duration} placeholder={t("feed.duration_months")}
            options={[6,7,8,9,10,11,12].map(m=>({value:String(m),label: m===12?t("feed.12_months"):`${m} ${t("misc.months")}`}))}
            onChange={v=>setDuration(v)}/>
        </div>
      </div>
      <div className="filter-row">
        {["All","Studio","1BR","2BR","3BR","House"].map(f=>(
          <div key={f} className={`chip ${filter===f?"on":""}`} onClick={()=>setFilter(f)}>{f}</div>
        ))}
      </div>
      <div className="feed-tabs">
        <button className={`feed-tab ${tab==="props"?"on":""}`} onClick={()=>setTab("props")} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6}}>{Ic("home",14)} {t("nav.properties")}</button>
        <button className={`feed-tab ${tab==="tenants"?"on":""}`} onClick={()=>setTab("tenants")} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6}}>{Ic("user",14)} {t("nav.tenants")}</button>
        {user && <button className={`feed-tab ${tab==="saved"?"on":""}`} onClick={()=>setTab("saved")} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,position:"relative"}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={tab==="saved"||(bookmarks&&bookmarks.length>0)?"currentColor":"none"} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg> {t("nav.saved")}
          {bookmarks&&bookmarks.length>0&&tab!=="saved"&&<span style={{position:"absolute",top:-2,right:-4,width:7,height:7,background:"var(--color-primary)",borderRadius:"50%",border:"1.5px solid var(--color-bg-card)"}}/>}
        </button>}
      </div>
      {tab==="props"&&(
        <div className="card-grid">
          {/* Real listings — sorted by city/duration match */}
          {[...realListings].sort((a,b) => {
            let sa=0, sb=0;
            if (feedCity) {
              if ((a.location||a.city||"").toLowerCase().includes(feedCity.toLowerCase())) sa+=10;
              if ((b.location||b.city||"").toLowerCase().includes(feedCity.toLowerCase())) sb+=10;
            }
            if (duration) {
              if (a.minStay && Number(a.minStay) <= Number(duration)) sa+=5;
              if (b.minStay && Number(b.minStay) <= Number(duration)) sb+=5;
            }
            if (filter && filter!=="All") {
              const ft = filter.replace("BR"," Bedroom");
              if ((a.propertyType||"").includes(ft) || (a.propertyType||"").includes(filter)) sa+=3;
              if ((b.propertyType||"").includes(ft) || (b.propertyType||"").includes(filter)) sb+=3;
            }
            return sb - sa;
          }).map((l,i) => (
            <div key={l.id} className="lcard" style={{animationDelay:`${i*55}ms`}} onClick={()=>onSelect(l)}>
              <div className="lc-img-wrap">
                {l.image
                  ? <img src={l.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center",display:"block"}}/>
                  : <div className="lc-img" style={{background:"var(--color-bg-secondary)"}}>{SVGS[0]}</div>}
                <div className="lc-badge" style={{background:"var(--teal)",color:"var(--color-primary-text)"}}>{t("feed.signed_on_chain")}</div>
                {user && role==="tenant" && <button onClick={e=>{e.stopPropagation();toggleBookmark(l);}} style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,0.35)",border:"none",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",backdropFilter:"blur(4px)"}}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={isBookmarked(l.id,"listing")?"white":"none"} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
                </button>}
              </div>
              <div className="lc-loc">{l.location}</div>
              <div className="lc-price-row">
                <div className="lc-price">{l.price.toLocaleString()} <span>{t("misc.usdc_mo")}</span></div>
              </div>
              <div style={{fontSize:11,color:"var(--color-text-secondary)",margin:"0 12px 2px",fontWeight:400}}>{l.propertyType || l.property_type || (l.beds === 0 ? "Studio" : l.beds === 1 ? "1 Bedroom" : l.beds === 2 ? "2 Bedrooms" : l.beds ? l.beds + " Bedrooms" : "")}</div>
              <div style={{marginTop:6}}>
                <UserBadges address={l.contract} size="xs" getIdentityBadges={getIdentityBadges}/>
              </div>
              <div className="lc-chain"><div className="lc-chain-dot"/>{t("misc.on_chain")}</div>
            </div>
          ))}
          {/* Mock listings — sorted by city/duration match.
              TASK 10AJ: only on arc-testnet. On arc-mainnet these are
              indistinguishable from real listings to a first-time visitor
              (no "demo" label), so with 0 real listings today, showing them
              made the Mainnet marketplace look populated with fictional
              properties. Real listings (realListings, above) are unaffected
              on both networks. */}
          {ACTIVE_NETWORK_NAME === 'arc-testnet' && [...LISTINGS].sort((a,b) => {
            let sa=0, sb=0;
            if (feedCity) {
              if ((a.location||"").toLowerCase().includes(feedCity.toLowerCase())) sa+=10;
              if ((b.location||"").toLowerCase().includes(feedCity.toLowerCase())) sb+=10;
            }
            return sb - sa;
          }).map((l,i)=>{ const isRented = !!(activeContract && activeContract.listing && activeContract.listing.id === l.id); return (
            <div key={l.id} className="lcard" style={{animationDelay:`${i*55}ms`,opacity:isRented?0.92:1}} onClick={()=>onSelect(l)}>
              <div className="lc-img-wrap">
                {l.image ? <img src={l.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center",display:"block"}}/> : <div className="lc-img" style={{background:"var(--color-bg-secondary)"}}>{SVGS[l.id%SVGS.length]}</div>}
                {isRented
                  ? <div className="lc-badge" style={{background:"var(--color-warning)",color:"white"}}>{t("feed.just_rented")}</div>
                  : <div className="lc-badge">{l.tag}</div>}
                {user && role==="tenant" && <button onClick={e=>{e.stopPropagation();toggleBookmark(l);}} style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,0.35)",border:"none",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",backdropFilter:"blur(4px)"}}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={isBookmarked(l.id,"listing")?"white":"none"} stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
                </button>}
              </div>
              <div className="lc-loc">{l.location}</div>
              <div className="lc-price-row">
                <div className="lc-price">{l.price.toLocaleString()} <span>{t("misc.usdc_mo")}</span></div>
              </div>
              {l.beds != null && <div style={{fontSize:11,color:"var(--color-text-secondary)",margin:"0 12px 2px",fontWeight:400}}>{l.beds === 0 ? "Studio" : l.beds === 1 ? "1 Bedroom" : l.beds === 2 ? "2 Bedrooms" : l.beds + " Bedrooms"}</div>}
              <div className="lc-chain"><div className="lc-chain-dot"/>{t("misc.on_chain")}</div>
            </div>
          );})}
        </div>
      )}
      {tab==="tenants"&&(
        <div className="tcard-list">
          {/* Real tenant search requests — sorted by city match */}
          {[...realTenants].sort((a,b) => {
            let sa=0, sb=0;
            if (feedCity) {
              if ((a.city||"").toLowerCase().includes(feedCity.toLowerCase())) sa+=10;
              if ((b.city||"").toLowerCase().includes(feedCity.toLowerCase())) sb+=10;
            }
            if (duration) {
              if (a.duration && Number(a.duration) === Number(duration)) sa+=5;
              if (b.duration && Number(b.duration) === Number(duration)) sb+=5;
            }
            return sb - sa;
          }).map((rt,i)=>(
            <div key={"rt-"+rt.addr} className="tcard" style={{animationDelay:`${i*55}ms`,position:"relative",border:"1.5px solid var(--teal)",background:"var(--color-bg-card)"}}>
              {user && role==="landlord" && <button onClick={e=>{e.stopPropagation();toggleBookmark({id:rt.addr,name:rt.name,area:rt.city,mr:rt.budget,verified:rt.verified,propertyType:rt.propertyType,duration:rt.duration});}} style={{position:"absolute",top:10,right:10,background:"none",border:"none",cursor:"pointer",padding:4,zIndex:1}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill={isBookmarked(rt.addr,"tenant")?"var(--accent)":"none"} stroke={isBookmarked(rt.addr,"tenant")?"var(--accent)":"var(--muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
              </button>}
              <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:12}}>
                <AvatarBox id={null} size={64} radius={14} walletAddr={rt.addr}/>
                <div style={{flex:1}}>
                  <div className="tc-name" style={{fontSize:15}}>{rt.name}</div>
                  <div style={{marginTop:3}}>
                    {rt.verified
                      ? <span style={{color:"var(--green)",fontWeight:700,fontSize:11}}>{t("misc.verified_on_chain")}</span>
                      : <span style={{color:"var(--muted)",fontSize:11}}>{t("misc.unverified")}</span>}
                  </div>
                  <div style={{fontSize:11,color:"var(--muted)",marginTop:3}}>{rt.city || "—"}</div>
                </div>
              </div>
              <div className="tc-title" style={{marginBottom:8}}>{rt.propertyType || "Any"} · {rt.duration === "12" ? "1 year" : (rt.duration || "—") + " mo"}</div>
              <div className="tc-mr-row">
                <span className="tc-mr-label">{t("misc.budget")}</span>
                <span className="tc-mr-val">{rt.budget || "—"} USDC</span>
              </div>
              {role==="landlord" && (
                <OfferViewingButton myAddr={user?.addr} peerAddr={rt.addr} onNeedAuth={onNeedAuth} user={user}/>
              )}
            </div>
          ))}
          {/* Mock TENANTS for demo — TASK 10AK: arc-testnet only, same gating as the mock LISTINGS block above (TASK 10AJ). */}
          {ACTIVE_NETWORK_NAME === 'arc-testnet' && TENANTS.map((tn,i)=>(
            <div key={tn.id} className="tcard" style={{animationDelay:`${i*55}ms`,position:"relative"}}>
              {user && role==="landlord" && <button onClick={e=>{e.stopPropagation();toggleBookmark(tn);}} style={{position:"absolute",top:10,right:10,background:"none",border:"none",cursor:"pointer",padding:4,zIndex:1}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill={isBookmarked(tn.id,"tenant")?"var(--accent)":"none"} stroke={isBookmarked(tn.id,"tenant")?"var(--accent)":"var(--muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
              </button>}
              {/* Big avatar banner */}
              <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:12}}>
                <AvatarBox id={tn.avatar} size={64} radius={14}/>
                <div style={{flex:1}}>
                  <div className="tc-name" style={{fontSize:15}}>{tn.name}</div>
                  <div style={{marginTop:3}}>{tn.verified
                    ? <span style={{color:"var(--green)",fontWeight:700,fontSize:11}}>{t("misc.verified_on_chain")}</span>
                    : <span style={{color:"var(--muted)",fontSize:11}}>{t("misc.unverified")}</span>}
                  </div>
                  <div style={{fontSize:11,color:"var(--muted)",marginTop:3}}>{tn.area}</div>
                </div>
              </div>
              <div className="tc-title" style={{marginBottom:8}}>{tn.title}</div>
              <div style={{marginBottom:8}}>
                <RepScore role="tenant" viewings={tn.viewingsReq} rentals={tn.rentals}/>
              </div>
              <div className="tc-mr-row">
                <span className="tc-mr-label">{t("misc.budget")}</span>
                <span className="tc-mr-val">{tn.mr.toLocaleString()} USDC</span>
              </div>
              {/* Offer my place button — visible to all, guard for guest */}
              <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid var(--border)"}}>
                {offers[tn.id] ? (
                  <div style={{fontSize:12,color:"var(--green)",fontWeight:600}}>Place offered</div>
                ) : isGuest ? (
                  <button className="ca-btn accent" style={{width:"100%",textAlign:"center"}}
                    onClick={onNeedAuth}>
                    Offer my place
                  </button>
                ) : role==="landlord" ? (
                  totalOffers>=3 ? (
                    <div style={{fontSize:11,color:"var(--dim)",fontWeight:600}}>Offer limit reached (3/3)</div>
                  ) : (
                    <button className="ca-btn accent" style={{width:"100%",textAlign:"center"}}
                      onClick={()=>setOffers(o=>({...o,[tn.id]:true}))}>
                      Offer my place
                    </button>
                  )
                ) : null}
              </div>
            </div>
          ))}
          {role==="landlord"&&totalOffers>0&&(
            <div style={{fontSize:11,color:"var(--muted)",textAlign:"center",padding:"6px 0"}}>
              Offers sent: {totalOffers}/3 · Max 3 active at a time
            </div>
          )}
        </div>
      )}
      {tab==="saved"&&bookmarks&&(
        <div style={{padding:"0 16px"}}>
          {bookmarks.filter(b=>b.type==="listing").length>0 && (
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>{t("nav.properties")}</div>
              {bookmarks.filter(b=>b.type==="listing").map(b => {
                const l = LISTINGS.find(x=>x.id===b.id) || realListings.find(x=>x.id===b.id);
                const display = l || { id: b.id, title: b.name, location: b.location, price: b.price, image: b.image };
                return (
                  <div key={b.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid var(--border)",cursor:"pointer"}} onClick={()=>{if(l)onSelect(l);}}>
                    <div style={{width:50,height:50,borderRadius:8,overflow:"hidden",flexShrink:0,background:"var(--color-bg-secondary)"}}>
                      {display.image ? <img src={display.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🏠</div>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{display.title || "Listing"}</div>
                      <div style={{fontSize:11,color:"var(--muted)"}}>{display.location} · {display.price} {t("misc.usdc_mo")}</div>
                    </div>
                    <button onClick={e=>{e.stopPropagation();toggleBookmark(display);}} style={{background:"none",border:"none",cursor:"pointer",padding:4}}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {bookmarks.filter(b=>b.type==="tenant").length>0 && (
            <div>
              {bookmarks.filter(b=>b.type==="tenant").map(b => {
                const tn = TENANTS.find(x=>x.id===b.id);
                const display = tn || { id: b.id, name: b.name, area: b.location, mr: b.price, avatar: "alex" };
                return (
                  <div key={b.id} className="tcard" style={{position:"relative",marginBottom:8}}>
                    <button onClick={e=>{e.stopPropagation();toggleBookmark(display);}} style={{position:"absolute",top:10,right:10,background:"none",border:"none",cursor:"pointer",padding:4,zIndex:1}}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
                    </button>
                    <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:12}}>
                      <AvatarBox id={display.avatar || "alex"} size={64} radius={14}/>
                      <div style={{flex:1}}>
                        <div className="tc-name" style={{fontSize:15}}>{display.name || "Tenant"}</div>
                        <div style={{marginTop:3}}>
                          {(b.verified || display.verified)
                            ? <span style={{color:"var(--green)",fontWeight:700,fontSize:11}}>{t("misc.verified_on_chain")}</span>
                            : <span style={{color:"var(--muted)",fontSize:11}}>{t("misc.unverified")}</span>}
                        </div>
                        <div style={{fontSize:11,color:"var(--muted)",marginTop:3}}>{display.area || b.location || "—"}</div>
                      </div>
                    </div>
                    {(b.propertyType || display.propertyType) && <div className="tc-title" style={{marginBottom:8}}>{b.propertyType || display.propertyType} · {b.duration === "12" ? "1 year" : (b.duration || "—") + " mo"}</div>}
                    <div className="tc-mr-row">
                      <span className="tc-mr-label">{t("misc.budget")}</span>
                      <span className="tc-mr-val">{display.mr || b.price || "—"} USDC</span>
                    </div>
                    {b.id && String(b.id).startsWith("0x") && (
                      <OfferViewingButton myAddr={user?.addr} peerAddr={b.id} onNeedAuth={()=>{}} user={user}/>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default FeedPage;
