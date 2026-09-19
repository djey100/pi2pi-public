import React, { useState, useEffect, useRef, useCallback } from 'react';
import { t } from '../i18n/index.js';
import { readUsdcBalance, getProvider } from '../wallet.js';
import { USDC_ADDRESS, encAddr, EXPLORER_BASE_URL } from '../helpers.js';
import { Ic } from './ui/Icons.jsx';

function WalletPanel({ onClose }) {
  const [addr, setAddr] = useState(null);
  const [balance, setBalance] = useState(null);
  const [view, setView] = useState("main"); // main | receive | send | scan | history
  const [history, setHistory] = useState(null); // null = loading, [] = empty
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendStatus, setSendStatus] = useState(null);
  const [copied, setCopied] = useState(false);
  const [scanError, setScanError] = useState(null);
  const videoRef = React.useRef(null);
  const scanStreamRef = React.useRef(null);
  const scanRafRef = React.useRef(null);

  const refreshBalance = React.useCallback(async () => {
    try {
      // Prefer Circle SCA address directly (most authoritative)
      let realAddr = null;
      if (window.pi2piWallet?._circleAddress) {
        realAddr = window.pi2piWallet._circleAddress;
      } else {
        const provider = getProvider() || window.ethereum;
        if (!provider) return;
        const accs = await provider.request({method:"eth_accounts"});
        if (!accs?.[0]) return;
        realAddr = accs[0];
      }
      setAddr(realAddr);
      const bal = await readUsdcBalance(realAddr);
      setBalance(bal);
      console.log("[wallet] refreshed:", realAddr, "→", bal, "USDC");
    } catch(e){ console.error("[wallet] refresh failed:", e); }
  }, []);

  useEffect(() => { refreshBalance(); }, [refreshBalance]);

  // Load USDC transaction history for the wallet
  const loadHistory = React.useCallback(async (forAddr) => {
    if (!forAddr) return;
    setHistory(null);
    try {
      // Use the active network's block explorer API to get USDC token
      // transfers for this address. Assumes the same Etherscan-compatible
      // API shape as Arc Testnet's arcscan.app — unverified for Arc Mainnet's
      // explorer.arc.io, since only the explorer's base URL is confirmed
      // (TASK 10A); revisit if Arc Mainnet's explorer API differs.
      const r = await fetch(`${EXPLORER_BASE_URL}/api?module=account&action=tokentx&address=${forAddr}&sort=desc&page=1&offset=50`);
      const j = await r.json();
      const txs = (j.result || []).filter(t => (t.contractAddress || "").toLowerCase() === USDC_ADDRESS.toLowerCase());
      const me = forAddr.toLowerCase();
      const items = txs.map(t => ({
        hash: t.hash,
        from: t.from,
        to: t.to,
        amount: Number(t.value) / 1e6,
        timestamp: parseInt(t.timeStamp) * 1000,
        block: parseInt(t.blockNumber),
        direction: t.from.toLowerCase() === me ? "out" : "in",
        peer: t.from.toLowerCase() === me ? t.to : t.from,
      }));
      setHistory(items);
    } catch(e) { console.error("[wallet] history load failed:", e); setHistory([]); }
  }, []);

  // Stop camera when scan view closes
  const stopScan = React.useCallback(() => {
    if (scanRafRef.current) { cancelAnimationFrame(scanRafRef.current); scanRafRef.current = null; }
    if (scanStreamRef.current) {
      scanStreamRef.current.getTracks().forEach(t => t.stop());
      scanStreamRef.current = null;
    }
  }, []);

  // Start QR scanner using camera + BarcodeDetector (native) or jsQR fallback
  const startScan = async () => {
    setScanError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      scanStreamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // Use BarcodeDetector if available (Chrome/Edge), else load jsQR from CDN
      let detector = null;
      if (typeof BarcodeDetector !== "undefined") {
        detector = new BarcodeDetector({ formats: ["qr_code"] });
      } else {
        // Lazy-load jsQR for Safari (no native BarcodeDetector)
        if (!window.jsQR) {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
        }
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (!videoRef.current || videoRef.current.readyState !== 4) {
          scanRafRef.current = requestAnimationFrame(tick);
          return;
        }
        try {
          let qrText = null;
          if (detector) {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length) qrText = codes[0].rawValue;
          } else if (window.jsQR) {
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = window.jsQR(imageData.data, canvas.width, canvas.height);
            if (code) qrText = code.data;
          }
          if (qrText) {
            // Extract address — supports "0x..." or "ethereum:0x..." or longer URIs
            const match = qrText.match(/0x[0-9a-fA-F]{40}/);
            if (match) {
              setSendTo(match[0]);
              stopScan();
              setView("send");
              return;
            } else {
              setScanError("QR doesn't contain a valid address");
            }
          }
        } catch(e){}
        scanRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch(e) {
      setScanError(e.message || "Camera access denied. Allow camera in Safari settings.");
    }
  };

  useEffect(() => () => stopScan(), [stopScan]);

  return (
    <div onClick={()=>{if(sendStatus!=="sending")onClose();}} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-bg-card)",borderRadius:16,padding:"24px 20px",maxWidth:420,width:"100%",maxHeight:"90vh",overflowY:"auto",fontFamily:"var(--ff)"}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:18,fontWeight:800,display:"flex",alignItems:"center",gap:8}}>
            {view==="main"?<>{Ic("wallet",18)} {t("wallet.title")}</>:view==="receive"?<>{Ic("download",18)} {t("wallet.receive_usdc")}</>:<>{Ic("upload",18)} {t("wallet.send_usdc")}</>}
          </div>
          <button onClick={()=>{if(sendStatus!=="sending")onClose();}} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"var(--muted)"}}></button>
        </div>

        {/* Main view */}
        {view==="main" && (
          <React.Fragment>
            <div style={{background:"var(--wallet-card-bg, var(--color-text-primary))",borderRadius:14,padding:"20px",color:"var(--wallet-card-text, #ffffff)",marginBottom:16}}>
              <div style={{fontSize:11,opacity:0.65,marginBottom:4,textTransform:"uppercase",letterSpacing:"1px",fontFamily:"var(--ffm)"}}>{t("misc.usdc_balance")} · {t("misc.arc_testnet")}</div>
              <div style={{fontSize:32,fontWeight:300,letterSpacing:"-1.5px",fontFamily:"var(--ffm)"}}>
                {balance===null?<span className="spinner" style={{width:24,height:24,borderColor:"rgba(255,255,255,0.3)",borderTopColor:"currentColor"}}/>:balance.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
              </div>
              <div style={{fontSize:10,opacity:0.5,marginTop:6,fontFamily:"var(--ffm)",wordBreak:"break-all",letterSpacing:"-0.2px"}}>{addr || "—"}</div>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <button onClick={()=>setView("receive")} style={{flex:1,padding:"14px",borderRadius:10,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                {Ic("download")} {t("wallet.receive")}
              </button>
              <button onClick={()=>setView("send")} style={{flex:1,padding:"14px",borderRadius:10,background:"var(--color-primary)",color:"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                {Ic("upload")} {t("wallet.send")}
              </button>
            </div>
            <button onClick={()=>{setView("history");loadHistory(addr);}} style={{width:"100%",padding:"12px",borderRadius:10,background:"var(--color-bg-secondary)",color:"var(--color-text-primary)",border:"1px solid var(--color-border)",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              {Ic("clock")} {t("wallet.tx_history")}
            </button>
            <button onClick={refreshBalance} style={{width:"100%",padding:"8px",borderRadius:8,background:"var(--bg2)",color:"var(--muted)",border:"1px solid var(--border)",fontFamily:"var(--ff)",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              {Ic("refresh",12)} {t("wallet.refresh_balance")}
            </button>
          </React.Fragment>
        )}

        {/* History view */}
        {view==="history" && (
          <React.Fragment>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <button onClick={()=>setView("main")} style={{background:"none",border:"none",color:"var(--accent)",fontSize:12,cursor:"pointer",padding:0}}>{t("btn.back")}</button>
              <button onClick={()=>loadHistory(addr)} style={{background:"none",border:"none",color:"var(--color-primary)",fontSize:11,cursor:"pointer",padding:0,display:"inline-flex",alignItems:"center",gap:4}}>{Ic("refresh",12)} {t("btn.refresh")}</button>
            </div>
            <div style={{fontSize:11,color:"var(--muted)",marginBottom:10}}>{t("misc.usdc_transfers")}</div>
            {history === null && (
              <div style={{textAlign:"center",padding:"30px",color:"var(--muted)",fontSize:12}}>{t("body.loading")}</div>
            )}
            {history !== null && history.length === 0 && (
              <div style={{textAlign:"center",padding:"30px",color:"var(--muted)",fontSize:12}}>{t("body.no_transactions")}</div>
            )}
            {history !== null && history.length > 0 && (
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:"55vh",overflowY:"auto"}}>
                {history.map((tx,i) => (
                  <a key={i} href={EXPLORER_BASE_URL+"/tx/"+tx.hash} target="_blank" rel="noopener"
                    style={{textDecoration:"none",display:"block",padding:"10px 12px",background:tx.direction==="in"?"var(--color-primary-surface)":"rgba(220,38,38,0.04)",border:"1px solid "+(tx.direction==="in"?"var(--color-primary-border)":"rgba(220,38,38,0.2)"),borderRadius:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{color:tx.direction==="in"?"var(--color-primary)":"var(--color-danger)",display:"inline-flex",alignItems:"center"}}>{tx.direction==="in"?Ic("download",14):Ic("upload",14)}</span>
                        <span style={{fontSize:12,fontWeight:700,color:tx.direction==="in"?"var(--green)":"var(--color-danger)"}}>
                          {tx.direction==="in"?t("wallet.received"):t("wallet.sent_label")}
                        </span>
                      </div>
                      <span style={{fontSize:14,fontWeight:800,color:tx.direction==="in"?"var(--green)":"var(--color-danger)"}}>
                        {tx.direction==="in"?"+":"−"}{tx.amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} USDC
                      </span>
                    </div>
                    <div style={{fontSize:10,color:"var(--muted)",lineHeight:1.5}}>
                      <div>{tx.direction==="in"?t("wallet.from"):t("wallet.to")}: <span style={{fontFamily:"monospace"}}>{tx.peer.slice(0,10)}…{tx.peer.slice(-6)}</span></div>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <span>{new Date(tx.timestamp).toLocaleString(undefined,{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span>
                        <span style={{fontFamily:"monospace"}}>tx: {tx.hash.slice(0,8)}…</span>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </React.Fragment>
        )}

        {/* Receive view */}
        {view==="receive" && addr && (
          <React.Fragment>
            <button onClick={()=>setView("main")} style={{background:"none",border:"none",color:"var(--accent)",fontSize:12,cursor:"pointer",marginBottom:10,padding:0}}>{t("btn.back")}</button>
            <div style={{background:"var(--color-warning-surface)",border:"1px solid var(--color-warning-border)",borderRadius:10,padding:"10px 12px",marginBottom:16,fontSize:11,color:"var(--color-warning)",lineHeight:1.6}}>
              <strong>{t("wallet.send_only_warning")}</strong>
            </div>
            <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>
              <img src={"https://api.qrserver.com/v1/create-qr-code/?size=240x240&data="+encodeURIComponent(addr)} alt={t("a11y.qr_code")} style={{width:240,height:240,border:"1px solid var(--border)",borderRadius:10}}/>
            </div>
            <div style={{fontSize:10,color:"var(--muted)",marginBottom:4,textAlign:"center"}}>{t("misc.your_wallet_address")}</div>
            <div style={{background:"var(--bg2)",borderRadius:8,padding:"10px 12px",fontFamily:"monospace",fontSize:11,wordBreak:"break-all",textAlign:"center",marginBottom:10}}>{addr}</div>
            <button onClick={()=>{navigator.clipboard.writeText(addr);setCopied(true);setTimeout(()=>setCopied(false),2000);}} style={{width:"100%",padding:"10px",borderRadius:8,background:copied?"var(--green)":"var(--accent)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
              {copied ? t("wallet.copied") : t("wallet.copy_address")}
            </button>
            <div style={{fontSize:10,color:"var(--muted)",marginTop:10,lineHeight:1.6,textAlign:"center"}}>
              {t("misc.network_arc")}
            </div>
          </React.Fragment>
        )}

        {/* Scan view */}
        {view==="scan" && (
          <React.Fragment>
            <button onClick={()=>{stopScan();setView("send");setScanError(null);}} style={{background:"none",border:"none",color:"var(--accent)",fontSize:12,cursor:"pointer",marginBottom:10,padding:0}}>{t("btn.back")}</button>
            <div style={{fontSize:12,color:"var(--muted)",marginBottom:10,textAlign:"center"}}>{t("wallet.point_camera")}</div>
            <div style={{position:"relative",background:"#000",borderRadius:12,overflow:"hidden",aspectRatio:"1"}}>
              <video ref={videoRef} playsInline muted style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              <div style={{position:"absolute",inset:"15%",border:"3px solid var(--color-primary)",borderRadius:12,pointerEvents:"none"}}/>
            </div>
            {scanError && (
              <div style={{background:"#fee2e2",border:"1px solid var(--color-danger-border)",borderRadius:8,padding:"10px",marginTop:10,fontSize:11,color:"var(--color-danger-dark)"}}>{scanError}</div>
            )}
            <div style={{fontSize:10,color:"var(--muted)",marginTop:10,textAlign:"center",lineHeight:1.6}}>
              {t("wallet.auto_fill")}
            </div>
          </React.Fragment>
        )}

        {/* Send view */}
        {view==="send" && addr && (
          <React.Fragment>
            <button onClick={()=>{if(sendStatus!=="sending"){setView("main");setSendStatus(null);setSendTo("");setSendAmount("");}}} style={{background:"none",border:"none",color:"var(--accent)",fontSize:12,cursor:"pointer",marginBottom:10,padding:0}}>{t("btn.back")}</button>
            <div style={{background:"var(--color-warning-surface)",border:"1px solid var(--color-warning-border)",borderRadius:10,padding:"10px 12px",marginBottom:16,fontSize:11,color:"var(--color-warning)",lineHeight:1.6}}>
              <strong>{t("wallet.send_warning")}</strong>
            </div>
            <div className="field-label">{t("field.recipient_address")}</div>
            <div style={{display:"flex",gap:6,marginBottom:6}}>
              <input className="field-inp" placeholder="0x..." value={sendTo} onChange={e=>setSendTo(e.target.value.trim())} disabled={sendStatus==="sending"} style={{fontFamily:"monospace",fontSize:12,flex:1}}/>
              <button onClick={async()=>{
                try { const txt = await navigator.clipboard.readText(); const m = (txt||"").match(/0x[0-9a-fA-F]{40}/); if (m) setSendTo(m[0]); else alert(t("wallet.clipboard_no_address")); } catch(e){ alert(t("wallet.clipboard_denied")); }
              }} disabled={sendStatus==="sending"} style={{padding:"0 10px",borderRadius:8,background:"var(--bg2)",border:"1px solid var(--border)",fontFamily:"var(--ff)",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{t("wallet.paste")}</button>
              <button onClick={()=>{setView("scan");setTimeout(startScan,100);}} disabled={sendStatus==="sending"} style={{padding:"0 10px",borderRadius:8,background:"var(--bg2)",border:"1px solid var(--border)",fontFamily:"var(--ff)",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{t("wallet.scan")}</button>
            </div>
            <div className="field-label" style={{marginTop:10}}>{t("field.amount_usdc")}</div>
            <input className="field-inp" type="number" step="0.01" min="0.01" placeholder="0.00" value={sendAmount} onChange={e=>setSendAmount(e.target.value)} disabled={sendStatus==="sending"}/>
            <div style={{fontSize:10,color:"var(--muted)",marginTop:4}}>{t("misc.available")}: {balance===null?"…":balance.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} {t("misc.usdc")}</div>
            {sendStatus && sendStatus !== "sending" && typeof sendStatus === "string" && sendStatus.startsWith("0x") && (
              <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:8,padding:"10px",marginTop:14,fontSize:11,color:"var(--color-primary)",lineHeight:1.6,wordBreak:"break-all"}}>
                Sent! TX: <a href={EXPLORER_BASE_URL+"/tx/"+sendStatus} target="_blank" style={{color:"var(--color-primary)",fontFamily:"monospace"}}>{sendStatus.slice(0,20)}…</a>
              </div>
            )}
            {sendStatus && sendStatus !== "sending" && typeof sendStatus === "string" && !sendStatus.startsWith("0x") && (
              <div style={{background:"#fee2e2",border:"1px solid var(--color-danger-border)",borderRadius:8,padding:"10px",marginTop:14,fontSize:11,color:"var(--color-danger-dark)"}}>{sendStatus}</div>
            )}
            <button disabled={sendStatus==="sending" || !sendTo || !sendAmount}
              onClick={async()=>{
                if (!/^0x[0-9a-fA-F]{40}$/.test(sendTo)) { setSendStatus(t("wallet.invalid_address")); return; }
                if (Number(sendAmount) <= 0) { setSendStatus(t("wallet.invalid_amount")); return; }
                if (Number(sendAmount) > Number(balance||0)) { setSendStatus(t("wallet.insufficient")); return; }
                setSendStatus("sending");
                try {
                  const amountWei = BigInt(Math.floor(Number(sendAmount) * 1e6));
                  const data = SEL.transfer + encAddr(sendTo) + encUint(amountWei);
                  const tx = await sendTxRaw(addr, USDC_ADDRESS, data);
                  setSendStatus(tx);
                  setTimeout(refreshBalance, 3000);
                } catch(e) {
                  setSendStatus(e.code === 4001 ? "Cancelled" : (e.message || "Transfer failed"));
                }
              }}
              style={{width:"100%",padding:"12px",borderRadius:10,background:sendStatus==="sending"?"var(--muted)":"var(--accent)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:13,cursor:"pointer",marginTop:14,opacity:(!sendTo||!sendAmount)?0.5:1}}>
              {sendStatus === "sending" ? "Signing & sending…" : "Send USDC"}
            </button>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

export default WalletPanel;
