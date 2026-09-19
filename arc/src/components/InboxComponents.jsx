import React, { useState, Fragment } from 'react';
import { t } from '../i18n/index.js';
import { ARC_TESTNET_CHAIN } from '../helpers.js';
import AvatarBox from './AvatarBox.jsx';

function EarlyTermInboxCard({ m, isLL, respond, cardState, onCardStateChange, onContractClose }) {
  const s = cardState || {};
  const set = (patch) => onCardStateChange(patch);

  const selectedDemand   = s.selectedDemand   ?? null;
  const bondPaid         = s.bondPaid         ?? false;
  const freezeOpen       = s.freezeOpen       ?? false;
  const timeSkipped      = s.timeSkipped      ?? false;
  const timerSkipped     = s.timerSkipped     ?? false;
  const pdPhase          = s.pdPhase          ?? null;
  const pdClaimPct       = s.pdClaimPct       ?? 60;
  const pdBondPaid       = s.pdBondPaid       ?? false;
  const pdFreezeSkipped  = s.pdFreezeSkipped  ?? false;
  const pdLlBondPaid     = s.pdLlBondPaid     ?? false;
  const pdLlFreezeSkipped= s.pdLlFreezeSkipped?? false;

  const setSelectedDemand   = v => set({ selectedDemand: v });
  const setBondPaid         = v => set({ bondPaid: v });
  const setFreezeOpen       = v => set({ freezeOpen: v });
  const setTimeSkipped      = v => set({ timeSkipped: v });
  const setTimerSkipped     = v => { set({ timerSkipped: v }); if(v) onContractClose?.("done_full_return"); };
  const TERMINAL_PHASES = ["done_full_return","done_claim","ll_no_bond"];
  const setPdPhase = v => {
    set({ pdPhase: v });
    if (TERMINAL_PHASES.includes(v)) onContractClose?.(v);
  };
  const setPdClaimPct       = v => set({ pdClaimPct: v });
  const setPdBondPaid       = v => set({ pdBondPaid: v });
  const setPdFreezeSkipped  = v => { set({ pdFreezeSkipped: v }); if(v) onContractClose?.("done_dispute"); };
  const setPdLlBondPaid     = v => set({ pdLlBondPaid: v });
  const setPdLlFreezeSkipped= v => { set({ pdLlFreezeSkipped: v }); if(v) onContractClose?.("done_dispute"); };
  const propDep = m.propDepAmt || 840; // default from EARLY_CONTRACT
  const hasPropDep = m.propDepAmt > 0;
  const fmt = (n) => Number(n).toLocaleString();

  // respond + close contract (for TN paths with no PropDep phase, or when propDep included in settlement)
  const respondAndClose = (id, status, reason) => {
    respond(id, status);
    // Close immediately if: no propDep, or tenant accepted demand (propDep included in claim), or mutual exit on green
    const closesImmediately = !hasPropDep || status === "accepted_demand" || (status === "mutual" && !hasPropDep);
    if (closesImmediately) onContractClose?.(reason || "completed");
  };
  // respond only — contract stays open until PropDep phase finishes (used for LL green/uninhabitable)
  const respondThenPropDep = (id, status) => respond(id, status);
  const isGreen = m.variant === "green";
  const isViolation = m.offer === "violation";
  const isUninhabitable = m.offer === "uninhabitable";
  const demandObj = m.demands && selectedDemand ? m.demands.find(d=>d.id===selectedDemand) : null;

  const accentColor = isGreen ? "var(--color-primary)" : "var(--color-danger)";
  const accentBg    = isGreen ? "var(--color-primary-surface)"  : "var(--color-danger-surface)";
  const accentBorder= isGreen ? "var(--color-primary-border)"  : "var(--color-danger-border)";
  const accentText  = isGreen ? "var(--color-primary)"  : "var(--color-danger-dark)";

  return (
    <div>
      {/* Reason block */}
      <div style={{background:accentBg,border:`1.5px solid ${accentBorder}`,borderRadius:10,padding:"10px 12px",marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:700,color:accentColor,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.5px"}}>
          {isGreen
            ? (isLL?"Tenant — self-initiated termination":"Landlord — self-initiated termination")
            : isUninhabitable
              ? "Tenant — forced exit due to landlord breach"
              : "Termination notice — violation"}
        </div>
        <div style={{fontSize:12,color:accentText,lineHeight:1.7,marginBottom:8,fontStyle:"italic"}}>
          "{m.reasonText}"
        </div>
        {isGreen && m.offer==="compensate" && (
          <div style={{background:"var(--color-bg-card)",borderRadius:8,padding:"8px 10px",fontSize:12,color:accentText,border:`1px solid ${accentBorder}`}}>
            {isLL
              ? <><strong>Tenant offers:</strong> Commitment Deposit ({fmt(m.offerAmt)} USDC) → You</>
              : <><strong>Landlord offers:</strong> Hosting Deposit ({fmt(m.offerAmt)} USDC) → You</>}
          </div>
        )}
      </div>

      {/* ── NOT YET RESPONDED ── */}
      {!m.status && !timerSkipped && (
        <div>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:10,lineHeight:1.6}}>
            Respond within <strong>3 days</strong> — or the contract auto-executes per protocol rules.
          </div>

          {/* GREEN letter — LL offers compensation */}
          {isGreen && m.offer==="compensate" && (<React.Fragment>
            <button style={{width:"100%",padding:"11px 12px",borderRadius:10,background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",color:"var(--color-primary)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
              onClick={()=>respondAndClose(m.id,"accepted_compensation","done_claim")}>
              Accept — {fmt(m.offerAmt)} USDC → You
              <div style={{fontWeight:400,fontSize:11,color:"var(--color-primary)",marginTop:3}}>
                {isLL
                  ?"Tenant's Commitment Deposit transfers to you. Property deposit settled separately."
                  :"Landlord's Hosting Deposit transfers to you. Property deposit settled separately."}
              </div>
            </button>
            <button style={{width:"100%",padding:"11px 12px",borderRadius:10,background:"#eef2ff",border:"1.5px solid #a5b4fc",color:"#3730a3",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
              onClick={()=>respondAndClose(m.id,"mutual","done_full_return")}>
              No thanks — mutual exit, each keeps own deposit
              <div style={{fontWeight:400,fontSize:11,color:"#3730a3",marginTop:3}}>
                Waive the compensation. Both deposits return to owners. Clean exit.
              </div>
            </button>
            <button style={{width:"100%",padding:"9px 12px",borderRadius:10,background:"#f8fafc",border:"1px solid var(--border)",color:"var(--muted)",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer",textAlign:"center"}}
              onClick={()=>setTimerSkipped(true)}>
              Simulate: 3 days pass — auto-accept
            </button>
          </React.Fragment>)}

          {/* RED letter — Tenant forced exit due to LL breach */}
          {isUninhabitable && isLL && (<React.Fragment>
            <div style={{background:"#fff1f2",border:"1px solid var(--color-danger-border)",borderRadius:8,padding:"10px 12px",marginBottom:10,fontSize:12,color:"var(--color-danger-dark)",lineHeight:1.6}}>
              Tenant claims the property is uninhabitable due to your breach of obligations.<br/>
              Review the claim and choose your response.
            </div>

            {/* LL response options */}
            {!selectedDemand && (
              <div>
                <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",marginBottom:8,textTransform:"uppercase"}}>Your response:</div>
                <button style={{width:"100%",padding:"11px 12px",borderRadius:10,background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",color:"var(--color-primary)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                  onClick={()=>respond(m.id,"mutual")}>
                  Accept — mutual exit, no claims
                  <div style={{fontWeight:400,fontSize:11,color:"var(--color-primary)",marginTop:3}}>
                    Acknowledge the issue. Each party keeps own deposit. Contract closed cleanly.
                  </div>
                </button>
                <button style={{width:"100%",padding:"11px 12px",borderRadius:10,background:"#eef2ff",border:"1.5px solid #a5b4fc",color:"#3730a3",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                  onClick={()=>respond(m.id,"accepted_compensation")}>
                  Accept + return Hosting Deposit to tenant
                  <div style={{fontWeight:400,fontSize:11,color:"#3730a3",marginTop:3}}>
                    Acknowledge fault. Your Hosting Deposit ({fmt(m.hostingDepAmt||420)} USDC) → Tenant. Property deposit settled separately.
                  </div>
                </button>
                <button style={{width:"100%",padding:"11px 12px",borderRadius:10,background:"#fff1f2",border:"1.5px solid var(--color-danger-border)",color:"var(--color-danger)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                  onClick={()=>setSelectedDemand("dispute_no_claim")}>
                  Reject — conditions were acceptable
                  <div style={{fontWeight:400,fontSize:11,color:"var(--color-danger)",marginTop:3}}>
                    Dispute the claim. No demands on tenant deposit. Mutual exit only.
                  </div>
                </button>
                <button style={{width:"100%",padding:"11px 12px",borderRadius:10,background:"#fff1f2",border:"1.5px solid var(--color-danger-border)",color:"var(--color-danger)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                  onClick={()=>setSelectedDemand("dispute_with_claim")}>
                  Reject + counter-claim on tenant deposit
                  <div style={{fontWeight:400,fontSize:11,color:"var(--color-danger)",marginTop:3}}>
                    Dispute the claim AND demand tenant's Security Deposit. Freezes all deposits for 60 days.
                  </div>
                </button>
                <button style={{width:"100%",padding:"9px 12px",borderRadius:10,background:"#f8fafc",border:"1px solid var(--border)",color:"var(--muted)",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer",textAlign:"center"}}
                  onClick={()=>setTimerSkipped(true)}>
                  3 days — no response, mutual exit auto-executed
                </button>
              </div>
            )}

            {/* Dispute no claim — mutual exit, property dep handled separately */}
            {selectedDemand==="dispute_no_claim" && !m.status && (
              <div>
                <div style={{background:"#f1f5f9",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",marginBottom:10,fontSize:11,color:"var(--muted)",lineHeight:1.6}}>
                  Claim rejected. No freeze required — no financial demands made.<br/>
                  Contract terminates as mutual exit. Property Security Deposit handled at checkout.
                </div>
                <button style={{width:"100%",padding:"10px 12px",borderRadius:9,background:"var(--color-text-dim)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}
                  onClick={()=>respond(m.id,"mutual")}>
                  Confirm — mutual exit, no claims
                </button>
              </div>
            )}

            {/* Dispute with counter-claim — LL freezes deposits */}
            {selectedDemand==="dispute_with_claim" && !m.status && (
              <div>
                <div style={{background:"var(--color-warning-surface)",border:"1.5px solid var(--color-warning-border)",borderRadius:8,padding:"10px 12px",marginBottom:10}}>
                  <div style={{fontWeight:700,fontSize:12,color:"var(--color-warning)",marginBottom:4}}>Counter-claim freezes deposits</div>
                  <div style={{fontSize:11,color:"var(--color-warning)",lineHeight:1.6}}>
                    You are claiming tenant's Security Deposit (420 USDC).<br/>
                    All deposits will be frozen for 60 days.<br/>
                    Frozen deposits earn yield in Aave v2. Returns after 60 days if no settlement.
                  </div>
                </div>
                {!bondPaid && (
                  <button onClick={()=>setBondPaid(true)}
                    style={{width:"100%",padding:"10px",borderRadius:9,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8}}>
                    {<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"-2px",width:14,height:14}}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>} Freeze Deposits — confirm counter-claim
                  </button>
                )}
                {bondPaid && !freezeOpen && (
                  <button onClick={()=>{setFreezeOpen(true);respond(m.id,"disputed_demand");}}
                    style={{width:"100%",padding:"10px",borderRadius:9,background:"var(--color-warning)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8}}>
                    Confirm counter-claim — open 60-day freeze
                  </button>
                )}
                {freezeOpen && (
                  <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:"12px 14px",marginBottom:10}}>
                    <div style={{fontWeight:700,fontSize:11,color:"#0369a1",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.4px"}}>Freeze active — what happens next</div>
                    <div style={{fontSize:11,color:"#0c4a6e",lineHeight:1.8}}>
                      <strong>Frozen in Aave v2:</strong> Your Security Deposit (420 USDC) + Tenant's Security Deposit (420 USDC)<br/>
                      <strong>Both parties have 60 days</strong> to resolve via:<br/>
                      &nbsp;&nbsp;• Direct settlement on-chain<br/>
                      &nbsp;&nbsp;• Local court in jurisdiction of property<br/>
                      &nbsp;&nbsp;• Licensed mediator<br/><br/>
                      <strong>After 60 days</strong> — all funds returned to each party. Court handles claims independently.
                    </div>
                    {!timeSkipped && (
                      <button onClick={()=>{setTimeSkipped(true);onContractClose?.("done_dispute");}}
                        style={{marginTop:10,width:"100%",padding:"9px",borderRadius:8,background:"var(--color-text-dim)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                        60 days — no agreement, funds returned
                      </button>
                    )}
                    {timeSkipped && (
                      <div style={{background:"var(--color-primary-surface)",borderRadius:8,padding:"10px",marginTop:8}}>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--color-primary)",marginBottom:2}}>Freeze ended — funds returned</div>
                        <div style={{fontSize:11,color:"var(--color-primary)"}}>Deposits unfrozen → each party. Court handles claim independently.</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </React.Fragment>)}

          {/* RED letter — LL demands due to violation */}
          {isViolation && (<React.Fragment>
            <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",marginBottom:8,textTransform:"uppercase"}}>
              {isLL ? "Your demand:" : "Landlord's demand:"}
            </div>

            {/* Demand selector (LL side) or display (TN side) */}
            {isLL && m.demands && m.demands.map(d=>(
              <div key={d.id} onClick={()=>setSelectedDemand(d.id)}
                style={{padding:"10px 12px",borderRadius:10,border:`2px solid ${selectedDemand===d.id?"var(--color-danger)":"var(--border)"}`,background:selectedDemand===d.id?"var(--color-danger-surface)":"var(--color-bg-card)",cursor:"pointer",marginBottom:8,transition:"all 0.15s"}}>
                <div style={{fontWeight:700,fontSize:12,color:selectedDemand===d.id?"var(--color-danger)":"var(--text)"}}>{d.label}</div>
                <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>{d.desc}</div>
              </div>
            ))}

            {/* TN sees landlord's demand — for demo show all three as "what LL could demand" */}
            {!isLL && (<React.Fragment>
              <div style={{background:"#fff1f2",border:"1px solid var(--color-danger-border)",borderRadius:8,padding:"10px 12px",marginBottom:10,fontSize:12,color:"var(--color-danger-dark)"}}>
                Landlord has not yet specified the exact demand. You will be notified once submitted. You have 3 days to respond after that.
              </div>
              {/* Simulate: pick which demand LL sends */}
              <div style={{fontSize:11,fontWeight:700,color:"var(--muted)",marginBottom:8,textTransform:"uppercase"}}>Simulate landlord demand:</div>
              {[
                {id:"dep_only",        label:"Commitment Deposit only — 420 USDC"},
                {id:"dep_and_propdep", label:"Commitment Deposit + 60% PropDep — 924 USDC"},
              ].map(d=>(
                <div key={d.id} onClick={()=>setSelectedDemand(d.id)}
                  style={{padding:"10px 12px",borderRadius:10,border:`2px solid ${selectedDemand===d.id?"var(--color-danger)":"var(--border)"}`,background:selectedDemand===d.id?"var(--color-danger-surface)":"var(--color-bg-card)",cursor:"pointer",marginBottom:8,transition:"all 0.15s"}}>
                  <div style={{fontWeight:700,fontSize:12,color:selectedDemand===d.id?"var(--color-danger)":"var(--text)"}}>{d.label}</div>
                </div>
              ))}
            </React.Fragment>)}

            {/* TN response buttons after demand selected */}
            {!isLL && selectedDemand && (<React.Fragment>
              <div style={{fontSize:11,color:"var(--muted)",marginBottom:8,lineHeight:1.6}}>Your response:</div>
              <button style={{width:"100%",padding:"11px 12px",borderRadius:10,background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",color:"var(--color-primary)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                onClick={()=>respondAndClose(m.id,"accepted_demand","done_claim")}>
                Accept — I acknowledge the violations
                <div style={{fontWeight:400,fontSize:11,color:"var(--color-primary)",marginTop:3}}>
                  {selectedDemand==="dep_and_propdep"
                    ?"Commitment Deposit (420) + 60% Property Deposit (504) → Landlord. 924 USDC total."
                    :"Commitment Deposit (420 USDC) → Landlord."}
                </div>
              </button>
              <button style={{width:"100%",padding:"11px 12px",borderRadius:10,background:"var(--color-warning-surface)",border:"1.5px solid var(--color-warning-border)",color:"var(--color-warning)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                onClick={()=>{respond(m.id,"disputed_demand");}}>
                Dispute — violations are false
                <div style={{fontWeight:400,fontSize:11,color:"var(--color-warning)",marginTop:3}}>
                  Freeze deposits 60 days → resolved by local law. Deposits return to each party if no agreement.
                </div>
              </button>
              <button style={{width:"100%",padding:"9px 12px",borderRadius:10,background:"#f8fafc",border:"1px solid var(--border)",color:"var(--muted)",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer",textAlign:"center"}}
                onClick={()=>setTimerSkipped(true)}>
                3 days — no response, auto-executed
              </button>
            </React.Fragment>)}
          </React.Fragment>)}
        </div>
      )}

      {/* 3-day timer expired — auto execute */}
      {timerSkipped && !m.status && (
        <div style={{background:"#f1f5f9",border:"1px solid var(--border)",borderRadius:10,padding:"10px 12px",marginBottom:8}}>
          <div style={{fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:4}}>3 days elapsed — auto-executed</div>
          <div style={{fontSize:11,color:"var(--muted)",lineHeight:1.6}}>
            {isGreen
              ? "No response received. Compensation accepted automatically per protocol."
              : isUninhabitable
                ? "No response. Mutual exit executed automatically. Each deposit returns to its owner."
                : selectedDemand==="just_leave"
                  ? "No response. Contract terminated, no penalty applied."
                  : "No response. Landlord's demand executed automatically."}
          </div>
        </div>
      )}

      {/* ── STATUS RESULTS ── */}
      {/* ── FINAL STATES ── */}

      {/* ── PropDep phase — triggered after compensation or mutual agreed ── */}
      {(m.status==="accepted_compensation"||m.status==="mutual") && (
        <div>
          {/* Step 0 — termination confirmed banner */}
          <div style={{background:m.status==="accepted_compensation"?"var(--color-primary-surface)":"#eef2ff",border:`1.5px solid ${m.status==="accepted_compensation"?"var(--color-primary-border)":"#a5b4fc"}`,borderRadius:10,padding:"10px 14px",marginBottom:12}}>
            <div style={{fontWeight:700,fontSize:12,color:m.status==="accepted_compensation"?"var(--color-primary)":"#3730a3",marginBottom:2}}>
              {m.status==="accepted_compensation"
                ? (isUninhabitable ? "Breach acknowledged — Hosting Deposit returned" : "Termination accepted — compensation confirmed")
                : "Mutual exit confirmed"}
            </div>
            <div style={{fontSize:11,color:m.status==="accepted_compensation"?"var(--color-primary)":"#3730a3"}}>
              {m.status==="accepted_compensation"
                ?(isLL
                    ? (isUninhabitable
                        ? `Your Hosting Deposit (${fmt(m.hostingDepAmt||420)} USDC) → Tenant.`
                        : `Tenant's Commitment Deposit (${fmt(m.offerAmt)} USDC) → You.`)
                    : `Landlord's Hosting Deposit (${fmt(m.offerAmt||m.hostingDepAmt||420)} USDC) → You.`)
                :"Each deposit returns to its owner."}
              {" "}Both parties' commitment deposits settled.
            </div>
          </div>

          {/* PropDep block */}
          {hasPropDep && (
            <div style={{border:"1.5px solid #e5e7eb",borderRadius:12,overflow:"hidden",marginBottom:4}}>
              {/* PropDep header */}
              <div style={{background:"#f8fafc",padding:"10px 14px",borderBottom:"1px solid #e5e7eb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontWeight:700,fontSize:12}}>Property Security Deposit</div>
                <div style={{fontWeight:800,fontSize:13,color:"var(--color-info)"}}>{fmt(propDep)} USDC</div>
              </div>

              <div style={{padding:"12px 14px"}}>

                {/* LL decides — claim or return */}
                {isLL && !pdPhase && (
                  <div>
                    <div style={{fontSize:11,color:"var(--muted)",marginBottom:10,lineHeight:1.6}}>
                      You have 7 days to inspect the property and file a damage claim. If no claim — full deposit returns to tenant automatically.
                    </div>
                    <button style={{width:"100%",padding:"10px 12px",borderRadius:9,background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",color:"var(--color-primary)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                      onClick={()=>setPdPhase("done_full_return")}>
                      No damage — return full deposit to tenant
                      <div style={{fontWeight:400,fontSize:11,marginTop:2}}>{fmt(propDep)} USDC → Tenant</div>
                    </button>
                    <button style={{width:"100%",padding:"10px 12px",borderRadius:9,background:"#fff1f2",border:"1.5px solid var(--color-danger-border)",color:"var(--color-danger)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",textAlign:"left"}}
                      onClick={()=>setPdPhase("claim_sent")}>
                      File damage claim — 60% of deposit
                      <div style={{fontWeight:400,fontSize:11,marginTop:2,color:"var(--color-danger)"}}>Claim: {fmt(Math.round(propDep*0.6))} USDC → You · Remainder: {fmt(Math.round(propDep*0.4))} USDC → Tenant</div>
                    </button>
                  </div>
                )}

                {/* TN waits for LL decision */}
                {!isLL && !pdPhase && (
                  <div>
                    <div style={{fontSize:11,color:"var(--muted)",lineHeight:1.6,marginBottom:10}}>
                      Landlord has 7 days to inspect and file a claim. If no action — full deposit returns to you automatically.
                    </div>
                    <button style={{width:"100%",padding:"9px 12px",borderRadius:9,background:"#f8fafc",border:"1px solid var(--border)",color:"var(--muted)",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer",marginBottom:6,textAlign:"center"}}
                      onClick={()=>setPdPhase("done_full_return")}>
                      7 days — no claim, full deposit returned
                    </button>
                    <button style={{width:"100%",padding:"9px 12px",borderRadius:9,background:"#fff1f2",border:"1px solid var(--color-danger-border)",color:"var(--color-danger)",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer",textAlign:"center"}}
                      onClick={()=>setPdPhase("claim_sent")}>
                      Simulate: landlord files damage claim
                    </button>
                  </div>
                )}

                {/* Claim filed — TN responds */}
                {pdPhase==="claim_sent" && (
                  <div>
                    <div style={{background:"#fff1f2",border:"1px solid var(--color-danger-border)",borderRadius:8,padding:"10px 12px",marginBottom:10}}>
                      <div style={{fontWeight:700,fontSize:12,color:"var(--color-danger)",marginBottom:4}}>Damage claim filed by landlord</div>
                      <div style={{fontSize:11,color:"var(--color-danger-dark)",lineHeight:1.6}}>
                        Claim: <strong>{fmt(Math.round(propDep*0.6))} USDC</strong> (60% of {fmt(propDep)} USDC)<br/>
                        Remainder if accepted: <strong>{fmt(Math.round(propDep*0.4))} USDC</strong> → Tenant
                      </div>
                    </div>
                    {isLL && (
                      <div>
                        <div style={{fontSize:11,color:"var(--muted)",marginBottom:10,lineHeight:1.6}}>Simulate tenant's response to the claim:</div>
                        <button style={{width:"100%",padding:"10px 12px",borderRadius:9,background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",color:"var(--color-primary)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                          onClick={()=>setPdPhase("done_claim")}>
                          Tenant accepted claim
                          <div style={{fontWeight:400,fontSize:11,marginTop:2}}>{fmt(Math.round(propDep*0.6))} USDC → You · {fmt(Math.round(propDep*0.4))} USDC → Tenant. Contract closed.</div>
                        </button>
                        <button style={{width:"100%",padding:"10px 12px",borderRadius:9,background:"#fff1f2",border:"1.5px solid var(--color-danger-border)",color:"var(--color-danger)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                          onClick={()=>setPdPhase("tn_rejected")}>
                          Tenant rejected claim
                          <div style={{fontWeight:400,fontSize:11,marginTop:2,color:"var(--color-danger)"}}>Tenant disputes the damage. You decide whether to freeze deposits.</div>
                        </button>
                        <button style={{width:"100%",padding:"9px 12px",borderRadius:9,background:"#f8fafc",border:"1px solid var(--border)",color:"var(--muted)",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer",textAlign:"center"}}
                          onClick={()=>setPdPhase("done_claim")}>
                          3 days — no response, claim auto-executed
                        </button>
                      </div>
                    )}
                    {!isLL && (
                      <div>
                        <div style={{fontSize:11,color:"var(--muted)",marginBottom:8}}>Respond within 3 days:</div>
                        <button style={{width:"100%",padding:"10px 12px",borderRadius:9,background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",color:"var(--color-primary)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                          onClick={()=>setPdPhase("done_claim")}>
                          Accept claim — {fmt(Math.round(propDep*0.6))} USDC → Landlord
                          <div style={{fontWeight:400,fontSize:11,marginTop:2}}>Remaining {fmt(Math.round(propDep*0.4))} USDC returns to you.</div>
                        </button>
                        <button style={{width:"100%",padding:"10px 12px",borderRadius:9,background:"var(--color-warning-surface)",border:"1.5px solid var(--color-warning-border)",color:"var(--color-warning)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                          onClick={()=>setPdPhase("pd_bond")}>
                          Dispute — damage claim is false
                          <div style={{fontWeight:400,fontSize:11,marginTop:2}}>Freeze deposits 60 days. Deposits return to each party after freeze.</div>
                        </button>
                        <button style={{width:"100%",padding:"9px 12px",borderRadius:9,background:"#f8fafc",border:"1px solid var(--border)",color:"var(--muted)",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer",textAlign:"center"}}
                          onClick={()=>setPdPhase("done_claim")}>
                          3 days — no response, claim auto-executed
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* LL: tenant rejected — freeze deposits or close without claim */}
                {pdPhase==="tn_rejected" && (
                  <div>
                    <div style={{background:"#fff1f2",border:"1.5px solid var(--color-danger-border)",borderRadius:8,padding:"10px 12px",marginBottom:10}}>
                      <div style={{fontWeight:700,fontSize:12,color:"var(--color-danger)",marginBottom:4}}>Tenant rejected the damage claim</div>
                      <div style={{fontSize:11,color:"var(--color-danger-dark)",lineHeight:1.6}}>
                        To pursue the claim, deposits will be frozen for 60 days.<br/>
                        If you do not confirm within <strong>3 days</strong> — the claim is dropped and the full deposit returns to the tenant.
                      </div>
                    </div>
                    {isLL && (
                      <div>
                        <button style={{width:"100%",padding:"10px 12px",borderRadius:9,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8,textAlign:"left"}}
                          onClick={()=>{setPdLlBondPaid(false);setPdLlFreezeSkipped(false);setPdPhase("ll_bond_paid");}}>
                          Freeze Deposits — open 60-day freeze
                          <div style={{fontWeight:400,fontSize:11,marginTop:2}}>Deposits return to each party after 60 days if no settlement reached.</div>
                        </button>
                        <button style={{width:"100%",padding:"9px 12px",borderRadius:9,background:"#f8fafc",border:"1px solid var(--border)",color:"var(--muted)",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer",marginBottom:8,textAlign:"center"}}
                          onClick={()=>setPdPhase("ll_no_bond")}>
                          Drop the claim
                        </button>
                        <button style={{width:"100%",padding:"9px 12px",borderRadius:9,background:"#f8fafc",border:"1px solid var(--border)",color:"var(--muted)",fontFamily:"var(--ff)",fontWeight:600,fontSize:11,cursor:"pointer",textAlign:"center"}}
                          onClick={()=>setPdPhase("ll_no_bond")}>
                          3 days — no action, claim dropped
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* LL confirmed freeze — 60-day freeze */}
                {pdPhase==="ll_bond_paid" && (
                  <div>
                    <div style={{background:"var(--color-warning-surface)",border:"1.5px solid var(--color-warning-border)",borderRadius:10,padding:"12px 14px",marginBottom:10}}>
                      <div style={{fontWeight:700,fontSize:12,color:"var(--color-warning)",marginBottom:6}}>Deposits frozen — 60-day freeze active</div>
                      <div style={{fontSize:11,color:"var(--color-warning)",lineHeight:1.7}}>
                        <strong>Frozen in Aave v2:</strong><br/>
                        • Your Security Deposit: {fmt(Math.round(propDep*0.6))} USDC<br/>
                        • Property Deposit: {fmt(propDep)} USDC<br/>
                        • Yield generated → pi2pi protocol fee during freeze
                      </div>
                    </div>
                    <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:"12px 14px",marginBottom:10}}>
                      <div style={{fontWeight:700,fontSize:11,color:"#0369a1",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.4px"}}>What happens next</div>
                      <div style={{fontSize:11,color:"#0c4a6e",lineHeight:1.8}}>
                        <strong>1. Both parties have 60 days</strong> to resolve this dispute through any available legal channel:<br/>
                        &nbsp;&nbsp;• Direct settlement — agree on an amount and submit mutual on-chain resolution<br/>
                        &nbsp;&nbsp;• Local court — file a claim in the jurisdiction of the property<br/>
                        &nbsp;&nbsp;• Police report — if property damage involves criminal liability<br/>
                        &nbsp;&nbsp;• Mediation service — any licensed local mediator<br/><br/>
                        <strong>2. pi2pi is not an arbitrator.</strong> The protocol does not evaluate claims, take sides, or enforce outcomes. It only holds funds safely and releases them per the rules both parties signed.<br/><br/>
                        <strong>3. After 60 days</strong> — regardless of outcome — all frozen deposits are returned to each party automatically. Any court-ordered recovery is enforced through legal channels, not through this protocol.
                      </div>
                    </div>
                    <div style={{background:"#f8fafc",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",marginBottom:10,fontSize:11,color:"var(--muted)",lineHeight:1.6}}>
                      <strong>Tip:</strong> On-chain transaction records from this contract are admissible as evidence in court. Use the Print Contract button to export a signed PDF with all tx hashes.
                    </div>
                    {!pdLlFreezeSkipped && (
                      <button onClick={()=>setPdLlFreezeSkipped(true)}
                        style={{width:"100%",padding:"9px",borderRadius:8,background:"var(--color-text-dim)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                        Simulate: 60 days passed — no agreement, funds returned
                      </button>
                    )}
                    {pdLlFreezeSkipped && (
                      <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10,padding:"12px 14px",marginTop:8}}>
                        <div style={{fontSize:13,marginBottom:4}}></div>
                        <div style={{fontSize:12,fontWeight:700,color:"var(--color-primary)",marginBottom:4}}>Freeze ended — deposits returned to each party</div>
                        <div style={{fontSize:11,color:"var(--color-primary)",lineHeight:1.6}}>Your deposit → You · Property Deposit → Tenant.<br/>Any unresolved claims must now be pursued independently through courts.<br/>Executed on {ARC_TESTNET_CHAIN.chainName}.</div>
                      </div>
                    )}
                  </div>
                )}

                {/* LL did not confirm — claim dropped, deposit returned */}
                {pdPhase==="ll_no_bond" && (
                  <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10,padding:"12px 14px",textAlign:"center"}}>
                    <div style={{fontSize:22,marginBottom:6}}></div>
                    <div style={{fontWeight:800,fontSize:13,color:"var(--color-primary)",marginBottom:4}}>Claim dropped — deposit returned in full</div>
                    <div style={{fontSize:12,color:"var(--color-primary)"}}>No action within 3 days — claim dropped.<br/>{fmt(propDep)} USDC → Tenant. Contract closed.<br/>Executed on {ARC_TESTNET_CHAIN.chainName}.</div>
                  </div>
                )}

                {/* Freeze flow (tenant disputes) */}
                {pdPhase==="pd_bond" && (
                  <div>
                    <div style={{background:"var(--color-warning-surface)",border:"1.5px solid var(--color-warning-border)",borderRadius:8,padding:"10px 12px",marginBottom:10}}>
                      <div style={{fontWeight:700,fontSize:12,color:"var(--color-warning)",marginBottom:4}}>Dispute — freeze deposits</div>
                      <div style={{fontSize:11,color:"var(--color-warning)",lineHeight:1.6}}>All deposits frozen for 60 days. Returns to each party if no settlement.</div>
                    </div>
                    {!pdBondPaid && (
                      <button onClick={()=>setPdBondPaid(true)}
                        style={{width:"100%",padding:"10px",borderRadius:9,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer",marginBottom:8}}>
                        {<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"-2px",width:14,height:14}}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>} Freeze Deposits — confirm dispute
                      </button>
                    )}
                    {pdBondPaid && !pdFreezeSkipped && (
                      <div style={{marginBottom:8}}>
                        <div style={{background:"var(--color-warning-surface)",border:"1.5px solid var(--color-warning-border)",borderRadius:10,padding:"12px 14px",marginBottom:10}}>
                          <div style={{fontWeight:700,fontSize:12,color:"var(--color-warning)",marginBottom:6}}>Deposits frozen — 60-day freeze active</div>
                          <div style={{fontSize:11,color:"var(--color-warning)",lineHeight:1.7}}>
                            <strong>Frozen in Aave v2:</strong><br/>
                            • Your Security Deposit<br/>
                            • Property Deposit: {fmt(propDep)} USDC<br/>
                            • Yield generated → pi2pi protocol fee during freeze
                          </div>
                        </div>
                        <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:"12px 14px",marginBottom:10}}>
                          <div style={{fontWeight:700,fontSize:11,color:"#0369a1",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.4px"}}>What happens next</div>
                          <div style={{fontSize:11,color:"#0c4a6e",lineHeight:1.8}}>
                            <strong>1. Both parties have 60 days</strong> to resolve this dispute through any available legal channel:<br/>
                            &nbsp;&nbsp;• Direct settlement — agree on an amount and submit mutual on-chain resolution<br/>
                            &nbsp;&nbsp;• Local court — file a claim in the jurisdiction of the property<br/>
                            &nbsp;&nbsp;• Police report — if property damage involves criminal liability<br/>
                            &nbsp;&nbsp;• Mediation service — any licensed local mediator<br/><br/>
                            <strong>2. pi2pi is not an arbitrator.</strong> The protocol does not evaluate claims, take sides, or enforce outcomes. It only holds funds safely and releases them per the rules both parties signed.<br/><br/>
                            <strong>3. After 60 days</strong> — regardless of outcome — all frozen deposits are returned to each party automatically. Any court-ordered recovery is enforced through legal channels, not through this protocol.
                          </div>
                        </div>
                        <div style={{background:"#f8fafc",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",marginBottom:10,fontSize:11,color:"var(--muted)",lineHeight:1.6}}>
                          <strong>Tip:</strong> On-chain transaction records are admissible as evidence in court. Use the Print Contract button to export a signed PDF with all tx hashes.
                        </div>
                        <button onClick={()=>setPdFreezeSkipped(true)}
                          style={{width:"100%",padding:"9px",borderRadius:8,background:"var(--color-text-dim)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                          Simulate: 60 days passed — no agreement, funds returned
                        </button>
                      </div>
                    )}
                    {pdFreezeSkipped && (
                      <div style={{background:"var(--color-primary-surface)",borderRadius:8,padding:"10px"}}>
                        <div style={{fontSize:11,fontWeight:700,color:"var(--color-primary)",marginBottom:2}}>Freeze ended — funds returned</div>
                        <div style={{fontSize:11,color:"var(--color-primary)"}}>Deposits unfrozen → each party. Court handles claim independently.</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Done states */}
                {pdPhase==="done_full_return" && (
                  <div style={{background:"var(--color-primary-surface)",border:"1.5px solid var(--color-primary-border)",borderRadius:10,padding:"12px 14px",textAlign:"center"}}>
                    <div style={{fontSize:22,marginBottom:6}}></div>
                    <div style={{fontWeight:800,fontSize:13,color:"var(--color-primary)",marginBottom:6}}>{t("body.propdep_returned_full")}</div>
                    <div style={{fontSize:12,color:"var(--color-primary)"}}>{fmt(propDep)} USDC → Tenant<br/>Executed on {ARC_TESTNET_CHAIN.chainName}. Contract closed.</div>
                  </div>
                )}
                {pdPhase==="done_claim" && (
                  <div style={{background:"#f8fafc",border:"1.5px solid var(--border)",borderRadius:10,padding:"12px 14px",textAlign:"center"}}>
                    <div style={{fontSize:22,marginBottom:6}}></div>
                    <div style={{fontWeight:800,fontSize:13,color:"var(--text)",marginBottom:6}}>{t("body.damage_claim_settled")}</div>
                    <div style={{fontSize:12,color:"var(--muted)"}}>{fmt(Math.round(propDep*0.6))} USDC → Landlord · {fmt(Math.round(propDep*0.4))} USDC → Tenant<br/>Executed on {ARC_TESTNET_CHAIN.chainName}. Contract closed.</div>
                  </div>
                )}

              </div>
            </div>
          )}
        </div>
      )}

      {m.status==="accepted_demand" && (
        <div style={{background:"#f8fafc",border:"1.5px solid var(--border)",borderRadius:12,padding:"14px 14px"}}>
          <div style={{textAlign:"center",fontSize:28,marginBottom:8}}></div>
          <div style={{fontWeight:800,fontSize:14,color:"var(--text)",marginBottom:10,textAlign:"center"}}>Demand accepted — contract closed</div>
          <div style={{background:"var(--color-bg-card)",borderRadius:8,padding:"10px 12px",marginBottom:10,fontSize:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{color:"#6b7280"}}>Commitment Deposit → Landlord</span>
              <span style={{fontWeight:700,color:"var(--color-danger)"}}>−420 USDC</span>
            </div>
            {selectedDemand==="dep_and_propdep" && (
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{color:"#6b7280"}}>60% Property Deposit → Landlord</span>
                <span style={{fontWeight:700,color:"var(--color-danger)"}}>−504 USDC</span>
              </div>
            )}
            {selectedDemand==="dep_and_propdep" && (
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{color:"#6b7280"}}>Remaining Property Deposit → You</span>
                <span style={{fontWeight:700,color:"var(--color-primary)"}}>+336 USDC</span>
              </div>
            )}
            {selectedDemand!=="dep_and_propdep" && (
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{color:"#6b7280"}}>Property Security Deposit → You</span>
                <span style={{fontWeight:700,color:"var(--color-primary)"}}>+840 USDC</span>
              </div>
            )}
            <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid var(--color-bg-secondary)",paddingTop:6,marginTop:4}}>
              <span style={{color:"#6b7280"}}>LL Hosting Deposit → Landlord</span>
              <span style={{fontWeight:700}}>returned</span>
            </div>
          </div>
          <div style={{fontSize:11,color:"var(--muted)",textAlign:"center",lineHeight:1.6}}>
            All funds executed on-chain. Contract closed.<br/>
            Recorded on {ARC_TESTNET_CHAIN.chainName}.
          </div>
        </div>
      )}
      {(m.status==="disputed_demand"||m.status==="disputed_eviction") && (
        <div>
          <div style={{background:"var(--color-warning-surface)",border:"1.5px solid var(--color-warning-border)",borderRadius:10,padding:"10px 12px",marginBottom:8}}>
            <div style={{fontWeight:700,fontSize:12,color:"var(--color-warning)",marginBottom:4}}>Disputed — deposits frozen</div>
            <div style={{fontSize:11,color:"var(--color-warning)",lineHeight:1.6,marginBottom:10}}>
              All deposits frozen for 60 days. Deposits return to each party if no agreement.
            </div>
            {!bondPaid && (
              <button onClick={()=>setBondPaid(true)}
                style={{width:"100%",padding:"10px",borderRadius:9,background:"var(--color-danger)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                {<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"-2px",width:14,height:14}}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>} Freeze Deposits — confirm dispute
              </button>
            )}
            {bondPaid && !freezeOpen && (
              <button onClick={()=>{setFreezeOpen(true); onContractClose?.("done_dispute");}}
                style={{width:"100%",padding:"10px",borderRadius:9,background:"var(--color-warning)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                Open freeze &amp; notify facilitator
              </button>
            )}
            {freezeOpen && !timeSkipped && (
              <div style={{background:"var(--color-bg-card)",borderRadius:8,padding:"10px",marginTop:8,fontSize:11,color:"var(--muted)",lineHeight:1.8}}>
                All funds frozen in Aave v2. Yield → pi2pi.<br/>
                Facilitator notified. Resolve via courts or settle directly.<br/>
                <button onClick={()=>setTimeSkipped(true)}
                  style={{marginTop:8,width:"100%",padding:"9px",borderRadius:8,background:"var(--color-text-dim)",color:"white",border:"none",fontFamily:"var(--ff)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                  60 days — no agreement, funds returned
                </button>
              </div>
            )}
            {timeSkipped && (
              <div style={{background:"var(--color-primary-surface)",borderRadius:8,padding:"10px",marginTop:8}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--color-primary)",marginBottom:4}}>Freeze ended — funds returned</div>
                <div style={{fontSize:11,color:"var(--color-primary)",lineHeight:1.6}}>Deposits unfrozen → each party. Court handles claims independently.</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function InboxBlock({ msgs, unread, isLL, expanded, open, respond, markAllRead, META, onViewListing, onOpenChat, onStartContract, earlyTermState, onEarlyTermStateChange, onContractClose }) {
  const [replyText, setReplyText] = useState({});

  return (
    <div className="sc-card" style={{marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div className="sc-title" style={{marginBottom:0}}>
          {t("inbox.title")}
          {unread>0&&<span style={{marginLeft:8,background:"var(--accent)",color:"var(--color-primary-text)",borderRadius:10,padding:"1px 7px",fontSize:10,fontWeight:800}}>{unread}</span>}
        </div>
        {unread>0&&<button onClick={markAllRead} style={{fontSize:11,color:"var(--teal)",background:"none",border:"none",cursor:"pointer",fontFamily:"var(--ff)",fontWeight:600}}>{t("inbox.mark_all")}</button>}
      </div>

      {msgs.length===0 ? (
        <div style={{fontSize:13,color:"var(--muted)",textAlign:"center",padding:"16px 0"}}>{t("inbox.no_messages")}</div>
      ) : msgs.map(m => {
        const meta = META[m.type] || {};
        const isOpen = expanded===m.id;
        return (
          <div key={m.id} style={{borderBottom:"1px solid var(--border)",paddingBottom:isOpen?12:0,
            background:m.type==="early_term_request"&&!m.status?(m.variant==="green"?"var(--color-primary-surface)":"#fff5f5"):"transparent",
            borderRadius:m.type==="early_term_request"&&!m.status?10:0,
            margin:m.type==="early_term_request"&&!m.status?"6px -4px":0,
            padding:m.type==="early_term_request"&&!m.status?"0 4px":0,
            border:m.type==="early_term_request"&&!m.status?(m.variant==="green"?"1.5px solid var(--color-primary-border)":"1.5px solid var(--color-danger-border)"):"none"}}>
            {/* Row */}
            <div onClick={()=>open(m.id)}
              style={{display:"flex",gap:10,padding:"10px 0",cursor:"pointer",opacity:m.read&&!isOpen&&m.type!=="early_term_request"?0.55:1,transition:"opacity 0.2s"}}>
              <div style={{position:"relative",flexShrink:0}}>
                <AvatarBox id={m.avatar} size={38} radius={10}/>
                {!m.read&&<div style={{position:"absolute",top:-2,right:-2,width:8,height:8,background:"var(--accent)",borderRadius:"50%",border:"2px solid white"}}/>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                  <span style={{fontWeight:700,fontSize:12}}>{m.from}</span>
                  <span style={{fontSize:10,color:"var(--muted)",flexShrink:0,marginLeft:6}}>{m.time}</span>
                </div>
                <div style={{fontSize:10,fontWeight:700,marginBottom:3,color:m.type==="early_term_request"?(m.variant==="green"?"var(--color-primary)":"var(--color-danger)"):meta.color}}>
                  {meta.icon} {m.type==="early_term_request"
                    ? (m.variant==="green"
                        ? (isLL?"Early Termination — Tenant":"Early Termination — Landlord")
                        : m.offer==="uninhabitable"
                          ? "Forced Exit — Landlord Breach"
                          : "Termination Notice — Violation")
                    : meta.label}
                </div>
                <div style={{fontSize:12,color:"var(--muted)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:isOpen?"normal":"nowrap"}}>{m.text}</div>
              </div>
              <div style={{fontSize:11,color:"var(--dim)",alignSelf:"center",flexShrink:0}}>{isOpen?"▲":"▼"}</div>
            </div>

            {/* Expanded actions */}
            {isOpen && (
              <div style={{paddingLeft:48,paddingBottom:4}}>

                {/* viewing_req — landlord sees: confirm or decline + optional message */}
                {m.type==="viewing_req" && isLL && (
                  m.status ? (
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:m.status==="confirmed"?"var(--green)":"var(--dim)",marginBottom:m.status==="confirmed"?8:0}}>
                        {m.status==="confirmed"?t("inbox.viewing_confirmed"):t("inbox.viewing_declined")}
                        {m.replyMsg&&<div style={{fontWeight:400,color:"var(--muted)",marginTop:4}}>You replied: "{m.replyMsg}"</div>}
                      </div>
                      {m.status==="confirmed" && (
                        <div>
                          <div style={{fontSize:11,color:"var(--muted)",marginBottom:8,lineHeight:1.6}}>
                            {t("inbox.ready_proceed")}
                          </div>
                          <div style={{display:"flex",gap:8}}>
                            <button className="bb-btn" style={{flex:1,fontSize:12,padding:"7px 12px",background:"var(--teal)",color:"var(--color-primary-text)",border:"none"}}
                              onClick={()=>onStartContract&&onStartContract(m.listingId)}>
                              {t("inbox.start_agreement")}
                            </button>
                            <button className="bb-btn" style={{flex:1,fontSize:12,padding:"7px 12px",background:"none",color:"var(--text)",border:"1.5px solid var(--border)"}}
                              onClick={()=>onOpenChat&&onOpenChat(m.listingId)}>
                              {t("inbox.open_chat")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div style={{display:"flex",gap:8,marginBottom:8}}>
                        <button className="bb-btn" style={{fontSize:12,padding:"6px 14px",background:"var(--green)",color:"var(--color-primary-text)",border:"none"}}
                          onClick={()=>respond(m.id,"confirmed",replyText[m.id])}>{t("inbox.confirm_viewing")}</button>
                        <button className="bb-btn" style={{fontSize:12,padding:"6px 14px",background:"none",color:"var(--dim)",border:"1.5px solid var(--border)"}}
                          onClick={()=>respond(m.id,"declined",replyText[m.id])}>{t("inbox.decline")}</button>
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <input className="field-inp" style={{flex:1,fontSize:12,padding:"7px 10px"}}
                          placeholder="Add a message (optional)…"
                          value={replyText[m.id]||""}
                          onChange={e=>setReplyText(t=>({...t,[m.id]:e.target.value}))}
                          onClick={e=>e.stopPropagation()}
                        />
                      </div>
                    </div>
                  )
                )}

                {/* suggestion — tenant clicks → go to listing page */}
                {m.type==="suggestion" && !isLL && (
                  <button className="ca-btn accent" style={{fontSize:12,padding:"6px 16px"}}
                    onClick={()=>onViewListing&&onViewListing(m.listingId)}>
                    {t("inbox.view_listing")}
                  </button>
                )}

                {/* chat_active — TN opened chat, show actions */}
                {m.type==="chat_active" && !isLL && (
                  <div>
                    <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:8,padding:"9px 12px",marginBottom:10,fontSize:11,color:"var(--color-primary)",fontWeight:600}}>
                      {t("inbox.chat_open")}
                    </div>
                    <div style={{fontSize:11,color:"var(--muted)",marginBottom:8}}>{t("inbox.next_steps")}</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button style={{flex:1,padding:"9px 10px",borderRadius:9,background:"var(--color-bg-card)",border:"1.5px solid var(--border)",color:"var(--text)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}
                        onClick={()=>onOpenChat&&onOpenChat(m.listingId)}>
                        {t("inbox.continue_chat")}
                      </button>
                      <button style={{flex:1,padding:"9px 10px",borderRadius:9,background:"var(--color-bg-card)",border:"1.5px solid var(--border)",color:"var(--text)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}
                        onClick={()=>onViewListing&&onViewListing(m.listingId)}>
                        {t("inbox.request_viewing")}
                      </button>
                      <button style={{flex:"0 0 100%",padding:"9px 10px",borderRadius:9,background:"var(--teal)",border:"none",color:"white",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}
                        onClick={()=>onStartContract&&onStartContract(m.listingId)}>
                        {t("inbox.apply_now")}
                      </button>
                    </div>
                  </div>
                )}

                {/* viewing_sent — TN requested viewing, now can chat or apply */}
                {m.type==="viewing_sent" && !isLL && (
                  <div>
                    <div style={{background:"var(--color-primary-surface)",border:"1px solid var(--color-primary-border)",borderRadius:8,padding:"9px 12px",marginBottom:10,fontSize:11,color:"var(--color-primary)",fontWeight:600}}>
                      {t("inbox.viewing_sent")}
                    </div>
                    <div style={{fontSize:11,color:"var(--muted)",marginBottom:8}}>{t("inbox.while_you_wait")}</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button style={{flex:1,padding:"9px 10px",borderRadius:9,background:"var(--color-bg-card)",border:"1.5px solid var(--border)",color:"var(--text)",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}
                        onClick={()=>onOpenChat&&onOpenChat(m.listingId)}>
                        {t("inbox.open_chat")}
                      </button>
                      <button style={{flex:1,padding:"9px 10px",borderRadius:9,background:"var(--teal)",border:"none",color:"white",fontFamily:"var(--ff)",fontWeight:700,fontSize:12,cursor:"pointer"}}
                        onClick={()=>onStartContract&&onStartContract(m.listingId)}>
                        {t("inbox.apply_now")}
                      </button>
                    </div>
                  </div>
                )}

                {/* message — inline reply, no full chat link */}
                {m.type==="message" && (
                  <div>
                    <div style={{background:"var(--bg2)",borderRadius:8,padding:"8px 10px",fontSize:12,marginBottom:8,lineHeight:1.5}}>
                      <span style={{fontWeight:700}}>{m.from}:</span> {m.text}
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <input
                        className="field-inp" style={{flex:1,fontSize:12,padding:"7px 10px"}}
                        placeholder="Reply…"
                        value={replyText[m.id]||""}
                        onChange={e=>setReplyText(t=>({...t,[m.id]:e.target.value}))}
                        onClick={e=>e.stopPropagation()}
                      />
                      <button className="bb-btn" style={{fontSize:12,padding:"0 14px",whiteSpace:"nowrap"}}
                        onClick={e=>{e.stopPropagation();setReplyText(t=>({...t,[m.id]:""}));}}>
                        Send ↑
                      </button>
                    </div>
                  </div>
                )}

                {/* application — landlord sees: accept or decline */}
                {m.type==="application" && isLL && (
                  m.status ? (
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{fontSize:12,fontWeight:700,color:m.status==="accepted"?"var(--green)":"var(--dim)"}}>
                        {m.status==="accepted"?"Application accepted":"Application declined"}
                      </div>
                      {m.status==="accepted" && (
                        <button className="bb-btn" style={{fontSize:11,padding:"5px 12px",background:"var(--accent)",color:"var(--color-primary-text)",border:"none"}}
                          onClick={()=>onStartContract&&onStartContract(m.listingId)}>
                          Start Agreement →
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{display:"flex",gap:8}}>
                      <button className="bb-btn" style={{fontSize:12,padding:"6px 14px",background:"var(--green)",color:"var(--color-primary-text)",border:"none"}}
                        onClick={()=>{ respond(m.id,"accepted"); setTimeout(()=>onStartContract&&onStartContract(m.listingId),300); }}>Accept & Start Agreement</button>
                      <button className="bb-btn" style={{fontSize:12,padding:"6px 14px",background:"none",color:"var(--dim)",border:"1.5px solid var(--border)"}}
                        onClick={()=>respond(m.id,"rejected")}>{t("inbox.decline")}</button>
                    </div>
                  )
                )}

                {/* early_term_request — other party wants to terminate */}
                {m.type==="early_term_request" && (
                  <EarlyTermInboxCard m={m} isLL={isLL} respond={respond}
                    cardState={earlyTermState?.[m.id] || {}}
                    onCardStateChange={patch => onEarlyTermStateChange?.(prev => ({...prev, [m.id]: {...(prev?.[m.id]||{}), ...patch}}))}
                    onContractClose={onContractClose}
                  />
                )}

              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── ACTIVE CONTRACT CARD ─────────────────────────────────────────────────────

// EarlyTermModal extracted to ./components/EarlyTermModal.jsx
// EarlyTermResponseForm extracted to ./components/EarlyTermResponseForm.jsx

// ─── CONTRACT DOCUMENTS — always visible once agreementId exists ─────────────
// SettingsNotifications extracted to ./components/SettingsNotifications.jsx

// SwitchRoleSection extracted to ./components/SwitchRoleSection.jsx
// ─── PROPERTY SECURITY DEPOSIT — unified state machine ──────────────────────
// PropDepositBlock + PropDepSection extracted to ./components/PropDepComponents.jsx


export { EarlyTermInboxCard, InboxBlock };
export default InboxBlock;
