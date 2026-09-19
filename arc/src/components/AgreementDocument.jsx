import React from 'react';
import { t } from '../i18n/index.js';
import { ARC_TESTNET_CHAIN, EXPLORER_BASE_URL } from '../helpers.js';

/**
 * Pure document renderer for lease agreements.
 * No hooks, no data fetching, no agreementId requirement.
 * Receives normalized data and renders the full document body.
 *
 * Props:
 *   data: {
 *     contractNo, llName, tnName, llAddr, tnAddr, propAddress, MR,
 *     commitDep, hostDep, propDep, startDate, endDate, duration, scAddress,
 *     llDocCid, tnDocCid, ownDocCid,
 *     photos: [{cid,name}], inventory: [{id,name,important,photoCid}],
 *     signatures: { landlord:{sig,signedAt}|null, tenant:{sig,signedAt}|null },
 *     agreementId (number|null), chainEvents (array|null), docHash (string|null),
 *     createdAt (Date|null), rentPayments (array), totalPaid (number),
 *   }
 *   L: primary lease text object
 *   secondL: secondary lease text object | null
 *   primaryLangLabel: string | null
 *   secondLangLabel: string | null
 *   onPreviewImage: ({src,title}) => void
 */

const PINATA_GW = "/api/ipfs/file/";

const fmtLong = d => new Date(d).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});

const secHead = {fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:"1px",color:"#6b7280",marginBottom:12,paddingBottom:6,borderBottom:"1px solid var(--color-bg-secondary)"};
const cardStyle = {background:"var(--color-bg-card)",borderRadius:12,padding:"18px 16px",border:"1px solid #e5e7eb",boxShadow:"0 2px 12px rgba(0,0,0,0.06)",boxSizing:"border-box",wordBreak:"break-word",overflowWrap:"break-word"};

