import React, { useState } from 'react';
import { t } from '../i18n/index.js';
import { IcBack } from './ui/Icons.jsx';
import AvatarBox from './AvatarBox.jsx';

export default function ChatPage({ listing, role, onBack, onContract }) {
  const [msgs, setMsgs] = useState([
    {id:1,from:"in",text:"Hello! I saw your listing and I'm very interested.",time:"14:23"},
    {id:2,from:"out",text:"Hi! Great to hear. Have you reviewed the smart contract terms on the listing?",time:"14:25"},
    {id:3,from:"in",text:"Yes. Can I schedule a viewing first?",time:"14:26"},
    {id:4,from:"sys",text:"Viewing request sent · Mar 10, 14:27"},
  ]);
  const [inp, setInp] = useState("");
  const [warned, setWarned] = useState(false);
  const [viewingRequested, setViewingRequested] = useState(false);

  const send = t => {
    if(!t.trim()) return;
    setMsgs(m=>[...m,{id:Date.now(),from:"out",text:t,time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}]);
    setInp("");
  };

  const doAction = a => {
    if(a==="contract"){
      if(!warned){ setWarned(true); setMsgs(m=>[...m,{id:Date.now(),from:"sys-warn",text:"Contract requested before viewing was confirmed. Proceeding is possible but not recommended."}]); return; }
      onContract();
    }
    if(a==="viewing"){
      setViewingRequested(true);
      setMsgs(m=>[...m,{id:Date.now(),from:"sys",text:"Viewing request sent · "+new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}]);
    }
    if(a==="question") send("Could you share additional photos of the kitchen and bathroom?");
    if(a==="offer") send("I'd like to make an offer — can we discuss the terms?");
    if(a==="invite") send("I'd like to invite you to view my property. Are you available this week?");
  };

  return (
    <div className="chat-wrap">
      <div className="chat-hdr">
        <button className="chat-back" onClick={onBack}><IcBack/></button>
        <AvatarBox id={listing.hostAvatar} size={36} radius={50}/>
        <div>
          <div className="chat-nm">{listing.host}</div>
          <div className="chat-st">● {t("misc.verified")} {role==="tenant"?t("role.landlord").toLowerCase():t("role.tenant").toLowerCase()}</div>
        </div>
        <div className="chat-tag">{t("chatpage.on_chain")}</div>
      </div>
      <div className="chat-body">
        {msgs.map(m=>
          m.from==="sys"?<div key={m.id} className="sys-msg">{m.text}</div>:
          m.from==="sys-warn"?<div key={m.id} className="sys-msg sys-warn">{m.text}</div>:(
          <div key={m.id} style={{display:"flex",flexDirection:"column",alignSelf:m.from==="out"?"flex-end":"flex-start"}}>
            <div className={`msg msg-${m.from}`}>{m.text}</div>
            <div className="msg-time" style={{textAlign:m.from==="out"?"right":"left"}}>{m.time}</div>
          </div>
        ))}
      </div>
      <div className="chat-foot">
        <div className="chat-inp-row">
          <input className="chat-inp" placeholder={t("ph.type_message")} value={inp} onChange={e=>setInp(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send(inp)}/>
          <button className="chat-send" onClick={()=>send(inp)}>↑</button>
        </div>
        <div className="chat-actions">
          {role==="tenant"&&<React.Fragment>
            {!viewingRequested
              ? <button className="ca-btn" onClick={()=>doAction("viewing")}>{t("chatpage.request_viewing")}</button>
              : <button className="ca-btn" style={{opacity:.45,cursor:"default"}}>{t("chatpage.viewing_requested")}</button>
            }
            <button className="ca-btn accent" onClick={()=>doAction("contract")}>{t("chatpage.apply_now")}</button>
          </React.Fragment>}
          {role==="landlord"&&<React.Fragment>
            <button className="ca-btn" onClick={()=>doAction("invite")}>{t("chatpage.offer_viewing")}</button>
            <button className="ca-btn accent" onClick={()=>onContract()}>{t("chatpage.start_agreement")}</button>
          </React.Fragment>}
        </div>
      </div>
    </div>
  );
}
