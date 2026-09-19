import React, { useState, useEffect } from 'react';
import { t, getLang } from '../i18n/index.js';
import QRCode from 'qrcode';

export default function QRShareBlock({ url, type, title }) {
  const [open, setOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && url) {
      QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: "#000", light: "#fff" } })
        .then(setQrDataUrl).catch(() => {});
    }
  }, [open, url]);

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const heading = type === "listing"
      ? (t("qr.rent_out") || "FOR RENT")
      : (t("qr.looking_for") || "LOOKING FOR");
    const card = `<div class="card">
      <div class="heading">${heading}</div>
      ${title ? `<div class="details">${title}</div>` : ""}
      <img class="qr" src="${qrDataUrl}" width="180" height="180" alt="QR"/>
      <div class="brand">pi2pi.io</div>
      <div class="sub">Rental agreements on blockchain</div>
    </div>`;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>pi2pi</title><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:system-ui,-apple-system,sans-serif}
      .page{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;width:210mm;height:297mm;padding:5mm}
      .card{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:1px dashed #ccc;padding:10mm}
      .heading{font-size:28px;font-weight:900;letter-spacing:2px;margin-bottom:8px}
      .details{font-size:14px;font-weight:600;color:#333;margin-bottom:16px;line-height:1.4}
      .qr{margin:0 0 12px}
      .brand{font-size:13px;font-weight:700;color:#555;letter-spacing:0.5px}
      .sub{font-size:9px;color:#999;margin-top:3px}
      @media print{.page{padding:0}.card{border:1px dashed #ddd}}
    </style></head><body>
      <div class="page">${card}${card}${card}${card}</div>
      <script>setTimeout(()=>window.print(),500)<\/script>
    </body></html>`);
    win.document.close();
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        width: "100%", padding: "10px", borderRadius: 8, marginTop: 10,
        background: "none", border: "1.5px dashed var(--border)",
        color: "var(--muted)", fontSize: 12, fontWeight: 600,
        cursor: "pointer", fontFamily: "var(--ff)",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        {t("qr.btn_open") || "QR code"}
      </button>
    );
  }

  return (
    <div style={{
      marginTop: 10, border: "1px solid var(--border)", borderRadius: 12,
      padding: 16, background: "var(--color-bg-card)", textAlign: "center"
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        {type === "listing"
          ? (t("qr.title_listing") || "QR code for your listing")
          : (t("qr.title_request") || "QR code for your request")}
      </div>
      <img src={qrDataUrl} width="200" height="200" alt="QR" style={{ borderRadius: 8, background: "white", padding: 8 }} />
      {title && <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>{title}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={handlePrint} style={{
          flex: 1, padding: "9px", borderRadius: 8,
          background: "var(--color-primary)", color: "var(--color-primary-text)",
          border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--ff)"
        }}>
          {t("qr.btn_print") || "Print"}
        </button>
        <button onClick={() => {
          navigator.clipboard?.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }} style={{
          flex: 1, padding: "9px", borderRadius: 8,
          background: "var(--color-bg-secondary)", color: "var(--text)",
          border: "1px solid var(--border)", fontSize: 12, fontWeight: 700,
          cursor: "pointer", fontFamily: "var(--ff)"
        }}>
          {t("qr.btn_copy") || "Copy link"}
        </button>
      </div>
      {copied && <div style={{fontSize:12,color:"var(--color-primary)",fontWeight:700,marginTop:6}}>{t("qr.copied") || "Link copied"} ✓</div>}
      <button onClick={() => setOpen(false)} style={{
        marginTop: 8, background: "none", border: "none",
        color: "var(--muted)", fontSize: 11, cursor: "pointer", fontFamily: "var(--ff)"
      }}>
        {t("qr.btn_collapse") || "Collapse"}
      </button>
    </div>
  );
}