function renderPracticalSections(LL, langLabel, data) {
  const { contractNo, llName, tnName, llAddr, tnAddr, propAddress, MR, commitDep, hostDep, propDep, startDate, endDate, duration, scAddress, llDocCid, tnDocCid, ownDocCid, inventory, agreementId } = data;
  return (
    <div className="print-card" style={cardStyle}>
      {/* Letterhead */}
      <div style={{textAlign:"center",marginBottom:28,paddingBottom:20,borderBottom:"2px solid #00a699"}}>
        <div style={{fontSize:26,fontWeight:900,color:"#00a699",letterSpacing:"-0.5px",marginBottom:4}}>pi2pi.io</div>
        <div style={{fontSize:11,color:"#6b7280",letterSpacing:"2px",textTransform:"uppercase",marginBottom:8}}>Decentralised Rental Protocol</div>
        <div style={{fontSize:18,fontWeight:800,color:"#111",marginBottom:4}}>{LL.title || "Residential Lease Agreement"}</div>
        <div style={{display:"flex",justifyContent:"center",gap:20,fontSize:12,color:"#6b7280"}}>
          <span>Contract № <strong style={{color:"#111"}}>{contractNo}</strong></span>
          <span>Signed: <strong style={{color:"#111"}}>{fmtLong(startDate)}</strong></span>
        </div>
        {langLabel && <div style={{marginTop:8,fontSize:10,fontWeight:700,color:"#00a699",textTransform:"uppercase",letterSpacing:"1px"}}>{langLabel}</div>}
      </div>
      {!langLabel && agreementId != null && (
        <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:10,padding:"10px 14px",marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--color-primary)",marginBottom:4}}>VERIFIED ON ARC TESTNET (chainId 5042002)</div>
          <div style={{fontSize:10,color:"#065f46",lineHeight:1.7}}>
            <div>Agreement ID: <strong>#{String(agreementId)}</strong></div>
            <div style={{fontFamily:"monospace",wordBreak:"break-all"}}>Escrow: {scAddress}</div>
            <div>Verify at <span style={{color:"#00a699"}}>{EXPLORER_BASE_URL.replace(/^https?:\/\//,"")}/address/{scAddress}</span></div>
          </div>
        </div>
      )}
      {/* Section 1: Parties */} 
      <div style={{marginBottom:22}}>
        <div style={secHead}>{LL.s1_title}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div style={{background:"#fafafa",borderRadius:10,padding:"12px 14px",border:"1px solid #e5e7eb"}}>
            <div style={{fontSize:10,fontWeight:800,color:"#6b7280",textTransform:"uppercase",marginBottom:6}}>{LL.landlord}</div>
            <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>{llName}</div>
            <div style={{fontSize:10,color:"#6b7280",marginBottom:4}}>{LL.walletLabel || "Wallet (legal identifier)"}:</div>
            <div style={{fontSize:10,fontFamily:"monospace",color:"#111",background:"var(--color-bg-card)",padding:"4px 8px",borderRadius:6,border:"1px solid #e5e7eb",marginBottom:8,wordBreak:"break-all"}}>{llAddr}</div>
            <div style={{fontSize:10,color:"#6b7280"}}>{LL.idDocument || "ID document"}: <span style={{color:llDocCid?"var(--color-primary)":"#9ca3af",fontWeight:700}}>{llDocCid?(LL.uploaded || "Uploaded — see Appendix"):(LL.notProvided || "— Not provided")}</span></div>
          </div>
          <div style={{background:"#fafafa",borderRadius:10,padding:"12px 14px",border:"1px solid #e5e7eb"}}>
            <div style={{fontSize:10,fontWeight:800,color:"#6b7280",textTransform:"uppercase",marginBottom:6}}>{LL.tenant}</div>
            <div style={{fontWeight:700,fontSize:14,marginBottom:3}}>{tnName}</div>
            <div style={{fontSize:10,color:"#6b7280",marginBottom:4}}>{LL.walletLabel || "Wallet (legal identifier)"}:</div>
            <div style={{fontSize:10,fontFamily:"monospace",color:"#111",background:"var(--color-bg-card)",padding:"4px 8px",borderRadius:6,border:"1px solid #e5e7eb",marginBottom:8,wordBreak:"break-all"}}>{tnAddr}</div>
            <div style={{fontSize:10,color:"#6b7280"}}>{LL.idDocument || "ID document"}: <span style={{color:tnDocCid?"var(--color-primary)":"#9ca3af",fontWeight:700}}>{tnDocCid?(LL.uploaded || "Uploaded — see Appendix"):(LL.notProvided || "— Not provided")}</span></div>
          </div>
        </div>
      </div>
      {/* Section 2: Property */}
      <div style={{marginBottom:22}}>
        <div style={secHead}>{LL.s2_title}</div>
        <div style={{background:"#fafafa",borderRadius:10,padding:"12px 14px",border:"1px solid #e5e7eb"}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>{propAddress}</div>
          <div style={{fontSize:11,color:"#6b7280",lineHeight:1.7}}>
            {LL.propertyCondition || "Property condition (photos and inventory) documented at contract signing — see Appendix B."}<br/>
            {(LL.itemsIncluded || "Items included with rental: {count} item(s) — see Appendix C.").replace("{count}", inventory.length)}
          </div>
          <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid var(--color-bg-secondary)"}}>
            <div style={{fontSize:10,color:"#6b7280"}}>{LL.ownershipDocument || "Ownership document"}: <span style={{color:ownDocCid?"var(--color-primary)":"#9ca3af",fontFamily:"monospace",fontWeight:700}}>{ownDocCid?""+ownDocCid.slice(0,16)+"…":(LL.notProvided || "Not provided")}</span></div>
          </div>
        </div>
      </div>
      {/* Section 3: Terms + Lease Grant */}
      <div style={{marginBottom:22}}>
        <div style={secHead}>{LL.s3_title}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[[LL.startDate||"Start Date",fmtLong(startDate)],[LL.endDate||"End Date",fmtLong(endDate)],[LL.duration||"Duration",duration+" "+(LL.months||"months")],[LL.monthlyRent||"Monthly Rent",MR.toLocaleString()+" USDC"],[LL.paymentDay||"Payment Day",LL.paymentDayValue||"Monthly from start date"],[LL.paymentMethod||"Payment Method",LL.paymentMethodValue||("USDC on "+ARC_TESTNET_CHAIN.chainName)]].map(([l,r])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"6px 0",borderBottom:"1px solid #f5f5f5"}}><span style={{color:"#6b7280"}}>{l}</span><span style={{fontWeight:700}}>{r}</span></div>
          ))}
        </div>
        {LL.leaseGrant && (<div style={{marginTop:14,paddingTop:12,borderTop:"1px solid var(--color-bg-secondary)"}}><div style={{fontSize:12,fontWeight:800,color:"#6b7280",marginBottom:8}}>{LL.leaseGrantTitle}</div><div style={{fontSize:11,color:"var(--color-text-secondary)",lineHeight:1.9,whiteSpace:"pre-wrap"}}>{LL.leaseGrant}</div></div>)}
      </div>
      {/* Section 4: Deposits */}
      <div style={{marginBottom:22}}>
        <div style={secHead}>{LL.s4_title}</div>
        {LL.s4_intro && <div style={{fontSize:11,color:"var(--color-text-secondary)",lineHeight:1.7,marginBottom:12}}>{LL.s4_intro}</div>}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[
            { label: LL.commitmentDeposit || "Commitment Deposit (Tenant)", amt: commitDep, from: tnAddr, note: LL.commitmentNote || "Locked in non-custodial escrow contract." },
            { label: LL.hostingDeposit || "Hosting Deposit (Landlord)", amt: hostDep, from: llAddr, note: LL.hostingNote || "Locked in non-custodial escrow contract." },
            ...(propDep > 0 ? [{ label: LL.propSecurityDeposit || "Property Security Deposit (Tenant)", amt: propDep, from: tnAddr, note: LL.propSecNote || "Locked in PropDepEscrow." }] : []),
          ].map((d,i)=>(
            <div key={i} style={{background:"#fafafa",borderRadius:8,padding:"10px 12px",border:"1px solid #e5e7eb"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:12,fontWeight:700}}>{d.label}</span><span style={{fontSize:13,fontWeight:800,color:"#00a699"}}>{d.amt.toLocaleString()} USDC</span></div>
              <div style={{fontSize:10,color:"#6b7280",marginBottom:4}}>From: <span style={{fontFamily:"monospace"}}>{d.from}</span></div>
              <div style={{fontSize:10,color:"#6b7280",lineHeight:1.6}}>{d.note}</div>
            </div>
          ))}
          <div style={{background:"var(--color-primary-surface)",borderRadius:8,padding:"8px 12px",border:"1px solid var(--color-primary-border)"}}>
            <div style={{fontSize:11,color:"var(--color-primary)",lineHeight:1.6}}>Smart Contract Address:<br/><span style={{fontFamily:"monospace",fontWeight:700,wordBreak:"break-all"}}>{scAddress}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderLegalSections(LL, langLabel) {
  return (
    <div className="print-card" style={cardStyle}>
      {langLabel && <div style={{textAlign:"center",marginBottom:16,fontSize:10,fontWeight:700,color:"#00a699",textTransform:"uppercase",letterSpacing:"1px"}}>{langLabel}</div>}
      {/* Section 0: Declarations */}
      <div style={{marginBottom:22}}>
        <div style={secHead}>0. {LL.s0_title.replace(/^0\.\s*/, "")}</div>
        <div style={{fontSize:11,color:"var(--color-text-secondary)",lineHeight:1.9,background:"#fafafa",padding:"12px 14px",borderRadius:10,border:"1px solid #e5e7eb",whiteSpace:"pre-wrap"}}>
          {LL.s0_intro}
          {"\n\n"}<strong>{LL.s0_1_title}</strong>{"\n"}{LL.s0_1}
          {"\n\n"}<strong>{LL.s0_2_title}</strong>{"\n"}{LL.s0_2}
          {"\n\n"}<strong>{LL.s0_3_title}</strong>{"\n"}{LL.s0_3}
          {"\n\n"}<strong>{LL.s0_4_title}</strong>{"\n"}{LL.s0_4_intro}
          {"\n"}{LL.s0_4_bullets.map(b => "• " + b).join("\n")}
          {"\n"}{LL.s0_4_footer}
          {"\n\n"}<strong>{LL.s0_5_title}</strong>{"\n"}{LL.s0_5}
          {"\n\n"}<strong>{LL.s0_6_title}</strong>{"\n"}{LL.s0_6_intro}
          {"\n"}{LL.s0_6_bullets.map(b => "• " + b).join("\n")}
          {"\n\n"}<strong>{LL.s0_7_title}</strong>{"\n"}{LL.s0_7}
          {"\n\n"}<strong>{LL.s0_8_title}</strong>{"\n"}{LL.s0_8}
        </div>
      </div>
      {/* Section 6: Dispute & Termination */}
      <div style={{marginBottom:24}}>
        <div style={secHead}>{LL.s6_title}</div>
        <div style={{fontSize:11,color:"var(--color-text-secondary)",lineHeight:1.9,background:"#fafafa",padding:"12px 14px",borderRadius:10,border:"1px solid #e5e7eb",whiteSpace:"pre-wrap"}}>
          {[1,2,3,4,5,6,7,8,9,10,11].map(n => { const tKey="s6_"+n+"_title",bKey="s6_"+n; return LL[tKey]?(<React.Fragment key={n}><strong>{LL[tKey]}</strong>{"\n"}{LL[bKey]}{n<11?"\n\n":""}</React.Fragment>):null; })}
        </div>
      </div>
      {/* Section 7: Additional Provisions */}
      <div style={{marginBottom:24}}>
        <div style={secHead}>{LL.s7_title}</div>
        <div style={{fontSize:11,color:"var(--color-text-secondary)",lineHeight:1.9,background:"#fafafa",padding:"12px 14px",borderRadius:10,border:"1px solid #e5e7eb",whiteSpace:"pre-wrap"}}>
          {[1,2,3,4,5,6,7].map(n => { const tKey="s7_"+n+"_title",bKey="s7_"+n; return LL[tKey]?(<React.Fragment key={n}><strong>{LL[tKey]}</strong>{"\n"}{LL[bKey]}{n<7?"\n\n":""}</React.Fragment>):null; })}
        </div>
      </div>
    </div>
  );
}

