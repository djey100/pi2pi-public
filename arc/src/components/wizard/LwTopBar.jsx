import React from 'react';
import { lwIcBack, lwIcClose } from './LwIcons.jsx';

export default function LwTopBar({ step, onBack, onClose }) {
  return (
    <div className="lw-topbar">
      <button className="lw-icon-btn" onClick={onBack}>{lwIcBack()}</button>
      <div className="lw-dots">
        {[1,2,3,4,5,6].map(n => <div key={n} className={`lw-dot ${n===step?"on":""}`}/>)}
      </div>
      <button className="lw-icon-btn" onClick={onClose}>{lwIcClose()}</button>
    </div>
  );
}
