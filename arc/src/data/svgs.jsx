import React from 'react';

export const SVGS = {
  0: (
    <svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%"}}>
      <rect width="300" height="200" fill="#e8f6f0"/>
      <rect x="0" y="130" width="300" height="70" fill="#c8e8d8"/>
      <rect x="0" y="0" width="300" height="130" fill="#b8e0f0"/>
      <circle cx="240" cy="35" r="28" fill="#ffe878" opacity="0.9"/>
      <rect x="60" y="40" width="180" height="140" fill="#4a9a7a"/>
      {[55,75,95,115,135].map((y,i)=>(
        <rect key={i} x="60" y={y} width="180" height="1" fill="#3a8a6a" opacity="0.4"/>
      ))}
      {[55,75,95,115,135].map((y,i)=>
        [70,100,130,160,190].map((x,j)=>(
          <rect key={`${i}-${j}`} x={x} y={y+4} width="14" height="14" rx="2" fill={i+j%2===0?"#fffbe0":"#2a7a5a"} opacity="0.95"/>
        ))
      )}
      <rect x="120" y="120" width="60" height="60" fill="#3a8a6a"/>
      <rect x="135" y="135" width="30" height="45" rx="3" fill="#fffbe0" opacity="0.8"/>
      <rect x="50" y="170" width="200" height="10" fill="#8acc99"/>
      <rect x="80" y="155" width="15" height="20" rx="2" fill="#6ab885"/>
      <rect x="205" y="150" width="15" height="25" rx="2" fill="#6ab885"/>
    </svg>
  ),
  1: ( // Penthouse - highrise with stars
    <svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%"}}>
      <rect width="300" height="200" fill="#e8f4f8"/>
      <rect x="0" y="120" width="300" height="80" fill="#d0e8f0"/>
      {/* Sky gradient */}
      <rect x="0" y="0" width="300" height="120" fill="#c5e3f0"/>
      {/* Stars */}
      <circle cx="30" cy="20" r="2" fill="#fff" opacity="0.7"/>
      <circle cx="80" cy="35" r="1.5" fill="#fff" opacity="0.6"/>
      <circle cx="220" cy="15" r="2" fill="#fff" opacity="0.8"/>
      <circle cx="260" cy="40" r="1.5" fill="#fff" opacity="0.5"/>
      {/* Moon */}
      <circle cx="250" cy="30" r="14" fill="#f5e6a0"/>
      <circle cx="258" cy="24" r="11" fill="#c5e3f0"/>
      {/* Main tower */}
      <rect x="100" y="20" width="100" height="160" fill="#4a7fa5"/>
      {/* Tower details - floors */}
      {[30,45,60,75,90,105,120,135,150].map((y,i)=>(
        <rect key={i} x="100" y={y} width="100" height="1" fill="#3a6f95" opacity="0.5"/>
      ))}
      {/* Windows lit up */}
      {[35,50,65,80,95,110,125,140].map((y,i)=>
        [110,125,140,155,165,180].map((x,j)=>(
          <rect key={`${i}-${j}`} x={x} y={y} width="8" height="8" rx="1"
            fill={Math.random()>0.3?"#ffe878":"#2a5f85"} opacity="0.9"/>
        ))
      )}
      {/* Penthouse top */}
      <rect x="115" y="10" width="70" height="18" fill="#3a6f95"/>
      <rect x="125" y="4" width="50" height="10" fill="#2a5f85"/>
      {/* Antenna */}
      <line x1="150" y1="4" x2="150" y2="-5" stroke="#2a5f85" strokeWidth="2"/>
      {/* Ground */}
      <rect x="0" y="170" width="300" height="30" fill="#b8d4bc"/>
      {/* Trees */}
      <rect x="60" y="145" width="6" height="25" fill="#8aa86e"/>
      <ellipse cx="63" cy="138" rx="16" ry="20" fill="#6a9a4e"/>
      <rect x="230" y="148" width="6" height="22" fill="#8aa86e"/>
      <ellipse cx="233" cy="140" rx="14" ry="18" fill="#6a9a4e"/>
      {/* Reflection in water at base */}
      <rect x="85" y="172" width="130" height="8" fill="#4a7fa5" opacity="0.2"/>
    </svg>
  ),
  2: ( // Loft - industrial building
    <svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%"}}>
      <rect width="300" height="200" fill="#f0ebe3"/>
      {/* Sky */}
      <rect x="0" y="0" width="300" height="130" fill="#e8e0d8"/>
      {/* Background buildings */}
      <rect x="10" y="60" width="40" height="130" fill="#c8b8a8" opacity="0.5"/>
      <rect x="240" y="50" width="50" height="130" fill="#c8b8a8" opacity="0.5"/>
      {/* Main loft building */}
      <rect x="60" y="40" width="180" height="140" fill="#8b7355"/>
      {/* Brick texture lines */}
      {[50,60,70,80,90,100,110,120,130,140,150,160].map((y,i)=>(
        <rect key={i} x="60" y={y} width="180" height="1" fill="#7a6245" opacity="0.4"/>
      ))}
      {[80,100,120,140,160,180,200,220,230].map((x,i)=>(
        <rect key={i} x={x} y="40" width="1" height="140" fill="#7a6245" opacity="0.25"/>
      ))}
      {/* Large industrial windows */}
      <rect x="70" y="55" width="50" height="55" rx="2" fill="#87ceeb" opacity="0.8"/>
      <line x1="95" y1="55" x2="95" y2="110" stroke="#7a6245" strokeWidth="2"/>
      <line x1="70" y1="82" x2="120" y2="82" stroke="#7a6245" strokeWidth="2"/>
      <rect x="135" y="55" width="50" height="55" rx="2" fill="#87ceeb" opacity="0.8"/>
      <line x1="160" y1="55" x2="160" y2="110" stroke="#7a6245" strokeWidth="2"/>
      <line x1="135" y1="82" x2="185" y2="82" stroke="#7a6245" strokeWidth="2"/>
      <rect x="200" y="55" width="30" height="55" rx="2" fill="#87ceeb" opacity="0.6"/>
      {/* Ground floor entrance */}
      <rect x="120" y="140" width="60" height="40" rx="2" fill="#5a4535"/>
      <rect x="148" y="140" width="4" height="40" fill="#4a3525"/>
      {/* Door handle */}
      <circle cx="140" cy="163" r="3" fill="#c8a855"/>
      <circle cx="160" cy="163" r="3" fill="#c8a855"/>
      {/* Rooftop elements */}
      <rect x="60" y="35" width="180" height="8" fill="#6a5240"/>
      <rect x="80" y="20" width="15" height="18" fill="#6a5240"/>
      <rect x="180" y="25" width="12" height="13" fill="#6a5240"/>
      {/* Water tower */}
      <rect x="210" y="10" width="20" height="28" fill="#8b7355"/>
      <ellipse cx="220" cy="10" rx="12" ry="5" fill="#7a6245"/>
      {/* Ground */}
      <rect x="0" y="175" width="300" height="25" fill="#c8b898"/>
      <rect x="0" y="175" width="300" height="4" fill="#a89878"/>
    </svg>
  ),
  3: ( // Villa - tropical beachfront
    <svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%"}}>
      {/* Sky */}
      <rect width="300" height="200" fill="#87ceeb"/>
      <rect x="0" y="0" width="300" height="110" fill="#a8dff0"/>
      {/* Sun */}
      <circle cx="240" cy="35" r="22" fill="#ffe878"/>
      {/* Clouds */}
      <ellipse cx="60" cy="30" rx="30" ry="14" fill="white" opacity="0.8"/>
      <ellipse cx="90" cy="25" rx="20" ry="12" fill="white" opacity="0.8"/>
      <ellipse cx="40" cy="28" rx="18" ry="10" fill="white" opacity="0.8"/>
      {/* Ocean */}
      <rect x="0" y="150" width="300" height="50" fill="#4a9fc8"/>
      <rect x="0" y="150" width="300" height="8" fill="#5ab0d8" opacity="0.6"/>
      {/* Wave lines */}
      <path d="M0 158 Q30 154 60 158 Q90 162 120 158 Q150 154 180 158 Q210 162 240 158 Q270 154 300 158" stroke="white" strokeWidth="1.5" fill="none" opacity="0.5"/>
      <path d="M0 165 Q40 161 80 165 Q120 169 160 165 Q200 161 240 165 Q270 161 300 165" stroke="white" strokeWidth="1" fill="none" opacity="0.3"/>
      {/* Sand */}
      <rect x="0" y="140" width="300" height="20" fill="#e8d898"/>
      {/* Villa main building */}
      <rect x="70" y="80" width="160" height="70" fill="#f5f0e8"/>
      {/* Roof */}
      <polygon points="55,80 150,40 245,80" fill="#c8765a"/>
      <polygon points="55,80 65,80 150,45 235,80 245,80 150,38" fill="#b86a4a"/>
      {/* Windows */}
      <rect x="85" y="95" width="35" height="30" rx="2" fill="#87ceeb" opacity="0.8"/>
      <line x1="102" y1="95" x2="102" y2="125" stroke="#d0c8b8" strokeWidth="1.5"/>
      <rect x="180" y="95" width="35" height="30" rx="2" fill="#87ceeb" opacity="0.8"/>
      <line x1="197" y1="95" x2="197" y2="125" stroke="#d0c8b8" strokeWidth="1.5"/>
      {/* Door */}
      <rect x="132" y="110" width="36" height="40" rx="3" fill="#8b6a40"/>
      <circle cx="163" cy="132" r="3" fill="#c8a855"/>
      {/* Pool */}
      <rect x="90" y="130" width="120" height="18" rx="4" fill="#4ab8d8" opacity="0.8"/>
      <rect x="90" y="130" width="120" height="4" rx="2" fill="#5ac8e8" opacity="0.6"/>
      {/* Palm trees */}
      <rect x="28" y="95" width="5" height="55" fill="#8b6a30" transform="rotate(-5,30,95)"/>
      <path d="M30 95 Q10 75 -5 65" stroke="#4a8a2a" strokeWidth="8" fill="none" strokeLinecap="round"/>
      <path d="M30 95 Q15 80 20 65" stroke="#4a8a2a" strokeWidth="7" fill="none" strokeLinecap="round"/>
      <path d="M30 95 Q50 78 55 62" stroke="#4a8a2a" strokeWidth="7" fill="none" strokeLinecap="round"/>
      <path d="M30 95 Q45 85 60 82" stroke="#5a9a3a" strokeWidth="6" fill="none" strokeLinecap="round"/>
      <rect x="258" y="100" width="5" height="50" fill="#8b6a30" transform="rotate(6,260,100)"/>
      <path d="M260 100 Q280 80 295 70" stroke="#4a8a2a" strokeWidth="8" fill="none" strokeLinecap="round"/>
      <path d="M260 100 Q275 85 270 70" stroke="#4a8a2a" strokeWidth="7" fill="none" strokeLinecap="round"/>
      <path d="M260 100 Q242 82 238 67" stroke="#4a8a2a" strokeWidth="7" fill="none" strokeLinecap="round"/>
    </svg>
  ),
  4: ( // Apartment - European city
    <svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg" style={{width:"100%",height:"100%"}}>
      {/* Sky */}
      <rect width="300" height="200" fill="#d4e8f8"/>
      {/* Background buildings */}
      <rect x="0" y="70" width="35" height="130" fill="#c4a882" opacity="0.6"/>
      <rect x="255" y="80" width="45" height="130" fill="#c4a882" opacity="0.6"/>
      <rect x="5" y="60" width="25" height="15" fill="#b49872" opacity="0.6"/>
      {/* Main building */}
      <rect x="50" y="30" width="200" height="150" fill="#e8d8c0"/>
      {/* Facade texture */}
      {[55,80,105,130,155].map((y,i)=>(
        <rect key={i} x="50" y={y} width="200" height="1" fill="#d8c8b0" opacity="0.6"/>
      ))}
      {/* Ornate top */}
      <rect x="50" y="22" width="200" height="12" fill="#d4b890"/>
      <rect x="45" y="18" width="210" height="8" fill="#c8a878"/>
      {/* Decorative top details */}
      {[60,80,100,120,140,160,180,200,220].map((x,i)=>(
        <rect key={i} x={x} y="14" width="8" height="6" fill="#c8a878"/>
      ))}
      {/* Windows row 1 */}
      {[60,100,140,180,210].map((x,i)=>(
        <g key={i}>
          <rect x={x} y="38" width="28" height="35" rx="12" fill="#87ceeb" opacity="0.75"/>
          <rect x={x} y="65" width="28" height="10" fill="#c8a878"/>
          <line x1={x+14} y1="38" x2={x+14} y2="73" stroke="#d8c8b0" strokeWidth="1"/>
        </g>
      ))}
      {/* Windows row 2 */}
      {[60,100,140,180,210].map((x,i)=>(
        <g key={i}>
          <rect x={x} y="90" width="28" height="35" rx="12" fill="#87ceeb" opacity="0.75"/>
          <rect x={x} y="117" width="28" height="10" fill="#c8a878"/>
          <line x1={x+14} y1="90" x2={x+14} y2="125" stroke="#d8c8b0" strokeWidth="1"/>
        </g>
      ))}
      {/* Windows row 3 */}
      {[60,100,140,180,210].map((x,i)=>(
        <g key={i}>
          <rect x={x} y="140" width="28" height="28" rx="2" fill="#87ceeb" opacity="0.7"/>
          <line x1={x+14} y1="140" x2={x+14} y2="168" stroke="#d8c8b0" strokeWidth="1"/>
        </g>
      ))}
      {/* Main entrance */}
      <rect x="126" y="148" width="48" height="32" rx="4" fill="#8b6a40"/>
      <rect x="148" y="148" width="4" height="32" fill="#7a5a30"/>
      <circle cx="138" cy="166" r="3" fill="#c8a855"/>
      <circle cx="162" cy="166" r="3" fill="#c8a855"/>
      {/* Arch above door */}
      <path d="M126 152 Q150 138 174 152" fill="#c8a878"/>
      {/* Balconies */}
      {[60,100,180,210].map((x,i)=>(
        <rect key={i} x={x-3} y="122" width="34" height="4" fill="#c8a878"/>
      ))}
      {/* Street */}
      <rect x="0" y="178" width="300" height="22" fill="#b8b0a0"/>
      <rect x="0" y="178" width="300" height="3" fill="#a8a090"/>
      {/* Cobblestones suggestion */}
      {[0,30,60,90,120,150,180,210,240,270].map((x,i)=>(
        <rect key={i} x={x} y="182" width="28" height="8" rx="1" fill="#b0a898" opacity="0.5"/>
      ))}
    </svg>
  ),
};

// Extend SVGS for additional listings (reuse existing SVGs cyclically)
[4,5,6,7,8,9,10,11,12,13].forEach((id) => { SVGS[id] = SVGS[id % 4]; });

