import React, { useState } from 'react';
import { t } from '../i18n/index.js';
import { Ic } from './ui/Icons.jsx';
import Dropdown from './ui/Dropdown.jsx';

function VerifyIntent({ chosenRole, onDone }) {
  const isT = chosenRole === "tenant";
  const [city, setCity] = useState("");
  const [propType, setPropType] = useState(isT ? "1BR" : "Apartment");
  const [budget, setBudget] = useState("");
  const [duration, setDuration] = useState("6");
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const MINS = { "Tbilisi, Georgia": 400, "Batumi, Georgia": 350, "Buenos Aires, Argentina": 500, "São Paulo, Brazil": 600, "Da Nang, Vietnam": 350, "Ho Chi Minh City, Vietnam": 400, "Nha Trang, Vietnam": 300, "Hanoi, Vietnam": 350, "Bangkok, Thailand": 500, "Samui, Thailand": 450, "Phuket, Thailand": 500 };
  const regionMin = MINS[city] || 0;
  const hardFloor = regionMin ? Math.round(regionMin * 0.8) : 0;
  const budgetNum = parseFloat(budget) || 0;
  const belowMarket = !isT && city && budgetNum > 0 && budgetNum < regionMin;
  const tooLow = !isT && city && budgetNum > 0 && budgetNum < hardFloor;
  const tenantTooLow = isT && city && budgetNum > 0 && budgetNum < regionMin;
  const budgetOk = budgetNum > 0 && !tooLow && !tenantTooLow;
  const canSign = city && budgetOk && (!belowMarket || accepted);

  const sign = () => { setSigning(true); setTimeout(() => { setSigning(false); setDone(true); }, 2200); };
  const finish = () => onDone({ city, propType, budget, duration });

  return <React.Fragment>
    <StepHeader step={2} total={3}/>
    <div style={{textAlign:"center",marginBottom:14}}>
      <div style={{marginBottom:6,color:"var(--color-primary)"}}>{Ic("edit",32)}</div>
      <div className="modal-title">Proof of Intent</div>
      <div style={{fontSize:15,fontWeight:600,color:"var(--color-text-secondary)",lineHeight:1.7,textAlign:"center",marginBottom:18,padding:"0 8px"}}>
        {isT ? "What are you looking for? Sign it with your wallet." : "What are you offering? Sign it with your wallet."}
      </div>
    </div>

    {!done ? <React.Fragment>
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>

        <div>
          <div className="field-label">City / Region</div>
          <Dropdown value={city} placeholder="Select a city"
            options={[
              {value:"Tbilisi, Georgia",label:"Tbilisi, Georgia"},
              {value:"Batumi, Georgia",label:"Batumi, Georgia"},
              {value:"Da Nang, Vietnam",label:"Da Nang, Vietnam"},
              {value:"Ho Chi Minh City, Vietnam",label:"Ho Chi Minh City, Vietnam"},
              {value:"Nha Trang, Vietnam",label:"Nha Trang, Vietnam"},
              {value:"Hanoi, Vietnam",label:"Hanoi, Vietnam"},
              {value:"Buenos Aires, Argentina",label:"Buenos Aires, Argentina"},
              {value:"São Paulo, Brazil",label:"São Paulo, Brazil"},
              {value:"Bangkok, Thailand",label:"Bangkok, Thailand"},
              {value:"Samui, Thailand",label:"Samui, Thailand"},
              {value:"Phuket, Thailand",label:"Phuket, Thailand"},
            ]}
            onChange={v=>{setCity(v);setBudget("");setAccepted(false);}}/>
        </div>

        {city && (
          <div style={{background:"var(--teal-dim)",border:"1px solid rgba(0,132,137,0.15)",borderRadius:8,padding:"9px 12px",fontSize:12,overflow:"hidden",wordBreak:"break-word"}}>
            <div style={{color:"var(--teal)",fontWeight:700}}>Regional minimum: {regionMin} USDC/mo</div>
            {!isT && <div style={{color:"var(--muted)",fontSize:11,marginTop:2}}>Hard floor: {hardFloor} USDC (−20%)</div>}
            {isT && <div style={{color:"var(--muted)",fontSize:11,marginTop:2}}>Cannot go below this</div>}
          </div>
        )}

        <div>
          <div className="field-label">{isT ? "Property type" : "I'm offering"}</div>
          <div className="radio-group">
            {(isT ? ["Studio","1BR","2BR","3BR","House"] : ["Apartment","House","Villa","Studio"]).map(t=>(
              <div key={t} className={`radio-opt ${propType===t?"on":""}`} onClick={()=>setPropType(t)} style={{fontSize:11,padding:"7px 4px",minWidth:0,flex:"1 1 0"}}>{t}</div>
            ))}
          </div>
        </div>

        <div>
          <div className="field-label">{isT ? "Max budget (USDC/mo)" : "Min rent (USDC/mo)"}</div>
          <input
            className="field-inp"
            type="number"
            placeholder={city ? (isT ? `Min ${regionMin}` : `e.g. ${regionMin}`) : "Select city first"}
            value={budget}
            disabled={!city}
            onChange={e => { setBudget(e.target.value); setAccepted(false); }}
          />
          {tenantTooLow && <div style={{fontSize:10,color:"var(--accent)",marginTop:3}}>Minimum is {regionMin} USDC for this region</div>}
          {tooLow && <div style={{fontSize:10,color:"var(--accent)",marginTop:3}}>Cannot go below {hardFloor} USDC (−20% of regional min)</div>}
        </div>
        <div>
          <div className="field-label">Duration</div>
          <Dropdown value={String(duration)}
            options={[
              {value:"6",label:"6 months"},{value:"7",label:"7 months"},{value:"8",label:"8 months"},
              {value:"9",label:"9 months"},{value:"10",label:"10 months"},{value:"11",label:"11 months"},
              {value:"12",label:"1 year"},
            ]}
            onChange={v=>setDuration(v)}/>
        </div>

        {belowMarket && !tooLow && (
          <div style={{background:"#fffbea",border:"1.5px solid #f0c844",borderRadius:10,padding:"13px 14px"}}>
            <div style={{fontWeight:700,fontSize:13,color:"#7a5c00",marginBottom:6}}>
              Below market — {regionMin - budgetNum} USDC under regional minimum
            </div>
            <div style={{fontSize:12,color:"#5a4400",lineHeight:1.65,marginBottom:10}}>
              Your listing will be marked <strong>"Below market"</strong>. By proceeding you agree:<br/><br/>
              · You <strong>cannot raise this price</strong> after publishing<br/>
              · You must rent at this price or remove the listing<br/>
              · Non-compliance results in <strong>account suspension</strong>
            </div>
            <div className="check-row" style={{background:"var(--color-bg-card)",marginBottom:0}} onClick={()=>setAccepted(a=>!a)}>
              <div className={`checkbox ${accepted?"on":""}`}>{accepted?"":""}</div>
              <div className="check-text" style={{fontSize:12}}>I understand and accept these conditions</div>
            </div>
          </div>
        )}
      </div>

      {signing
        ? <div style={{textAlign:"center"}}><div className="spinner"/><div style={{fontSize:12,color:"var(--muted)"}}>Signing intent with wallet…</div></div>
        : <button className="btn-p" style={{opacity:canSign?1:.4}} onClick={canSign?sign:undefined}>Sign intent with wallet →</button>
      }
    </React.Fragment> : <React.Fragment>
      <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10,padding:"13px 14px",marginBottom:14}}>
        <div style={{fontWeight:700,fontSize:13,color:"var(--green)",marginBottom:8}}>
          Intent signed onchain
          {belowMarket && <span style={{background:"#f0c844",color:"#5a4400",fontSize:10,padding:"2px 7px",borderRadius:5,marginLeft:6,fontWeight:700}}>BELOW MARKET</span>}
        </div>
        {[["Location",city],[isT?"Looking for":"Offering",propType],[isT?"Max budget":"Min rent",`${budget||"—"} USDC/mo`],["Duration",duration==="12"?"1 year":`${duration} months`]].map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0",borderBottom:"1px solid var(--color-primary-surface)"}}>
            <span style={{color:"var(--muted)"}}>{k}</span><span style={{fontWeight:600}}>{v}</span>
          </div>
        ))}
      </div>
      <button className="btn-p" onClick={finish}>Complete registration →</button>
    </React.Fragment>}
  </React.Fragment>;
}


