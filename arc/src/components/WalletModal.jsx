import React, { useState } from 'react';
import { t } from '../i18n/index.js';
import { getProvider, withWalletLock } from '../wallet.js';
import { ARC_TESTNET_CHAIN, ESCROW_ADDRESS, ACTIVE_NETWORK_NAME, isCircleSupported } from '../helpers.js';
import { logEventApi, getUser, patchUser, saveUser } from '../api/client.js';
import { Ic } from './ui/Icons.jsx';

function logEvent(type, payload = {}) {
  const log = { time: new Date().toISOString(), type, ...payload };
  console.log("[pi2pi-log]", log);
  logEventApi(log);
}

function WalletModal({ onClose, onConnected, hint="" }) {
  // Flow (new):    choose → connecting → verify-human → verify-funds → role-pick → create-listing → done
  // Flow (return): choose → connecting → done
  const TOTAL_STEPS = 5;
  const [stage, setStage] = useState("choose");
  const [chosenRole, setChosenRole] = useState(null);
  const [mmAddr, setMmAddr] = useState(null);
  const [mmError, setMmError] = useState(null);
  const [connectMethod, setConnectMethod] = useState(null); // 'mm' | 'wc' | null
  const [usdcBal, setUsdcBal] = useState(null);
  const [isReturning, setIsReturning] = useState(false);
  const [signError, setSignError] = useState(null);
  const [signing, setSigning] = useState(false);
  // Humanity verification state
  const [humanMethod, setHumanMethod] = useState(null);
  const [humanVerifying, setHumanVerifying] = useState(false);
  const [humanVerified, setHumanVerified] = useState(false);
  // Listing form fields
  const [listingData, setListingData] = useState({});
  const setField = (k, v) => setListingData(d => ({...d, [k]: v}));

  // Push wallet-type / biometric-status to server on every successful connect.
  // Server ignores the call if user hasn't registered yet (no role/listing saved).
  // For registered users, this updates walletType + circleBiometric so admin sees
  // fresh values on every login (not just at initial registration).
  // Canonical wallet types: "circle" | "injected" | "walletconnect" | "unknown"
  const getCanonicalWalletType = () => {
    const raw = window.pi2piWallet?.type;
    if (raw === "circle") return "circle";
    if (raw === "injected" || raw === "metamask") return "injected";
    if (raw === "walletconnect") return "walletconnect";
    // Fallback from connectMethod
    if (connectMethod === "mm") return "injected";
    if (connectMethod === "wc") return "walletconnect";
    if (connectMethod === "circle") return "circle";
    return "unknown";
  };

  const getWalletProviderName = () => {
    if (!window.ethereum) return null;
    if (window.ethereum.isMetaMask) return "metamask";
    if (window.ethereum.isRabby) return "rabby";
    if (window.ethereum.isBraveWallet) return "brave";
    return "unknown";
  };

  const syncWalletInfoToServer = (addr) => {
    if (!addr) return;
    try {
      const walletType = getCanonicalWalletType();
      const providerName = walletType === "injected" ? getWalletProviderName() : null;
      patchUser(addr, {
          walletType,
          ...(providerName && { providerName }),
          circleBiometric: walletType === "circle",
          lastLoginAt: Date.now(),
        }).catch(e => console.warn("[sync] wallet info patch failed:", e?.message));
    } catch (e) {}
  };

  const connectMetaMask = () => withWalletLock(async () => {
    setMmError(null);
    if (!window.ethereum) { setMmError("No wallet detected. Install MetaMask or use WalletConnect."); return; }
    try {
      setConnectMethod("mm");
      setStage("connecting");
      await window.ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
      const accs = await (getProvider()||window.ethereum)?.request({ method: "eth_accounts" });
      if (!accs || !accs.length) throw new Error("No accounts returned");
      const addr = accs[0];
      setMmAddr(addr);
      // Establish server auth session FIRST — then sync wallet metadata (requires auth)
      try { await window.pi2piWallet?._authLogin(addr, getProvider() || window.ethereum); } catch(e) { console.warn("[auth] mm login:", e?.message); }
      syncWalletInfoToServer(addr);
      logEvent("WALLET_CONNECT", { user: addr, action: "wallet_connect_success", data: { method: "metamask", walletType: "injected", providerName: getWalletProviderName() } });
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] });
      } catch (e) {
        if (e.code === 4902) await window.ethereum.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });
        else throw e;
      }
      // Returning user? Check localStorage first, then server
      let saved = null;
      try { saved = localStorage.getItem("pi2pi_user_" + addr.toLowerCase()); } catch(e){}
      if (!saved) {
        try {
          const resp = { ok: true, json: () => getUser(addr) };
          const serverData = await resp.json();
          if (serverData && serverData.role) {
            saved = JSON.stringify(serverData);
            // Cache to localStorage
            try { localStorage.setItem("pi2pi_user_" + addr.toLowerCase(), saved); } catch(e){}
          }
        } catch(e){}
      }
      if (saved) {
        const parsed = JSON.parse(saved);
        setChosenRole(parsed.role);
        setIsReturning(true);
        setStage("done");
      } else {
        setStage("role-pick");
      }
    } catch (e) {
      setMmError(e.code === 4001 ? "Connection rejected by user" : (e.message || "Unknown error"));
      setStage("choose");
    }
  });

  const connectWalletConnect = () => withWalletLock(async () => {
    setMmError(null);
    // NOTE: Do NOT check window.EthereumProvider here. The library is loaded
    // lazily inside wallet.connectWalletConnect() on first call. An early guard
    // would always reject the first click before the lazy loader can run.
    try {
      setConnectMethod("wc");
      setStage("connecting");
      // Initiate WC handshake (lazy-loads the lib, shows QR / opens wallet app).
      // After this, window.ethereum is monkey-patched to point at WC provider.
      await window.pi2piWallet.connectWalletConnect();
      const accs = await (getProvider()||window.ethereum)?.request({ method: "eth_accounts" });
      if (!accs || !accs.length) throw new Error("No accounts returned");
      const addr = accs[0];
      setMmAddr(addr);
      syncWalletInfoToServer(addr);
      logEvent("WALLET_CONNECT", { user: addr, action: "wallet_connect_success", data: { method: "walletconnect", walletType: "walletconnect" } });
      // WC connects on whatever chain the wallet currently has. Try to switch
      // to Arc Testnet now; if wallet doesn't know it, request to add it.
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] });
      } catch (e) {
        if (e.code === 4902 || /Unrecognized chain/i.test(e?.message || "")) {
          try {
            await window.ethereum.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });
          } catch (addErr) {
            console.warn("[pi2pi] could not add Arc Testnet to wallet:", addErr);
          }
        } else {
          console.warn("[pi2pi] could not switch to Arc Testnet:", e);
        }
      }
      let saved = null;
      try { saved = localStorage.getItem("pi2pi_user_" + addr.toLowerCase()); } catch(e){}
      if (!saved) {
        try {
          const resp = { ok: true, json: () => getUser(addr) };
          const serverData = await resp.json();
          if (serverData && serverData.role) {
            saved = JSON.stringify(serverData);
            try { localStorage.setItem("pi2pi_user_" + addr.toLowerCase(), saved); } catch(e){}
          }
        } catch(e){}
      }
      if (saved) {
        const parsed = JSON.parse(saved);
        setChosenRole(parsed.role);
        setIsReturning(true);
        setStage("done");
      } else {
        setStage("role-pick");
      }
    } catch (e) {
      setMmError(e.code === 4001 ? "Connection rejected by user" : (e.message || "WalletConnect failed"));
      setStage("choose");
    }
  });

  const connectCircle = () => withWalletLock(async () => {
    setMmError(null);
    try {
      setConnectMethod("circle");
      setStage("connecting");
      // Circle Modular Wallets — passkey/SCA flow. Tries login first; if no
      // existing passkey is found, falls back to register.
      // Stable username so iOS Keychain creates exactly ONE passkey per device,
      // not a new one each click. The actual SCA address is derived from the
      // passkey credential, not the username — but iOS uses username to dedupe
      // suggestions in the FaceID picker.
      // Don't pass hardcoded username — let the wallet generate a unique one for new users
      // or use the saved one from localStorage for returning users on this device
      const { address } = await window.pi2piWallet.connectCircleWallet();
      setMmAddr(address);
      if (window.pi2piWallet._authenticated) syncWalletInfoToServer(address);
      logEvent("WALLET_CONNECT", { user: address, action: "wallet_connect_success", data: { method: "circle", walletType: "circle" } });
      // Load existing user (server or localStorage)
      let saved = null;
      try { saved = localStorage.getItem("pi2pi_user_" + address.toLowerCase()); } catch(e){}
      if (!saved) {
        try {
          const resp = { ok: true, json: () => getUser(address) };
          const serverData = await resp.json();
          if (serverData && serverData.role) {
            saved = JSON.stringify(serverData);
            try { localStorage.setItem("pi2pi_user_" + address.toLowerCase(), saved); } catch(e){}
          }
        } catch(e){}
      }
      if (saved) {
        const parsed = JSON.parse(saved);
        setChosenRole(parsed.role);
        setIsReturning(true);
        setStage("done");
      } else {
        setStage("role-pick");
      }
    } catch (e) {
      console.error("[pi2pi] Circle connect failed:", e);
      setMmError(e.message || "Circle Wallet connection failed");
      setStage("choose");
    }
  });

  const loadBalance = async () => {
    if (!mmAddr || !window.ethereum || typeof ethers === "undefined") { setUsdcBal("—"); return; }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const usdc = new ethers.Contract(USDC_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
      const bal = await usdc.balanceOf(mmAddr);
      setUsdcBal(parseFloat(ethers.formatUnits(bal, 6)).toFixed(2));
    } catch(e) { setUsdcBal("—"); }
  };

  const signIntent = async () => {
    setSignError(null);
    setSigning(true);
    try {
      const payload = JSON.stringify({ role: chosenRole, listing: listingData, addr: mmAddr, ts: Date.now() });
      const sig = await window.ethereum.request({
        method: "personal_sign",
        params: [payload, mmAddr]
      });
      const _wt = getCanonicalWalletType();
      const _pn = _wt === "injected" ? getWalletProviderName() : null;
      const userData = {
        role: chosenRole, listing: listingData, signature: sig, addr: mmAddr, createdAt: Date.now(),
        walletType: _wt,
        ...(_pn && { providerName: _pn }),
        circleBiometric: _wt === "circle",
      };
      // Save to localStorage
      try { localStorage.setItem("pi2pi_user_" + mmAddr.toLowerCase(), JSON.stringify(userData)); } catch(e){}
      // Save to shared server (proof-of-funds is non-blocking — server sets flag if low balance)
      try { saveUser(userData); } catch(e){}
      logEvent("REGISTRATION", { user: mmAddr, action: "user_registered", data: { role: chosenRole, walletType: _wt, providerName: _pn } });
      setSigning(false);
      setStage("done");
    } catch(e) {
      setSigning(false);
      setSignError(e.code === 4001 ? "Signature rejected" : (e.message || "Unknown error"));
    }
  };

  const shortAddr = mmAddr ? mmAddr.slice(0,6)+"…"+mmAddr.slice(-4) : "";
  const finalRole = chosenRole;

  const inputStyle = {width:"100%",padding:"10px 12px",border:"1.5px solid var(--border)",borderRadius:10,fontFamily:"var(--ff)",fontSize:13,color:"var(--text)",outline:"none",background:"var(--bg)",marginBottom:8};
  const labelStyle = {fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4,marginTop:8};

  // While WalletConnect is initiating, hide pi2pi modal entirely so the
  // Reown QR modal can be the only UI on screen. After WC connect resolves
  // (success → next stage, failure → back to choose), this hide condition
  // drops and pi2pi modal becomes visible again at the right stage.
  const hideForWC = stage==="connecting" && connectMethod==="wc";

  return (
    <div className="modal-ov" onClick={e=>e.target===e.currentTarget&&onClose()} style={hideForWC ? {display:"none"} : undefined}>
      <div className="modal">
        <div className="modal-handle"/>

        {/* Step 0: Connect MetaMask */}
        {stage==="choose"&&<React.Fragment>
          <div style={{textAlign:"center",padding:"16px 0 12px"}}>
            <div style={{width:48,height:48,borderRadius:14,background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 10px",color:"var(--color-primary)"}}>{Ic("key",24)}</div>
            <div className="modal-title" style={{marginBottom:4,fontSize:17}}>{t("title.move_in")}</div>
            <div className="modal-sub" style={{marginBottom:14,fontSize:12}}>{t("body.connect_wallet", { network: ARC_TESTNET_CHAIN.chainName })}</div>
          </div>
          {mmError&&<div style={{background:"var(--color-danger-surface)",border:"1.5px solid var(--color-danger-border)",borderRadius:10,padding:"8px",marginBottom:10,fontSize:11,color:"var(--color-danger)"}}>{mmError}</div>}
          {/* Circle Smart Wallet — first in order (priority by position).
              TASK 10Y: hidden entirely when isCircleSupported() is false
              (currently arc-mainnet) — wallet.js already fail-closed blocks
              the connection attempt itself, this closes the matching UX gap
              found in TASK 10V so the button never appears somewhere it
              can't work. */}
          {isCircleSupported(ACTIVE_NETWORK_NAME) && <button onClick={connectCircle}
            style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",width:"100%",background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",borderRadius:12,cursor:"pointer",fontFamily:"var(--ff)",textAlign:"left",marginBottom:8,color:"var(--color-text-primary)"}}
            onMouseOver={e=>e.currentTarget.style.borderColor="var(--color-primary)"}
            onMouseOut={e=>e.currentTarget.style.borderColor="var(--color-border)"}
          >
            <span style={{width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <img
                src="/assets/logos/circle.svg"
                width="30"
                height="30"
                alt="Circle"
                style={{ display: "block" }}
              />
            </span>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:"var(--color-text-primary)"}}>{t("title.circle_wallet")}</div>
              <div style={{fontSize:11,color:"var(--color-text-secondary)",fontWeight:500}}>Powered by Passkey + Circle Modular SDK</div>
            </div>
            <span style={{marginLeft:"auto",color:"var(--color-text-dim)",fontSize:14}}>→</span>
          </button>}
          {/* MetaMask — second option */}
          <button onClick={connectMetaMask}
            style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",width:"100%",background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",borderRadius:12,cursor:"pointer",fontFamily:"var(--ff)",textAlign:"left",marginBottom:8,color:"var(--color-text-primary)"}}
            onMouseOver={e=>e.currentTarget.style.borderColor="var(--color-primary)"}
            onMouseOut={e=>e.currentTarget.style.borderColor="var(--color-border)"}
          >
            <span style={{width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <img src="/assets/logos/MetaMask-icon-fox.svg" width="30" height="30" alt="MetaMask" style={{display:"block"}}/>
            </span>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:"var(--color-text-primary)"}}>MetaMask / Browser Wallet</div>
              <div style={{fontSize:11,color:"var(--color-text-secondary)",fontWeight:500}}>Desktop · {ARC_TESTNET_CHAIN.chainName} · USDC</div>
            </div>
            <span style={{marginLeft:"auto",color:"var(--color-text-dim)",fontSize:14}}>→</span>
          </button>
          {/* WalletConnect — third option */}
          <button onClick={connectWalletConnect}
            style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",width:"100%",background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",borderRadius:12,cursor:"pointer",fontFamily:"var(--ff)",textAlign:"left",marginBottom:8,color:"var(--color-text-primary)"}}
            onMouseOver={e=>e.currentTarget.style.borderColor="var(--color-primary)"}
            onMouseOut={e=>e.currentTarget.style.borderColor="var(--color-border)"}
          >
            <span style={{width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <img src="/assets/logos/Connect.svg" width="30" height="30" alt="WalletConnect" style={{display:"block"}}/>
            </span>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:"var(--color-text-primary)"}}>{t("title.walletconnect")}</div>
              <div style={{fontSize:11,color:"var(--color-text-secondary)",fontWeight:500}}>Trust Wallet · Rainbow · Rabby</div>
            </div>
            <span style={{marginLeft:"auto",color:"var(--color-text-dim)",fontSize:14}}>→</span>
          </button>
          <div style={{fontSize:10,color:"var(--dim)",textAlign:"center",padding:"4px 0"}}>{ESCROW_ADDRESS.slice(0,10)}…{ESCROW_ADDRESS.slice(-4)}</div>
        </React.Fragment>}

        {/* Connecting spinner — MetaMask */}
        {stage==="connecting"&&connectMethod==="mm"&&<div style={{textAlign:"center",padding:"14px 0"}}>
          <div style={{fontSize:40,marginBottom:12}}></div>
          <div className="modal-title">Connecting wallet…</div>
          <div className="modal-sub">Confirm in your wallet…</div>
          <div className="spinner"/>
        </div>}

        {/* Connecting spinner — Circle Passkey */}
        {stage==="connecting"&&connectMethod==="circle"&&<div style={{textAlign:"center",padding:"14px 0"}}>
          <div style={{width:48,height:48,margin:"0 auto 12px",background:"linear-gradient(135deg,var(--color-primary),var(--accent))",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
          </div>
          <div className="modal-title">{t("title.circle_wallet")}</div>
          <div className="modal-sub">{t("body.use_faceid")}</div>
          <div className="spinner"/>
        </div>}

        {/* Connecting spinner — WalletConnect (minimal, lets Reown modal lead UI) */}
        {stage==="connecting"&&connectMethod==="wc"&&<div style={{textAlign:"center",padding:"14px 0"}}>
          <div style={{fontSize:40,marginBottom:12}}></div>
          <div className="modal-title">{t("title.walletconnect")}</div>
          <div className="modal-sub">{t("body.scan_qr")}</div>
          <div className="spinner"/>
        </div>}

        {/* Step 1: Verify Human — stub */}
        {stage==="verify-human"&&<React.Fragment>
          <div style={{textAlign:"center",marginBottom:14}}>
            <div style={{fontSize:32,marginBottom:6}}></div>
            <div className="modal-title">{t("title.proof_of_humanity")}</div>
            <div style={{fontSize:15,fontWeight:600,color:"var(--color-text-secondary)",lineHeight:1.7,textAlign:"center",marginBottom:18,padding:"0 8px"}}>{t("body.real_people_only")}</div>
          </div>
          <div style={{background:"var(--bg2)",borderRadius:10,padding:"8px 12px",marginBottom:14}}>
            <div style={{fontFamily:"monospace",fontSize:11,color:"var(--muted)"}}>{shortAddr} · {ARC_TESTNET_CHAIN.chainName}</div>
          </div>
          {!humanVerified ? (
            <React.Fragment>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
                {HUMANITY_METHODS.map(m=>(
                  <button key={m.id} onClick={()=>setHumanMethod(m.id)}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:"var(--bg2)",border:`2px solid ${humanMethod===m.id?"var(--text)":"var(--border)"}`,borderRadius:11,cursor:"pointer",fontFamily:"var(--ff)",textAlign:"left",transition:"all 0.18s"}}>
                    <span style={{fontSize:22}}>{m.icon}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13}}>{m.name}</div>
                      <div style={{fontSize:11,color:"var(--muted)"}}>{m.sub}</div>
                    </div>
                    {humanMethod===m.id&&<span style={{color:"var(--text)",fontWeight:700}}></span>}
                  </button>
                ))}
              </div>
              {humanVerifying
                ? <div style={{textAlign:"center"}}><div className="spinner"/><div style={{fontSize:12,color:"var(--muted)"}}>Verifying on-chain…</div></div>
                : <button className="btn-p" style={{opacity:humanMethod?1:.4}} onClick={humanMethod?()=>{setHumanVerifying(true);setTimeout(()=>{setHumanVerifying(false);setHumanVerified(true);},2000);}:undefined}>Verify identity →</button>
              }
            </React.Fragment>
          ) : (
            <React.Fragment>
              <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10,padding:"13px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:22}}></span>
                <div><div style={{fontWeight:700,fontSize:13,color:"var(--green)"}}>Humanity verified</div><div style={{fontSize:11,color:"var(--muted)"}}>via {HUMANITY_METHODS.find(m=>m.id===humanMethod)?.name||"—"}</div></div>
              </div>
              <button className="btn-p" onClick={()=>{setStage("verify-funds");loadBalance();}}>Continue →</button>
            </React.Fragment>
          )}
        </React.Fragment>}

        {/* Step 2: Verify Funds — real USDC balance */}
        {stage==="verify-funds"&&<React.Fragment>
          <div style={{textAlign:"center",marginBottom:14}}>
            <div style={{fontSize:32,marginBottom:6}}></div>
            <div className="modal-title">{t("title.proof_of_funds")}</div>
            <div style={{fontSize:15,fontWeight:600,color:"var(--color-text-secondary)",lineHeight:1.7,textAlign:"center",marginBottom:18,padding:"0 8px"}}>Show you can pay. Hold at least 1× monthly rent.<br/><span style={{fontSize:13,fontWeight:500,color:"#6b7280"}}>Just checked, never locked.</span></div>
          </div>
          <div style={{background:"var(--bg2)",borderRadius:10,padding:"14px",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:13,color:"var(--muted)"}}>USDC Balance</span>
              <span style={{fontSize:18,fontWeight:700,color:"var(--text)"}}>{usdcBal===null?<span className="spinner" style={{width:16,height:16}}/>:(usdcBal+" USDC")}</span>
            </div>
            <div style={{fontFamily:"monospace",fontSize:11,color:"var(--dim)",marginTop:6}}>{shortAddr}</div>
          </div>
          <button className="btn-p" onClick={()=>setStage("role-pick")}>Continue →</button>
          <button className="btn-g" style={{marginTop:8}} onClick={()=>setStage("verify-human")}>← Back</button>
        </React.Fragment>}

        {/* Step 3: Role pick */}
        {stage==="role-pick"&&<React.Fragment>
          <div style={{width:56,height:56,borderRadius:14,background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",color:"var(--color-primary)"}}>{Ic("user",26)}</div>
          <div className="modal-title">{t("title.i_am_a")}</div>
          <div className="modal-sub">Choose your role on pi2pi.io</div>
          <div style={{display:"flex",gap:10,margin:"16px 0"}}>
            {[{r:"tenant",iconName:"user",lbl:t("role.tenant"),sub:t("role.looking")},{r:"landlord",iconName:"home",lbl:t("role.landlord"),sub:t("role.offering")}].map(({r,iconName,lbl,sub})=>(
              <button key={r} onClick={()=>{
                setChosenRole(r);
                const _rwt = getCanonicalWalletType();
                const _rpn = _rwt === "injected" ? getWalletProviderName() : null;
                const userData = {
                  role: r, addr: mmAddr, createdAt: Date.now(),
                  walletType: _rwt,
                  ...(_rpn && { providerName: _rpn }),
                  circleBiometric: _rwt === "circle",
                };
                try { localStorage.setItem("pi2pi_user_" + mmAddr.toLowerCase(), JSON.stringify(userData)); } catch(e){}
                try { saveUser(userData); } catch(e){}
                setStage("done");
              }}
                style={{flex:1,padding:"18px 12px",background:"var(--color-bg-secondary)",border:"1.5px solid var(--color-border)",borderRadius:14,cursor:"pointer",fontFamily:"var(--ff)",textAlign:"center",transition:"all 0.18s",color:"var(--color-text-primary)"}}
                onMouseOver={e=>e.currentTarget.style.borderColor="var(--color-primary)"}
                onMouseOut={e=>e.currentTarget.style.borderColor="var(--color-border)"}
              >
                <div style={{width:44,height:44,borderRadius:12,background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 10px",color:"var(--color-primary)"}}>{Ic(iconName,22)}</div>
                <div style={{fontWeight:700,fontSize:14,letterSpacing:"-0.2px"}}>{lbl}</div>
                <div style={{fontSize:11,color:"var(--color-text-secondary)",marginTop:3,lineHeight:1.4}}>{sub}</div>
              </button>
            ))}
          </div>
          <button className="btn-g" onClick={()=>setStage("choose")}>{t("btn.back")}</button>
        </React.Fragment>}

        {/* Step 4: Proof of Intent — unified form + personal_sign */}
        {stage==="create-listing"&&<React.Fragment>
          <div style={{textAlign:"center",marginBottom:14}}>
            <div style={{marginBottom:6,color:"var(--color-primary)"}}>{Ic("edit",32)}</div>
            <div className="modal-title">{t("title.proof_of_intent")}</div>
            <div style={{fontSize:15,fontWeight:600,color:"var(--color-text-secondary)",lineHeight:1.7,textAlign:"center",marginBottom:18,padding:"0 8px"}}>
              {chosenRole==="tenant"?"What are you looking for? Sign it with your wallet.":"What are you offering? Sign it with your wallet."}
            </div>
          </div>

          <div style={labelStyle}>City</div>
          <Dropdown value={listingData.city||""} placeholder="Select city"
            options={[
              {value:"Buenos Aires",label:"Buenos Aires"},
              {value:"Da Nang",label:"Da Nang"},
              {value:"Tbilisi",label:"Tbilisi"},
            ]}
            onChange={v=>setField("city",v)}/>

          <div style={labelStyle}>Property Type</div>
          <Dropdown value={listingData.propertyType||""} placeholder="Select type"
            options={[
              {value:"Studio",label:"Studio"},
              {value:"1 Bedroom Apartment",label:"1 Bedroom Apartment"},
              {value:"2 Bedroom Apartment",label:"2 Bedroom Apartment"},
              {value:"3 Bedroom Apartment",label:"3 Bedroom Apartment"},
            ]}
            onChange={v=>setField("propertyType",v)}/>

          <div style={labelStyle}>{chosenRole==="tenant"?"Monthly Budget (USDC)":"Monthly Rent (USDC)"}</div>
          <input style={inputStyle} type="number" min="2" step="1" placeholder="2" value={listingData.rent||""} onChange={e=>setField("rent",e.target.value)}/>

          <div style={labelStyle}>{chosenRole==="tenant"?"Move-in Date":"Available From"}</div>
          <input style={inputStyle} type="date" min={new Date().toISOString().split("T")[0]} value={listingData.date||""} onChange={e=>setField("date",e.target.value)}/>

          <div style={labelStyle}>Lease Duration</div>
          <Dropdown value={listingData.duration||""} placeholder="Select duration"
            options={[6,7,8,9,10,11,12].map(m=>({value:String(m),label:`${m} months`}))}
            onChange={v=>setField("duration",v)}/>

          {chosenRole==="landlord" && <React.Fragment>
            <div style={labelStyle}>Expected Security Deposit</div>
            <Dropdown value={listingData.securityDeposit||"0"} placeholder="Select deposit amount"
              options={[
                {value:"0",label:"None (0× rent) — trusting"},
                {value:"1",label:"1× monthly rent — standard"},
                {value:"2",label:"2× monthly rent — moderate"},
                {value:"3",label:"3× monthly rent — maximum"},
              ]}
              onChange={v=>setField("securityDeposit",v)}/>
            <div style={{fontSize:11,color:"var(--color-text-secondary)",marginTop:6,lineHeight:1.5,marginBottom:10}}>
              Tenant stakes this on top of 1× commitment deposit. Returned at checkout if no damage. Frozen for 60 days if disputed.
            </div>
          </React.Fragment>}

          {/* Early termination explainer — expandable */}
          <ExpandableInfo title="How does early termination work?" />


          {signError&&<div style={{background:"var(--color-danger-surface)",border:"1.5px solid var(--color-danger-border)",borderRadius:10,padding:"10px",marginBottom:12,fontSize:12,color:"var(--color-danger)",marginTop:8}}>{signError}</div>}
          {signing
            ?<div style={{textAlign:"center",padding:"10px 0"}}><div className="spinner"/><div style={{fontSize:12,color:"var(--muted)",marginTop:8}}>Confirm signature in your wallet…</div></div>
            :<React.Fragment>
              <button className="btn-p" style={{marginTop:10,opacity:(listingData.city&&listingData.propertyType&&listingData.rent&&listingData.date&&listingData.duration)?1:0.4}}
                onClick={(listingData.city&&listingData.propertyType&&listingData.rent&&listingData.date&&listingData.duration)?signIntent:undefined}>
                Sign with wallet →
              </button>
              <button className="btn-g" style={{marginTop:8}} onClick={()=>{setChosenRole(null);setStage("role-pick");}}>← Back</button>
            </React.Fragment>
          }
        </React.Fragment>}

        {/* Done — both new and returning users */}
        {stage==="done"&&<React.Fragment>
          <div className="success-icon" style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div className="modal-title" style={{textAlign:"center"}}>{isReturning?"Welcome back!":t("title.welcome")}</div>
          <div className="modal-sub">{isReturning?"Wallet recognised.":"Your account is ready."}</div>
          <div style={{background:"var(--bg2)",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
            <div style={{fontSize:10,color:"var(--muted)",fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.5px"}}>Connected wallet</div>
            <div style={{fontFamily:"monospace",fontSize:12,color:"var(--muted)",marginBottom:2}}>{mmAddr||"—"}</div>
            <div style={{fontSize:11,marginTop:5,display:"flex",alignItems:"center",gap:6}}>
              <span style={{color:"var(--color-primary)",fontWeight:700}}>● {window.pi2piWallet?.type === "circle" ? "Circle Wallet" : "Injected Wallet"} · {ARC_TESTNET_CHAIN.chainName}</span>
              <span style={{background:finalRole==="landlord"?"var(--teal-dim)":"var(--accent-dim)",color:finalRole==="landlord"?"var(--teal)":"var(--accent)",fontWeight:700,padding:"2px 8px",borderRadius:6,fontSize:10,textTransform:"uppercase"}}>
                {finalRole==="landlord"?"Landlord":"Tenant"}
              </span>
            </div>
          </div>
          <button className="btn-p" onClick={()=>onConnected(finalRole, shortAddr||"User", mmAddr||"0x0", !isReturning, null)}>Enter →</button>
        </React.Fragment>}
      </div>
    </div>
  );
}

// ─── ERROR BOUNDARY ──────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return (
      React.createElement("div", {style:{padding:"40px 20px",textAlign:"center",fontFamily:"var(--ff)"}},
        React.createElement("div", {style:{fontSize:40,marginBottom:12}}, ""),
        React.createElement("h2", {style:{marginBottom:8}}, "Something went wrong"),
        React.createElement("pre", {style:{fontSize:11,color:"var(--color-danger)",background:"var(--color-danger-surface)",padding:12,borderRadius:10,textAlign:"left",whiteSpace:"pre-wrap",maxWidth:400,margin:"0 auto"}}, this.state.error?.message || "Unknown error"),
        React.createElement("button", {style:{marginTop:16,padding:"10px 24px",background:"var(--color-danger)",color:"white",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"},onClick:()=>{this.setState({error:null});}}, "Retry")
      )
    );
    return this.props.children;
  }
}

// ─── REAL CHAT ───────────────────────────────────────────────────────────────

export default WalletModal;
