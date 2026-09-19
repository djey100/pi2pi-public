import React from 'react';

export default function LwSticky({ leftLabel, onLeft, ctaLabel, ctaDisabled, onCta, backLabel, onBack }) {
  return (
    <div className="lw-sticky">
      {backLabel ? (
        <button className="lw-cta-back" onClick={onBack}>← {backLabel}</button>
      ) : leftLabel ? (
        <button className="lw-save" onClick={onLeft}>{leftLabel}</button>
      ) : <span/>}
      <button className={`lw-cta ${ctaDisabled?"disabled":""}`} disabled={ctaDisabled} onClick={ctaDisabled?undefined:onCta}>{ctaLabel}</button>
    </div>
  );
}
