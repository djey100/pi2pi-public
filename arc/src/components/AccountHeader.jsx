import React, { useState, useEffect } from 'react';
import { t } from '../i18n/index.js';
import { readUsdcBalance, getProvider } from '../wallet.js';
import RepScore from './ui/RepScore.jsx';
import UserBadges from './UserBadges.jsx';
import WorldIDVerifyButton from './WorldIDVerifyButton.jsx';

export default function AccountHeader({ user, role, displayName, setDisplayName, repStats, getIdentityBadges, triggerWorldIDVerify }) {
  const [balance, setBalance] = useState(null);
  const [fullAddr, setFullAddr] = useState(null);
  const [identityBadges, setIdentityBadges] = useState([]);
  const [storedName, setStoredName] = useState("");

  useEffect(() => {
    (async () => {
      try {
        // Prefer Circle SCA address (authoritative for Circle wallet users)
        let addr = window.pi2piWallet?._circleAddress;
        if (!addr) {
          const provider = getProvider() || window.ethereum;
          if (!provider) return;
          const accs = await provider.request({ method: "eth_accounts" });
          if (!accs?.[0]) return;
          addr = accs[0];
        }
        setFullAddr(addr);
        // Display name stored by Settings dropdown — one-time permanent rename
        try {
          const saved = localStorage.getItem("pi2pi_displayname_" + addr.toLowerCase());
          if (saved) setStoredName(saved);
        } catch {}
        // Direct RPC call — works for all wallet types (MetaMask, WalletConnect, Circle)
        const bal = await readUsdcBalance(addr);
        setBalance(bal.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}));
        // Identity badges (Coinbase Verified, Circle Biometric, etc.)
        const badges = await getIdentityBadges(addr, true);
        setIdentityBadges(badges);
      } catch(e) { setBalance("—"); }
    })();
  }, []);

  const shortAddr = fullAddr ? fullAddr.slice(0,10)+"…"+fullAddr.slice(-4) : (user?.addr||"—");
  // Display priority: stored permanent name → prop displayName → wallet addr
  const shownName = storedName || displayName || shortAddr;

  return (
    <div className="sc-card" style={{marginBottom:12,padding:"10px 12px"}}>
      {/* Top row: display name (left) + USDC balance (right, prominent) */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:10,marginBottom:6}}>
        <div style={{fontSize:15,fontWeight:700,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {shownName}
        </div>
        <div style={{fontSize:16,fontWeight:800,color:"var(--text)",whiteSpace:"nowrap",flexShrink:0}}>
          {balance===null?"…":balance} <span style={{fontSize:11,color:"var(--muted)",fontWeight:600}}>USDC</span>
        </div>
      </div>

      {/* Stats row — viewings + contracts + disputes */}
      <div style={{display:"flex",alignItems:"center",gap:10,fontSize:11,color:"var(--muted)",marginBottom:6,flexWrap:"wrap"}}>
        <span><strong style={{color:"var(--teal)",fontSize:13}}>{repStats?.viewings||0}</strong> {t("misc.viewings")}</span>
        <span style={{color:"var(--border)"}}>·</span>
        <span><strong style={{color:"var(--green)",fontSize:13}}>{repStats?.rentals||0}</strong> {t("misc.contracts")}</span>
        <span style={{color:"var(--border)"}}>·</span>
        <span><strong style={{color:repStats?.disputes>0?"var(--color-danger)":"var(--muted)",fontSize:13}}>{repStats?.disputes||0}</strong> {t("misc.disputes")}</span>
      </div>

      {/* Identity Verifications — one compact horizontal row */}
      {(() => {
        const has = (id) => identityBadges.some(b => b.id === id);
        const chips = [
          { id: "circle_biometric", label: "Biometric", icon: "", color: "#6366f1", verified: has("circle_biometric") },
          { id: "worldid_verified",  label: "World ID",  icon: "", color: "#EAF0FF", verified: has("worldid_verified") },
          { id: "coinbase_verified", label: "Coinbase",  icon: "", color: "var(--color-info)", verified: has("coinbase_verified") },
          { id: "binance_bab",       label: "Binance",   icon: "", color: "#F3BA2F", verified: has("binance_bab") },
        ];
        const refreshBadges = async () => {
          if (!fullAddr) return;
          const b = await getIdentityBadges(fullAddr, true);
          setIdentityBadges(b);
        };
        const onClick = (chip) => {
          if (chip.verified) return;
          if (chip.id === "worldid_verified") {
            triggerWorldIDVerify(fullAddr, refreshBadges);
          } else if (chip.id === "coinbase_verified") {
            window.open("https://www.coinbase.com/onchain-verify", "_blank", "noopener");
          } else if (chip.id === "binance_bab") {
            window.open("https://www.binance.com/en/babt", "_blank", "noopener");
          }
        };
        return (
          <div style={{borderTop:"1px solid var(--border)",paddingTop:8,marginBottom:2,display:"flex",gap:4,flexWrap:"nowrap",overflowX:"auto",WebkitOverflowScrolling:"touch",paddingBottom:2}}>
            {chips.map(chip => (
              <button key={chip.id} onClick={()=>onClick(chip)} title={chip.verified ? chip.label + " verified" : "Tap to get " + chip.label}
                style={{
                  display:"inline-flex",alignItems:"center",gap:4,
                  padding:"4px 8px",borderRadius:50,
                  background: chip.verified ? chip.color + "15" : "var(--bg2)",
                  border: "1px solid " + (chip.verified ? chip.color + "40" : "var(--border)"),
                  fontSize:10,fontWeight:700,
                  color: chip.verified ? chip.color : "var(--muted)",
                  fontFamily:"var(--ff)",
                  cursor: chip.verified ? "default" : "pointer",
                  whiteSpace:"nowrap",flexShrink:0,
                }}>
                <span style={{fontSize:11}}>{chip.verified ? "" : chip.icon}</span>
                <span>{chip.label}</span>
              </button>
            ))}
          </div>
        );
      })()}

    </div>
  );
}
