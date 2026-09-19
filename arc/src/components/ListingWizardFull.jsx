import React, { useState, useEffect, useRef, Fragment } from 'react';
import { t } from '../i18n/index.js';
import { getProvider } from '../wallet.js';
import { logEventApi, createListing, updateListing, uploadListingPhoto, composeDescription, publishListingWithSig, getOwnerListings, getListing } from '../api/client.js';
import { Ic } from './ui/Icons.jsx';
import { lwIcBack, lwIcClose, lwIcCheck, lwIcChevron, lwIcPlus, lwIcImage, lwIcInfo, lwIcWarn, lwIcLock, lwIcShield } from './wizard/LwIcons.jsx';
import LwTopBar from './wizard/LwTopBar.jsx';
import LwSummary from './wizard/LwSummary.jsx';
import LwSticky from './wizard/LwSticky.jsx';
import LwStep3 from './wizard/LwStep3.jsx';
import {
  LW_CITIES, LW_CITY_LIST, LW_DISTRICTS, LW_DISTRICT_CENTERS,
  LW_PROPERTY_TYPES, LW_MIN_STAY, LW_QUICK_RENT, LW_PHOTO_CAPTIONS, LW_AMENITY_GROUPS,
  lwCompressImage, LW_DRAFT_KEY, LW_BLANK_STATE
} from '../data/wizard-config.js';

function logEvent(type, payload = {}) {
  const log = { time: new Date().toISOString(), type, ...payload };
  console.log("[pi2pi-log]", log);
  logEventApi(log);
}

