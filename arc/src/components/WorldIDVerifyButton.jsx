import React, { useState, useEffect } from 'react';
import { t } from '../i18n/index.js';
import { verifyWorldId } from '../api/client.js';

const WORLDCOIN_APP_ID = "app_f91b29c468c68d04fce31a8722fd8114";
const WORLDCOIN_ACTION = "pi2pi-personhood";

const _loadIDKitGlobal = async () => {
  if (window.IDKit && typeof window.IDKit.init === "function") return window.IDKit;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@worldcoin/idkit-standalone@2.2.0/build/index.global.js";
    script.onload = () => {
      if (window.IDKit && typeof window.IDKit.init === "function") {
        resolve(window.IDKit);
      } else {
        reject(new Error("IDKit global not registered after script load"));
      }
    };
    script.onerror = (e) => reject(new Error("IDKit script failed to load: " + (e?.message || "unknown")));
    document.head.appendChild(script);
    setTimeout(() => { if (!window.IDKit) reject(new Error("IDKit load timeout")); }, 30000);
  });
};

export default function WorldIDVerifyButton({ myAddr, onVerified }) {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const handleClick = async () => {
    if (busy || !myAddr) return;
    try {
      const IDKit = await _loadIDKitGlobal();
      setBusy(true); setErrorMsg(null);
      console.log("[worldid] IDKit ready");
      IDKit.init({
        app_id: WORLDCOIN_APP_ID,
        action: WORLDCOIN_ACTION,
        // No `signal` — uses empty string default (deterministic, matches backend)
        verification_level: "device",
        handleVerify: async (proof) => {
          console.log("[worldid] proof received");
          const r = await verifyWorldId({
              addr: myAddr,
              proof: proof.proof,
              merkle_root: proof.merkle_root,
              nullifier_hash: proof.nullifier_hash,
              verification_level: proof.verification_level,
            });
          if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            console.error("[worldid] backend rejected:", err);
            throw new Error(err.message || err.error || "Backend verification failed");
          }
        },
        onSuccess: (result) => {
          console.log("[worldid] verification success");
          // Refresh badges in parent — no alert, badge will appear automatically
          if (onVerified) onVerified();
        },
      });
      await IDKit.open();
    } catch (e) {
      console.error("[worldid]", e);
      setErrorMsg(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!myAddr) return null;
  return (
    <div style={{display:"inline-flex",flexDirection:"column",gap:4}}>
      <button
        onClick={handleClick}
        disabled={busy}
        style={{padding:"8px 14px",background:busy?"#666":"#000",border:"none",borderRadius:8,fontFamily:"var(--ff)",fontSize:12,fontWeight:700,color:"white",cursor:busy?"wait":"pointer",display:"inline-flex",alignItems:"center",gap:6}}>
        {busy ? "Loading…" : "Verify with World ID"}
      </button>
      {errorMsg && (
        <div style={{fontSize:10,color:"var(--color-danger)",maxWidth:220,lineHeight:1.4}}>{errorMsg}</div>
      )}
    </div>
  );
}
