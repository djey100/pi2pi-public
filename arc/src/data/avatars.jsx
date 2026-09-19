import React from 'react';

export // ─── SVG AVATARS ──────────────────────────────────────────────────────────────
const AVATARS = {
  // Alex Chen - Landlord, Asian male, short dark hair, teal shirt
  "alex": (
    <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%",display:"block"}}>
      <rect width="60" height="60" fill="#d4e8f0"/>
      <ellipse cx="30" cy="38" rx="20" ry="14" fill="#2a6a9a"/>
      <circle cx="30" cy="23" r="12" fill="#f5c9a0"/>
      <ellipse cx="30" cy="15" rx="11" ry="7" fill="#1a1a1a"/>
      <ellipse cx="30" cy="13" rx="13" ry="5" fill="#111"/>
      <ellipse cx="25" cy="24" rx="2" ry="2.5" fill="#6b3a1f"/>
      <ellipse cx="35" cy="24" rx="2" ry="2.5" fill="#6b3a1f"/>
      <path d="M26 29 Q30 32 34 29" stroke="#c0785a" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  ),
  // Nino Beridze - Georgian female, dark wavy hair, red top
  "nino": (
    <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%",display:"block"}}>
      <rect width="60" height="60" fill="#f0e8d8"/>
      <ellipse cx="30" cy="38" rx="20" ry="14" fill="#c0392b"/>
      <circle cx="30" cy="23" r="12" fill="#e8b896"/>
      <path d="M18 18 Q20 8 30 10 Q40 8 42 18 Q44 10 38 8 Q32 4 28 4 Q20 4 16 10 Z" fill="#2c1810"/>
      <path d="M18 18 Q16 26 20 30 Q18 22 18 18Z" fill="#2c1810"/>
      <path d="M42 18 Q44 26 40 30 Q42 22 42 18Z" fill="#2c1810"/>
      <ellipse cx="25" cy="24" rx="2" ry="2.5" fill="#5a2d0c"/>
      <ellipse cx="35" cy="24" rx="2" ry="2.5" fill="#5a2d0c"/>
      <path d="M26 29 Q30 33 34 29" stroke="#b05030" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  ),
  // Mia Torres - Latina female, black straight hair, yellow top
  "mia": (
    <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%",display:"block"}}>
      <rect width="60" height="60" fill="var(--color-warning-surface)"/>
      <ellipse cx="30" cy="38" rx="20" ry="14" fill="var(--color-warning)"/>
      <circle cx="30" cy="23" r="12" fill="#d4956a"/>
      <rect x="18" y="10" width="24" height="16" rx="2" fill="#111"/>
      <rect x="16" y="14" width="4" height="20" rx="2" fill="#111"/>
      <rect x="40" y="14" width="4" height="20" rx="2" fill="#111"/>
      <ellipse cx="25" cy="24" rx="2" ry="2.5" fill="#4a2010"/>
      <ellipse cx="35" cy="24" rx="2" ry="2.5" fill="#4a2010"/>
      <path d="M26 29 Q30 32 34 29" stroke="#a05030" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  ),
  // Wayan Sari - Balinese female, black bun, green traditional top
  "wayan": (
    <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%",display:"block"}}>
      <rect width="60" height="60" fill="#d1fae5"/>
      <ellipse cx="30" cy="38" rx="20" ry="14" fill="var(--color-primary)"/>
      <circle cx="30" cy="23" r="12" fill="#c8956a"/>
      <circle cx="30" cy="10" r="7" fill="#1a1a1a"/>
      <circle cx="30" cy="8" r="4" fill="#1a1a1a"/>
      <path d="M19 18 Q20 12 30 14 Q40 12 41 18" fill="#1a1a1a"/>
      <ellipse cx="25" cy="24" rx="2" ry="2.5" fill="#3a1a08"/>
      <ellipse cx="35" cy="24" rx="2" ry="2.5" fill="#3a1a08"/>
      <path d="M26 29 Q30 32 34 29" stroke="#905030" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  ),
  // Yuki Tanaka - Tenant, Japanese female, bob cut, blue
  "yuki": (
    <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%",display:"block"}}>
      <rect width="60" height="60" fill="#e0e7ff"/>
      <ellipse cx="30" cy="38" rx="20" ry="14" fill="#4f46e5"/>
      <circle cx="30" cy="23" r="12" fill="#f0c8a8"/>
      <path d="M18 22 Q18 10 30 10 Q42 10 42 22 Q44 14 40 10 Q36 4 30 4 Q24 4 20 10 Q16 14 18 22Z" fill="#1a1a1a"/>
      <rect x="17" y="18" width="4" height="12" rx="2" fill="#1a1a1a"/>
      <rect x="39" y="18" width="4" height="12" rx="2" fill="#1a1a1a"/>
      <ellipse cx="25" cy="24" rx="2" ry="2" fill="#3a1a08"/>
      <ellipse cx="35" cy="24" rx="2" ry="2" fill="#3a1a08"/>
      <path d="M26 29 Q30 33 34 29" stroke="#904030" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  ),
  // Priya Shah - Indian female, long dark hair, purple
  "priya": (
    <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%",display:"block"}}>
      <rect width="60" height="60" fill="#f3e8ff"/>
      <ellipse cx="30" cy="38" rx="20" ry="14" fill="var(--color-info)"/>
      <circle cx="30" cy="23" r="12" fill="#c8856a"/>
      <path d="M18 20 Q18 8 30 8 Q42 8 42 20" fill="#1a0a00"/>
      <rect x="38" y="14" width="5" height="28" rx="2.5" fill="#1a0a00"/>
      <path d="M18 20 Q17 14 20 10" stroke="#1a0a00" strokeWidth="4" fill="none"/>
      <ellipse cx="25" cy="24" rx="2" ry="2.5" fill="#3a1808"/>
      <ellipse cx="35" cy="24" rx="2" ry="2.5" fill="#3a1808"/>
      <circle cx="30" cy="20" r="1.5" fill="#e53e3e" opacity="0.8"/>
      <path d="M26 29 Q30 32 34 29" stroke="#904030" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  ),
  // Marco Ricci - Italian male, brown curly hair, orange
  "marco": (
    <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%",display:"block"}}>
      <rect width="60" height="60" fill="#fff7ed"/>
      <ellipse cx="30" cy="38" rx="20" ry="14" fill="#ea580c"/>
      <circle cx="30" cy="23" r="12" fill="#e8b880"/>
      <circle cx="24" cy="14" r="5" fill="#6b3a10"/>
      <circle cx="30" cy="11" r="5" fill="#7a4418"/>
      <circle cx="36" cy="14" r="5" fill="#6b3a10"/>
      <circle cx="20" cy="18" r="4" fill="#6b3a10"/>
      <circle cx="40" cy="18" r="4" fill="#6b3a10"/>
      <ellipse cx="25" cy="24" rx="2" ry="2.5" fill="#4a2010"/>
      <ellipse cx="35" cy="24" rx="2" ry="2.5" fill="#4a2010"/>
      <path d="M25 28 Q27 27 30 27 Q33 27 35 28" stroke="#8b4513" strokeWidth="2" fill="none" strokeLinecap="round"/>
      <rect x="26" y="28" width="8" height="3" rx="1.5" fill="#c0784a"/>
    </svg>
  ),
};