function LwStep1({ state, set, onNext, onClose, onSave, isEdit }) {
  const cityData = state.city ? LW_CITIES[state.city] : null;
  const districts = cityData ? cityData.districts : [];
  const valid = state.city && state.district && state.address.length >= 5 && state.property_type && Number(state.monthly_rent) > 0 && LW_MIN_STAY.includes(Number(state.min_stay_months));
  const showFloor = !["House","Room"].includes(state.property_type);
  return (
    <>
      <LwTopBar step={1} onBack={onClose} onClose={onClose}/>
      <div className="lw-content">
        <div className="lw-h1">{t("lw.list_your_place")}</div>
        <div className="lw-sub">{t("lw.takes_about")}</div>

        <div className="lw-block-label">{t("lw.location")}</div>

        <div className="lw-field-label first">{t("field.city")}</div>
        <select className="lw-input" value={state.city} onChange={e=>{set({city:e.target.value, district:"", zone_lat:null, zone_lng:null});}}>
          <option value="">{t("feed.select_city")}</option>
          {LW_CITY_LIST.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {state.city && <React.Fragment>
          <div className="lw-field-label">{t("field.city_region")}</div>
          <select className="lw-input" value={state.district} onChange={e=>set({district:e.target.value})}>
            <option value="">Select district...</option>
            {districts.map(d => <option key={d}>{d}</option>)}
          </select>
        </React.Fragment>}

        <div className="lw-field-label">{t("lw.street_number")}</div>
        <input className="lw-input" type="text" placeholder={t("ph.address_example")} value={state.address} onChange={e=>set({address:e.target.value})}/>
        <div className="lw-helper">{t("lw.address_privacy")}</div>

        <div className="lw-block-sep"/>

        <div className="lw-block-label" style={{marginTop:0}}>{t("lw.property")}</div>

        <div className="lw-field-label first">{t("lw.property_type")}</div>
        <div className="lw-pill-scroll">
          {LW_PROPERTY_TYPES.map(t => (
            <button key={t} className={`lw-chip ${state.property_type===t?"on":""}`} onClick={()=>set({property_type:t})}>{state.property_type===t?lwIcCheck():null}{t}</button>
          ))}
        </div>

        {showFloor && <>
          <div className="lw-field-label">{t("lw.floor_optional")}</div>
          <input className="lw-input-narrow" type="text" placeholder={t("ph.floor")} value={state.floor} onChange={e=>set({floor:e.target.value.replace(/\D/g,"")})}/>
        </>}

        <div className="lw-field-label">{t("lw.monthly_rent")}</div>
        <div className="lw-input-row">
          <input className="lw-input" type="text" inputMode="numeric" placeholder={t("ph.rent")} value={state.monthly_rent} onChange={e=>set({monthly_rent:e.target.value.replace(/\D/g,"")})} style={{flex:1}}/>
          <span className="lw-input-suffix">USDC</span>
        </div>
        <div className="lw-pill-row">
          {LW_QUICK_RENT.map(v => (
            <button key={v} className="lw-quick" onClick={()=>set({monthly_rent:String(v)})}>${v}</button>
          ))}
        </div>
        <div className="lw-helper" style={{marginTop:8}}>{t("lw.wallet_must_hold")}</div>

        <div className="lw-field-label">{t("lw.min_stay")}</div>
        <div className="lw-seg-row">
          {LW_MIN_STAY.map(m => (
            <button key={m} className={`lw-seg ${Number(state.min_stay_months)===m?"on":""}`} onClick={()=>set({min_stay_months:m})}>{m}mo</button>
          ))}
        </div>
        <div className="lw-helper">{t("lw.min_stay_note")}</div>
      </div>
      <LwSticky leftLabel={isEdit ? t("btn.save") : t("lw.save_draft")} onLeft={onSave || onClose} ctaLabel={t("lw.continue")} ctaDisabled={!valid} onCta={onNext}/>
    </>
  );
}

// ─── STEP 2: MAP ────────────────────────────────────────────────────────────
function LwStep2({ state, set, onNext, onBack, onClose, coverUrl }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const circleRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    if (!window.L || !mapDivRef.current) return;
    const center = (state.zone_lat && state.zone_lng)
      ? [state.zone_lat, state.zone_lng]
      : (LW_DISTRICT_CENTERS[state.district] || LW_DISTRICT_CENTERS["Other"]);
    const map = window.L.map(mapDivRef.current, {
      center, zoom: 15, minZoom: 14, maxZoom: 17,
      scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
      zoomControl: true, tap: true, dragging: true, touchZoom: true,
    });
    window.L.tileLayer("https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=pk.eyJ1IjoiYWRqZXkiLCJhIjoiY21vN2F1YW1yMDU3YzJ4cG1kYmh0ejF5ayJ9.YbixttiQd4lG5o7mGvNulg", {
      maxZoom: 19, tileSize: 512, zoomOffset: -1,
      attribution: "© Mapbox"
    }).addTo(map);
    const circle = window.L.circle(center, {
      radius: 300,
      color: "var(--color-primary)",
      weight: 1.5,
      fillColor: "var(--color-primary)",
      fillOpacity: 0.20,
      interactive: false,
    }).addTo(map);
    const marker = window.L.marker(center, { draggable: true, autoPan: true }).addTo(map);
    marker.on("drag", () => {
      const p = marker.getLatLng();
      circle.setLatLng(p);
    });
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      set({ zone_lat: p.lat, zone_lng: p.lng });
    });
    mapRef.current = map;
    circleRef.current = circle;
    markerRef.current = marker;
    // Save initial center if not set
    if (!state.zone_lat || !state.zone_lng) {
      set({ zone_lat: center[0], zone_lng: center[1] });
    }
    return () => { try { map.remove(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update center if district changed externally
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    const c = LW_DISTRICT_CENTERS[state.district];
    if (c && (!state.zone_lat || !state.zone_lng)) {
      mapRef.current.setView(c, 15);
      markerRef.current.setLatLng(c);
      circleRef.current.setLatLng(c);
      set({ zone_lat: c[0], zone_lng: c[1] });
    }
  }, [state.district]); // eslint-disable-line

  const valid = state.zone_lat != null && state.zone_lng != null;

  return (
    <>
      <LwTopBar step={2} onBack={onBack} onClose={onClose}/>
      <LwSummary state={state} coverUrl={coverUrl}/>
      <div className="lw-content">
        <div className="lw-h1">{t("lw.confirm_zone")}</div>
        <div className="lw-sub">{t("lw.tenants_see_circle")}</div>

        <div className="lw-map">
          <div ref={mapDivRef} style={{width:"100%",height:"100%"}}/>
          <div className="lw-map-pill">{t("lw.300m")}</div>
        </div>

        <div className="lw-zone-text">{t("lw.approx_zone", {district: state.district})}</div>

        <div className="lw-helper-block">
          <span style={{flexShrink:0,marginTop:1,color:"var(--color-primary)"}}>{lwIcInfo()}</span>
          <div className="lw-helper-block-text">{t("lw.privacy_note")}</div>
        </div>
      </div>
      <LwSticky backLabel={t("cf.back")} onBack={onBack} ctaLabel={t("lw.looks_right")} ctaDisabled={!valid} onCta={onNext}/>
    </>
  );
}

// ─── STEP 3: AMENITIES ───────────────────────────────────────────────────────
// LwStep3 extracted to ./components/wizard/LwStep3.jsx

