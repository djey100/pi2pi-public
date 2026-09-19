import React from 'react';

export default function LightboxViewer({ photo, onClose, pinataGw }) {
  const [decryptedUrl, setDecryptedUrl] = React.useState(null);
  const [decryptError, setDecryptError] = React.useState(null);
  const [decrypting, setDecrypting] = React.useState(false);
  // Revoke object URL on unmount to prevent memory leak
  React.useEffect(() => {
    return () => { if (decryptedUrl && decryptedUrl.startsWith("blob:")) URL.revokeObjectURL(decryptedUrl); };
  }, [decryptedUrl]);

  React.useEffect(() => {
    if (!photo?.cid || photo.url) return;
    let cancelled = false;
    (async () => {
      try {
        // Try server-side decrypt endpoint first
        setDecrypting(true);
        const decResp = await fetch("/api/ipfs/decrypt/" + photo.cid, {credentials:"include"});
        if (decResp.ok) {
          const blob = await decResp.blob();
          if (!cancelled) setDecryptedUrl(URL.createObjectURL(blob));
          setDecrypting(false);
          return;
        }
        // Not encrypted or no key — try direct URL
        setDecrypting(false);
        if (!cancelled) setDecryptedUrl(pinataGw + photo.cid);
      } catch (e) {
        setDecrypting(false);
        // Fallback to direct URL
        if (!cancelled) setDecryptedUrl(pinataGw + photo.cid);
      }
    })();
    return () => { cancelled = true; };
  }, [photo?.cid]);

  const imgSrc = photo.url || decryptedUrl || "";
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.92)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
      {decrypting && <div style={{color:"white",fontSize:13,marginBottom:8}}>Decrypting document...</div>}
      {decryptError && <div style={{color:"#f87171",fontSize:13,marginBottom:8}}>Decrypt failed: {decryptError}</div>}
      {!decrypting && !decryptError && !imgSrc && <div style={{color:"white",fontSize:12,marginBottom:8}}>Loading...</div>}
      {imgSrc && <img src={imgSrc} alt={photo.name} style={{maxWidth:"95vw",maxHeight:"85vh",objectFit:"contain",borderRadius:8}}/>}
      <div style={{color:"white",fontSize:13,marginTop:10,fontWeight:600}}>{photo.name}</div>
      {photo.cid && <div style={{color:"rgba(255,255,255,0.5)",fontSize:10,fontFamily:"monospace",marginTop:4}}>IPFS: {photo.cid}{decryptedUrl && !decryptError ? " (encrypted)" : ""}</div>}
      <div style={{color:"rgba(255,255,255,0.4)",fontSize:11,marginTop:8}}>Tap to close</div>
    </div>
  );
}
