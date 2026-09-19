import React, { useRef, Fragment } from 'react';
import { t } from '../../i18n/index.js';
import { lwIcCheck, lwIcChevron } from './LwIcons.jsx';
import { LW_AMENITY_GROUPS } from '../../data/wizard-config.js';
import LwTopBar from './LwTopBar.jsx';
import LwSummary from './LwSummary.jsx';
import LwSticky from './LwSticky.jsx';

export default function LwStep3({ state, set, onNext, onBack, onClose, coverUrl }) {
  const toggle = (item) => {
    const next = state.amenities.includes(item)
      ? state.amenities.filter(x => x !== item)
      : [...state.amenities, item];
    set({ amenities: next });
    if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
  };
  const valid = state.amenities.length >= 3;
  return (
    <>
      <LwTopBar step={3} onBack={onBack} onClose={onClose}/>
      <LwSummary state={state} coverUrl={coverUrl}/>
      <div className="lw-content">
        <div className="lw-h1">{t("lw.whats_included")}</div>
        <div className="lw-sub">{t("lw.tap_everything")}</div>
        <div style={{fontSize:12,color:"var(--color-text-secondary)",textAlign:"center",marginBottom:16}}>{t("lw.most_listings")}</div>

        {LW_AMENITY_GROUPS.map((g,gi) => (
          <Fragment key={g.label}>
            <div className={`lw-group-label ${gi===0?"first":""}`}>{g.label}</div>
            <div className="lw-pill-row">
              {g.items.map(item => (
                <button key={item} className={`lw-chip ${state.amenities.includes(item)?"on":""}`} onClick={()=>toggle(item)}>
                  {state.amenities.includes(item) && lwIcCheck()}{item}
                </button>
              ))}
            </div>
          </Fragment>
        ))}

        <div className="lw-amenity-counter">{state.amenities.length} {t("lw.selected")}{!valid && " · "+t("lw.pick_at_least")}</div>
      </div>
      <LwSticky backLabel={t("cf.back")} onBack={onBack} ctaLabel={t("lw.continue")} ctaDisabled={!valid} onCta={onNext}/>
    </>
  );
}
