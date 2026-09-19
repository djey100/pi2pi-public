import React, { useState, useEffect } from 'react';
import { t } from '../i18n/index.js';
import {
  ESCROW_ADDRESS, USDC_ADDRESS, ARC_TESTNET_CHAIN, USDC_DECIMALS,
  SEL, encAddr, encUint,
} from '../helpers.js';
import {
  encBytes32, readUsdcBalance, sendTxRaw, waitReceipt,
} from '../wallet.js';
import { Ic, hashGen } from './ui/Icons.jsx';

export default function BlockchainModal({ listing, propDepAgreed, propDepAmount, onClose, onSuccess }) {
  const MR = listing.price;
  const [stage, setStage] = useState("preflight");
  const [txIndex, setTxIndex] = useState(-1);
  const [txHash, setTxHash] = useState("");
  const [block, setBlock] = useState(null);
  const [downloaded, setDownloaded] = useState(false);
  const [web3Error, setWeb3Error] = useState(null);
  const [walletAddr, setWalletAddr] = useState(null);
  // Landlord address from listing data (demo fallback)
  const landlordAddress = listing.contract && listing.contract.length === 42 ? listing.contract : "0x29c9a3b7E5Be7c3F8dd89f77C09Cf51F1c67af1";

  const propDepIncluded = propDepAgreed && propDepAmount > 0;
  const propDepMultiplier = propDepIncluded ? (propDepAmount / MR).toFixed(2) : 0;

  // Total tenant must have: 1st month + Commitment Deposit + optional PropDep
  const totalRequired = MR + MR + (propDepIncluded ? propDepAmount : 0);
  const [tenantBal, setTenantBal] = useState(null);

  // Fetch real USDC balance on mount
  useEffect(() => {
    if (!walletAddr) return;
    readUsdcBalance(walletAddr).then(setTenantBal);
  }, [walletAddr]);

  const yieldPct = 4.2;
  const stakingBase = MR * 2;
  const monthlyYieldDeposits = stakingBase * yieldPct / 100 / 12;
  const eachPartyYield = (monthlyYieldDeposits * 0.70 / 2).toFixed(2);
  const pi2piCutDeposits = (monthlyYieldDeposits * 0.30).toFixed(2);

  const monthlyYieldPropDep = propDepIncluded ? (propDepAmount * yieldPct / 100 / 12) : 0;
  const tenantPropDepYield = (monthlyYieldPropDep * 0.70).toFixed(2);
  const pi2piCutPropDep = (monthlyYieldPropDep * 0.30).toFixed(2);

  const buildTxList = () => {
    const txs = [
      { icon:"", label:t("sign.tx_first_rent"), detail:t("sign.tx_first_rent_detail", {mr: MR.toLocaleString()}) },
      { icon:"", label:t("sign.tx_commitment"), detail:t("sign.tx_commitment_detail", {mr: MR.toLocaleString()}) },
      { icon:"", label:t("sign.tx_hosting"), detail:t("sign.tx_hosting_detail", {mr: MR.toLocaleString()}) },
    ];
    if (propDepIncluded) {
      txs.push({ icon:"", label:t("sign.tx_propdep", {multiplier: propDepMultiplier}), detail:t("sign.tx_propdep_detail", {amount: (Number(propDepAmount)||0).toLocaleString()}) });
    }
    txs.push({ icon:"", label:t("sign.tx_hash_chain"), detail:t("sign.tx_hash_detail") });
    return txs;
  };

  const [transactions] = useState(buildTxList());

  const startSigning = async () => {
    setWeb3Error(null);
    try {
      if (!window.ethereum) throw new Error("No wallet detected. Open in your wallet's built-in browser.");

      // 1. Switch chain
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_TESTNET_CHAIN.chainId }] });
      } catch (switchErr) {
        if (switchErr.code === 4902) await window.ethereum.request({ method: "wallet_addEthereumChain", params: [ARC_TESTNET_CHAIN] });
        else throw switchErr;
      }

      // 2. Connect wallet
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const tenantAddr = accounts[0];
      setWalletAddr(tenantAddr);

      // Pre-flight balance check (tenant pays first rent + commitment + optional propDep)
      const totalRequired = MR + MR + (propDepIncluded ? Number(propDepAmount) : 0);
      const tenantBalance = await readUsdcBalance(tenantAddr);
      if (tenantBalance < totalRequired) {
        setWeb3Error("Insufficient USDC. You have " + tenantBalance.toFixed(2) + ", need " + totalRequired.toFixed(2) + ". Top up your wallet and try again.");
        return;
      }

      setStage("signing");

      // 3. Encode createAgreement
      const rentWei = BigInt(MR) * BigInt(10 ** USDC_DECIMALS);
      const propWei = propDepIncluded ? BigInt(propDepAmount) * BigInt(10 ** USDC_DECIMALS) : 0n;
      const contentHash = hashGen();

      const createData = SEL.createAgreement
        + encAddr(tenantAddr) + encAddr(landlordAddress)
        + encUint(rentWei) + encUint(propWei) + encUint(6n)
        + encBytes32(contentHash);

      // 4. Send createAgreement
      const createTx = await sendTxRaw(tenantAddr, ESCROW_ADDRESS, createData);
      setTxHash(createTx);

      // 5. Wait for receipt, extract agreement ID
      const receipt = await waitReceipt(createTx);
      if (!receipt || receipt.status === "0x0") throw new Error("createAgreement reverted");
      const agreementId = receipt.logs?.[0]?.topics?.[1] || "0x0";

      // 6. Approve USDC
      const totalUsdc = rentWei + rentWei + propWei;
      const approveData = SEL.approve + encAddr(ESCROW_ADDRESS) + encUint(totalUsdc);
      const approveTx = await sendTxRaw(tenantAddr, USDC_ADDRESS, approveData);
      const approveRc = await waitReceipt(approveTx);
      if (!approveRc || approveRc.status === "0x0") throw new Error("USDC approve reverted");

      // 7. tenantDeposit
      const depositData = SEL.tenantDeposit + encUint(BigInt(agreementId));
      const depositTx = await sendTxRaw(tenantAddr, ESCROW_ADDRESS, depositData);
      const depositRc = await waitReceipt(depositTx);
      if (!depositRc || depositRc.status === "0x0") throw new Error("tenantDeposit reverted");

      // 8. All confirmed — show animation
      setTimeout(() => { setStage("txs"); runTx(0, buildTxList()); }, 800);

    } catch (err) {
      setWeb3Error(err.code === 4001 ? "Transaction cancelled." : (err.message || "Transaction failed"));
      setStage("preflight");
    }
  };

  const runTx = (i, txList) => {
    if (i >= txList.length) { setBlock(Math.floor(19000000+Math.random()*500000)); setTimeout(()=>setStage("done"),600); return; }
    setTxIndex(i);
    setTimeout(() => runTx(i+1, txList), 1300);
  };

  return (
    <div className="modal-ov" onClick={e=>e.target===e.currentTarget&&stage==="preflight"&&onClose()}>
      <div className="modal" style={{maxHeight:"88vh",overflowY:"auto"}}>
        <div className="modal-handle"/>

        {/* ── PREFLIGHT ── */}
        {stage==="preflight"&&<React.Fragment>
          <div className="modal-icon"></div>
          <div className="modal-title">{t("title.sign_agreement")}</div>
          <div className="modal-sub" style={{marginBottom:16}}>{t("body.review_before_signing")}</div>

          {/* Property Security Deposit — read-only, agreed in contract flow */}
          {propDepIncluded ? (
            <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:12,padding:"13px 14px",marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--color-primary)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:6}}>{t("sign.propdep_agreed")}</div>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:13,color:"var(--color-primary)"}}>{t("sign.amount_x_rent", {multiplier: propDepMultiplier})}</span>
                <span style={{fontSize:13,fontWeight:800,color:"var(--color-primary)"}}>{(Number(propDepAmount)||0).toLocaleString()} USDC</span>
              </div>
              <div style={{fontSize:11,color:"#16a34a",marginTop:6}}>{t("sign.yield_est", {tenantYield: tenantPropDepYield, pi2piYield: pi2piCutPropDep})}</div>
            </div>
          ) : (
            <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"10px 14px",marginBottom:14}}>
              <div style={{fontSize:12,color:"var(--muted)"}}>{t("sign.propdep_not_included")}</div>
            </div>
          )}

          {/* Balance check */}
          {(()=>{
            const sufficient = tenantBal !== null && tenantBal >= totalRequired;
            return (
              <div style={{background:sufficient?"var(--bg2)":"var(--color-danger-surface)",border:`1.5px solid ${sufficient?"var(--border)":"var(--color-danger-border)"}`,borderRadius:12,padding:"12px 14px",marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>{t("sign.balance_check")}</div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:12,color:"var(--muted)"}}>{t("sign.your_balance")}</span>
                  <span style={{fontSize:13,fontWeight:800,color:sufficient?"var(--green)":"var(--color-danger)"}}>{tenantBal!==null?tenantBal.toLocaleString():"…"} USDC {tenantBal!==null?(sufficient?"":""):""}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:12,color:"var(--muted)"}}>{t("sign.required_min")}</span>
                  <span style={{fontSize:13,fontWeight:700}}>{totalRequired.toLocaleString()} USDC</span>
                </div>
                <div style={{fontSize:10,color:"var(--muted)",lineHeight:1.6,marginTop:6,paddingTop:6,borderTop:"1px solid var(--border)"}}>
                  {t("sign.breakdown", {mr: MR.toLocaleString(), mr2: MR.toLocaleString()})}{propDepIncluded ? t("sign.breakdown_propdep", {propDep: (Number(propDepAmount)||0).toLocaleString()}) : ""}
                </div>
                {!sufficient&&<div style={{marginTop:8,fontSize:12,fontWeight:700,color:"var(--color-danger)"}}>
                  {t("sign.insufficient")}
                </div>}
              </div>
            );
          })()}

          {/* Transactions list */}
          <div style={{fontSize:12,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>{t("sign.txs_on_signing")}</div>
          {buildTxList().map((tx,i)=>(
            <div key={i} style={{display:"flex",gap:10,padding:"9px 0",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:18,flexShrink:0}}>{tx.icon}</span>
              <div>
                <div style={{fontWeight:700,fontSize:13}}>{tx.label}</div>
                <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>{tx.detail}</div>
              </div>
            </div>
          ))}

          {/* Deposits yield */}
          <div style={{background:"var(--color-info-surface)",border:"1.5px solid var(--color-info-border)",borderRadius:12,padding:"12px 14px",margin:"14px 0"}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--color-info)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>{t("sign.yield_title", {pct: yieldPct})}</div>
            <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.8}}>
              <span style={{fontWeight:600,color:"var(--text)"}}>Commitment + Hosting Deposits ({stakingBase.toLocaleString()} USDC):</span><br/>
              <span style={{color:"var(--color-primary)"}}>→ You: ~{eachPartyYield} USDC/mo · Landlord: ~{eachPartyYield} USDC/mo</span><br/>
              <span style={{color:"var(--color-info)"}}>→ pi2pi: ~{pi2piCutDeposits} USDC/mo</span>
              {propDepIncluded&&<React.Fragment><br/><br/>
              <span style={{fontWeight:600,color:"var(--text)"}}>Property Security Deposit ({(Number(propDepAmount)||0).toLocaleString()} USDC):</span><br/>
              <span style={{color:"var(--color-primary)"}}>→ You: ~{tenantPropDepYield} USDC/mo (full yield, your money)</span><br/>
              <span style={{color:"var(--color-info)"}}>→ pi2pi: ~{pi2piCutPropDep} USDC/mo</span>
              </React.Fragment>}
            </div>
          </div>

          {/* Wallet + network info block */}
          {(() => { const isCircle = window.pi2piWallet?.type === "circle"; const walletLabel = isCircle ? "Circle Wallet" : "Injected Wallet"; return (
          <div style={{background:"var(--color-bg-secondary)",border:"1px solid var(--color-border)",borderRadius:12,padding:"11px 14px",marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--color-text-primary)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>{Ic("wallet",14)} {walletLabel} — {ARC_TESTNET_CHAIN.chainName}</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,color:"var(--color-text-secondary)"}}>{t("sign.contract")}</span>
              <span style={{fontSize:11,fontWeight:500,color:"var(--color-text-primary)",fontFamily:"var(--ffm)",letterSpacing:"-0.2px"}}>{ESCROW_ADDRESS.slice(0,10)}…{ESCROW_ADDRESS.slice(-6)}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
              <span style={{fontSize:12,color:"var(--color-text-secondary)"}}>{t("sign.network")}</span>
              <span style={{fontSize:11,fontWeight:700,color:"var(--color-primary)"}}>{t("sign.network_ok")}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
              <span style={{fontSize:12,color:"var(--color-text-secondary)"}}>{t("sign.payment_token")}</span>
              <span style={{fontSize:11,fontWeight:500,color:"var(--color-text-primary)"}}>USDC (ERC-20)</span>
            </div>
          </div>
          ); })()}

          {/* Late payment clause */}
          <div style={{background:"var(--color-danger-surface)",border:"1.5px solid var(--color-danger-border)",borderRadius:12,padding:"12px 14px",marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--color-danger)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:6}}>{t("sign.late_clause")}</div>
            <div style={{fontSize:12,color:"var(--color-danger-dark)",lineHeight:1.7}}>
              {t("sign.late_clause_text", {mr: MR.toLocaleString()})}
            </div>
          </div>

          {web3Error && (
            <div style={{background:"var(--color-danger-surface)",border:"1.5px solid var(--color-danger-border)",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"var(--color-danger)"}}>
              {web3Error}
            </div>
          )}
          <div className="modal-btns">
            <button
              className="btn-p"
              style={{
                opacity: (tenantBal!==null && tenantBal>=totalRequired) ? 1 : 0.35,
                background: "#FF6B00",
                boxShadow: "0 4px 20px rgba(255,107,0,0.35)"
              }}
              onClick={()=>(tenantBal!==null&&tenantBal>=totalRequired)&&startSigning()}
            >
              {t("btn.sign_wallet")}
            </button>
            <button className="btn-g" onClick={onClose}>{t("btn.cancel")}</button>
          </div>
        </React.Fragment>}

        {/* ── SIGNING ── */}
        {stage==="signing"&&<div style={{textAlign:"center",padding:"24px 0"}}>
          <div className="spinner"/>
          <div className="modal-title" style={{marginTop:16}}>{t("title.waiting_wallet")}</div>
          <div className="modal-sub">{t("body.confirm_in_wallet")}</div>
          <div className="hash-box" style={{marginTop:12}}>{txHash}</div>
        </div>}

        {/* ── TXS BROADCASTING ── */}
        {stage==="txs"&&<div style={{padding:"8px 0"}}>
          <div className="modal-title" style={{textAlign:"center",marginBottom:4}}>{t("title.broadcasting")}</div>
          <div className="modal-sub" style={{textAlign:"center",marginBottom:20}}>{t("body.do_not_close")}</div>
          {transactions.map((tx,i)=>{
            const done = i < txIndex;
            const active = i === txIndex;
            return (
              <div key={i} style={{display:"flex",gap:12,alignItems:"center",padding:"12px 0",borderBottom:"1px solid var(--border)",opacity:i>txIndex?0.35:1,transition:"opacity 0.3s"}}>
                <div style={{width:32,height:32,borderRadius:"50%",background:done?"var(--green)":active?"var(--accent)":"var(--border2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"background 0.3s"}}>
                  {done ? <span style={{color:"white",fontWeight:800,fontSize:14}}></span>
                        : active ? <div style={{width:14,height:14,border:"2px solid white",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>
                        : <span style={{fontSize:14}}>{tx.icon}</span>}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13}}>{tx.label}</div>
                  <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>{active?t("sign.confirming"):done?t("sign.confirmed"):tx.detail}</div>
                </div>
              </div>
            );
          })}
        </div>}

        {/* ── DONE ── */}
        {stage==="done"&&<React.Fragment>
          <div className="success-icon" style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div className="modal-title" style={{textAlign:"center"}}>{t("title.agreement_signed")}</div>
          <div className="modal-sub" style={{marginBottom:16}}>{t("body.all_confirmed")}</div>
          <div className="tx-table">
            {[
              [t("sign.tx_hash"),`${txHash.slice(0,10)}…${txHash.slice(-6)}`,"green"],
              [t("sign.block"),`#${block?.toLocaleString()}`,""],
              [t("sign.confirmations"),block ? "Confirmed" : "Pending…",block ? "green" : ""],
              [t("sign.commitment_dep"),`${MR.toLocaleString()} USDC · Aave v2`,""],
              ...(propDepIncluded?[[t("sign.propdep_label"),`${(Number(propDepAmount)||0).toLocaleString()} USDC · Aave v2`,""]]:[]),
              [t("sign.status"),t("sign.status_active"),"green"],
            ].map(([k,v,c])=>(
              <div key={k} className="tx-row"><span className="tx-k">{k}</span><span className={`tx-v ${c}`}>{v}</span></div>
            ))}
          </div>
          <div style={{background:"var(--bg2)",borderRadius:12,padding:"12px 14px",marginTop:12,marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>{t("sign.what_next")}</div>
            <div style={{fontSize:12,color:"var(--muted)",lineHeight:1.9}}>
              {t("sign.next_pay")}<br/>
              {t("sign.next_yield")}<br/>
              {propDepIncluded&&<React.Fragment>{t("sign.next_propdep")}<br/></React.Fragment>}
              {t("sign.next_onchain")}
            </div>
          </div>
          <button className="btn-p" style={{marginBottom:10}} onClick={()=>setDownloaded(true)}>
            {downloaded?t("sign.downloaded"):t("btn.download_pdf")}
          </button>
          <button className="btn-g" onClick={()=>onSuccess({propDepIncluded, propDepAmount, propDepMultiplier})}>{t("btn.go_dashboard")}</button>
        </React.Fragment>}
      </div>
    </div>
  );
}
