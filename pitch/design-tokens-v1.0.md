# pi2pi — Design Token System
## Version 1.0 · For Claude Code implementation

---

## Fonts (load via Google Fonts or local)

```
Primary UI:  Inter (weights: 400, 500, 600, 700, 800)
Monospace:   JetBrains Mono (weights: 300, 400, 500)
```

Google Fonts URL:
```
https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500&display=swap
```

CSS variables:
```css
--font-ui:   'Inter', -apple-system, system-ui, sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

### Typography scale

| Role | Font | Size | Weight | Letter-spacing | Usage |
|------|------|------|--------|----------------|-------|
| h1 | Inter | 20px | 700 | -0.5px | Page titles |
| h2 | Inter | 16px | 700 | -0.3px | Section heads |
| h3 | Inter | 14px | 600 | -0.2px | Card titles |
| body | Inter | 13px | 500 | 0 | Default text |
| small | Inter | 11px | 500 | 0 | Secondary text |
| label | Inter | 9px | 700 | 1.5px UPPERCASE | Section labels |
| price | JetBrains Mono | 18–28px | 300–500 | -1px | USDC amounts |
| address | JetBrains Mono | 9–10px | 400 | -0.2px | 0x... addresses |
| tx-hash | JetBrains Mono | 9px | 300 | 0 | Tx hashes |
| tag | Inter | 8–9px | 700 | 0.8px UPPERCASE | Role/status tags |

---

## Theme 1 — SAFE LIGHT (default)

```css
[data-theme="light"] {
  /* ── Fonts ── */
  --font-ui:   'Inter', -apple-system, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* ── Backgrounds ── */
  --color-bg-primary:    #FFFFFF;
  --color-bg-secondary:  #F7F8FA;
  --color-bg-card:       #FFFFFF;
  --color-bg-input:      #FFFFFF;
  --color-bg-overlay:    rgba(11, 15, 26, 0.30);

  /* ── Borders ── */
  --color-border:        #E6E8EC;
  --color-border-strong: #D0D3DA;

  /* ── Text ── */
  --color-text-primary:  #0B0F1A;
  --color-text-secondary:#5B6475;
  --color-text-dim:      #8A93A6;
  --color-text-placeholder: #B8BEC9;

  /* ── Primary action: Green ── */
  --color-primary:        #16C784;
  --color-primary-hover:  #13A66C;
  --color-primary-text:   #FFFFFF;
  --color-primary-surface:#E8F8F2;
  --color-primary-border: rgba(22, 199, 132, 0.20);

  /* ── Semantic: Warning ── */
  --color-warning:        #F59E0B;
  --color-warning-surface:#FFF6E5;
  --color-warning-border: rgba(245, 158, 11, 0.20);

  /* ── Semantic: Danger ── */
  --color-danger:         #EF4444;
  --color-danger-dark:    #B91C1C;
  --color-danger-surface: #FEECEC;
  --color-danger-border:  rgba(239, 68, 68, 0.18);

  /* ── Semantic: Info ── */
  --color-info:           #3B82F6;
  --color-info-surface:   #EAF2FF;
  --color-info-border:    rgba(59, 130, 246, 0.20);

  /* ── Deal state machine ── */
  --state-active:         #16C784;
  --state-active-surface: #E8F8F2;
  --state-active-border:  rgba(22, 199, 132, 0.20);

  --state-ending:         #F59E0B;
  --state-ending-surface: #FFF6E5;
  --state-ending-border:  rgba(245, 158, 11, 0.20);

  --state-damage:         #EF4444;
  --state-damage-surface: #FEECEC;
  --state-damage-border:  rgba(239, 68, 68, 0.18);

  --state-dispute:        #B91C1C;
  --state-dispute-surface:#FEF0F0;
  --state-dispute-border: rgba(185, 28, 28, 0.20);

  --state-settled:        #9CA3AF;
  --state-settled-surface:#F3F4F6;
  --state-settled-border: rgba(156, 163, 175, 0.20);

  --state-provisional:    #3B82F6;
  --state-provisional-surface: #EAF2FF;
  --state-provisional-border:  rgba(59, 130, 246, 0.20);

  /* ── Buttons ── */
  --btn-primary-bg:      #16C784;
  --btn-primary-text:    #FFFFFF;
  --btn-primary-hover:   #13A66C;

  --btn-secondary-bg:    #F1F3F5;
  --btn-secondary-text:  #0B0F1A;
  --btn-secondary-border:#E6E8EC;

  --btn-danger-bg:       #FEECEC;
  --btn-danger-text:     #EF4444;
  --btn-danger-border:   rgba(239, 68, 68, 0.18);

  --btn-disabled-bg:     #F1F3F5;
  --btn-disabled-text:   #B8BEC9;

  /* ── Shadows ── */
  --shadow-sm:  0 1px 2px rgba(11,15,26,.04), 0 2px 8px rgba(11,15,26,.06);
  --shadow-md:  0 2px 8px rgba(11,15,26,.06), 0 8px 24px rgba(11,15,26,.08);
  --shadow-lg:  0 4px 16px rgba(11,15,26,.08), 0 16px 48px rgba(11,15,26,.10);
  --shadow-card: 0 1px 2px rgba(11,15,26,.04), 0 2px 8px rgba(11,15,26,.06);

  /* ── Radius ── */
  --radius-sm:  6px;
  --radius-md:  10px;
  --radius-lg:  14px;
  --radius-xl:  20px;
  --radius-full:9999px;

  /* ── Spacing base: 4px grid ── */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* ── Transitions ── */
  --transition-fast: 120ms ease;
  --transition-base: 200ms ease;
}
```

---

## Theme 2 — TECH DARK

```css
[data-theme="dark"] {
  /* ── Fonts ── */
  --font-ui:   'Inter', -apple-system, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* ── Backgrounds ── */
  --color-bg-primary:    #05070D;
  --color-bg-secondary:  #0A0F1C;
  --color-bg-card:       #0F1629;
  --color-bg-input:      #0F1629;
  --color-bg-overlay:    rgba(0, 0, 0, 0.60);

  /* ── Borders ── */
  --color-border:        #1C2540;
  --color-border-strong: #2A3560;

  /* ── Text ── */
  --color-text-primary:  #EAF0FF;
  --color-text-secondary:#7F8AA3;
  --color-text-dim:      #4B5563;
  --color-text-placeholder: #2E3A52;

  /* ── Primary action: Neon Green ── */
  --color-primary:        #00FFA3;
  --color-primary-hover:  #00E695;
  --color-primary-text:   #05070D;
  --color-primary-surface:rgba(0, 255, 163, 0.10);
  --color-primary-border: rgba(0, 255, 163, 0.22);

  /* ── Semantic: Warning ── */
  --color-warning:        #FFC857;
  --color-warning-surface:rgba(255, 200, 87, 0.10);
  --color-warning-border: rgba(255, 200, 87, 0.22);

  /* ── Semantic: Danger ── */
  --color-danger:         #FF5A5F;
  --color-danger-dark:    #FF2E2E;
  --color-danger-surface: rgba(255, 90, 95, 0.10);
  --color-danger-border:  rgba(255, 90, 95, 0.20);

  /* ── Semantic: Info ── */
  --color-info:           #3ABEFF;
  --color-info-surface:   rgba(58, 190, 255, 0.10);
  --color-info-border:    rgba(58, 190, 255, 0.20);

  /* ── Deal state machine ── */
  --state-active:         #00FFA3;
  --state-active-surface: rgba(0, 255, 163, 0.10);
  --state-active-border:  rgba(0, 255, 163, 0.22);

  --state-ending:         #FFC857;
  --state-ending-surface: rgba(255, 200, 87, 0.10);
  --state-ending-border:  rgba(255, 200, 87, 0.22);

  --state-damage:         #FF5A5F;
  --state-damage-surface: rgba(255, 90, 95, 0.10);
  --state-damage-border:  rgba(255, 90, 95, 0.20);

  --state-dispute:        #FF2E2E;
  --state-dispute-surface:rgba(255, 46, 46, 0.10);
  --state-dispute-border: rgba(255, 46, 46, 0.20);

  --state-settled:        #6B7280;
  --state-settled-surface:rgba(107, 114, 128, 0.08);
  --state-settled-border: rgba(107, 114, 128, 0.15);

  --state-provisional:    #3ABEFF;
  --state-provisional-surface: rgba(58, 190, 255, 0.10);
  --state-provisional-border:  rgba(58, 190, 255, 0.20);

  /* ── Buttons ── */
  --btn-primary-bg:      #00FFA3;
  --btn-primary-text:    #05070D;
  --btn-primary-hover:   #00E695;

  --btn-secondary-bg:    #0F1629;
  --btn-secondary-text:  #7F8AA3;
  --btn-secondary-border:#1C2540;

  --btn-danger-bg:       rgba(255, 90, 95, 0.10);
  --btn-danger-text:     #FF5A5F;
  --btn-danger-border:   rgba(255, 90, 95, 0.20);

  --btn-disabled-bg:     #0A0F1C;
  --btn-disabled-text:   #2E3A52;

  /* ── Shadows ── */
  --shadow-sm:   0 0 0 1px #1C2540, 0 2px 8px rgba(0,0,0,.3);
  --shadow-md:   0 0 0 1px #1C2540, 0 4px 16px rgba(0,0,0,.4);
  --shadow-lg:   0 0 0 1px #1C2540, 0 8px 40px rgba(0,0,0,.5);
  --shadow-card: 0 0 0 1px #1C2540, 0 2px 8px rgba(0,0,0,.3);

  /* ── Radius (same as light) ── */
  --radius-sm:  6px;
  --radius-md:  10px;
  --radius-lg:  14px;
  --radius-xl:  20px;
  --radius-full:9999px;

  /* ── Spacing (same as light) ── */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  /* ── Transitions ── */
  --transition-fast: 120ms ease;
  --transition-base: 200ms ease;
}
```

---

## Component usage rules

### Buttons

```
Primary CTA       → btn-primary-bg / btn-primary-text
  Examples: "Pay rent →", "Sign with wallet →", "Publish listing →"

