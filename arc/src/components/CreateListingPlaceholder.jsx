import React from 'react';
import { t } from '../i18n/index.js';
import { IcBack } from './ui/Icons.jsx';

export default function CreateListingPlaceholder({ onBack }) {
  return (
    <div className="cf-wrap">
      <button className="cf-back" onClick={onBack}><IcBack/> {t("cf.back")}</button>
      <div className="cf-title">{t("body.listing_wizard_coming")}</div>
      <div className="cf-sub" style={{marginBottom:22}}>The new wizard with photos, map, and amenities is on the way. Hold tight.</div>
    </div>
  );
}