export default function AgreementDocument({ data, L, secondL, primaryLangLabel, secondLangLabel, onPreviewImage }) {
  const { contractNo, llName, tnName, llAddr, tnAddr, scAddress, signatures, agreementId, chainEvents, docHash, createdAt, rentPayments, totalPaid, photos, inventory, llDocCid, tnDocCid, ownDocCid, MR, commitDep, hostDep, propDep, duration } = data;

  return (
    <>
      {/* ══════════ PRACTICAL SECTIONS (primary language) ══════════ */}
      {renderPracticalSections(L, primaryLangLabel, data)}

      {/* ══════════ PRACTICAL SECTIONS (second language) ══════════ */}
      {secondL && renderPracticalSections(secondL, secondLangLabel, data)}

      {/* ══════════ SIGNATURES (once, after all language bodies) ══════════ */}
      <div className="print-card" style={cardStyle}>
        <div style={{borderTop:"2px solid #e5e7eb",paddingTop:20}}>
          <div style={{fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:"1px",color:"#6b7280",marginBottom:14}}>
            {L.s8_title || "8. CRYPTOGRAPHIC SIGNATURES"}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            {[
              { role:"Landlord", name:llName, addr:llAddr, ...(signatures?.landlord || {}) },
              { role:"Tenant",   name:tnName, addr:tnAddr, ...(signatures?.tenant || {}) },
            ].map(s=>(
              <div key={s.role} style={{background:"#fafafa",borderRadius:10,padding:"12px 14px",border:"1px solid #e5e7eb",textAlign:"center"}}>
                <div style={{fontSize:10,fontWeight:800,color:"#6b7280",textTransform:"uppercase",marginBottom:6}}>{s.role} Signature</div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{s.name}</div>
                <div style={{fontSize:9,fontFamily:"monospace",color:"#9ca3af",marginBottom:6,wordBreak:"break-all"}}>{s.addr}</div>
                {s.sig ? (
                  <div style={{background:"var(--color-primary-surface)",borderRadius:6,padding:"6px 8px",marginBottom:4}}>
                    <div style={{fontSize:9,color:"var(--color-primary)",fontWeight:700}}>Signed (personal_sign)</div>
                    <div style={{fontSize:9,fontFamily:"monospace",color:"#065f46",wordBreak:"break-all"}}>{s.sig.slice(0,18)}…{s.sig.slice(-10)}</div>
                  </div>
                ) : (
                  <div style={{background:"var(--color-warning-surface)",borderRadius:6,padding:"6px 8px",marginBottom:4,fontSize:10,color:"var(--color-warning)"}}>{t("body.not_yet_signed")}</div>
                )}
                {s.signedAt && <div style={{fontSize:9,color:"#9ca3af"}}>{new Date(s.signedAt).toLocaleString()}</div>}
              </div>
            ))}
          </div>
          <div style={{marginTop:14,textAlign:"center",fontSize:10,color:"#9ca3af",lineHeight:1.7}}>
            Agreement ID: <strong>#{agreementId != null ? String(agreementId) : "Pending"}</strong>{createdAt ? <> · Created: <strong>{fmtLong(createdAt)}</strong></> : null}<br/>
            Verify on-chain: <span style={{color:"#00a699"}}>{EXPLORER_BASE_URL.replace(/^https?:\/\//,"")}/address/{scAddress}</span><br/>
            {docHash && <>Document SHA-256: <span style={{fontFamily:"monospace",color:"var(--color-text-secondary)",fontSize:9,wordBreak:"break-all"}}>{docHash}</span></>}
          </div>
        </div>
      </div>

      {/* ══════════ APPENDIX A — DOCUMENTS ══════════ */}
      {(llDocCid || tnDocCid || ownDocCid) && (
        <div className="print-card" style={cardStyle}>
          <div style={{textAlign:"center",marginBottom:20,paddingBottom:14,borderBottom:"2px solid #00a699"}}>
            <div style={{fontSize:18,fontWeight:800,color:"#111"}}>Appendix A — Documents</div>
            <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>Identity and ownership documents — IPFS references</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {[
              { label:"Landlord — National ID", cid: llDocCid },
              { label:"Tenant — National ID", cid: tnDocCid },
              { label:"Property Ownership Certificate", cid: ownDocCid },
            ].filter(d=>d.cid).map((d,i)=>(
              <div key={i} style={{padding:"12px 14px",background:"#fafafa",borderRadius:10,border:"1px solid #e5e7eb"}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{d.label}</div>
                <div style={{fontSize:10,fontFamily:"monospace",color:"var(--color-text-secondary)",wordBreak:"break-all",marginBottom:6}}>IPFS: {d.cid}</div>
                <img src={"/api/ipfs/decrypt/" + d.cid} alt={d.label} aria-label={d.label} onClick={()=>onPreviewImage({src:"/api/ipfs/decrypt/"+d.cid,title:d.label})} style={{maxWidth:"100%",maxHeight:300,borderRadius:6,display:"block",cursor:"zoom-in"}} onError={e=>{e.target.style.display="none"}}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════ APPENDIX B — PROPERTY PHOTOS ══════════ */}
      {photos.length > 0 && (
        <div className="print-card" style={cardStyle}>
          <div style={{textAlign:"center",marginBottom:20,paddingBottom:14,borderBottom:"2px solid #00a699"}}>
            <div style={{fontSize:18,fontWeight:800,color:"#111"}}>Appendix B — Property Photos</div>
            <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>{photos.length} photo(s) at contract signing — Tenant acknowledged condition</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {photos.map((p,i)=>(
              <div key={i} style={{padding:8,background:"#fafafa",borderRadius:8,border:"1px solid #e5e7eb"}}>
                <img src={PINATA_GW + p.cid} alt={p.name} aria-label={p.name} onClick={()=>onPreviewImage({src:PINATA_GW+p.cid,title:p.name})} style={{width:"100%",borderRadius:4,display:"block",cursor:"zoom-in"}} onError={e=>{e.target.style.display="none"}}/>
                <div style={{fontSize:10,marginTop:6,color:"#6b7280",fontWeight:600,wordBreak:"break-all"}}>{p.name}</div>
                <div style={{fontSize:9,color:"#9ca3af",fontFamily:"monospace",wordBreak:"break-all"}}>IPFS: {p.cid}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════ APPENDIX C — INVENTORY ══════════ */}
      {inventory.length > 0 && (
        <div className="print-card" style={cardStyle}>
          <div style={{textAlign:"center",marginBottom:20,paddingBottom:14,borderBottom:"2px solid #00a699"}}>
            <div style={{fontSize:18,fontWeight:800,color:"#111"}}>Appendix C — Property Inventory</div>
            <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>{inventory.length} item(s) included with rental — Tenant acknowledged</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {inventory.map((item, i) => (
              <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",background:"#fafafa",borderRadius:8,border:"1px solid #e5e7eb"}}>
                {item.photoCid && <img src={"/api/ipfs/decrypt/" + item.photoCid} alt={item.name} aria-label={item.name} onClick={()=>onPreviewImage({src:"/api/ipfs/decrypt/"+item.photoCid,title:item.name})} style={{width:60,height:60,objectFit:"cover",borderRadius:6,cursor:"zoom-in"}} onError={e=>{e.target.style.display="none"}}/>}
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700}}>{item.important ? "" : ""}{item.name}</div>
                  {item.photoCid && <div style={{fontSize:9,color:"#9ca3af",fontFamily:"monospace",wordBreak:"break-all",marginTop:2}}>IPFS: {item.photoCid}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════ PAYMENT HISTORY ══════════ */}
      {chainEvents !== undefined && (
        <div className="print-card" style={cardStyle}>
          {/* Letterhead */}
          <div style={{textAlign:"center",marginBottom:28,paddingBottom:20,borderBottom:"2px solid #00a699"}}>
            <div style={{fontSize:26,fontWeight:900,color:"#00a699",letterSpacing:"-0.5px",marginBottom:4}}>pi2pi.io</div>
            <div style={{fontSize:11,color:"#6b7280",letterSpacing:"2px",textTransform:"uppercase",marginBottom:8}}>Decentralised Rental Protocol</div>
            <div style={{fontSize:18,fontWeight:800,color:"#111",marginBottom:4}}>Blockchain Payment History</div>
            <div style={{display:"flex",justifyContent:"center",gap:20,fontSize:12,color:"#6b7280"}}>
              <span>Contract № <strong style={{color:"#111"}}>{contractNo}</strong></span>
              <span>Generated: <strong style={{color:"#111"}}>{fmtLong(new Date())}</strong></span>
            </div>
          </div>

          {/* Blockchain verification */}
          <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:10,padding:"10px 14px",marginBottom:24,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:18}}></span>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:"var(--color-primary)",marginBottom:1}}>ALL PAYMENTS VERIFIED ON ARC TESTNET</div>
              <div style={{fontSize:10,color:"#065f46"}}>Each transaction is immutable and independently verifiable on Arbiscan</div>
            </div>
          </div>

          {/* Parties summary */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
            <div style={{background:"#fafafa",borderRadius:8,padding:"10px 12px",border:"1px solid #e5e7eb",fontSize:11}}>
              <div style={{fontWeight:700,marginBottom:2}}>Paying Party (Tenant)</div>
              <div style={{color:"#6b7280",marginBottom:2}}>{tnName}</div>
              <div style={{fontFamily:"monospace",fontSize:10,color:"var(--color-text-secondary)",wordBreak:"break-all"}}>{tnAddr}</div>
            </div>
            <div style={{background:"#fafafa",borderRadius:8,padding:"10px 12px",border:"1px solid #e5e7eb",fontSize:11}}>
              <div style={{fontWeight:700,marginBottom:2}}>Receiving Party (Landlord)</div>
              <div style={{color:"#6b7280",marginBottom:2}}>{llName}</div>
              <div style={{fontFamily:"monospace",fontSize:10,color:"var(--color-text-secondary)",wordBreak:"break-all"}}>{llAddr}</div>
            </div>
          </div>

          {/* On-chain timeline */}
          {chainEvents !== null && chainEvents.length > 0 && (
            <div style={{marginBottom:24}}>
              <div style={{fontSize:12,fontWeight:800,textTransform:"uppercase",letterSpacing:"1px",color:"#6b7280",marginBottom:10,paddingBottom:6,borderBottom:"1px solid var(--color-bg-secondary)"}}>
                On-chain Financial Timeline
              </div>
              <div style={{fontSize:11,color:"#6b7280",marginBottom:10,lineHeight:1.6}}>
                All movements pulled directly from {ARC_TESTNET_CHAIN.chainName} contracts. {chainEvents.length} event(s) recorded.
              </div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead>
                  <tr style={{background:"#f1f5f9"}}>
                    {["#","Block","Event","Amount","TX"].map(h=>(
                      <th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:700,color:"#6b7280",fontSize:10,textTransform:"uppercase",borderBottom:"2px solid #e5e7eb"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chainEvents.map((ev, i) => {
                    const colorByKind = {
                      deposit: "var(--color-info)",
                      activated: "#0ea5e9",
                      rent: "#00a699",
                      bond: "var(--color-danger)",
                      settled: "#6b7280",
                      renewed: "var(--color-primary)",
                      propdep_created: "var(--color-info)",
                      claim_filed: "var(--color-danger)",
                      claim_accepted: "#16a34a",
                      claim_disputed: "var(--color-warning)",
                      claim_dropped: "#6b7280",
                      propdep_settled: "#6b7280",
                    }[ev.kind] || "var(--color-text-secondary)";
                    return (
                      <tr key={i} style={{borderBottom:"1px solid var(--color-bg-secondary)",background:i%2===0?"white":"#fafafa"}}>
                        <td style={{padding:"8px 10px",fontWeight:600,color:"#6b7280"}}>{i+1}</td>
                        <td style={{padding:"8px 10px",fontFamily:"monospace",fontSize:10,color:"#6b7280"}}>{ev.blockNumber}</td>
                        <td style={{padding:"8px 10px",fontWeight:600,color:colorByKind}}>{ev.description}</td>
                        <td style={{padding:"8px 10px",fontWeight:700,color:colorByKind,whiteSpace:"nowrap"}}>{ev.amount !== null && ev.amount !== undefined ? ev.amount.toFixed(2) + " USDC" : "—"}</td>
                        <td style={{padding:"8px 10px",fontFamily:"monospace",fontSize:9,color:"var(--color-text-secondary)"}}>{ev.txHash ? ev.txHash.slice(0,10) + "…" : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {chainEvents === null && (
            <div style={{marginBottom:16,padding:"12px",background:"#fafafa",border:"1px solid #e5e7eb",borderRadius:8,fontSize:11,color:"#6b7280",textAlign:"center"}}>
              Loading on-chain events…
            </div>
          )}
          {chainEvents !== null && chainEvents.length === 0 && (
            <div style={{marginBottom:16,padding:"12px",background:"#fafafa",border:"1px solid #e5e7eb",borderRadius:8,fontSize:11,color:"#6b7280",textAlign:"center"}}>
              No on-chain events yet for this agreement.
            </div>
          )}

          {/* Summary */}
          {chainEvents !== null && chainEvents.length > 0 && (
            <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:10,padding:"14px 16px",marginBottom:20}}>
              <div style={{fontSize:12,fontWeight:800,color:"var(--color-primary)",marginBottom:10}}>Summary</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  ["Rent payments", `${rentPayments.length} of ${duration || "?"}`],
                  ["Total rent paid", `${totalPaid.toLocaleString()} USDC`],
                  ["Deposits committed", `${(commitDep + hostDep + propDep).toLocaleString()} USDC`],
                  ["Total events", `${chainEvents.length}`],
                ].map(([l,r])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0"}}>
                    <span style={{color:"var(--color-primary)"}}>{l}</span>
                    <span style={{fontWeight:700,color:"var(--color-primary)"}}>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legal note */}
          <div style={{background:"#fafafa",borderRadius:10,padding:"12px 14px",border:"1px solid #e5e7eb",fontSize:10,color:"#6b7280",lineHeight:1.8}}>
            <strong style={{color:"var(--color-text-secondary)"}}>Legal Notice:</strong> This document is automatically generated from immutable blockchain records. All transactions listed above are permanently recorded on {ARC_TESTNET_CHAIN.chainName} and cannot be altered. This document is admissible as evidence in court proceedings. To independently verify any transaction, visit {EXPLORER_BASE_URL.replace(/^https?:\/\//,"")} and search by the TX hash. Smart contract address: <span style={{fontFamily:"monospace",color:"var(--color-text-secondary)"}}>{scAddress}</span>
          </div>

          {/* Footer */}
          <div style={{marginTop:20,textAlign:"center",fontSize:10,color:"#9ca3af",lineHeight:1.7,paddingTop:16,borderTop:"1px solid #e5e7eb"}}>
            pi2pi.io — Decentralised Rental Protocol · {ARC_TESTNET_CHAIN.chainName}<br/>
            Contract № {contractNo} · Generated {fmtLong(new Date())}<br/>
            <span style={{color:"#00a699"}}>pi2pi.io</span> · <span style={{color:"#00a699"}}>x://dim_ul</span>
          </div>
        </div>
      )}

      {/* ══════════ LEGAL SECTIONS (primary language) ══════════ */}
      {renderLegalSections(L, primaryLangLabel)}

      {/* ══════════ LEGAL SECTIONS (second language) ══════════ */}
      {secondL && renderLegalSections(secondL, secondLangLabel)}
    </>
  );
}