// ─── STEP 4: PHOTOS ──────────────────────────────────────────────────────────
function LwStep4({ state, set, onNext, onBack, onClose, coverUrl }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError("");
    setUploading(true);
    try {
      const remaining = 10 - state.photos.length;
      const toUpload = files.slice(0, remaining);
      const newPhotos = [];
      for (const f of toUpload) {
        const blob = await lwCompressImage(f);
        const fd = new FormData();
        fd.append("file", blob, f.name.replace(/\.[^.]+$/, "") + ".jpg");
        const data = await uploadListingPhoto(fd);
        if (!data.url) throw new Error(data.error || "upload_failed");
        newPhotos.push({ url: data.url, path: data.path, caption: "" });
      }
      set({ photos: [...state.photos, ...newPhotos] });
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removePhoto = (i) => {
    const next = state.photos.filter((_, idx) => idx !== i);
    set({ photos: next });
  };

  const setCaption = (i, caption) => {
    const next = state.photos.map((p, idx) => idx === i ? { ...p, caption } : p);
    set({ photos: next });
  };

  const cycleCaption = (i) => {
    const cur = state.photos[i].caption;
    const idx = LW_PHOTO_CAPTIONS.indexOf(cur);
    const next = LW_PHOTO_CAPTIONS[(idx + 1) % LW_PHOTO_CAPTIONS.length];
    setCaption(i, next);
  };

  const hasFullKitchen = state.amenities.includes("Full kitchen");
  const hasKitchenPhoto = state.photos.some(p => (p.caption || "").toLowerCase() === "kitchen");
  const showKitchenWarn = hasFullKitchen && !hasKitchenPhoto && state.photos.length > 0;

  const valid = state.photos.length >= 5 && state.photos.length <= 10 && !showKitchenWarn;

  return (
    <>
      <LwTopBar step={4} onBack={onBack} onClose={onClose}/>
      <LwSummary state={state} coverUrl={coverUrl}/>
      <div className="lw-content">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
          <div>
            <div className="lw-h1">{t("lw.show_your_place")}</div>
            <div className="lw-sub" style={{marginBottom:0}}>{t("lw.photo_count")}</div>
          </div>
          <div className="lw-counter-right" style={{whiteSpace:"nowrap",marginTop:4}}>{state.photos.length} / 10</div>
        </div>

        {showKitchenWarn && (
          <div className="lw-smart-banner" style={{marginTop:16}}>
            <span style={{flexShrink:0}}>{lwIcWarn()}</span>
            <div className="lw-smart-text">{t("lw.kitchen_warn")}</div>
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp" multiple style={{display:"none"}} onChange={onFiles}/>

        <div className="lw-photo-grid" style={{marginTop:16}}>
          {state.photos.map((p, i) => (
            <div key={(p.url||p.cid) + i} className="lw-photo">
              <img src={p.url || (p.cid ? `/api/ipfs/file/${p.cid}` : "")} alt=""/>
              {i === 0 && <div className="lw-photo-cover">{t("lw.cover")}</div>}
              <div className="lw-photo-caption" onClick={()=>cycleCaption(i)}>{p.caption || t("lw.tap_to_label")}</div>
              <button className="lw-photo-del" onClick={()=>removePhoto(i)}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l6 6M8 2L2 8"/></svg>
              </button>
            </div>
          ))}
          {state.photos.length < 10 && (
            <button className="lw-photo-add" onClick={()=>fileRef.current?.click()} disabled={uploading}>
              {lwIcPlus()}
              <span>{uploading ? t("lw.uploading") : t("lw.add_photo")}</span>
            </button>
          )}
        </div>

        {error && <div style={{color:"var(--color-danger)",fontSize:12,marginBottom:10}}>{error}</div>}

        <div className="lw-photos-hint">{t("lw.photos_hint")}</div>
      </div>
      <LwSticky backLabel={t("cf.back")} onBack={onBack} ctaLabel={t("lw.continue")} ctaDisabled={!valid} onCta={onNext}/>
    </>
  );
}

// ─── STEP 5: DESCRIPTION ─────────────────────────────────────────────────────
function LwStep5({ state, set, onNext, onBack, onClose, coverUrl }) {
  const [composed, setComposed] = useState("");
  const [composing, setComposing] = useState(false);

  // Server-side compose; debounced
  useEffect(() => {
    if (state.description_mode !== "auto") return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setComposing(true);
        const data = await composeDescription({
            property_type: state.property_type,
            district: state.district,
            monthly_rent: state.monthly_rent,
            min_stay_months: state.min_stay_months,
            amenities: state.amenities,
            description_prompts: state.description_prompts,
          });
        if (!cancelled) {
          setComposed(data.text || "");
          set({ description: data.text || "" });
        }
      } catch {} finally { setComposing(false); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.description_mode, state.description_prompts.special, state.description_prompts.neighborhood, state.amenities.join("|"), state.property_type, state.district, state.monthly_rent, state.min_stay_months]);

  const valid = (state.description || "").trim().length >= 80 && (state.description || "").trim().length <= 500;
  const isAuto = state.description_mode === "auto";

  return (
    <>
      <LwTopBar step={5} onBack={onBack} onClose={onClose}/>
      <LwSummary state={state} coverUrl={coverUrl}/>
      <div className="lw-content">
        <div className="lw-h1">{t("lw.almost_done")}</div>
        <div className="lw-sub">{t("lw.well_write")}</div>

        <div className="lw-toggle">
          <div className={`lw-toggle-opt ${isAuto?"on":""}`} onClick={()=>set({description_mode:"auto"})}>
            {isAuto && <span style={{color:"#00a699"}}>{lwIcCheck()}</span>}{t("lw.auto_write")}
          </div>
          <div className={`lw-toggle-opt ${!isAuto?"on":""}`} onClick={()=>set({description_mode:"manual"})}>
            {!isAuto && <span style={{color:"#00a699"}}>{lwIcCheck()}</span>}{t("lw.write_own")}
          </div>
        </div>

        {isAuto ? (
          <>
            <div className="lw-prompt-label">{t("lw.whats_special")}</div>
            <input className="lw-prompt-input" type="text" placeholder={t("ph.special")} value={state.description_prompts.special} onChange={e=>set({description_prompts:{...state.description_prompts, special:e.target.value}})}/>

            <div className="lw-prompt-label">{t("lw.about_neighborhood")}</div>
            <input className="lw-prompt-input" type="text" placeholder={t("ph.neighborhood")} value={state.description_prompts.neighborhood} onChange={e=>set({description_prompts:{...state.description_prompts, neighborhood:e.target.value}})}/>

            <div className="lw-preview-block">
              <div className="lw-preview-label">{t("lw.preview")} {composing && "· "+t("lw.composing")}</div>
              <div className="lw-preview-text">{composed || state.description || t("lw.fill_prompts")}</div>
            </div>
          </>
        ) : (
          <>
            <textarea className="lw-input" rows={6} maxLength={500} placeholder={t("ph.description")} value={state.description} onChange={e=>set({description:e.target.value})} style={{resize:"vertical",minHeight:140,fontFamily:"inherit"}}/>
            <div className="lw-helper" style={{textAlign:"right"}}>
              {t("lw.chars_count", {count: state.description.length})}
            </div>
          </>
        )}

        <div className="lw-info-row">
          <div className="lw-info-row-left">{lwIcInfo()}{t("lw.et_terms")}</div>
          <span className="lw-info-row-link" onClick={()=>alert("Terminate early paths:\n\n• Mutual: both sign → deposits returned\n• Initiator accepts loss: deposit goes to counterparty\n• Disputed: 60-day freeze + court resolution")}>{t("lw.et_how")}</span>
        </div>
      </div>
      <LwSticky backLabel={t("cf.back")} onBack={onBack} ctaLabel={t("lw.continue")} ctaDisabled={!valid} onCta={onNext}/>
    </>
  );
}

// ─── STEP 6: PREVIEW ─────────────────────────────────────────────────────────
function LwStep6({ state, jumpTo, onPublish, onBack, onClose, publishing, publishError, coverUrl, isEdit }) {
  const [mode, setMode] = useState("feed"); // feed | full
  const escrow = Number(state.monthly_rent) * 2; // 1× commitment + 1× security
  const topAmenities = (state.amenities || []).slice(0, 4);

  return (
    <>
      <LwTopBar step={6} onBack={onBack} onClose={onClose}/>
      <LwSummary state={state} coverUrl={coverUrl}/>
      <div className="lw-content">
        <div className="lw-h1">{t("lw.how_tenants_see")}</div>
        <div style={{height:4}}/>

        <div className="lw-toggle" style={{marginBottom:16}}>
          <div className={`lw-toggle-opt ${mode==="feed"?"on":""}`} onClick={()=>setMode("feed")}>
            {mode==="feed" && <span style={{color:"#00a699"}}>{lwIcCheck()}</span>}{t("lw.feed_card")}
          </div>
          <div className={`lw-toggle-opt ${mode==="full"?"on":""}`} onClick={()=>setMode("full")}>
            {mode==="full" && <span style={{color:"#00a699"}}>{lwIcCheck()}</span>}{t("lw.full_listing")}
          </div>
        </div>

        {mode === "feed" ? (
          <div className="lw-feed-card">
            <div className="lw-feed-hero">
              {coverUrl ? <img src={coverUrl} alt=""/> : lwIcImage()}
              <div className="lw-trust-badge">{lwIcLock()}{t("body.escrow_protected")}</div>
            </div>
            <div className="lw-feed-body">
              <div className="lw-feed-title">{t("lw.type_in_district", {type: state.property_type, district: state.district})}</div>
              <div className="lw-feed-zone">{t("lw.zone_approx", {district: state.district})}</div>
              {topAmenities.length > 0 && (
                <div className="lw-pill-row">
                  {topAmenities.map(a => <span key={a} className="lw-chip small">{a}</span>)}
                </div>
              )}
              <div className="lw-feed-bottom">
                <div>
                  <div className="lw-feed-price">{state.monthly_rent} USDC/mo</div>
                  <div className="lw-feed-minstay">{t("lw.min_months", {months: state.min_stay_months})}</div>
                </div>
                <div className="lw-trust-inline">{lwIcShield()}{t("body.deposit_secured")}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="lw-feed-card">
            <div className="lw-feed-hero">
              {coverUrl ? <img src={coverUrl} alt=""/> : lwIcImage()}
              <div className="lw-trust-badge">{lwIcLock()}{t("body.escrow_protected")}</div>
            </div>
            <div className="lw-feed-body">
              <div className="lw-feed-title" style={{fontSize:20}}>{t("lw.type_in_district", {type: state.property_type, district: state.district})}</div>
              <div className="lw-feed-zone">{t("lw.zone_approx", {district: state.district})}</div>
              <div style={{display:"flex",gap:8,margin:"12px 0"}}>
                <div className="lw-trust-inline">{lwIcLock()}{t("body.escrow_protected")}</div>
                <div className="lw-trust-inline">{lwIcShield()}{t("body.deposit_secured")}</div>
              </div>
              <div style={{background:"var(--color-bg-secondary)",borderRadius:12,padding:"14px 16px",margin:"12px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:22,fontWeight:800,lineHeight:1.1}}>{state.monthly_rent} USDC<span style={{fontSize:15,fontWeight:600}}>/mo</span></div>
                  <div style={{fontSize:12,color:"var(--color-text-secondary)",marginTop:3}}>{t("lw.minimum_months", {months: state.min_stay_months})}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,color:"var(--color-text-secondary)"}}>{t("lw.escrow_at_signing")}</div>
                  <div style={{fontSize:15,fontWeight:700}}>{escrow} USDC</div>
                  <div style={{fontSize:10,color:"var(--color-text-secondary)",marginTop:2}}>{t("lw.commit_plus_security")}</div>
                </div>
              </div>
              <div style={{fontSize:14,lineHeight:1.6,margin:"16px 0"}}>{state.description}</div>
              {LW_AMENITY_GROUPS.map(g => {
                const active = (state.amenities || []).filter(a => g.items.includes(a));
                if (!active.length) return null;
                return (
                  <Fragment key={g.label}>
                    <div className="lw-group-label">{g.label}</div>
                    <div className="lw-pill-row">
                      {active.map(a => <span key={a} className="lw-chip on">{lwIcCheck()}{a}</span>)}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>
        )}

        <div style={{marginTop:20}}>
          {[
            {label:t("lw.edit_essentials"), step:1},
            {label:t("lw.edit_zone"), step:2},
            {label:t("lw.edit_amenities"), step:3},
            {label:t("lw.edit_photos"), step:4},
            {label:t("lw.edit_description"), step:5},
          ].map(r => (
            <div key={r.step} className="lw-edit-row" onClick={()=>jumpTo(r.step)}>
              <div className="lw-edit-left">{r.label}</div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" strokeWidth="1.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
            </div>
          ))}
        </div>

        {publishError && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>onPublish("clear-error")}>
            <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-bg-card)",borderRadius:16,padding:"24px 20px",maxWidth:380,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.3)"}}>
              <div style={{textAlign:"center",marginBottom:16}}>
                <div style={{fontSize:36,marginBottom:8}}>⚠️</div>
                <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>{t("balance.gate_title")}</div>
              </div>
              <div style={{background:"var(--color-danger-surface)",border:"1px solid var(--color-danger-border)",borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                <div style={{fontSize:13,color:"var(--color-danger)",lineHeight:1.6}}>{publishError}</div>
              </div>
              <div style={{fontSize:11,color:"var(--muted)",marginBottom:16,lineHeight:1.5}}>{t("balance.gate_topup")}</div>
              <button onClick={()=>onPublish("clear-error")} style={{width:"100%",padding:"12px",borderRadius:10,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:14,cursor:"pointer"}}>OK</button>
            </div>
          </div>
        )}
      </div>
      <div className="lw-sticky" style={{padding:"12px 20px"}}>
        <button className={`lw-cta full ${publishing?"disabled":""}`} disabled={publishing} onClick={publishing?undefined:onPublish}>
          {publishing ? t("lw.publishing") : isEdit ? t("btn.save_changes") : t("lw.publish_listing")}
        </button>
      </div>
    </>
  );
}

// ─── ROOT ListingWizard ──────────────────────────────────────────────────────
function lwDataToState(d) {
  return {
    ...LW_BLANK_STATE,
    city: d.city || "",
    district: d.district || "",
    address: d.address || "",
    property_type: d.propertyType || d.property_type || "",
    floor: d.floor || "",
    monthly_rent: String(d.monthlyRent || d.monthly_rent || ""),
    min_stay_months: Number(d.minStayMonths || d.min_stay_months || 6),
    lat: d.zoneLat || d.lat || null,
    lng: d.zoneLng || d.lng || null,
    amenities: d.amenities || [],
    photos: (d.photos || []).map(p => ({ cid: p.cid, url: p.url, caption: p.caption || "", uploading: false })),
    description_mode: d.descriptionMode || d.description_mode || "auto",
    description: d.description || "",
    description_prompts: d.descriptionPrompts || d.description_prompts || { special: "", neighborhood: "" },
  };
}

function ListingWizard({ user, editData, editId, onClose, onPublished, onNavigate }) {
  const addr = (user?.addr || "").toLowerCase();
  const isEdit = !!(editData || editId);
  const [step, setStep] = useState(1);
  const [state, setState] = useState(() => editData ? lwDataToState(editData) : LW_BLANK_STATE);
  const [listingId, setListingId] = useState(editData?.id || editId || null);
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(!editData && !!editId);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const saveTimerRef = useRef(null);
  const lastSavedRef = useRef("");

  // Load listing from server when editId is set but editData is not (page refresh)
  useEffect(() => {
    if (editData || !editId) return;
    getListing(editId).then(data => {
      if (data && data.id) {
        setState(lwDataToState(data));
        setListingId(data.id);
      }
    }).catch(() => {}).finally(() => setLoadingEdit(false));
  }, [editId]); // eslint-disable-line

  // On mount: check for localStorage draft, then server draft (skip in edit mode)
  useEffect(() => {
    if (isEdit) return;
    // Check localStorage first
    try {
      const raw = localStorage.getItem(LW_DRAFT_KEY(addr));
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && draft.state) { setResumeAvailable(true); return; }
      }
    } catch {}
    // Fallback: check server for draft listings
    if (addr && addr.length >= 42) {
      getOwnerListings(addr).then(listings => {
        const draft = (listings || []).find(l => l.status === "draft" && l.draftData);
        if (draft && draft.draftData?.state) {
          // Restore to localStorage so resumeDraft() works
          localStorage.setItem(LW_DRAFT_KEY(addr), JSON.stringify({ step: draft.draftData.step || 1, state: draft.draftData.state, listingId: draft.id, savedAt: Date.now() }));
          setResumeAvailable(true);
        }
      }).catch(()=>{});
    }
  }, [addr, isEdit]);

  const resumeDraft = () => {
    try {
      const raw = localStorage.getItem(LW_DRAFT_KEY(addr));
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && draft.state) setState(draft.state);
        if (draft && draft.step) setStep(draft.step);
        if (draft && draft.listingId) setListingId(draft.listingId);
      }
    } catch {}
    setResumeAvailable(false);
  };

  const discardDraft = () => {
    try { localStorage.removeItem(LW_DRAFT_KEY(addr)); } catch {}
    setResumeAvailable(false);
  };

  // Auto-save to localStorage + server every change (debounced 2s)
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!addr || isEdit) return;
      // Don't create server draft until user has filled something meaningful
      const hasContent = state.city || state.district || state.address.length > 0 || state.monthly_rent || state.photos.length > 0;
      try {
        const snapshot = JSON.stringify({ step, state, listingId, savedAt: Date.now() });
        if (snapshot === lastSavedRef.current) return;
        localStorage.setItem(LW_DRAFT_KEY(addr), snapshot);
        lastSavedRef.current = snapshot;
        // Save to server as draft (only if user started filling)
        if (!hasContent) return;
        if (listingId) {
          await updateListing(listingId, { owner_addr: addr, draft_data: { step, state }, ...stateToServer(state) }).catch(()=>{});
        } else {
          try {
            const data = await createListing({ owner_addr: addr, draft_data: { step, state }, ...stateToServer(state) });
            if (data?.id) setListingId(data.id);
          } catch {}
        }
      } catch {}
    }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [step, state, listingId, addr]);

  const set = (patch) => setState(s => ({ ...s, ...patch }));

  // Cover URL for summary bar
  const coverUrl = (state.photos && state.photos[0])
    ? (state.photos[0].url || `/api/ipfs/file/${state.photos[0].cid}`)
    : null;

  // Save draft to server (creates listings row in 'draft' status)
  const ensureServerDraft = async () => {
    if (listingId) return listingId;
    if (!addr) return null;
    try {
      const data = await createListing({ owner_addr: addr, ...stateToServer(state) });
      if (data?.id) {
        setListingId(data.id);
        return data.id;
      }
    } catch {}
    return null;
  };

  const publish = async (action) => {
    if (action === "clear-error") { setPublishError(""); return; }
    setPublishError("");
    if (!addr) { setPublishError(t("err.wallet_required")); return; }
    setPublishing(true);
    try {
      // Ensure server-side row exists; PATCH latest state; then call /publish
      let id = listingId;
      if (!id) id = await ensureServerDraft();
      if (!id) { setPublishError(t("err.draft_create_failed")); setPublishing(false); return; }
      // PATCH all fields
      const patchRes = await updateListing(id, { owner_addr: addr, ...stateToServer(state) });
      if (!patchRes.ok) {
        const e = await patchRes.json().catch(()=>({}));
        setPublishError(e.error || "Failed to save listing");
        setPublishing(false);
        return;
      }
      // Edit mode: sign + save, don't re-publish
      if (isEdit) {
        const editMsg = `pi2pi: Edit listing ${id}`;
        const editProvider = getProvider() || window.ethereum;
        const editSig = await editProvider.request({ method: "personal_sign", params: [editMsg, addr] });
        logEvent("UI_ACTION", { user: addr, action: "listing_edited", data: { listingId: id, signature: editSig.slice(0,20)+"..." } });
        try { localStorage.removeItem(LW_DRAFT_KEY(addr)); } catch {}
        setPublishing(false);
        onPublished?.({ id });
        return;
      }
      // Sign with wallet before publishing
      const signMsg = `pi2pi: Publish listing ${id}`;
      const provider = getProvider() || window.ethereum;
      const sig = await provider.request({ method: "personal_sign", params: [signMsg, addr] });
      logEvent("UI_ACTION", { user: addr, action: "listing_published", data: { listingId: id, signature: sig.slice(0,20)+"..." } });
      // Publish
      const pubRes = await publishListingWithSig(id, { owner_addr: addr, signature: sig });
      const pubData = await pubRes.json();
      if (!pubRes.ok) {
        if (pubData.errors && Array.isArray(pubData.errors)) {
          setPublishError(pubData.errors.map(e => `• ${e.message}`).join("\n"));
        } else {
          setPublishError(pubData.error || "Publish failed");
        }
        setPublishing(false);
        return;
      }
      // Success: clear local draft, notify parent
      try { localStorage.removeItem(LW_DRAFT_KEY(addr)); } catch {}
      onPublished?.(pubData);
    } catch (e) {
      setPublishError(e.message || "Publish failed");
      setPublishing(false);
    }
  };

  // ── Loading edit data from server (page refresh during edit) ──
  if (loadingEdit) {
    return (
      <div className="lw-shell" style={{display:"flex",flexDirection:"column",minHeight:"100vh",alignItems:"center",justifyContent:"center"}}>
        <div className="spinner" style={{width:32,height:32,borderRadius:"50%",border:"3px solid var(--color-border)",borderTopColor:"var(--teal)",animation:"spin .8s linear infinite"}}/>
      </div>
    );
  }

  // ── Resume prompt — centered dialog when saved draft exists ──
  if (resumeAvailable) {
    return (
      <div className="lw-shell" style={{display:"flex",flexDirection:"column",minHeight:"100vh"}}>
        {/* Centered focused dialog (leave bottom room for nav) */}
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 24px 88px"}}>
          <div style={{width:"100%",maxWidth:340,background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",borderRadius:16,padding:"28px 24px",textAlign:"center"}}>
            <div style={{width:48,height:48,borderRadius:12,background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",color:"var(--color-primary)"}}>
              {Ic("edit",22)}
            </div>
            <div style={{fontSize:16,fontWeight:700,color:"var(--color-text-primary)",marginBottom:6,letterSpacing:"-0.3px"}}>
              {t("lw.saved_draft")}
            </div>
            <div style={{fontSize:12,color:"var(--color-text-secondary)",lineHeight:1.55,marginBottom:20}}>
              {t("lw.saved_draft_desc")}
            </div>
            <button onClick={resumeDraft} className="btn-p" style={{marginBottom:8}}>
              {t("lw.resume_draft")}
            </button>
            <button onClick={discardDraft} className="btn-g">
              {t("lw.start_fresh")}
            </button>
          </div>
        </div>

        {/* Bottom nav — same as rest of app, so user isn't trapped */}
        {onNavigate && (
          <nav className="bnav">
            <button className="bnav-btn" onClick={()=>onNavigate("feed")}>
              <span className="bnav-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              </span>
              {t("nav.explore")}
            </button>
            <button className="bnav-btn" onClick={()=>onNavigate("inbox")}>
              <span className="bnav-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              </span>
              {t("nav.inbox")}
            </button>
            <button className="bnav-btn" onClick={()=>onNavigate("deals")}>
              <span className="bnav-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
              </span>
              {t("nav.deals")}
            </button>
            <button className="bnav-btn" onClick={()=>onNavigate("account")}>
              <span className="bnav-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
              {t("nav.account")}
            </button>
          </nav>
        )}
      </div>
    );
  }

  // ── Main wizard frame ──
  const goNext = () => setStep(s => Math.min(6, s + 1));
  const goBack = () => setStep(s => Math.max(1, s - 1));
  const close = () => {
    onClose?.();
  };
  const saveAndClose = async () => {
    if (isEdit && listingId) {
      try {
        await updateListing(listingId, { owner_addr: addr, draft_data: { step, state }, ...stateToServer(state) });
      } catch {}
    }
    onClose?.();
  };
  const jumpTo = (n) => setStep(n);

  // For edit mode: "Save" button saves to server; X closes without saving
  // For new listing: "Save draft" keeps localStorage draft; X closes
  const onLeftAction = isEdit ? saveAndClose : close;

  return (
    <div className="lw-shell">
      {step === 1 && <LwStep1 state={state} set={set} onNext={goNext} onClose={close} onSave={onLeftAction} isEdit={isEdit}/>}
      {step === 2 && <LwStep2 state={state} set={set} onNext={goNext} onBack={goBack} onClose={close} coverUrl={coverUrl} onSave={onLeftAction} isEdit={isEdit}/>}
      {step === 3 && <LwStep3 state={state} set={set} onNext={goNext} onBack={goBack} onClose={close} coverUrl={coverUrl} onSave={onLeftAction} isEdit={isEdit}/>}
      {step === 4 && <LwStep4 state={state} set={set} onNext={goNext} onBack={goBack} onClose={close} coverUrl={coverUrl} onSave={onLeftAction} isEdit={isEdit}/>}
      {step === 5 && <LwStep5 state={state} set={set} onNext={goNext} onBack={goBack} onClose={close} coverUrl={coverUrl} onSave={onLeftAction} isEdit={isEdit}/>}
      {step === 6 && <LwStep6 state={state} jumpTo={jumpTo} onPublish={publish} onBack={goBack} onClose={close} publishing={publishing} publishError={publishError} coverUrl={coverUrl} isEdit={isEdit}/>}
    </div>
  );
}

// Convert wizard state → server payload
function stateToServer(s) {
  return {
    city: s.city || null,
    district: s.district,
    address: s.address,
    zone_lat: s.zone_lat,
    zone_lng: s.zone_lng,
    property_type: s.property_type,
    floor: s.floor ? Number(s.floor) : null,
    monthly_rent: Number(s.monthly_rent) || 0,
    min_stay_months: Number(s.min_stay_months) || 6,
    amenities: s.amenities || [],
    photos: s.photos || [],
    description: s.description || "",
    description_mode: s.description_mode || "auto",
    description_prompts: s.description_prompts || null,
  };
}

// ─── MY LISTINGS PAGE (M6) ────────────────────────────────────────────────────

export { lwDataToState, stateToServer };
export default ListingWizard;
