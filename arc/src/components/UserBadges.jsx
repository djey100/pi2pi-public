import React, { useState, useEffect } from 'react';
import { t } from '../i18n/index.js';
import { readUsdcBalance, getProvider } from '../wallet.js';

export default function UserBadges({ address, isCurrentUser = false, size = "sm", maxBadges = 3, getIdentityBadges }) {
  const [badges, setBadges] = useState([]);
  React.useEffect(() => {
    let cancelled = false;
    if (!address) return;
    getIdentityBadges(address, isCurrentUser).then(b => { if (!cancelled) setBadges(b); }).catch(() => {});
    return () => { cancelled = true; };
  }, [address, isCurrentUser]);
  if (!badges.length) return null;
  const padding = size === "xs" ? "2px 6px" : "4px 9px";
  const fontSize = size === "xs" ? 9 : 11;
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
      {badges.slice(0, maxBadges).map(b => (
        <div key={b.id}
          title={b.desc}
          style={{display:"inline-flex",alignItems:"center",gap:3,padding,borderRadius:50,background:b.color+"15",border:"1px solid "+b.color+"40",fontSize,fontWeight:700,color:b.color,cursor:"help"}}>
          <span>{b.icon}</span>
          {size !== "xs" && <span>{b.label}</span>}
        </div>
      ))}
    </div>
  );
}
