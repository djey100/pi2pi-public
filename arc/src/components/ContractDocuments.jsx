import React, { useState, useEffect, useCallback } from 'react';
import { t } from '../i18n/index.js';
import { parseAgreement, ESCROW_ADDRESS, SEL, encUint, toDecAgreementId, EXPLORER_BASE_URL, ARC_TESTNET_CHAIN } from '../helpers.js';
import { ethCallRpc } from '../wallet.js';
import { Ic } from './ui/Icons.jsx';
import PrintModal from './PrintModal.jsx';

export default function ContractDocuments({ agreementId, myAddr, peerAddr, role, leaseTexts, loadFinancialEvents }) {
  const [show, setShow] = useState(null); // null | "agreement" | "fullPrint"
  const [data, setData] = useState(null);

  const loadData = useCallback(async () => {
    if (!agreementId) return;
    try {
      const hex = await ethCallRpc(ESCROW_ADDRESS, SEL.getAgreement + encUint(BigInt(agreementId)));
      setData(parseAgreement(hex));
    } catch(e) {}
  }, [agreementId]);

  // Load on mount + whenever Quick Summary opens (to see latest payments)
  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (show === "agreement") loadData(); }, [show, loadData]);

  if (!agreementId || !data) return null;

  const cancelled = data.state === 8 && !data.activatedAt;
  const explorerAddr = EXPLORER_BASE_URL + "/address/" + ESCROW_ADDRESS;

  return (
    <div style={{marginTop:10,padding:"10px 0",borderTop:"1px solid var(--border)"}}>
      {/* Full document modal */}
      {show==="fullPrint" && myAddr && peerAddr && !cancelled && (
        <PrintModal agreementId={agreementId} myAddr={myAddr} peerAddr={peerAddr} role={role} onClose={()=>setShow(null)} leaseTexts={leaseTexts} loadFinancialEvents={loadFinancialEvents}/>
      )}
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <button onClick={cancelled ? undefined : ()=>setShow("fullPrint")} disabled={cancelled}
          style={{flex:2,padding:"10px",borderRadius:10,background:cancelled?"var(--color-bg-secondary)":"var(--color-primary)",color:cancelled?"var(--muted)":"var(--color-primary-text)",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:cancelled?"not-allowed":"pointer",letterSpacing:"-0.1px",opacity:cancelled?0.5:1}}>
          {t("btn.open_full_doc")}
        </button>
        <button onClick={cancelled ? undefined : ()=>setShow(show==="agreement"?null:"agreement")} disabled={cancelled}
          style={{flex:1,padding:"8px",borderRadius:10,background:cancelled?"var(--color-bg-secondary)":(show==="agreement"?"var(--color-primary-surface)":"var(--color-bg-secondary)"),color:cancelled?"var(--muted)":(show==="agreement"?"var(--color-primary)":"var(--color-text-primary)"),border:`1px solid ${cancelled?"var(--color-border)":(show==="agreement"?"var(--color-primary-border)":"var(--color-border)")}`,fontFamily:"var(--ff)",fontWeight:700,fontSize:11,cursor:cancelled?"not-allowed":"pointer",letterSpacing:"-0.1px",opacity:cancelled?0.5:1}}>
          {t("btn.quick_summary")}
        </button>
      </div>
      {show==="agreement" && (
        <div style={{background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",borderRadius:10,padding:"12px",fontSize:12,lineHeight:1.8,marginBottom:8,color:"var(--color-text-primary)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,gap:8}}>
            <div style={{fontWeight:700,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"var(--color-text-primary)"}}>Lease Agreement #{toDecAgreementId(agreementId)}</div>
            <button onClick={loadData} style={{fontSize:10,color:"var(--color-primary)",background:"none",border:"none",cursor:"pointer",fontFamily:"var(--ff)",flexShrink:0,display:"inline-flex",alignItems:"center"}}>{Ic("refresh",12)}</button>
          </div>
          <div style={{wordBreak:"break-all",color:"var(--color-text-secondary)"}}>Tenant: <span style={{fontFamily:"var(--ffm)",fontSize:10,color:"var(--color-text-primary)"}}>{data.tenant}</span></div>
          <div style={{wordBreak:"break-all",color:"var(--color-text-secondary)"}}>Landlord: <span style={{fontFamily:"var(--ffm)",fontSize:10,color:"var(--color-text-primary)"}}>{data.landlord}</span></div>
          <div style={{color:"var(--color-text-secondary)"}}>Monthly Rent: <strong style={{color:"var(--color-text-primary)",fontFamily:"var(--ffm)",fontWeight:500}}>{data.rent} USDC</strong></div>
          <div style={{color:"var(--color-text-secondary)"}}>Commitment Deposit: <span style={{color:"var(--color-text-primary)",fontFamily:"var(--ffm)"}}>{data.commitDep} USDC</span></div>
          <div style={{color:"var(--color-text-secondary)"}}>Hosting Deposit: <span style={{color:"var(--color-text-primary)",fontFamily:"var(--ffm)"}}>{data.hostDep} USDC</span></div>
          {data.propDep > 0 && <div style={{color:"var(--color-text-secondary)"}}>Property Deposit: <span style={{color:"var(--color-text-primary)",fontFamily:"var(--ffm)"}}>{data.propDep} USDC</span></div>}
          <div style={{color:"var(--color-text-secondary)"}}>Duration: <span style={{color:"var(--color-text-primary)"}}>{data.duration} months</span></div>
          <div style={{color:"var(--color-text-secondary)"}}>Created: <span style={{color:"var(--color-text-primary)"}}>{new Date(data.createdAt*1000).toLocaleDateString()}</span></div>
          <div style={{color:"var(--color-text-secondary)"}}>Activated: <span style={{color:"var(--color-text-primary)"}}>{data.activatedAt > 0 ? new Date(data.activatedAt*1000).toLocaleDateString() : "—"}</span></div>
          <div style={{color:"var(--color-text-secondary)"}}>Lease End: <span style={{color:"var(--color-text-primary)"}}>{data.leaseEnd > 0 ? new Date(data.leaseEnd*1000).toLocaleDateString() : "—"}</span></div>
          <div style={{marginTop:6,padding:"6px 0",borderTop:"1px solid var(--color-border)"}}>
            {(() => {
              const totalPaid = (data.rentPayments || 0) + (data.firstRentPaid ? 1 : 0);
              return (
                <div style={{fontWeight:700,color:"var(--color-primary)"}}>Rent paid: {totalPaid} of {data.duration} months ({(totalPaid * data.rent).toFixed(2)} USDC total)</div>
              );
            })()}
          </div>
          <div style={{marginTop:6}}><a href={explorerAddr} target="_blank" style={{color:"var(--color-primary)",fontSize:11}}>View on {ARC_TESTNET_CHAIN.chainName} ↗</a></div>
          <button onClick={()=>window.print()} style={{marginTop:8,padding:"6px 14px",borderRadius:6,background:"var(--color-bg-card)",border:"1px solid var(--color-border)",fontFamily:"var(--ff)",fontSize:11,cursor:"pointer",color:"var(--color-text-primary)"}}>{t("btn.print")}</button>
        </div>
      )}
    </div>
  );
}