Secondary action  → btn-secondary-bg / btn-secondary-text
  Examples: "Terminate early", "Cancel", "Decline"

Danger action     → btn-danger-bg / btn-danger-text
  Examples: "Open dispute", "Delete listing", "Disconnect wallet"

Disabled          → btn-disabled-bg / btn-disabled-text
  Examples: "Continue →" when form incomplete
```

### Wallet balance card

```
ALWAYS dark background regardless of theme:
  Light theme: background = color-text-primary (#0B0F1A)
  Dark theme:  background = color-bg-card (#0F1629) with border

Reasoning: money zone must feel different from UI
```

### Prices and amounts

```
Font:    font-mono
Color:
  Light: color-text-primary
  Dark:  color-primary (neon green) — makes prices pop on dark
Size:    18px for card prices, 28–32px for balance
Weight:  300–500 (never bold — mono at 700 feels heavy)
```

### Wallet addresses and tx hashes

```
Font:    font-mono
Color:   color-text-dim
Size:    9–10px
Weight:  300–400
word-break: break-all
```

### Deal state pills/badges

```
Each state uses 3 vars:
  --state-{name}          → dot color, text color
  --state-{name}-surface  → pill/banner background
  --state-{name}-border   → pill/banner border

Always: dot + state name + optional detail text

States in priority order (highest first):
  1. dispute   → red/dark red "Frozen"
  2. damage    → red "Damage claim"
  3. ending    → amber "Ending in N days"
  4. active    → green "Live"
  5. settled   → grey "Settled"
  6. provisional → blue (contract pending signature)
```

### Navigation tabs (bottom)

```
Active tab:
  color: color-text-primary
  indicator: 2px line, color-primary, top edge, 18px wide centered

Inactive tabs:
  color: color-text-dim

Badge (unread):
  8px circle, color-danger, border 1.5px color-bg-primary
  position: top-right of icon
```

### Section/group labels

```
Font:   font-ui
Size:   9px
Weight: 700
Case:   UPPERCASE
Spacing: 1.5px letter-spacing
Color:  color-text-dim
```

### Input fields

```
Background: color-bg-input
Border:     1px solid color-border
Radius:     radius-md (10px)
Padding:    9px 12px
Font-size:  13px
Color:      color-text-primary
Placeholder: color-text-placeholder

Focus:      border-color → color-primary
```

### Cards

```
Background: color-bg-card
Border:     1px solid color-border
Radius:     radius-lg (14px)
Shadow:     shadow-card
Padding:    0 (image full-bleed top, content 8–10px)
```

### Modals / overlays

```
Overlay background: color-bg-overlay
Modal card:
  background: color-bg-card
  border:     1px solid color-border
  radius:     radius-xl (20px)
  padding:    22px
  shadow:     shadow-lg
  max-width:  260px centered
```

---

## Theme switching

```html
<!-- Default: light -->
<html data-theme="light">

<!-- Dark mode -->
<html data-theme="dark">
```

```js
// Toggle
document.documentElement.setAttribute(
  'data-theme',
  current === 'light' ? 'dark' : 'light'
)

// Persist
localStorage.setItem('pi2pi-theme', theme)

// On load
const saved = localStorage.getItem('pi2pi-theme') || 'light'
document.documentElement.setAttribute('data-theme', saved)
```

---

## Quick reference: color-primary usage

```
✅ CTA buttons (primary action)
✅ Active tab indicator line
✅ Live status dot (wallet connected)
✅ "New" badge on listing cards
✅ Verified badge text
✅ On-chain indicator dot
✅ Active deal state
✅ Bottom nav active item indicator

❌ NOT for body text
❌ NOT for backgrounds
❌ NOT for borders (use color-border)
❌ NOT for multiple simultaneous elements on one screen
```

---

## Microcopy rules (terminology locked)

```
"Terminate early"   NOT "Early exit"
"Open dispute"      NOT "Dispute"
"Archive listing"   NOT "Archive"
"Pause listing"     NOT "Pause"
"Submit claim"      NOT "Submit"
"Sign with wallet"  NOT "Sign" / "Confirm"
"Confirm with wallet" → for payment confirmations only
```

---

## File structure recommendation for Claude Code

```
src/
  styles/
    tokens.css          ← this file (both themes)
    base.css            ← reset + body defaults
    components/
      button.css
      card.css
      deal-state.css
      modal.css
      input.css
      nav.css
  components/
    DealCard.jsx        ← reads --state-{name} vars
    DepositBlock.jsx
    WalletBalance.jsx   ← always dark bg
    ...
```