const WALLETS = [
  { id:"trust",     name:"Trust Wallet",    icon:"", sub:"Register as Tenant",                      scenario:"register-tenant" },
  { id:"rabby",     name:"Rabby Wallet",    icon:"", sub:"Register as Landlord",                    scenario:"register-landlord" },
  { id:"metamask",  name:"MetaMask",        icon:"", sub:"Login as Tenant — sign a contract",        scenario:"login-tenant" },
  { id:"coinbase",  name:"Coinbase Wallet", icon:"", sub:"Login as Landlord — sign a contract",      scenario:"login-landlord" },
  { id:"ledger",    name:"Ledger",          icon:"", sub:"Login as Landlord — early termination",    scenario:"login-early-landlord" },
  { id:"rainbow",   name:"Rainbow",         icon:"", sub:"Login as Tenant — early termination",      scenario:"login-early-tenant" },
  { id:"phantom",   name:"Phantom",         icon:"", sub:"Login as Landlord — contract ending soon", scenario:"login-ending-landlord" },
  { id:"okx",       name:"OKX Wallet",      icon:"", sub:"Login as Tenant — contract ending soon",   scenario:"login-ending-tenant" },
];

const ACCOUNTS = {
  "login-tenant":          { addr:"0x9f2c…d841", name:"Yuki Tanaka",    role:"tenant" },
  "login-landlord":        { addr:"0x4a3b…f91c", name:"Alex Chen",      role:"landlord" },
  "login-ending-landlord": { addr:"0x7e1d…c320", name:"Marco Ricci",    role:"landlord" },
  "login-ending-tenant":   { addr:"0x3b8a…f047", name:"Priya Shah",     role:"tenant" },
  "login-early-landlord":  { addr:"0x5c2a…b813", name:"Nino Beridze",   role:"landlord" },
  "login-early-tenant":    { addr:"0x8d4f…e291", name:"Yuki Tanaka",    role:"tenant" },
};

