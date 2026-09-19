import React from 'react';
import { t } from '../../i18n/index.js';
import { lwIcImage } from './LwIcons.jsx';

export default function LwSummary({ state, coverUrl }) {
  const title = state.property_type && state.district
    ? `${state.property_type} · ${state.district}`
    : t("lw.new_listing");
  const sub = state.monthly_rent
    ? `$${state.monthly_rent}/mo · ${t("lw.min_months", {months: state.min_stay_months})}`
    : t("lw.fill_essentials");
  return (
    <div className="lw-summary">
      <div className="lw-sum-photo">
        {coverUrl ? <img src={coverUrl} alt=""/> : lwIcImage()}
      </div>
      <div style={{minWidth:0,flex:1}}>
        <div className="lw-sum-row1" style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{title}</div>
        <div className="lw-sum-row2">{sub}</div>
      </div>
    </div>
  );
}
