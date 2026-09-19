#!/usr/bin/env node
// Generates static, JS-free SEO/AEO landing pages into public/seo/*.html.
//
// Why this exists: the pi2pi app (arc/) uses React Router's HashRouter
// (see arc/src/main.jsx), so every in-app route lives after a "#" in the
// URL and is resolved entirely client-side. Search engine crawlers and
// LLM/AI agents that do not execute JavaScript never see that content —
// the server always returns the same empty <div id="root"></div> shell
// for "/". These pages are therefore NOT React routes. They are plain
// static HTML files, generated once here (or regenerated any time this
// script is re-run), and served directly by server-arc.js from
// public/seo/ BEFORE the request would ever reach the SPA shell.
//
// Run: node scripts/build-seo-pages.mjs
// Output: public/seo/<slug>.html (11 files)
//
// Content policy (see docs task): only confirmed facts drawn from
// CLAUDE.md, pitch/, and the actual code (config/deployments.json,
// arc/src/helpers.js, contracts/audit/slither-report.md). No mainnet
// claims, no legal guarantees, no yield promises, no invented features.
// EN only — localization of these pages is a separate future task.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "seo");
mkdirSync(OUT_DIR, { recursive: true });

// Single source of truth for contract addresses — same file server-arc.js
// reads for /api/version and /project-info.json. We only display these as
// a labeled snapshot on the /arc page; the live value always comes from
// /project-info.json, generated dynamically by the server on every request.
const deployments = JSON.parse(readFileSync(join(ROOT, "config", "deployments.json"), "utf8"));
const active = deployments["5042002"].active;
const RENTAL_ESCROW = active.RentalEscrow.address;
const PROPDEP_ESCROW = active.PropDepEscrow.address;
const CHAIN_ID = 5042002;

// Canonical/OG/sitemap domain for everything this repo serves. This repo
// deploys to my.pi2pi.io only (Fly app "pi2pi-project"). The bare pi2pi.io
// domain is served by a SEPARATE GitHub Pages repository that is not part
// of this codebase — its source is not here, cannot be inspected or edited
// from this repo, and must never be used as a canonical/OG/sitemap target
// for pages this server actually serves. pi2pi.io is referenced only as a
// plain "website" link (see public/llms.txt), never as the domain a URL
// here claims to be canonical on.
const SITE = "https://my.pi2pi.io";
const APP = "https://my.pi2pi.io"; // live working app (same domain — kept as a separate name for readability at call sites)

const NAV = [
  ["/how-it-works", "How it works"],
  ["/for-tenants", "For tenants"],
  ["/for-landlords", "For landlords"],
  ["/security", "Security"],
  ["/deposit-protection", "Deposit protection"],
  ["/arc", "Arc"],
  ["/faq", "FAQ"],
];

// Baseline disclaimer language for pages that discuss operational/production
// status — verbatim per the project's own production-state record. Keep
// "implemented in code" and "verified in production" as distinct claims;
// never merge them.
const PRODUCTION_STATUS_NOTE = "Infrastructure and the main public surfaces were operating, but full production end-to-end testing of financial and contract workflows has not been performed.";

const CITY_NAV = [
  ["/tbilisi", "Tbilisi"],
  ["/batumi", "Batumi"],
  ["/da-nang", "Da Nang"],
  ["/nha-trang", "Nha Trang"],
];

function escAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

function orgJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "pi2pi",
    "url": SITE,
    "logo": `${SITE}/favicon-32.png`,
    "sameAs": ["https://x.com/dim_ul"],
    "description": "pi2pi is a USDC-native rental agreement execution layer on Arc Testnet. Tenants and landlords enter direct peer-to-peer rental agreements settled in USDC, with deposits held in smart-contract escrow.",
  };
}

function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "pi2pi",
    "url": SITE,
  };
}

function softwareAppJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "pi2pi",
    "applicationCategory": "FinanceApplication",
    "operatingSystem": "Web",
    "url": APP,
    "description": "Peer-to-peer rental agreement protocol with smart-contract deposit escrow, settled in USDC on Arc Testnet.",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD",
      "description": "Zero platform fees, zero commissions.",
    },
  };
}

