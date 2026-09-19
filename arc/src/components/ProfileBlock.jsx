import React, { useState, useEffect, useRef } from 'react';
import { t } from '../i18n/index.js';
import { readUsdcBalance, getProvider } from '../wallet.js';
import { ARC_TESTNET_CHAIN, OTHER_NETWORK_APP_URL, OTHER_NETWORK_LABEL } from '../helpers.js';
import RepScore from './ui/RepScore.jsx';
import WorldIDVerifyButton from './WorldIDVerifyButton.jsx';

export default function ProfileBlock({ user, displayName, setDisplayName, getIdentityBadges }) {
  const [nameSaved, setNameSaved] = useState(!!user?.name);
  const [nameEdit, setNameEdit] = useState(false);
  const [balance, setBalance] = useState(null);
  const [nextRefresh, setNextRefresh] = useState(30);
  const [identityBadges, setIdentityBadges] = useState([]);
  const [myAddr, setMyAddr] = useState(null);

  const fetchBalance = async () => {
    if (!window.ethereum) { setBalance("—"); return; }
    try {
      // Direct RPC — works for all wallet types
      const accs = await (getProvider()||window.ethereum)?.request({ method: "eth_accounts" });
      if (!accs || !accs.length) { setBalance("—"); return; }
      setMyAddr(accs[0]);
      const bal = await readUsdcBalance(accs[0]);
      setBalance(bal.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}));
      // Also fetch identity badges
      const badges = await getIdentityBadges(accs[0], true);
      setIdentityBadges(badges);
    } catch(e) { setBalance("—"); }
  };

  useEffect(() => {
    fetchBalance();
    const t = setInterval(() => {
      setNextRefresh(n => {
        if (n <= 1) { fetchBalance(); return 30; }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="sc-card" style={{marginBottom:16}}>
      {/* Wallet balance */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
        <div>
          <div style={{fontSize:11,color:"var(--muted)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4}}>{t("body.wallet_balance")}</div>
          <div style={{fontSize:26,fontWeight:800,letterSpacing:"-0.5px"}}>{balance===null?<span className="spinner" style={{width:20,height:20}}/>:balance} <span style={{fontSize:13,fontWeight:400,color:"var(--muted)"}}>USDC</span></div>
          <div style={{fontSize:10,color:"var(--muted)",marginTop:3}}>
            Next update in <span style={{fontWeight:700,color:"var(--teal)"}}>{nextRefresh}s</span>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"monospace",fontSize:10,color:"var(--muted)",marginBottom:4}}>{user?.addr||"0x7e1f…c290"}</div>
          <div style={{fontSize:10,color:"var(--green)",fontWeight:700}}>● {ARC_TESTNET_CHAIN.chainName}</div>
          {OTHER_NETWORK_APP_URL && (
            <a href={OTHER_NETWORK_APP_URL} style={{fontSize:9,color:"var(--muted)",textDecoration:"none",display:"block",marginTop:2}}>Switch to {OTHER_NETWORK_LABEL} →</a>
          )}
        </div>
      </div>

      {/* Identity & Verifications */}
      <div style={{borderTop:"1px solid var(--border)",paddingTop:12,marginBottom:12}}>
        <div className="field-label" style={{marginBottom:6}}>{t("body.identity_verifications")}</div>
        {identityBadges.length > 0 && (
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
            {identityBadges.map(b => (
              <div key={b.id}
                title={b.desc}
                style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 9px",borderRadius:50,background:b.color+"15",border:"1px solid "+b.color+"40",fontSize:11,fontWeight:700,color:b.color,cursor:"help"}}>
                <span>{b.icon}</span>
                <span>{b.label}</span>
              </div>
            ))}
          </div>
        )}
        {/* World ID button — hidden if already verified */}
        {!identityBadges.some(b => b.id === "worldid_verified") && myAddr && (
          <div style={{marginTop:8}}>
            <WorldIDVerifyButton myAddr={myAddr} onVerified={fetchBalance}/>
          </div>
        )}
        {!identityBadges.some(b => b.id === "coinbase_verified") && (
          <div style={{marginTop:6}}>
            <a href="https://www.coinbase.com/onchain-verify" target="_blank" rel="noopener"
              style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 14px",background:"var(--color-info)",border:"none",borderRadius:8,fontFamily:"var(--ff)",fontSize:12,fontWeight:700,color:"white",textDecoration:"none"}}>
              Get Coinbase Verified
            </a>
          </div>
        )}
      </div>

      {/* Display name */}
      <div style={{borderTop:"1px solid var(--border)",paddingTop:12}}>
        <div className="field-label" style={{display:"flex",justifyContent:"space-between"}}>
          Display name
          {nameSaved&&!nameEdit&&<span style={{fontSize:10,color:"var(--teal)",cursor:"pointer",fontWeight:700}} onClick={()=>setNameEdit(true)}>Edit</span>}
        </div>
        {nameSaved&&!nameEdit ? (
          <div style={{padding:"10px 12px",background:"var(--bg2)",borderRadius:10,fontSize:13,fontWeight:600}}>
            {displayName}
            <span style={{fontSize:10,color:"var(--muted)",fontWeight:400,marginLeft:8}}>· visible on your listing</span>
          </div>
        ) : (
          <div style={{display:"flex",gap:8}}>
            <input className="field-inp" style={{flex:1}} placeholder="e.g. Alex C." value={displayName}
              onChange={e=>setDisplayName(e.target.value)}/>
            <button className="bb-btn" style={{fontSize:12,padding:"0 14px",whiteSpace:"nowrap"}}
              onClick={()=>{if(displayName.trim()){setNameSaved(true);setNameEdit(false);}}}>{t("btn.save")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