// Pre-built ending contract for Phantom/OKX accounts
const ENDING_CONTRACT = {
  listing: { id:2, title:"Loft District Studio", location:"Buenos Aires, Argentina", price:520, host:"Marco Ricci", hostAvatar:"marco" },
  role: null,
  signedAt: new Date(Date.now() - (6*30 - 7)*24*60*60*1000),
  txHash: "0xf3a291bcd44e7109ab3c821f0dd4e8b23a5f1c90ee34d7820b19a4c56ff2e8d3",
  propDepIncluded: true,
  propDepAmount: 1040,
  propDepMultiplier: 2,
  daysLeft: 7,
};

// Pre-built early termination contract for Ledger/Rainbow accounts
// Penthouse Tbilisi, month 2 of 6, both deposits included
const EARLY_CONTRACT = {
  listing: { id:1, title:"Penthouse Sky Residence", location:"Tbilisi, Georgia", price:420, host:"Nino Beridze", hostAvatar:"nino" },
  role: null,
  signedAt: new Date(Date.now() - 62*24*60*60*1000), // ~2 months ago
  txHash: "0xa7c304def18b2053cd94e817f0ac2b34d76e9f01cc85a3921d0e57b48ce3f92a",
  propDepIncluded: true,
  propDepAmount: 840,
  propDepMultiplier: 2,
  earlyTermination: true,
  monthsElapsed: 2,
  monthsTotal: 6,
};

const ONB = [
  { title:"Welcome to pi2pi.io", icon:"", text:"A peer-to-peer rental platform with zero intermediaries. All agreements are secured by smart contracts on Ethereum." },
  { title:"How it works", icon:"", text:"Landlords list properties. Tenants find and contact them directly. No agency. No platform fee. No middleman." },
  { title:"Your wallet = your identity", icon:"", text:"Your Ethereum wallet address is your account. No email or password needed. You stay in full control." },
  { title:"Monthly Rent (MR) deposit", icon:"", text:"To activate your listing, your wallet must hold at least 1× monthly rent in USDC. This signals serious intent to both parties." },
  { title:"Security Deposit (SD)", icon:"", text:"When a contract is signed, both parties lock 1× MR into a smart contract. It auto-releases at lease end." },
];


export default VerifyIntent;