function page({ slug, title, description, h1, body, ogImage = "/images/tbilisi-day.jpg", jsonLd = [] }) {
  const canonical = `${SITE}/${slug}`;
  const ld = [orgJsonLd(), websiteJsonLd(), ...jsonLd];
  const navLinks = NAV.map(([href, label]) =>
    `<a href="${href}"${href === "/" + slug ? ' aria-current="page"' : ""}>${label}</a>`
  ).join("\n        ");
  const cityLinks = CITY_NAV.map(([href, label]) =>
    `<a href="${href}"${href === "/" + slug ? ' aria-current="page"' : ""}>${label}</a>`
  ).join("\n        ");

  const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<meta name="description" content="${escAttr(description)}"/>
<link rel="canonical" href="${canonical}"/>
<meta name="robots" content="index, follow"/>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"/>
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png"/>
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png"/>

<!-- Open Graph -->
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="pi2pi"/>
<meta property="og:title" content="${escAttr(title)}"/>
<meta property="og:description" content="${escAttr(description)}"/>
<meta property="og:url" content="${canonical}"/>
<meta property="og:image" content="${SITE}${ogImage}"/>

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:site" content="@dim_ul"/>
<meta name="twitter:title" content="${escAttr(title)}"/>
<meta name="twitter:description" content="${escAttr(description)}"/>
<meta name="twitter:image" content="${SITE}${ogImage}"/>

<link rel="stylesheet" href="/styles/tokens.css"/>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0;
    font-family: var(--font-ui, -apple-system, system-ui, sans-serif);
    background: var(--color-bg-primary, #0B0F1A);
    color: var(--color-text-primary, #F4F6FA);
    line-height: 1.6;
  }
  a { color: var(--color-primary, #16C784); }
  .wrap { max-width: 860px; margin: 0 auto; padding: 0 20px; }
  header.site { border-bottom: 1px solid var(--color-border, #23283A); padding: 16px 0; }
  header.site .wrap { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .brand { font-weight: 800; font-size: 20px; letter-spacing: -0.5px; text-decoration: none; color: var(--color-text-primary, #F4F6FA); }
  .brand span { color: var(--color-primary, #16C784); }
  nav.primary { display: flex; gap: 14px; flex-wrap: wrap; font-size: 14px; }
  nav.primary a { text-decoration: none; color: var(--color-text-secondary, #9AA3B8); }
  nav.primary a:hover, nav.primary a[aria-current="page"] { color: var(--color-primary, #16C784); }
  .cta { background: var(--color-primary, #16C784); color: #061012; padding: 8px 16px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 14px; white-space: nowrap; }
  .testnet-banner { background: var(--color-warning-surface, #2A2210); color: var(--color-warning, #F59E0B); font-size: 13px; text-align: center; padding: 8px 12px; border-bottom: 1px solid var(--color-warning-border, rgba(245,158,11,0.2)); }
  main { padding: 40px 0 60px; }
  h1 { font-size: 32px; letter-spacing: -0.5px; margin: 0 0 8px; }
  h2 { font-size: 22px; margin: 36px 0 12px; }
  .lede { font-size: 18px; color: var(--color-text-secondary, #9AA3B8); margin-bottom: 28px; }
  .card { background: var(--color-bg-card, #131826); border: 1px solid var(--color-border, #23283A); border-radius: 12px; padding: 18px 20px; margin: 16px 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin: 16px 0; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 15px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--color-border, #23283A); }
  code, .mono { font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 0.92em; background: var(--color-bg-secondary, #1A2033); padding: 2px 6px; border-radius: 4px; }
  ul.cities { display: flex; gap: 10px; flex-wrap: wrap; list-style: none; padding: 0; }
  ul.cities a { display: inline-block; padding: 6px 12px; border: 1px solid var(--color-border, #23283A); border-radius: 20px; text-decoration: none; font-size: 14px; }
  footer.site { border-top: 1px solid var(--color-border, #23283A); padding: 28px 0 40px; font-size: 13px; color: var(--color-text-secondary, #9AA3B8); }
  footer.site nav { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
  footer.site nav a { color: var(--color-text-secondary, #9AA3B8); text-decoration: none; }
  footer.site nav a:hover { color: var(--color-primary, #16C784); }
</style>
${ld.map((obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`).join("\n")}
</head>
<body>
<div class="testnet-banner">pi2pi runs on Arc Testnet. This is a working prototype, not a production financial product — do not use real-world funds beyond small test amounts.</div>
<header class="site">
  <div class="wrap">
    <a class="brand" href="/">pi<span>2</span>pi</a>
    <nav class="primary">
      ${navLinks}
    </nav>
    <a class="cta" href="${APP}">Open App →</a>
  </div>
</header>
<main>
  <div class="wrap">
    <h1>${h1}</h1>
    ${body.trim()}
  </div>
</main>
<footer class="site">
  <div class="wrap">
    <nav>
      <a href="/">Home</a>
      ${navLinks}
      ${cityLinks}
      <a href="${APP}">Open App</a>
      <a href="/llms.txt">llms.txt</a>
      <a href="/project-info.json">project-info.json</a>
    </nav>
    <p>pi2pi — peer-to-peer rental agreements settled in USDC. Arc Testnet, chain ID ${CHAIN_ID}. No platform fees, no commissions, no token. Contact: <a href="https://x.com/dim_ul">@dim_ul</a>.</p>
  </div>
</footer>
</body>
</html>
`;
  return { slug, html };
}

const pages = [];

pages.push(page({
  slug: "how-it-works",
  title: "How pi2pi works — on-chain rental agreements in USDC | pi2pi",
  description: "How pi2pi's peer-to-peer rental protocol works: listing, negotiation, on-chain agreement signing, escrow deposits, monthly USDC rent, and dispute resolution — on Arc Testnet.",
  h1: "How pi2pi works",
  ogImage: "/images/tbilisi-day.jpg",
  jsonLd: [softwareAppJsonLd()],
  body: `
    <p class="lede">pi2pi replaces paper rental contracts and rental-agency middlemen with a smart-contract protocol. Tenants and landlords agree on terms directly, sign on-chain, and settle everything in USDC — deposits, monthly rent, and dispute outcomes.</p>

    <h2>The five steps</h2>
    <ol>
      <li><strong>Find a listing.</strong> Browse available properties in the pilot markets in the app.</li>
      <li><strong>Negotiate in chat.</strong> Tenant and landlord discuss terms using pi2pi's built-in chat before committing to anything on-chain.</li>
      <li><strong>Sign the agreement on-chain.</strong> Both sides sign a rental agreement and post their deposits to a smart-contract escrow (RentalEscrow). No signature, no funds move.</li>
      <li><strong>Pay rent monthly in USDC.</strong> Recurring rent settlement runs through the protocol, not through a bank transfer to a landlord's personal account.</li>
      <li><strong>Lease end.</strong> The contract releases deposits according to its rules: back to each side at a clean checkout with no damage claim, or through the protocol's bond-and-freeze dispute process if a claim is raised.</li>
    </ol>

    <h2>What's actually locked in escrow</h2>
    <p>pi2pi uses a symmetric "equal stakes" deposit model — both sides put something at risk, not just the tenant:</p>
    <table>
      <tr><th>Deposit</th><th>Who posts it</th><th>Amount</th></tr>
      <tr><td>Commitment Deposit</td><td>Tenant</td><td>1× monthly rent</td></tr>
      <tr><td>Hosting Deposit</td><td>Landlord</td><td>1× monthly rent</td></tr>
      <tr><td>Property Security Deposit</td><td>Tenant (optional)</td><td>0–3× monthly rent</td></tr>
    </table>

    <h2>The agreement lifecycle</h2>
    <p>Every agreement moves through a fixed on-chain state machine, enforced by the RentalEscrow contract:</p>
    <p class="mono">Created → AwaitingLandlordDep / AwaitingTenantDep → Active → CheckoutProposed / EarlyTermProposed → DamageClaimed → DisputeOpen → Settled</p>
    <p>An automated enforcement bot (the "keeper") watches deadlines on-chain and triggers the permissionless contract actions those deadlines allow: flagging missed rent, executing an unanswered damage claim, expiring an unposted bond, releasing funds after an expired dispute freeze. It does not pay rent or move funds on your behalf — you still send your own rent and deposit transactions; the keeper only enforces what happens when a deadline is missed. See <a href="/security">Security</a> for details.</p>

    <h2>No fees, no token</h2>
    <p>pi2pi charges zero platform fees and zero commissions. There is no pi2pi token and no plan to launch one. The protocol's revenue model is a yield spread: while a deposit sits in escrow it can be routed through ERC-4626 yield adapters (Aave, Morpho), with yield split 70% to the tenant/landlord and 30% to the protocol treasury. The contract's escrow accounting tracks what each party is owed separately from the yield strategy's performance; this design has not been independently audited or stress-tested against an adapter loss scenario.</p>

    <h2>Wallets</h2>
    <p>pi2pi uses Circle Programmable Wallets with WebAuthn/passkey login — no seed phrases to write down or lose. MetaMask and WalletConnect are also supported for users who already have a wallet.</p>

    <h2>Current status</h2>
    <p>pi2pi runs on <strong>Arc Testnet</strong> (chain ID 5042002), not mainnet. The steps above are implemented in the app and contracts and used for pilot testing. ${PRODUCTION_STATUS_NOTE} See <a href="/security">Security</a> for what has and hasn't been verified.</p>

    <p><a href="/for-tenants">Read more for tenants →</a> · <a href="/for-landlords">Read more for landlords →</a></p>
  `,
}));

pages.push(page({
  slug: "for-tenants",
  title: "pi2pi for tenants — deposit protection, no agent fees | pi2pi",
  description: "Rent an apartment through pi2pi: your deposit sits in smart-contract escrow instead of a landlord's personal account, and there are no agent commissions. USDC on Arc Testnet.",
  h1: "pi2pi for tenants",
  ogImage: "/images/tbilisi-sunset.jpg",
  body: `
    <p class="lede">If you're renting internationally — as an expat, digital nomad, or relocant — you're used to handing over a large deposit to a stranger with no real recourse if things go wrong. pi2pi changes where that money sits.</p>

    <h2>Your deposit goes into escrow, not a landlord's pocket</h2>
    <p>When you sign a rental agreement on pi2pi, your Commitment Deposit (and Property Security Deposit, if the listing requires one) is locked in the RentalEscrow smart contract — not transferred directly to the landlord. It stays there for the life of the agreement, visible on-chain, and is only released according to the contract's rules: back to you at a clean checkout, or through a dispute process if the landlord raises a damage claim.</p>

    <h2>No agent fees</h2>
    <p>Traditional rental agents in these markets commonly charge 50–100% of one month's rent as a commission just for connecting you with a landlord. pi2pi charges nothing — 0% platform fee, 0% commission.</p>

    <h2>What you can do in the app</h2>
    <ul>
      <li>Browse listings and message landlords directly in built-in chat before committing to anything</li>
      <li>Review the full rental agreement terms on-chain before signing</li>
      <li>Pay monthly rent in USDC yourself through the app each cycle — the protocol enforces the deadline, it doesn't pay for you</li>
      <li>At lease end, your deposit is released according to the contract's rules — back to you at a clean checkout, or through the dispute process (bond posting + freeze window) if the landlord raises a damage claim</li>
      <li>Download a hash-verified, SHA-256-checksummed printable copy of your signed agreement, verifiable against the on-chain record on Arc Explorer</li>
    </ul>

    <h2>No seed phrases</h2>
    <p>pi2pi uses Circle Programmable Wallets — you log in with a passkey (biometric/device authentication), not a 12-word phrase you have to protect yourself. MetaMask and WalletConnect work too if you already have a wallet.</p>

    <h2>Current status</h2>
    <p>pi2pi is live on <strong>Arc Testnet</strong> (chain ID 5042002), not mainnet. The tenant flow — browse, chat, sign, deposit, pay rent, checkout/dispute — is implemented in the app for testing. ${PRODUCTION_STATUS_NOTE}</p>

    <p>Pilot cities currently supported: <a href="/tbilisi">Tbilisi</a>, <a href="/batumi">Batumi</a>, <a href="/da-nang">Da Nang</a>, <a href="/nha-trang">Nha Trang</a>. See <a href="/deposit-protection">how deposit protection works</a> in detail.</p>
  `,
}));

pages.push(page({
  slug: "for-landlords",
  title: "pi2pi for landlords — escrow-secured deposits, deadline enforcement | pi2pi",
  description: "List your property on pi2pi: no listing fees, no commissions, tenant deposits secured in smart-contract escrow, and automated on-chain deadline enforcement for missed rent. USDC on Arc Testnet.",
  h1: "pi2pi for landlords",
  ogImage: "/images/danang.jpg",
  body: `
    <p class="lede">List a property on pi2pi and get a tenant relationship backed by an on-chain agreement, not a verbal promise or a paper lease that's hard to enforce across a border.</p>

    <h2>No listing fees, no commissions</h2>
    <p>Publishing a listing costs nothing. pi2pi takes 0% commission on rent or deposits. The protocol's only revenue is a yield spread on escrowed USDC while an agreement is active, split 70% back to the two parties (tenant + landlord) and 30% to the protocol treasury.</p>

    <h2>Your Hosting Deposit — and the tenant's stake</h2>
    <p>pi2pi's "equal stakes" model isn't tenant-only risk: as a landlord you also post a Hosting Deposit (1× monthly rent) into the same RentalEscrow contract the tenant's Commitment Deposit goes into. This is a symmetric commitment mechanism, not a one-sided security deposit against the tenant.</p>

    <h2>What's protected</h2>
    <ul>
      <li>Tenant deposits sit in the RentalEscrow smart contract for the life of the agreement — you don't have to trust that a tenant "has the money" for damages later, it's already locked</li>
      <li>Tenants pay monthly rent on-chain through the app; an automated enforcement bot watches the payment deadline and flags a missed payment on-chain if it isn't paid in time — it does not collect or pay rent on the tenant's behalf</li>
      <li>If there's property damage at checkout, you can raise a damage claim through the protocol's bond-and-freeze dispute process instead of relying on informal deposit withholding</li>
      <li>Every signed agreement produces a hash-verified printable document, checkable against the on-chain record</li>
    </ul>

    <h2>Current status</h2>
    <p>pi2pi runs on <strong>Arc Testnet</strong> (chain ID 5042002) — this is a working prototype for pilot testing, not a mainnet financial product yet. The landlord flow (list → chat → sign → receive deposits → receive rent payments → checkout/dispute) is implemented in the app for testing. ${PRODUCTION_STATUS_NOTE}</p>

    <p>Currently piloting in <a href="/tbilisi">Tbilisi</a>, <a href="/batumi">Batumi</a>, <a href="/da-nang">Da Nang</a>, and <a href="/nha-trang">Nha Trang</a>. See <a href="/how-it-works">how the full protocol works</a>.</p>
  `,
}));

pages.push(page({
  slug: "security",
  title: "Security — pi2pi smart contract escrow | pi2pi",
  description: "pi2pi's security posture: Arc Testnet status, automated Slither static analysis results, internal/AI-assisted code review, and what has not yet been done (no third-party human audit, no mainnet).",
  h1: "Security",
  ogImage: "/images/tbilisi-day.jpg",
  body: `
    <p class="lede">Deposits are only worth locking in escrow if the escrow itself is trustworthy. Here is exactly what has and has not been done to verify pi2pi's smart contracts, stated plainly.</p>

    <h2>Testnet status — read this first</h2>
    <p><strong>pi2pi runs on Arc Testnet only (chain ID 5042002).</strong> It is not deployed to mainnet. Do not treat funds used on Arc Testnet as real-world savings — this is a working prototype for pilot and demo purposes, actively preparing for a formal audit ahead of any mainnet deployment. ${PRODUCTION_STATUS_NOTE}</p>

    <h2>What has been done</h2>
    <ul>
      <li><strong>Automated static analysis:</strong> the two core contracts (<code>RentalEscrow.sol</code>, <code>PropDepEscrow.sol</code>) have been run through Slither (slither-analyzer). Result: 0 High severity findings; 1 Medium finding reviewed and dispositioned as a false positive (intentional state-enum equality check); 3 Low findings reviewed (2 accepted as low risk, 1 noted for a future fix); 4 Info findings acknowledged.</li>
      <li><strong>Automated test suite:</strong> an extensive Foundry test suite covers the agreement lifecycle, deposit accounting, adapter integrations (Aave, Morpho), dispute flows, and multiple regression/security-fix scenarios.</li>
      <li><strong>Internal and AI-assisted code review passes</strong> have been performed against the contracts and the off-chain enforcement bot as part of ongoing development.</li>
    </ul>

    <h2>What has not been done yet</h2>
    <ul>
      <li>No formal third-party human security audit has been completed. This is planned before any mainnet deployment.</li>
      <li>No mainnet deployment exists. No production financial guarantees are made or implied.</li>
      <li>No legal opinion has been obtained on the enforceability of on-chain rental agreements in any jurisdiction.</li>
    </ul>

    <h2>How the deposit escrow is structured</h2>
    <p>Deposits are held by the <code>RentalEscrow</code> contract (and, for optional property-damage coverage, the linked <code>PropDepEscrow</code> contract) — not by either party directly, and not by pi2pi as a company. The contract implements a fixed on-chain state machine, and an automated enforcement bot is implemented to handle deadline-based transitions (missed rent, unanswered claims, expired dispute-freeze windows) instead of requiring manual staff intervention. This describes what the code implements, not a claim that every path has been exercised end-to-end in production. See <a href="/deposit-protection">Deposit protection</a> for the full mechanics.</p>

    <h2>Report a security issue</h2>
    <p>If you find a vulnerability, contact <a href="https://x.com/dim_ul">@dim_ul</a> directly rather than disclosing it publicly.</p>
  `,
}));

pages.push(page({
  slug: "deposit-protection",
  title: "Deposit protection — how pi2pi escrow works | pi2pi",
  description: "How pi2pi protects rental deposits: smart-contract escrow, the equal-stakes deposit model, the on-chain agreement state machine, and the bond-and-freeze dispute process.",
  h1: "Deposit protection",
  ogImage: "/images/tbilisi-sunset.jpg",
  body: `
    <p class="lede">The core problem pi2pi solves: in most cross-border rentals, a tenant's deposit sits in a landlord's personal bank account with no enforceable guarantee it comes back. pi2pi moves that deposit into a smart contract instead.</p>

    <h2>The equal-stakes deposit model</h2>
    <p>Both sides post a stake into the same escrow contract — this isn't a one-sided security deposit against the tenant:</p>
    <table>
      <tr><th>Deposit</th><th>Posted by</th><th>Amount</th><th>Purpose</th></tr>
      <tr><td>Commitment Deposit</td><td>Tenant</td><td>1× monthly rent</td><td>Tenant's commitment to the lease</td></tr>
      <tr><td>Hosting Deposit</td><td>Landlord</td><td>1× monthly rent</td><td>Landlord's commitment to honor the agreement</td></tr>
      <tr><td>Property Security Deposit</td><td>Tenant (optional)</td><td>0–3× monthly rent</td><td>Covers potential property damage, set per listing</td></tr>
    </table>

    <h2>Where the money actually sits</h2>
    <p>All of it goes into the <code>RentalEscrow</code> smart contract (and <code>PropDepEscrow</code> for the property security deposit specifically) on Arc Testnet — addresses are published at <a href="/arc">/arc</a> and <a href="/project-info.json">/project-info.json</a>. Neither party, and not pi2pi as a company, can move these funds outside the rules encoded in the contract.</p>

    <h2>The on-chain lifecycle</h2>
    <p class="mono">Created → AwaitingLandlordDep / AwaitingTenantDep → Active → CheckoutProposed / EarlyTermProposed → DamageClaimed → DisputeOpen → Settled</p>
    <p>At a clean checkout with no damage claim, the contract's rules release deposits back to each party. If a landlord raises a damage claim, the agreement moves into a bond-posting and freeze-window process before any dispute is settled — this prevents either side from unilaterally grabbing funds by simply staying silent.</p>

    <h2>Automated enforcement — not automated payment</h2>
    <p>An off-chain "keeper" bot is implemented to continuously monitor every active agreement for deadline-based conditions and trigger the corresponding permissionless on-chain action. It enforces deadlines — it does not pay rent or move funds into anyone's wallet on their behalf; tenants and landlords still send their own payment and deposit transactions:</p>
    <ul>
      <li>Rent overdue → flags the agreement as rent-missed</li>
      <li>Landlord raised a damage claim and the tenant stayed silent past the deadline → executes the claim</li>
      <li>Landlord didn't post the required bond in time → the claim expires</li>
      <li>A dispute's freeze window has expired → frozen funds are released per the contract's rules</li>
    </ul>
    <p>This is what the deadline-enforcement code is designed to do. It does not mean every path above has been exercised end-to-end in production — ${PRODUCTION_STATUS_NOTE}</p>

    <h2>Yield on escrowed funds</h2>
    <p>While a deposit sits in escrow, it can be routed through ERC-4626 yield adapters (Aave, Morpho). Yield is split 70% back to the two parties and 30% to the protocol treasury — this is how pi2pi earns revenue instead of charging fees. The escrow contract tracks the principal amount owed to each party separately from yield performance; this design has not been independently audited or stress-tested against an adapter loss scenario.</p>

    <p>See <a href="/security">Security</a> for audit status and <a href="/how-it-works">How it works</a> for the full agreement flow.</p>
  `,
}));

pages.push(page({
  slug: "arc",
  title: "pi2pi on Arc Testnet — USDC-native settlement | pi2pi",
  description: "Why pi2pi is built on Arc: native USDC gas, deterministic sub-second finality, and no bridges or wrapped tokens. Current contract addresses and chain ID.",
  h1: "pi2pi on Arc",
  ogImage: "/images/tbilisi-day.jpg",
  body: `
    <p class="lede">pi2pi is built on Arc, a blockchain designed around USDC as its native gas and settlement asset. That fits a rental protocol better than a general-purpose chain where you'd need a separate token just to pay transaction fees.</p>

    <h2>Why Arc, specifically</h2>
    <ul>
      <li><strong>Native USDC gas.</strong> Tenants never need to hold a separate gas token (like ETH) just to sign an agreement or pay rent — USDC covers everything.</li>
      <li><strong>Deterministic, fast finality.</strong> Arc targets sub-second (&lt;350ms) deterministic finality, which matters for a protocol where deposit confirmations and rent payments need to be predictable, not probabilistic.</li>
      <li><strong>No bridges, no wrapped tokens.</strong> Rent and deposits are USDC on Arc directly — not a wrapped representation that needs to be bridged in and out.</li>
    </ul>

    <h2>Network details</h2>
    <table>
      <tr><th>Network</th><td>Arc Testnet</td></tr>
      <tr><th>Chain ID</th><td class="mono">${CHAIN_ID}</td></tr>
      <tr><th>Settlement asset</th><td>USDC</td></tr>
    </table>

    <h2>Current active contracts</h2>
    <p>This is a point-in-time snapshot as of when this page was generated. <a href="/project-info.json">/project-info.json</a> uses the same resolved runtime contract addresses as <code>/api/version</code>, including configured environment overrides.</p>
    <table>
      <tr><th>Contract</th><th>Address</th></tr>
      <tr><td>RentalEscrow</td><td class="mono">${RENTAL_ESCROW}</td></tr>
      <tr><td>PropDepEscrow</td><td class="mono">${PROPDEP_ESCROW}</td></tr>
    </table>
    <p>This is Arc <em>Testnet</em>, not mainnet. See <a href="/security">Security</a> for what verification has and has not been performed.</p>
  `,
}));

const cityPage = ({ slug, name, country, blurb, priceLine, ops, ogImage }) => page({
  slug,
  title: `Rent in ${name} on pi2pi — deposit-protected P2P rentals | pi2pi`,
  description: `Peer-to-peer rental agreements in ${name}, ${country} with deposits secured in smart-contract escrow and settled in USDC. No agent commissions. Arc Testnet pilot market.`,
  h1: `pi2pi in ${name}`,
  ogImage,
  body: `
    <p class="lede">${blurb}</p>

    <h2>Typical rent range</h2>
    <p>${priceLine} (indicative pilot-market range, not a live listings feed — <a href="${APP}">open the app</a> to see current listings).</p>

    <h2>Operations</h2>
    <p>${ops}</p>

    <h2>How renting works here</h2>
    <p>Same protocol as everywhere else pi2pi operates: browse a listing, negotiate terms in built-in chat, sign an on-chain rental agreement, and settle deposits and monthly rent in USDC through smart-contract escrow instead of handing cash or a bank transfer directly to the other party. No agent commission — traditional agents in this region commonly charge 50–100% of one month's rent just to make the introduction. See <a href="/how-it-works">how it works</a> and <a href="/deposit-protection">deposit protection</a>.</p>

    <h2>Status</h2>
    <p>pi2pi runs on <strong>Arc Testnet</strong> (chain ID ${CHAIN_ID}) — a working prototype for pilot testing, not a mainnet product yet.</p>

    <p>Other pilot markets: <ul class="cities">${CITY_NAV.filter(([h]) => h !== "/" + slug).map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join("")}</ul></p>
  `,
});

pages.push(cityPage({
  slug: "tbilisi",
  name: "Tbilisi",
  country: "Georgia",
  blurb: "Tbilisi is pi2pi's primary pilot market — a city with a large international relocant population (100K+) and founder-led on-the-ground operations.",
  priceLine: "$600–1,500/month for 2–3 bedroom apartments (Saburtalo district and similar areas)",
  ops: "Founder-led operations. Tbilisi is where pi2pi's on-the-ground pilot activity is most active.",
  ogImage: "/images/tbilisi-sunset.jpg",
}));

pages.push(cityPage({
  slug: "batumi",
  name: "Batumi",
  country: "Georgia",
  blurb: "Batumi is pi2pi's secondary Georgian pilot market, on the Black Sea coast.",
  priceLine: "$400–900/month",
  ops: "Secondary Georgian pilot market alongside Tbilisi.",
  ogImage: "/images/tbilisi-day.jpg",
}));

pages.push(cityPage({
  slug: "da-nang",
  name: "Da Nang",
  country: "Vietnam",
  blurb: "Da Nang has a growing expat and digital-nomad community, making it a natural fit for pi2pi's cross-border deposit-protection model.",
  priceLine: "$300–1,000/month",
  ops: "Growing expat and digital-nomad community.",
  ogImage: "/images/danang.jpg",
}));

pages.push(cityPage({
  slug: "nha-trang",
  name: "Nha Trang",
  country: "Vietnam",
  blurb: "Nha Trang is a partner-led pilot market for pi2pi in Vietnam.",
  priceLine: "$300–800/month",
  ops: "Partner-led operations.",
  ogImage: "/images/danang-2.jpg",
}));

pages.push(page({
  slug: "faq",
  title: "FAQ — pi2pi rental protocol | pi2pi",
  description: "Frequently asked questions about pi2pi: fees, currency, network, deposit protection, disputes, wallets, and current testnet status.",
  h1: "Frequently asked questions",
  ogImage: "/images/tbilisi-day.jpg",
  body: `
    <h2>Is pi2pi live on mainnet?</h2>
    <p>No. pi2pi currently runs on <strong>Arc Testnet</strong> (chain ID 5042002). It is a working prototype used for pilot testing, not a production mainnet product. See <a href="/security">Security</a> for what has and hasn't been verified.</p>

    <h2>Has the full agreement lifecycle been tested end-to-end in production?</h2>
    <p>The lifecycle is implemented in the contracts and app and covered by the automated test suite. ${PRODUCTION_STATUS_NOTE} "Implemented in code" and "verified end-to-end in production" are different claims — see <a href="/security">Security</a> for the distinction.</p>

    <h2>What does pi2pi cost?</h2>
    <p>Zero platform fees and zero commissions, for both tenants and landlords. Revenue comes from a yield spread on USDC value locked in escrow while an agreement is active, split 70% to the two parties and 30% to the protocol treasury.</p>

    <h2>Is there a pi2pi token?</h2>
    <p>No. There is no pi2pi token and no plan to launch one. USDC is the only currency used on the protocol.</p>

    <h2>Where does my deposit actually sit?</h2>
    <p>In the <code>RentalEscrow</code> smart contract (and <code>PropDepEscrow</code> for the optional property security deposit) — not in the other party's personal account, and not held by pi2pi as a company. See <a href="/deposit-protection">Deposit protection</a>.</p>

    <h2>What happens if there's a dispute?</h2>
    <p>A landlord's damage claim moves the agreement into a bond-posting and freeze-window process rather than an immediate withdrawal. An automated enforcement bot is implemented to handle deadline-based transitions (e.g. an unanswered claim, or an expired freeze window) so the outcome doesn't depend on either side remembering to act — it enforces deadlines, it does not move funds outside the contract's own rules.</p>

    <h2>What wallet do I need?</h2>
    <p>pi2pi uses Circle Programmable Wallets with WebAuthn/passkey login — no seed phrase required. MetaMask and WalletConnect are also supported.</p>

    <h2>Which cities does pi2pi operate in?</h2>
    <p><a href="/tbilisi">Tbilisi</a> and <a href="/batumi">Batumi</a> in Georgia, and <a href="/da-nang">Da Nang</a> and <a href="/nha-trang">Nha Trang</a> in Vietnam.</p>

    <h2>Has pi2pi been audited?</h2>
    <p>The core contracts have been run through automated Slither static analysis (0 high-severity findings) and internal/AI-assisted code review, but no formal third-party human security audit has been completed yet. That is planned before any mainnet deployment. Full detail on <a href="/security">Security</a>.</p>

    <h2>Where can I see the current contract addresses?</h2>
    <p>At <a href="/arc">/arc</a> for a human-readable page, or <a href="/project-info.json">/project-info.json</a> for a machine-readable, always-current source.</p>
  `,
}));

for (const { slug, html } of pages) {
  writeFileSync(join(OUT_DIR, `${slug}.html`), html, "utf8");
}

console.log(`Generated ${pages.length} SEO pages into ${OUT_DIR}:`);
for (const { slug } of pages) console.log(`  - ${slug}.html`);
