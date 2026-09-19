import React, { useState, useEffect, useRef, useMemo, useCallback, Fragment } from 'react';
import ReactDOM from 'react-dom/client';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { t, setLang, getLang, SUPPORTED_LANGS } from './i18n/index.js';

import {
  REVERT_MAP, extractRevertReason, NETWORK_RE, mapRevertReason,
  fmtCountdown, parseAgreement, parsePropDep,
  getDealView, getNextStep, getDealActions,
  ESCROW_ADDRESS, PROPDEP_ADDRESS, USDC_ADDRESS, ARC_TESTNET_CHAIN, USDC_DECIMALS,
  toDecAgreementId, SEL, SEL_PROPDEP, encAddr, encUint, CONTRACT_VERSION, RPC_URL,
  ACTIVE_NETWORK_NAME
} from './helpers.js';
import {
  withWalletLock, encBytes32, sysMsg, rpcCall, ethCallRpc, getGasPrice,
  getProvider, ensureWalletReady, readUsdcBalance, getMyUsdcBalance, checkUsdcBalance,
  sendTxRaw, waitReceipt
} from './wallet.js';
import { LISTINGS, TENANTS } from './mocks.js';
import UserAvatar from './components/UserAvatar.jsx';
import ContractTimer from './components/ContractTimer.jsx';
import Dropdown from './components/ui/Dropdown.jsx';
import InfoTip from './components/ui/InfoTip.jsx';
import WarningModal from './components/ui/WarningModal.jsx';
import InputModal from './components/ui/InputModal.jsx';
import { Toast, ToastStack } from './components/ui/Toast.jsx';
import ExpandableInfo from './components/ui/ExpandableInfo.jsx';
import StepHeader from './components/ui/StepHeader.jsx';
import DealStateBanner from './components/ui/DealStateBanner.jsx';
import Info from './components/ui/Info.jsx';
import ListingMap from './components/ListingMap.jsx';
import LightboxViewer from './components/LightboxViewer.jsx';
import RepScore from './components/ui/RepScore.jsx';
import AvatarBox from './components/AvatarBox.jsx';
// AVATARS removed — UserAvatar uses PNG from assets/avatars/
import { SVGS } from './data/svgs.jsx';
import { Ic, hashGen, IcSearch, IcUser, IcBack, IcHeart, IcStar, IcMenu } from './components/ui/Icons.jsx';
import OfferViewingButton from './components/OfferViewingButton.jsx';
import EarlyTermModal from './components/EarlyTermModal.jsx';
import SettingsNotifications from './components/SettingsNotifications.jsx';
import SwitchRoleSection from './components/SwitchRoleSection.jsx';
import CreateListingPlaceholder from './components/CreateListingPlaceholder.jsx';
import TenantIntentBlock from './components/TenantIntentBlock.jsx';
import { lwIcBack, lwIcClose, lwIcCheck, lwIcChevron, lwIcPlus, lwIcImage, lwIcInfo, lwIcWarn, lwIcLock, lwIcShield } from './components/wizard/LwIcons.jsx';
import LwTopBar from './components/wizard/LwTopBar.jsx';
import LwSummary from './components/wizard/LwSummary.jsx';
import LwSticky from './components/wizard/LwSticky.jsx';
import AccountHeader from './components/AccountHeader.jsx';
import UserBadges from './components/UserBadges.jsx';
import WorldIDVerifyButton from './components/WorldIDVerifyButton.jsx';
import ProfileBlock from './components/ProfileBlock.jsx';
import VerifyHuman from './components/VerifyHuman.jsx';
import VerifyFunds from './components/VerifyFunds.jsx';
import SuspensionBanner from './components/SuspensionBanner.jsx';
import LandlordListingsBlock from './components/LandlordListingsBlock.jsx';
import AgreementDocument from './components/AgreementDocument.jsx';
import LwStep3 from './components/wizard/LwStep3.jsx';
import {
  LW_CITIES, LW_CITY_LIST, LW_DISTRICTS, LW_DISTRICT_CENTERS,
  LW_PROPERTY_TYPES, LW_MIN_STAY, LW_QUICK_RENT, LW_PHOTO_CAPTIONS, LW_AMENITY_GROUPS,
  lwCompressImage, LW_DRAFT_KEY, LW_BLANK_STATE
} from './data/wizard-config.js';
import { LEASE_EN } from './lease-text-en.js';
import PrintModal from './components/PrintModal.jsx';
import ContractDocuments from './components/ContractDocuments.jsx';
import ClosureDetailsBlock from './components/ClosureDetailsBlock.jsx';
import EarlyTermResponseForm from './components/EarlyTermResponseForm.jsx';
import FeedPage from './components/FeedPage.jsx';
import { LEASE_RU } from './lease-text-ru.js';
import { LEASE_KA } from './lease-text-ka.js';
import { LEASE_VI } from './lease-text-vi.js';
import { LEASE_ES } from './lease-text-es.js';
import { LEASE_UK } from './lease-text-uk.js';
import { LEASE_PT } from './lease-text-pt.js';
import { LEASE_TH } from './lease-text-th.js';
import {
  checkCoinbaseVerification, isCircleBiometric, checkBinanceBAB,
  WORLDCOIN_APP_ID, WORLDCOIN_ACTION, _loadIDKitGlobal,
  submitWorldIDProof, checkWorldIDVerification,
  getIdentityBadges, getVerificationState,
  ENFORCE_VERIFICATION_GATES, canEnterProtocol, canPublishListing, canSignContract,
} from './services/identity.js';
import { encryptAndUploadContract, fetchAndDecryptContract } from './services/encryption.js';
import BlockchainModal from './components/BlockchainModal.jsx';
import ChatPage from './components/ChatPage.jsx';
import PropertyPage from './components/PropertyPage.jsx';
import MyListingsPage from './components/MyListingsPage.jsx';
import MyIntentPage from './components/MyIntentPage.jsx';
import ListingWizard, { lwDataToState, stateToServer } from './components/ListingWizardFull.jsx';
import { PropDepositBlock, PropDepSection } from './components/PropDepComponents.jsx';
import VerifyIntent from './components/VerifyIntent.jsx';
import WalletPanel from './components/WalletPanel.jsx';
import WalletModal from './components/WalletModal.jsx';
import RealChatPage from './components/RealChatPage.jsx';
import { EarlyTermInboxCard, InboxBlock } from './components/InboxComponents.jsx';
import ActiveContractCard from './components/ActiveContractCard.jsx';
import Dashboard from './components/Dashboard.jsx';
import ContractFlow, { LEASE_TEXTS } from './components/ContractFlow.jsx';
import TenantRequestPage from './components/TenantRequestPage.jsx';
import './app.css';
import { logEventApi, getUser, patchUser, getUserStatus, getListings, getListing, getOwnerListings, createListing, updateListing, deleteListing, publishListing, listingAction, composeDescription, getMessages, sendMessage, createViewingRequest, getActiveContract, getContractForm, saveContractForm, getContractProposals, getCitySettings, uploadFile, uploadListingPhoto, saveUser, saveTenantRequest, getTenantRequests, sendEarlyTerm, respondEarlyTerm, archiveContract, getArchivedContracts, getInbox, getStats, respondViewingRequest, cancelContractProposal, getActiveContracts, verifyWorldId, signContract, createContractProposal, saveActiveContract, publishListingWithSig, uploadIpfsJson, resetAll, deleteUser, resetAccount, apiGet, apiPost, apiPatch, apiDelete } from './api/client.js';

// LEASE_TEXTS moved to ContractFlow.jsx

// ─── STRUCTURED EVENT LOGGING ────────────────────────────────────────────
function logEvent(type, payload = {}) {
  const log = { time: new Date().toISOString(), type, ...payload };
  console.log("[pi2pi-log]", log);
  logEventApi(log);
}

// ─── Acquisition tracking (first page load) ─────────────────────────────────
(() => {
  try {
    if (sessionStorage.getItem("pi2pi_page_viewed")) return; // already tracked this session
    sessionStorage.setItem("pi2pi_page_viewed", "1");
    const params = new URLSearchParams(location.search);
    const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
    logEvent("PAGE_VIEW", {
      action: "page_view",
      data: {
        utm_source: params.get("utm_source") || null,
        utm_medium: params.get("utm_medium") || null,
        utm_campaign: params.get("utm_campaign") || null,
        utm_content: params.get("utm_content") || null,
        referrer: document.referrer || null,
        landingPath: location.pathname,
        device: isMobile ? "mobile" : "desktop",
        userAgent: navigator.userAgent.slice(0, 200),
      },
    });
  } catch {}
})();

const DEV_MODE = false; // Accelerated time mode: contracts run on compressed timelines for testing
const SHOW_RESET = import.meta.env.VITE_ENABLE_ACCOUNT_RESET === "true" || location.hostname === "localhost";

// CSS extracted to app.css (Phase D)

// ─── LUCIDE-STYLE INLINE ICONS (replaces emoji in UI chrome) ──────────────────
// Ic extracted to ./components/ui/Icons.jsx

// ─── DEAL STATE VIEW — pure function from State Map v1.0 (Sprint 9) ──
// Maps on-chain Agreement struct + timestamp to a typed UI view.
// States in priority order (higher overrides lower):
//   7 DisputeOpen → dispute   (danger)
//   6 DamageClaimed → damage  (danger, deprecated — now in PropDep)
//   9 LeaseEnded → ended      (warning, pending PropDep inspection)
//   4 EarlyTermProposed → et  (warning)
//   5 CheckoutProposed → checkout (warning)
//   3 Active + ≤14d left → ending (warning)
//   3 Active (overdue) → overdue (danger) [not fully detected — rentDue check TBD]
//   3 Active → live           (success)
//   0-2 Created/AwaitingX → provisional (info)
//   8 Settled → settled        (neutral)
// Format a countdown in human "Nd Nh Nm" or "Nh Nm" or "Nm" — short form.

// DealStateBanner extracted to ./components/ui/DealStateBanner.jsx
// Dropdown extracted to ./components/ui/Dropdown.jsx

// ExpandableInfo extracted to ./components/ui/ExpandableInfo.jsx

// AVATARS, AvatarBox, SVGS extracted to data/avatars.jsx, data/svgs.jsx, components/AvatarBox.jsx

// ─── ICONS ────────────────────────────────────────────────────────────────────
// hashGen, IcSearch..IcMenu extracted to ./components/ui/Icons.jsx


// Identity verification extracted to ./services/identity.js

// Lit Protocol encryption extracted to ./services/encryption.js

// BlockchainModal extracted to ./components/BlockchainModal.jsx

// LeaseReader removed (dead code — not referenced anywhere)
// LightboxViewer extracted to ./components/LightboxViewer.jsx
// ─── CONTRACT FLOW ────────────────────────────────────────────────────────────
// ContractFlow extracted to ./components/ContractFlow.jsx

// ChatPage extracted to ./components/ChatPage.jsx

// PropertyPage extracted to ./components/PropertyPage.jsx


// ─── CREATE LISTING ───────────────────────────────────────────────────────────
// CreateListing removed in M4 (2026-04-16). Replaced by ListingWizard in M5.
// Placeholder rendered when view==="create" until wizard ships.
// CreateListingPlaceholder extracted to ./components/CreateListingPlaceholder.jsx

// ─── LISTING WIZARD (M5, 2026-04-16) ─────────────────────────────────────────
// LW_CITIES, LW_* constants, lwCompressImage extracted to ./data/wizard-config.js

// lwIc* extracted to ./components/wizard/LwIcons.jsx

// LwTopBar extracted to ./components/wizard/LwTopBar.jsx

// LwSummary extracted to ./components/wizard/LwSummary.jsx

// LwSticky extracted to ./components/wizard/LwSticky.jsx

// ─── STEP 1 ─────────────────────────────────────────────────────────────────
// ListingWizard + LwSteps extracted to ./components/ListingWizardFull.jsx

// ─── MY LISTINGS PAGE (M6) ────────────────────────────────────────────────────
// MyListingsPage extracted to ./components/MyListingsPage.jsx

// ─── MY INTENT PAGE (M6) ──────────────────────────────────────────────────────
// MyIntentPage extracted to ./components/MyIntentPage.jsx


// Info extracted to ./components/ui/Info.jsx
// ─── M7: Dashboard inserts ────────────────────────────────────────────────────

// Landlord block: empty banner OR compact summary (1 line) with tap → My listings
// LandlordListingsBlock extracted to ./components/LandlordListingsBlock.jsx

// Tenant: compact 1-line intent summary, tap → My intent page. CTA if no intent yet.
// TenantIntentBlock extracted to ./components/TenantIntentBlock.jsx

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
// ─── ACCOUNT HEADER — compact profile block ─────────────────────────────────
// AccountHeader extracted to ./components/AccountHeader.jsx

// Reusable UserBadges component — shows identity verification badges for any address
// Used in profile, feed cards, contract details, listings
// UserBadges extracted to ./components/UserBadges.jsx

// PKCE helper for OAuth/OIDC code flow
const _generatePKCE = async () => {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const verifier = btoa(String.fromCharCode.apply(null, random))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode.apply(null, new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return { verifier, challenge };
};

// World ID Verify Button — uses bundled IDKit standalone (window.IDKit global)
// Standalone World ID verification trigger — used by both WorldIDVerifyButton
// and inline chip rows. Single source of truth for IDKit init + backend call.
async function triggerWorldIDVerify(myAddr, onVerified, setBusy, setErrorMsg) {
  if (!myAddr) return;
  if (setBusy) setBusy(true);
  if (setErrorMsg) setErrorMsg(null);
  try {
    const IDKit = await _loadIDKitGlobal();
    console.log("[worldid] IDKit ready");
    IDKit.init({
      app_id: WORLDCOIN_APP_ID,
      action: WORLDCOIN_ACTION,
      verification_level: "device",
      handleVerify: async (proof) => {
        console.log("[worldid] proof received");
        const r = await verifyWorldId({
            addr: myAddr,
            proof: proof.proof,
            merkle_root: proof.merkle_root,
            nullifier_hash: proof.nullifier_hash,
            verification_level: proof.verification_level,
          });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          console.error("[worldid] backend rejected:", err);
          throw new Error(err.message || err.error || "Backend verification failed");
        }
      },
      onSuccess: () => {
        console.log("[worldid] verification success");
        if (onVerified) onVerified();
      },
      onError: (e) => {
        console.error("[worldid] error:", e);
        if (setErrorMsg) setErrorMsg(e?.message || "Verification failed");
      },
    });
    IDKit.open();
  } catch (e) {
    console.error("[worldid] trigger failed:", e);
    if (setErrorMsg) setErrorMsg(e.message || "Failed to load World ID");
  } finally {
    if (setBusy) setBusy(false);
  }
}

// WorldIDVerifyButton extracted to ./components/WorldIDVerifyButton.jsx

// ProfileBlock extracted to ./components/ProfileBlock.jsx

// ─── REPUTATION SCORE ─────────────────────────────────────────────────────────
// RepScore extracted to ./components/ui/RepScore.jsx

// ─── EVENT TOPICS — for reading on-chain financial history ────────────────────
const EVT = {
  DepositPlaced:        "0xf6d82847ae02826984c79c535f5f390400bdfd4c3f98803dbfbbc0fb15770b88",
  AgreementActivated:   "0xc028729348667f2b92e145e0011d7062e3fe0f26ba820051b955a98c46489a0d",
  RentPaid:             "0xa62c35dfc0ff11d3713608ebcdc5c5d1952c7702620f2c46c22950f7b70d5797",
  BondPosted:           "0xafde4e40131ac495ebb0e64c79232bb8e3829156d0fba713d597c0735865d873",
  AgreementSettled:     "0x1970c22e337565408654f9069320d0ef9054de15c76717d62a6667579cfedba4",
  AgreementRenewed:     "0xd4bf9451344da2d45bfeb2f6426cc99b903a54dd7a88f895acfc34acb971fdb1",
  // PropDepEscrow events:
  PropDepCreated:       "0x51ab852c06860f6306b9918e428a43fee64f16e3dd31f0ed602d455f98bcb6a9",
  DamageClaimFiled:     "0x5e6645249da873680bb986163079d85e83511f004d257d1d313bde5b13496efd",
  DamageClaimAccepted:  "0xc6bab660ef72fadcdfaaa2d00b4bccdf3f714300d8926cc9c1ae1358a30c4bff",
  DamageClaimDisputed:  "0x6bff80b50f36e82777ef758d96dcf64a8a4fcb4ba0b2dcec390498adf81702b2",
  DamageClaimDropped:   "0xd97c332ba296636f61bcb746edf66fd4eec966d7ea6b852f4c435ff3d5a95532",
  PropDepSettled:       "0x9ecd6f6a38ebbc0c63f4fd200fe28cc40b86b66dc302a786f6f9da97035be761",
};

// Decode an indexed uint256 from topic[1]
const decodeTopicUint = (topic) => parseInt(topic, 16);
// Decode an indexed address from topic
const decodeTopicAddr = (topic) => "0x" + topic.slice(26);

// Read all financial events for a given agreement from both contracts.
// Returns array of { blockNumber, txHash, kind, description, amount, party } sorted ascending.
async function loadFinancialEvents(agreementId) {
  if (agreementId === undefined || agreementId === null) return [];
  const idHex = "0x" + BigInt(agreementId).toString(16).padStart(64, "0");
  // Arc Testnet limits eth_getLogs to 10k blocks per request.
  // Paginate backwards from latest in 10k chunks until we find agreement events or exhaust reasonable range.
  const latestHex = await rpcCall("eth_blockNumber", []);
  const latest = parseInt(latestHex, 16);
  const CHUNK = 9500;
  const MAX_CHUNKS = 50; // look back ~475K blocks max (sufficient for recent contracts)
  const out = [];
  const allLogsEscrow = [];
  const allLogsPropDep = [];

  // Chunk fetcher
  const fetchChunks = async (address, results) => {
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const to = latest - i * CHUNK;
      const from = Math.max(0, to - CHUNK + 1);
      try {
        const logs = await rpcCall("eth_getLogs", [{
          fromBlock: "0x" + from.toString(16),
          toBlock: "0x" + to.toString(16),
          address,
          topics: [null, idHex],
        }]);
        if (logs && logs.length) results.push(...logs);
      } catch(e) { break; }
      if (from === 0) break;
    }
  };

  // Helper to decode log data words
  const dataWord = (data, i) => parseInt(data.slice(2 + i*64, 2 + (i+1)*64), 16);

  // Fetch RentalEscrow logs (paginated)
  await fetchChunks(ESCROW_ADDRESS, allLogsEscrow);
  try {
    for (const log of allLogsEscrow) {
      const topic0 = (log.topics[0] || "").toLowerCase();
      const data = log.data || "0x";
      let entry = { blockNumber: parseInt(log.blockNumber, 16), txHash: log.transactionHash, kind: "?", description: "Unknown event", amount: null };
      if (topic0 === EVT.DepositPlaced.toLowerCase()) {
        const party = decodeTopicAddr(log.topics[2]);
        const amount = dataWord(data, 0) / 1e6;
        // Parse depositType (dynamic string): offset at word 1, then len, then data
        let depositType = "deposit";
        try {
          const strOffset = dataWord(data, 1); // bytes offset from start of data
          const len = parseInt(data.slice(2 + strOffset*2, 2 + strOffset*2 + 64), 16);
          const strHex = data.slice(2 + strOffset*2 + 64, 2 + strOffset*2 + 64 + len*2);
          let s = "";
          for (let i = 0; i < strHex.length; i += 2) s += String.fromCharCode(parseInt(strHex.slice(i, i+2), 16));
          if (s) depositType = s;
        } catch(e){}
        // Pretty name: "commitment" → "Commitment Deposit (Tenant)", etc.
        const prettyMap = {
          commitment: "Commitment Deposit — Tenant",
          hosting: "Hosting Deposit — Landlord",
          property_security: "Property Security Deposit — Tenant",
          property: "Property Security Deposit — Tenant",
        };
        const prettyName = prettyMap[depositType] || (depositType.charAt(0).toUpperCase() + depositType.slice(1) + " Deposit");
        entry = { ...entry, kind: "deposit", description: prettyName + " placed", amount, from: party, to: ESCROW_ADDRESS, depositType };
      } else if (topic0 === EVT.AgreementActivated.toLowerCase()) {
        const activatedAt = dataWord(data, 0);
        entry = { ...entry, kind: "activated", description: "Agreement activated. First rent paid by tenant directly to landlord.", timestamp: activatedAt };
      } else if (topic0 === EVT.RentPaid.toLowerCase()) {
        const month = dataWord(data, 0);
        const amount = dataWord(data, 1) / 1e6;
        entry = { ...entry, kind: "rent", description: "Rent paid (month " + month + ")", amount };
      } else if (topic0 === EVT.BondPosted.toLowerCase()) {
        const poster = decodeTopicAddr(log.topics[2]);
        const amount = dataWord(data, 0) / 1e6;
        entry = { ...entry, kind: "bond", description: "Deposit frozen (RentalEscrow)", amount, from: poster };
      } else if (topic0 === EVT.AgreementSettled.toLowerCase()) {
        // string reason — read length and bytes
        const lenOffset = dataWord(data, 0); // offset of string in data
        const len = parseInt(data.slice(2 + lenOffset*2, 2 + lenOffset*2 + 64), 16);
        const strHex = data.slice(2 + lenOffset*2 + 64, 2 + lenOffset*2 + 64 + len*2);
        let reason = "";
        for (let i = 0; i < strHex.length; i += 2) reason += String.fromCharCode(parseInt(strHex.slice(i, i+2), 16));
        entry = { ...entry, kind: "settled", description: "Agreement settled — " + reason };
      } else if (topic0 === EVT.AgreementRenewed.toLowerCase()) {
        entry = { ...entry, kind: "renewed", description: "Lease renewed for another term" };
      } else {
        continue; // unknown event in our event list
      }
      out.push(entry);
    }
  } catch(e){ console.error("RentalEscrow logs failed", e); }

  // Fetch PropDepEscrow logs (paginated)
  await fetchChunks(PROPDEP_ADDRESS, allLogsPropDep);
  try {
    for (const log of allLogsPropDep) {
      const topic0 = (log.topics[0] || "").toLowerCase();
      const data = log.data || "0x";
      let entry = { blockNumber: parseInt(log.blockNumber, 16), txHash: log.transactionHash, kind: "?", description: "Unknown event", amount: null };
      if (topic0 === EVT.PropDepCreated.toLowerCase()) {
        continue; // Skip: duplicates Property Security Deposit — Tenant placed from RentalEscrow
      } else if (topic0 === EVT.DamageClaimFiled.toLowerCase()) {
        const amount = dataWord(data, 0) / 1e6;
        entry = { ...entry, kind: "claim_filed", description: "Damage claim filed by landlord", amount };
      } else if (topic0 === EVT.DamageClaimAccepted.toLowerCase()) {
        const amount = dataWord(data, 0) / 1e6;
        entry = { ...entry, kind: "claim_accepted", description: "Damage claim accepted by tenant", amount };
      } else if (topic0 === EVT.DamageClaimDisputed.toLowerCase()) {
        entry = { ...entry, kind: "claim_disputed", description: "Damage claim disputed by tenant" };
      } else if (topic0 === EVT.DamageClaimDropped.toLowerCase()) {
        entry = { ...entry, kind: "claim_dropped", description: "Damage claim dropped" };
      } else if (topic0 === EVT.BondPosted.toLowerCase()) {
        const poster = decodeTopicAddr(log.topics[2]);
        const amount = dataWord(data, 0) / 1e6;
        entry = { ...entry, kind: "bond", description: "Deposit frozen (PropDep)", amount, from: poster };
      } else if (topic0 === EVT.PropDepSettled.toLowerCase()) {
        const lenOffset = dataWord(data, 0);
        const len = parseInt(data.slice(2 + lenOffset*2, 2 + lenOffset*2 + 64), 16);
        const strHex = data.slice(2 + lenOffset*2 + 64, 2 + lenOffset*2 + 64 + len*2);
        let reason = "";
        for (let i = 0; i < strHex.length; i += 2) reason += String.fromCharCode(parseInt(strHex.slice(i, i+2), 16));
        entry = { ...entry, kind: "propdep_settled", description: "PropDep settled — " + reason };
      } else {
        continue;
      }
      out.push(entry);
    }
  } catch(e){ console.error("PropDepEscrow logs failed", e); }

  // Sort by blockNumber ascending
  out.sort((a, b) => a.blockNumber - b.blockNumber);
  return out;
}

// PrintModal extracted to ./components/PrintModal.jsx


// EarlyTermInboxCard + InboxBlock extracted to ./components/InboxComponents.jsx

// ActiveContractCard extracted to ./components/ActiveContractCard.jsx



// Dashboard extracted to ./components/Dashboard.jsx

// WalletModal extracted to ./components/WalletModal.jsx


// ─── ERROR BOUNDARY ──────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return (
      React.createElement("div", {style:{padding:"40px 20px",textAlign:"center",fontFamily:"var(--ff)"}},
        React.createElement("div", {style:{fontSize:40,marginBottom:12}}, ""),
        React.createElement("h2", {style:{marginBottom:8}}, "Something went wrong"),
        React.createElement("pre", {style:{fontSize:11,color:"var(--color-danger)",background:"var(--color-danger-surface)",padding:12,borderRadius:10,textAlign:"left",whiteSpace:"pre-wrap",maxWidth:400,margin:"0 auto"}}, this.state.error?.message || "Unknown error"),
        React.createElement("button", {style:{marginTop:16,padding:"10px 24px",background:"var(--color-danger)",color:"white",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"},onClick:()=>{this.setState({error:null});}}, "Retry")
      )
    );
    return this.props.children;
  }
}

// ─── REAL CHAT ───────────────────────────────────────────────────────────────
// RealChatPage extracted to ./components/RealChatPage.jsx


// ─── WALLET PANEL ─────────────────────────────────────────────────────────────
// WalletPanel extracted to ./components/WalletPanel.jsx


// ─── SUSPENSION BANNER ────────────────────────────────────────────────────────
// SuspensionBanner extracted to ./components/SuspensionBanner.jsx

// ─── APP ──────────────────────────────────────────────────────────────────────
// ContractTimer extracted to ./components/ContractTimer.jsx

export default function App() {
  // Force reload if contract version changed (stale tab protection)
  useEffect(() => {
    const saved = localStorage.getItem("pi2pi_contract_version");
    if (saved && Number(saved) !== CONTRACT_VERSION) {
      localStorage.setItem("pi2pi_contract_version", String(CONTRACT_VERSION));
      window.location.reload();
      return;
    }
    localStorage.setItem("pi2pi_contract_version", String(CONTRACT_VERSION));
  }, []);

  // Global toast for wallet.js errors (dispatched via CustomEvent 'app:toast')
  const [globalToasts, setGlobalToasts] = useState([]);
  const removeGlobalToast = useCallback((id) => setGlobalToasts(prev => prev.filter(t => t.id !== id)), []);
  useEffect(() => {
    const handler = (e) => {
      const { msg, kind } = e.detail || {};
      if (!msg) return;
      setGlobalToasts(prev => [...prev, { id: Date.now() + Math.random(), msg, kind: kind || "error" }]);
    };
    window.addEventListener("app:toast", handler);
    return () => window.removeEventListener("app:toast", handler);
  }, []);

  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState("tenant");

  // ─── URL-based navigation (React Router) ────────────────────────────────────
  // Parse URL → nav/view state
  const parseRoute = (path) => {
    if (!path || path === "/") return { nav: "feed", view: null };
    if (path === "/inbox") return { nav: "inbox", view: null };
    if (path === "/deals") return { nav: "deals", view: null };
    if (path === "/account") return { nav: "account", view: null };
    if (path === "/create") return { nav: "deals", view: "create" };
    if (path.startsWith("/create/edit/")) return { nav: "deals", view: "create", param: path.split("/")[3] };
    if (path === "/my-listings") return { nav: "deals", view: "my-listings" };
    if (path === "/my-intent") return { nav: "deals", view: "my-intent" };
    if (path.startsWith("/tenant/")) return { nav: "feed", view: "tenant-request", param: path.split("/")[2] };
    if (path.startsWith("/listing/")) return { nav: "feed", view: "prop", param: path.split("/")[2] };
    if (path.startsWith("/chat/r/")) return { nav: "inbox", view: "real-chat", param: path.split("/")[3] };
    if (path.startsWith("/chat/")) return { nav: "feed", view: "chat", param: path.split("/")[2] };
    if (path.startsWith("/contract/r/")) return { nav: "deals", view: "real-contract", param: path.split("/")[3] };
    if (path.startsWith("/contract/")) return { nav: "feed", view: "contract", param: path.split("/")[2] };
    return { nav: "feed", view: null };
  };

  const route = parseRoute(location.pathname);
  const [nav, _setNav] = useState(route.nav);
  const [view, _setView] = useState(route.view);

  // Sync URL → state (back/forward button)
  const prevPathRef = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname !== prevPathRef.current) {
      prevPathRef.current = location.pathname;
      const r = parseRoute(location.pathname);
      _setNav(r.nav);
      _setView(r.view);
      // Restore listing/chatPeer from URL params
      if (r.view === "prop" || r.view === "chat" || r.view === "contract") {
        // TASK 10AK: see matching note on the listing useState initializer above.
        const isMockId = ACTIVE_NETWORK_NAME === 'arc-testnet' && /^\d+$/.test(r.param);
        if (isMockId) {
          setListing(LISTINGS.find(l => l.id === parseInt(r.param)) || LISTINGS[0]);
        } else if (r.param) {
          // UUID — real listing, restore from sessionStorage or fetch from server
          try {
            const saved = sessionStorage.getItem("pi2pi_listing_" + r.param);
            if (saved) { setListing(JSON.parse(saved)); }
            else {
              const cleanId = r.param.startsWith("real-") ? r.param.slice(5) : r.param;
              getListing(cleanId).then(l => {
                if (l && l.id) {
                  const mapped = {
                    ...l, id: l.id,
                    title: `${l.propertyType || "Property"} in ${(l.city || l.district || "").split(",")[0]}`,
                    location: l.city || l.district || "",
                    price: Number(l.monthlyRent) || 0,
                    image: l.photos?.[0]?.url || (l.photos?.[0]?.cid ? `/api/ipfs/file/${l.photos[0].cid}` : null),
                    _photos: l.photos || [],
                    _realUser: true,
                    host: l.ownerName || l.ownerAddr?.slice(0,6)+"…",
                    contract: l.ownerAddr,
                    beds: l.bedrooms || 1, baths: l.bathrooms || 1, sqm: l.area || 0,
                    rating: "5.0", reviews: 0, tag: "New",
                    amenities: l.amenities || [], desc: l.description || "",
                    lat: l.lat, lng: l.lng, zoneLat: l.zoneLat, zoneLng: l.zoneLng,
                  };
                  setListing(mapped);
                  try { sessionStorage.setItem("pi2pi_listing_" + l.id, JSON.stringify(mapped)); } catch {}
                }
              }).catch(() => {});
            }
          } catch {}
        }
      }
      if (r.view === "real-chat" || r.view === "real-contract") {
        setChatPeer(r.param || null);
      }
    }
  }, [location.pathname]);

  // Navigation helpers — update state + URL
  const setNav = (v) => {
    _setNav(v);
    _setView(null);
    const url = v === "feed" ? "/" : "/" + v;
    navigate(url);
    window.scrollTo(0, 0);
  };
  const setView = (v) => {
    _setView(v);
    if (!v) {
      navigate(nav === "feed" ? "/" : "/" + nav);
    }
    // URL for specific views is set at call sites via navigateTo()
  };
  // Navigate to a view with URL
  const navigateTo = (path) => {
    const r = parseRoute(path);
    _setNav(r.nav);
    _setView(r.view);
    navigate(path);
  };

  const [listing, setListing] = useState(() => {
    if (route.view === "prop" || route.view === "chat" || route.view === "contract") {
      // TASK 10AK: numeric mock listing IDs only resolve on arc-testnet —
      // on arc-mainnet a numeric route.param falls through to the real-ID
      // fetch path below (same as a UUID that doesn't resolve), landing on
      // the existing "listing not found" state rather than a demo listing.
      const isMockId = ACTIVE_NETWORK_NAME === 'arc-testnet' && /^\d+$/.test(route.param);
      if (isMockId) return LISTINGS.find(l => l.id === parseInt(route.param)) || LISTINGS[0];
      // UUID (or, on mainnet, a numeric id) — will be fetched from server in useEffect below
    }
    return null;
  });
  // TASK 10AL: single point of truth for "what listing do we show when the
  // real one isn't loaded" — arc-testnet keeps the mock[0] safety net
  // (demo/UX convenience, pre-existing behavior), arc-mainnet has none, so
  // ChatPage/PropertyPage/ContractFlow only ever render with a real listing
  // or not at all (both of those components read listing.* fields with no
  // null-check of their own, so rendering them with a null listing would
  // throw — the guards below avoid that without inventing new UI).
  const mockFallbackListing = ACTIVE_NETWORK_NAME === 'arc-testnet' ? LISTINGS[0] : null;
  const effectiveListing = listing || mockFallbackListing;
  // Fetch listing from server on initial load (QR code links)
  useEffect(() => {
    const isUUID = route.param && !/^\d+$/.test(route.param);
    if (isUUID && route.view === "prop") {
      // Always fetch fresh — ignore stale sessionStorage/state
      setListing(null);
      const cleanId = route.param.startsWith("real-") ? route.param.slice(5) : route.param;
      getListing(cleanId).then(l => {
        if (l && l.id) {
          const mapped = {
            ...l, id: l.id,
            title: `${l.propertyType || "Property"} in ${(l.city || l.district || "").split(",")[0]}`,
            location: l.city || l.district || "",
            price: Number(l.monthlyRent) || 0,
            image: l.photos?.[0]?.url || (l.photos?.[0]?.cid ? `/api/ipfs/file/${l.photos[0].cid}` : null),
            _photos: l.photos || [],
            _realUser: true,
            host: l.ownerName || l.ownerAddr?.slice(0,6)+"…",
            contract: l.ownerAddr,
            beds: l.bedrooms || 1, baths: l.bathrooms || 1, sqm: l.area || 0,
            rating: "5.0", reviews: 0, tag: "New",
            amenities: l.amenities || [], desc: l.description || "",
            lat: l.lat, lng: l.lng, zoneLat: l.zoneLat, zoneLng: l.zoneLng,
          };
          setListing(mapped);
          try { sessionStorage.setItem("pi2pi_listing_" + l.id, JSON.stringify(mapped)); } catch {}
        }
      }).catch(() => {});
    }
  }, []);
  const [editListing, setEditListing] = useState(null);
  const [showWallet, setShowWallet] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWalletPanel, setShowWalletPanel] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [showProtocol, setShowProtocol] = useState(false);
  const [walletHint, setWalletHint] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const effectiveUnread = unreadCount;
  const dismissInbox = () => {
    // No-op — badge reflects live actionable count, resets when actions are resolved
  };
  const [activeContract, setActiveContract] = useState(null);
  const [activeContractChecked, setActiveContractChecked] = useState(false);
  const [archivePrint, setArchivePrint] = useState(null); // {agreementId, myAddr, peerAddr, role}
  useEffect(() => {
    const handler = (e) => setArchivePrint(e.detail);
    window.addEventListener("pi2pi-open-print", handler);
    return () => window.removeEventListener("pi2pi-open-print", handler);
  }, []);
  const [viewingRequestedListing, setViewingRequestedListing] = useState(null);
  const [chatOpenedListing, setChatOpenedListing] = useState(null);
  const [inboxMsgs, setInboxMsgs] = useState(null); // null = use default INBOX
  // Bookmarks — saved listings (tenant) / saved tenants (landlord)
  const [bookmarks, setBookmarks] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pi2pi_bookmarks") || "[]"); } catch { return []; }
  });
  const toggleBookmark = (item) => {
    setBookmarks(prev => {
      // Determine type: if item has price/title/location — it's a listing, if it has mr/name/area — tenant
      const type = item._bookmarkType || (item.price !== undefined || item.title ? "listing" : "tenant");
      const exists = prev.some(b => b.id === item.id && b.type === type);
      const next = exists ? prev.filter(b => !(b.id === item.id && b.type === type)) : [...prev, { id: item.id, type, name: item.title || item.name, location: item.location || item.area, price: item.price || item.mr, image: item.image || null, verified: item.verified || false, propertyType: item.propertyType || null, duration: item.duration || null }];
      try { localStorage.setItem("pi2pi_bookmarks", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const isBookmarked = (id, type) => bookmarks.some(b => b.id === id && b.type === type);
  const [chatPeer, _setChatPeer] = useState(() => {
    // Restore from URL first (deep link), then sessionStorage fallback
    const r = parseRoute(location.pathname);
    if ((r.view === "real-chat" || r.view === "real-contract") && r.param) return r.param;
    try { return sessionStorage.getItem("pi2pi_chatPeer") || null; } catch(e) { return null; }
  });
  const setChatPeer = (v) => { _setChatPeer(v); try { if (v) sessionStorage.setItem("pi2pi_chatPeer", v); else sessionStorage.removeItem("pi2pi_chatPeer"); } catch(e){} };
  // Listen for "open chat" events from anywhere in the app
  useEffect(() => {
    const handler = (e) => {
      const peer = e?.detail?.peer;
      if (!peer) return;
      setChatPeer(peer);
      navigateTo("/chat/r/" + peer);
    };
    window.addEventListener("pi2pi-open-chat", handler);
    return () => window.removeEventListener("pi2pi-open-chat", handler);
  }, []);
  // Listen for "open new agreement form" — bypasses chat, opens contract wizard directly
  useEffect(() => {
    const handler = (e) => {
      const peer = e?.detail?.peer;
      if (!peer) return;
      setChatPeer(peer);
      navigateTo("/contract/r/" + peer);
    };
    window.addEventListener("pi2pi-new-agreement", handler);
    return () => window.removeEventListener("pi2pi-new-agreement", handler);
  }, []);
  // EarlyTermInboxCard persistent state — survives Explore↔Account navigation
  const [earlyTermState, setEarlyTermState] = useState({});
  const closeContract = async (reason) => {
    setActiveContract(prev => prev ? {...prev, closed:true, closedReason: reason||"completed"} : prev);
    // Archive on server with reason
    try {
      let addr = user?.addr;
      if (!addr || addr.includes("…") || addr.length < 42) {
        const accs = await window.ethereum?.request({method:"eth_accounts"});
        if (accs?.[0]) addr = accs[0];
      }
      if (addr) await archiveContract(addr);
    } catch {}
  };

  // Save active contract to state + server
  const saveContract = async (contractData) => {
    setActiveContract(contractData);
    try {
      let addr = user?.addr;
      if (!addr || addr.includes("…") || addr.length < 42) {
        const accs = await window.ethereum?.request({method:"eth_accounts"});
        if (accs?.[0]) addr = accs[0];
      }
      if (addr) {
        await saveActiveContract({ addr, ...contractData, listing: { title: contractData.listing?.title, price: contractData.listing?.price, location: contractData.listing?.location, contract: contractData.listing?.contract } });
      }
    } catch(e){}
  };

  const openWallet = (hint="") => { setWalletHint(hint); setShowWallet(true); };
  const [user, setUser] = useState(null);
  const [suspendedInfo, setSuspendedInfo] = useState(null); // {suspended, balance, required, role}
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [userMenuRect, setUserMenuRect] = useState(null);
  const menuBtnRef = React.useRef(null);

  useEffect(() => {
    // CSS loaded via <link> in index.html (app.css)
    // Ensure correct viewport meta for mobile
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement("meta");
      vp.name = "viewport";
      document.head.appendChild(vp);
    }
    vp.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
    // Auto-sync localStorage users to shared server (only those with listing data)
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith("pi2pi_user_"))
        .forEach(k => {
          try {
            const data = JSON.parse(localStorage.getItem(k));
            if (data && data.addr && data.role && data.listing && data.signature) {
              saveUser(data).catch(()=>{});
            }
          } catch(e){}
        });
    } catch(e){}
    // Auto-login: check Circle session FIRST, then MetaMask/WC fallback
    (async () => {
      // Respect explicit logout — if user pressed Disconnect, don't auto-restore
      try {
        if (localStorage.getItem("pi2pi_logged_out") === "1") return;
      } catch (e) {}

      // Restore auth session from cookie (no new signature needed)
      try {
        const { authCheckSession } = await import('./api/client.js');
        const session = await authCheckSession();
        if (session.authenticated && window.pi2piWallet) {
          window.pi2piWallet._authenticated = true;
          console.log("[auth] session restored from cookie for", session.addr?.slice(0,8));
        }
      } catch {}

      // === Circle Modular Wallet SILENT restore ===
      // CRITICAL: WebAuthn (passkey) requires a USER GESTURE (button click).
      // Pull-to-refresh / page reload is NOT a gesture, so iOS rejects any
      // WebAuthn call from useEffect with "user denied permission". Therefore
      // auto-restore must NOT call connectCircleWallet here.
      //
      // Instead: read the session + profile from localStorage, set React
      // state directly (logged-in feel), and mark the wallet as "pending
      // reconnect". When the user later clicks something that needs signing,
      // THAT click is a valid gesture and we recreate the SCA via passkey.
      try {
        const circleSession = localStorage.getItem("pi2pi_circle_session");
        console.log("[pi2pi/circle] silent restore: session in localStorage?", !!circleSession);
        if (circleSession) {
          const parsedSession = JSON.parse(circleSession);
          const addr = parsedSession.address;
          console.log("[pi2pi/circle] silent restore: restoring user for", addr);

          let saved = null;
          try { saved = localStorage.getItem("pi2pi_user_" + addr.toLowerCase()); } catch(e){}
          if (!saved) {
            try {
              const resp = { ok: true, json: () => getUser(addr) };
              const data = await resp.json();
              if (data && data.role) saved = JSON.stringify(data);
            } catch(e){}
          }

          if (saved) {
            const parsedUser = JSON.parse(saved);
            const short = addr.slice(0,6)+"…"+addr.slice(-4);
            // Only restore full React user state if backend auth session is valid
            if (window.pi2piWallet?._authenticated) {
              console.log("[pi2pi/circle] silent restore: authenticated, applying user state, role:", parsedUser.role);
              setRole(parsedUser.role);
              setUser({ name: short, addr: addr, role: parsedUser.role, isNew: false });
            } else {
              console.log("[pi2pi/circle] silent restore: NOT authenticated, skipping user state");
            }
            // Don't setNav("feed") — let sessionStorage restore keep the user on their current screen
            // Mark wallet adapter as "pending circle reconnect"; signing flows
            // will call connectCircleWallet on first user action (which IS a
            // valid WebAuthn user gesture).
            try {
              if (window.pi2piWallet) {
                window.pi2piWallet._circleAddress = addr;
                window.pi2piWallet._circlePendingReconnect = true;
                window.pi2piWallet._circleSessionUsername = parsedSession.username;
                window.pi2piWallet.type = "circle";
                // Lazy-reconnect provider stub. When the user clicks something
                // that needs signing (e.g. createAgreement), this stub's .request
                // is called inside a real user gesture. It then awaits
                // connectCircleWallet (which will trigger one passkey prompt),
                // installs the real EIP-1193 wrapper, and forwards the request.
                // After first call, all subsequent .request calls go straight to
                // the real wrapper.
                const wallet = window.pi2piWallet;
                // Read-only RPC methods that DON'T require passkey — proxy them
                // straight to Arc Testnet RPC. Without this list, even balance
                // checks and contract reads would trigger Touch ID/FaceID on
                // every page load.
                const READ_ONLY_METHODS = new Set([
                  "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_blockNumber",
                  "eth_getBlockByNumber", "eth_getBlockByHash",
                  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getTransactionCount",
                  "eth_getLogs", "eth_getBalance", "eth_getCode", "eth_getStorageAt",
                  "eth_feeHistory", "eth_maxPriorityFeePerGas", "net_version",
                ]);
                const SIGNING_METHODS = new Set([
                  "eth_sendTransaction", "eth_signTransaction", "personal_sign",
                  "eth_sign", "eth_signTypedData", "eth_signTypedData_v4",
                ]);
                const directRpc = async (method, params) => {
                  const resp = await fetch(RPC_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params || [] }),
                  });
                  const j = await resp.json();
                  if (j.error) throw new Error(j.error.message || "RPC error");
                  return j.result;
                };
                const stubProvider = {
                  request: async (args) => {
                    const method = args && args.method;
                    const params = args && args.params;
                    console.log("[pi2pi/circle] lazy stub request:", method);
                    // Identity methods — answer immediately, no RPC, no passkey
                    if (method === "eth_accounts") return [wallet._circleAddress];
                    if (method === "eth_requestAccounts") return [wallet._circleAddress];
                    if (method === "eth_chainId") return "0x" + ARC_CHAIN_ID_DEC.toString(16);
                    if (method === "wallet_switchEthereumChain") return null;
                    if (method === "wallet_addEthereumChain") return null;
                    // Read-only blockchain queries — direct RPC, no passkey
                    if (READ_ONLY_METHODS.has(method)) {
                      return await directRpc(method, params);
                    }
                    // Signing methods — lazy-reconnect via passkey (this IS a user gesture)
                    if (SIGNING_METHODS.has(method) && wallet._circlePendingReconnect) {
                      console.log("[pi2pi/circle] lazy reconnect: triggering passkey for signing");
                      wallet._circlePendingReconnect = false;
                      wallet.provider = null;
                      wallet.type = null;
                      // Lazy reconnect — pass saved username from session if available,
                      // otherwise let connectCircleWallet pick from localStorage
                      await wallet.connectCircleWallet(wallet._circleSessionUsername ? { username: wallet._circleSessionUsername } : {});
                      if (wallet.provider && wallet.provider !== stubProvider) {
                        return await wallet.provider.request(args);
                      }
                      throw new Error("Circle lazy reconnect failed");
                    }
                    // Unknown method — try direct RPC as best-effort
                    console.warn("[pi2pi/circle] lazy stub: unknown method, trying direct RPC:", method);
                    return await directRpc(method, params);
                  },
                };
                wallet.provider = stubProvider;
              }
            } catch(e){}
            try {
              const cResp = { ok: true, json: () => getActiveContract(addr) };
              const cData = await cResp.json();
              if (cData && cData.listing && !cData.archived) {
                setActiveContract({ ...cData, signedAt: cData.signedAt ? new Date(cData.signedAt) : new Date() });
              }
            } catch(e){} finally { setActiveContractChecked(true); }
            console.log("[pi2pi/circle] silent restore: COMPLETE");
            return; // Skip MetaMask path
          }
          console.log("[pi2pi/circle] silent restore: no profile found, skipping");
        }
      } catch (e) {
        console.warn("[pi2pi/circle] silent restore outer error:", e && e.message);
      }

      // === MetaMask / WalletConnect auto-restore (existing path) ===
      // Resolve addr from eth_accounts OR fallback to last known addr in localStorage.
      // On iPhone Safari with WalletConnect, eth_accounts may be empty right after page
      // reload (WC client not yet initialized), but we still want to show the user as
      // logged in based on cached profile.
      let restoreAddr = null;
      if (window.ethereum) {
        try {
          const accs = await (getProvider()||window.ethereum)?.request({ method: "eth_accounts" });
          if (accs && accs.length) restoreAddr = accs[0];
        } catch(e){}
      }
      if (!restoreAddr) {
        // Fallback: last known logged-in addr from localStorage
        try { restoreAddr = localStorage.getItem("pi2pi_last_addr"); } catch(e){}
      }
      if (!restoreAddr) {
        // Final fallback: scan for any pi2pi_user_* key (single user case)
        try {
          const keys = Object.keys(localStorage).filter(k => k.startsWith("pi2pi_user_"));
          if (keys.length === 1) restoreAddr = keys[0].slice("pi2pi_user_".length);
        } catch(e){}
      }
      if (!restoreAddr) return;
      try {
        const addr = restoreAddr;
        // Check localStorage first
        let saved = null;
        try { saved = localStorage.getItem("pi2pi_user_" + addr.toLowerCase()); } catch(e){}
        // Then server
        if (!saved) {
          try {
            const resp = { ok: true, json: () => getUser(addr) };
            const data = await resp.json();
            if (data && data.role) saved = JSON.stringify(data);
          } catch(e){}
        }
        if (saved) {
          const parsed = JSON.parse(saved);
          const short = addr.slice(0,6)+"…"+addr.slice(-4);
          setRole(parsed.role);
          setUser({ name: short, addr: addr, role: parsed.role, isNew: false });
          // Establish server auth session on restore (required for mutations like archive)
          try {
            const provider = getProvider() || window.ethereum;
            if (provider && window.pi2piWallet) {
              await window.pi2piWallet._authLogin(addr, provider);
            }
          } catch (e) { console.warn("[restore] auth login:", e?.message); }
          // Sync fresh wallet info to server on MetaMask/WC restore.
          try {
            const walletType = window.pi2piWallet?.type === "circle" ? "circle"
              : window.pi2piWallet?.type === "walletconnect" ? "walletconnect"
              : (window.pi2piWallet?.type === "injected" || window.pi2piWallet?.type === "metamask") ? "injected"
              : window.pi2piWallet?.type || null;
            const providerName = walletType === "injected" && window.ethereum ? (window.ethereum.isMetaMask ? "metamask" : window.ethereum.isRabby ? "rabby" : null) : null;
            patchUser(addr, { walletType, ...(providerName && { providerName }), circleBiometric: walletType === "circle", lastLoginAt: Date.now() }).catch(()=>{});
          } catch (e) {}
          // Don't setNav("feed") — let sessionStorage restore keep the user on their current screen
          // Restore active contract from server
          try {
            const cResp = { ok: true, json: () => getActiveContract(addr) };
            const cData = await cResp.json();
            if (cData && cData.listing) {
              setActiveContract({ ...cData, signedAt: cData.signedAt ? new Date(cData.signedAt) : new Date() });
            }
          } catch(e){} finally { setActiveContractChecked(true); }
        }
      } catch(e){}
    })();
  }, []);

  // Redirect away from contract wizard if agreement is already signed (e.g. reload on /contract/r/<peer> after dispute opened)
  useEffect(() => {
    if (view === "real-contract" && activeContract?.agreementId && chatPeer) {
      const peerMatch = !activeContract.peerAddr || activeContract.peerAddr.toLowerCase() === chatPeer.toLowerCase();
      if (peerMatch) navigateTo("/deals");
    }
  }, [view, activeContract?.agreementId, chatPeer]);

  // Poll suspension status every 30s when logged in
  useEffect(() => {
    if (!user?.addr || user.addr.length < 42) { setSuspendedInfo(null); return; }
    const addr = user.addr.toLowerCase();
    const check = () => getUserStatus(addr).then(d => setSuspendedInfo(d)).catch(()=>{});
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
  }, [user?.addr]);

  const recheckSuspension = async () => {
    if (!user?.addr) return;
    const d = await getUserStatus(user.addr).catch(()=>null);
    if (d) setSuspendedInfo(d);
    return d;
  };

  const handleConnected = (r, name, addr, isNew, intentData) => {
    // User explicitly logged in — clear the logout flag so future page loads
    // can auto-restore session.
    try { localStorage.removeItem("pi2pi_logged_out"); } catch(e){}
    // Save last connected addr for fast auto-restore even if eth_accounts is empty on next reload
    try { localStorage.setItem("pi2pi_last_addr", addr); } catch(e){}
    // Fresh login = fresh navigation (don't inherit stale view from previous session)
    try { sessionStorage.removeItem("pi2pi_nav"); sessionStorage.removeItem("pi2pi_view"); sessionStorage.removeItem("pi2pi_chatPeer"); } catch(e){}
    setRole(r);
    setUser({ name, addr, role: r, intentData, isNew });
    setUnreadCount(0);
    setShowWallet(false);
    setView(null);
    setInboxMsgs([]);
    setEarlyTermState({});
    setViewingRequestedListing(null);
    setChatOpenedListing(null);
    setActiveContract(null);
    setActiveContractChecked(false);
    setNav("feed");
    // Async: check if user already has a signed contract (sets activeContractChecked)
    (async () => {
      try {
        const cData = await getActiveContract(addr);
        if (cData && cData.listing && !cData.archived) {
          setActiveContract({ ...cData, signedAt: cData.signedAt ? new Date(cData.signedAt) : new Date() });
        }
      } catch(e) {} finally { setActiveContractChecked(true); }
    })();
  };

  // Periodic active contract refresh — keeps header timer and deals in sync on PWA resume
  useEffect(() => {
    if (!user?.addr) return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      try {
        let addr = user.addr;
        if (addr.includes("\u2026") || addr.length < 42) {
          addr = window.pi2piWallet?._circleAddress || addr;
        }
        if (!addr || addr.length < 42) return;
        const cData = await getActiveContract(addr);
        if (cancelled) return;
        if (cData && cData.listing && !cData.archived) {
          setActiveContract(prev => {
            if (prev?.agreementId === cData.agreementId) return prev;
            return { ...cData, signedAt: cData.signedAt ? new Date(cData.signedAt) : new Date() };
          });
        }
      } catch {}
    };
    refresh();
    const iv = setInterval(refresh, 10000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const onFocus = () => refresh();
    const onPageShow = () => refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => { cancelled = true; clearInterval(iv); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onPageShow); };
  }, [user?.addr]);

  // Global inbox polling for bell notification
  useEffect(() => {
    if (!user?.addr) return;
    let cancelled = false;
    let timer = null;
    let pollFn = null;
    let nullCount = 0;
    async function start() {
      let addr = user.addr;
      if (addr.includes("…") || addr.length < 42) {
        // For Circle, use stored full address — do NOT fall back to window.ethereum (MetaMask)
        const circleAddr = window.pi2piWallet?._circleAddress;
        if (circleAddr && circleAddr.length >= 42) {
          addr = circleAddr;
        } else {
          try { const accs = await (getProvider()||window.ethereum)?.request({method:"eth_accounts"}); if(accs?.[0]) addr=accs[0]; else return; } catch{ return; }
        }
      }
      const poll = () => {
        if (cancelled) return;
        // Check if user still exists on server (Reset All from other browser)
        // Only disconnect after 3 CONSECUTIVE null responses to avoid transient network issues
        getUser(addr).then(u=>{
          if(cancelled) return;
          if(!u) {
            nullCount++;
            if (nullCount >= 3) {
              // Circle wallets: do NOT hard logout — auth session may just need reconnect
              if (window.pi2piWallet?.type === "circle" || window.pi2piWallet?._circleAddress) {
                console.warn("[poll] user not found but Circle wallet active — skipping hard logout");
                nullCount = 0;
                return;
              }
              console.warn("[poll] user not found on server after 3 attempts — disconnecting");
              try { localStorage.clear(); } catch(e){}
              disconnect();
            }
            return;
          }
          nullCount = 0; // reset counter on successful response
        }).catch(()=>{ /* network error — don't increment counter */ });
        getInbox(addr).then(resp=>{
          if(cancelled) return;
          const items = resp?.items || resp || [];
          const seen = resp?.lastSeenInbox || 0;
          let count = 0;
          (Array.isArray(items)?items:[]).forEach(m => {
            const ts = m.createdAt ? new Date(m.createdAt).getTime() : 0;
            if (ts <= seen) return; // already seen — skip
            if (m.type==="viewing_request_received" && m.status==="pending") count++;
            else if (m.type==="contract_received" && m.status !== "cancelled" && m.status !== "rejected" && m.status !== "signed-by-both") count++;
            else if (m.type==="early_term_received" && m.status==="proposed") count++;
          });
          setUnreadCount(count);
        }).catch(()=>{});
      };
      poll();
      pollFn = poll;
      timer = setInterval(poll, 5000);
    }
    start();
    const onVisible = () => { if (document.visibilityState === "visible" && pollFn) pollFn(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled=true; if(timer) clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [user?.addr]);

  const disconnect = async () => {
    // 1. Mark logged out so the auto-restore on next mount is suppressed
    //    even if the wallet still has the site permissioned.
    try { localStorage.setItem("pi2pi_logged_out", "1"); } catch(e){}

    // 2. Clear all cached pi2pi user records from localStorage.
    //    Without this, the WalletModal "returning user" branch would
    //    silently re-login the user without going through verify steps.
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith("pi2pi_user_"))
        .forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
    } catch(e){}

    // 3. Disconnect the active wallet adapter (closes WalletConnect session
    //    if it's the active provider; injected providers ignore this).
    try {
      if (window.pi2piWallet && typeof window.pi2piWallet.disconnect === "function") {
        await window.pi2piWallet.disconnect();
      }
    } catch(e){}

    // 4. Try to revoke MetaMask permissions for this site.
    //    EIP-2255 — supported by recent MetaMask, ignored by older wallets.
    //    Failure here is non-fatal; the logout flag and localStorage purge
    //    are sufficient to prevent auto-login.
    try {
      if (window.ethereum && typeof window.ethereum.request === "function") {
        await window.ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }]
        });
      }
    } catch(e){
      // Wallet doesn't support revokePermissions — that's OK, we have the flag
    }

    // 5. Clear nav persistence so next login starts fresh
    try { sessionStorage.removeItem("pi2pi_nav"); sessionStorage.removeItem("pi2pi_view"); sessionStorage.removeItem("pi2pi_chatPeer"); } catch(e){}

    // 6. Reset React state immediately so the UI flips to the welcome screen
    setUser(null);
    setRole("tenant");
    setShowUserMenu(false);
    setView(null);
    setNav("feed");
    setActiveContract(null);
    setActiveContractChecked(false);
    setListing(null);
    setUnreadCount(0);
    setViewingRequestedListing(null);
    setChatOpenedListing(null);
    setChatPeer(null);
    setInboxMsgs(null);
    setEarlyTermState({});

    // 6. Force a clean page reload so any async polling, intervals, or
    //    in-flight fetches from the previous session are killed.
    setTimeout(() => { try { window.location.reload(); } catch(e){} }, 100);
  };

  return (
    <ErrorBoundary>
    <div className="shell" onClick={()=>setShowUserMenu(false)}>
      <header className="hdr">
        <div className="logo">pi2pi<span className="logo-dot">.io</span></div>
        {user && <ContractTimer agreementId={activeContract?.agreementId} userAddr={user?.addr} />}
        <div className="hdr-right" style={{position:"relative"}}>
          {user ? <React.Fragment>
            <button ref={menuBtnRef} className="menu-btn"
              style={{padding:"6px 10px",fontFamily:"var(--ff)",fontSize:12,fontWeight:800,color:"var(--green)",display:"flex",alignItems:"center",gap:4}}
              onClick={e=>{e.stopPropagation();if(!showUserMenu&&menuBtnRef.current)setUserMenuRect(menuBtnRef.current.getBoundingClientRect());setShowUserMenu(m=>!m);}}
            >
              <span style={{background:user.role==="landlord"?"var(--color-info-surface)":"var(--color-primary-surface)",color:user.role==="landlord"?"var(--color-info)":"var(--color-primary)",border:`1px solid ${user.role==="landlord"?"var(--color-info-border)":"var(--color-primary-border)"}`,padding:"3px 10px",borderRadius:6,fontSize:11,textTransform:"uppercase",fontWeight:800,letterSpacing:"0.5px"}}>
                {user.role==="landlord"?"Landlord":"Tenant"}
              </span>
              <span style={{color:"var(--green)",fontSize:14,marginLeft:2}}>▾</span>
            </button>
            {/* dropdown rendered via portal below */}
          </React.Fragment> : (
            <button className="menu-btn" style={{padding:"7px 16px",fontFamily:"var(--ff)",fontSize:13,fontWeight:700,color:"var(--text)"}} onClick={()=>{setShowDemo(false);setShowProtocol(false);openWallet();}}>Move in</button>
          )}
        </div>
      </header>

      <main>
        {/* Suspension hard-block: show STOP banner instead of all content (except Account tab) */}
        {view===null&&nav==="feed"&&<FeedPage role={role} user={user} activeContract={activeContract} onNeedAuth={()=>openWallet("landlord")} onSelect={l=>{setListing(l);try{sessionStorage.setItem("pi2pi_listing_"+l.id,JSON.stringify(l));}catch{} navigateTo("/listing/"+l.id);}} onCreate={()=>navigateTo("/create")} bookmarks={bookmarks} toggleBookmark={toggleBookmark} isBookmarked={isBookmarked} getIdentityBadges={getIdentityBadges}/>}
        {view===null&&(nav==="inbox"||nav==="deals"||nav==="account")&&<React.Fragment>
          <div style={{padding:"10px 16px 2px"}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:"2px",textTransform:"uppercase",color:"var(--color-text-dim)",marginBottom:2}}>
              {nav==="inbox"?t("title.notifications"):nav==="deals"?t("title.contracts_listings"):t("title.profile_wallet")}
            </div>
            <div style={{fontSize:20,fontWeight:700,color:"var(--color-text-primary)",letterSpacing:"-0.5px"}}>
              {nav==="inbox"?t("title.inbox"):nav==="deals"?t("nav.deals"):t("nav.account")}
            </div>
          </div>
          <Dashboard role={role} user={user} tab={nav} onUnreadChange={setUnreadCount} activeContract={activeContract}
          viewingRequestedListing={viewingRequestedListing}
          onClearViewingRequest={()=>setViewingRequestedListing(null)}
          chatOpenedListing={chatOpenedListing}
          onClearChatOpened={()=>setChatOpenedListing(null)}
          inboxMsgs={inboxMsgs} onInboxMsgsChange={setInboxMsgs}
          earlyTermState={earlyTermState} onEarlyTermStateChange={setEarlyTermState}
          onContractClose={closeContract}
          onViewListing={id=>{setListing(LISTINGS.find(l=>l.id===id)||mockFallbackListing);navigateTo("/listing/"+id);}}
          onOpenChat={id=>{setListing(LISTINGS.find(l=>l.id===id)||mockFallbackListing);navigateTo("/chat/"+id);}}
          onStartContract={id=>{setListing(LISTINGS.find(l=>l.id===id)||mockFallbackListing);navigateTo("/contract/"+id);}}
          onOpenRealChat={(peerAddr)=>{setChatPeer(peerAddr);navigateTo("/chat/r/"+peerAddr);}}
          onStartRealContract={(peerAddr)=>{setChatPeer(peerAddr);navigateTo("/contract/r/"+peerAddr);}}
          onCreateListing={()=>navigateTo("/create")}
          onOpenMyListings={()=>navigateTo("/my-listings")}
          onOpenMyIntent={()=>navigateTo("/my-intent")}
          triggerWorldIDVerify={triggerWorldIDVerify}
          loadFinancialEvents={loadFinancialEvents}
        />
        </React.Fragment>}
        {view==="create"&&<ListingWizard user={user} editData={editListing} editId={route.param||null} onClose={()=>{navigateTo("/deals");setEditListing(null);}} onPublished={()=>{navigateTo("/my-listings");setEditListing(null);}} onNavigate={(tab)=>{setNav(tab);setUnreadCount(tab==="inbox"?0:unreadCount);}}/>}
        {view==="my-listings"&&<MyListingsPage user={user} onBack={()=>navigate(-1)} onCreate={()=>{setEditListing(null);navigateTo("/create");}} onEdit={(l)=>{setEditListing(l);navigateTo("/create/edit/"+l.id);}}/>}
        {view==="my-intent"&&<MyIntentPage user={user} suspendedInfo={suspendedInfo} onBack={()=>navigate(-1)}/>}
        {view==="tenant-request"&&route.param&&<TenantRequestPage addr={route.param} user={user} role={role} onBack={()=>navigate(-1)} onNeedAuth={()=>openWallet("landlord")}/>}
        {view==="prop"&&!listing&&route.param&&!/^\d+$/.test(route.param)&&(
          <div style={{padding:40,textAlign:"center",color:"var(--muted)",fontSize:13}}>Loading listing...</div>
        )}
        {view==="prop"&&effectiveListing&&(listing||!route.param||(ACTIVE_NETWORK_NAME==='arc-testnet'&&/^\d+$/.test(route.param)))&&<PropertyPage listing={effectiveListing} role={role} user={user} activeContract={activeContract} suspended={!!suspendedInfo?.suspended} toggleBookmark={toggleBookmark} isBookmarked={isBookmarked} onBack={()=>navigate(-1)} onChat={()=>{
          const l = effectiveListing;
          if (l._realUser && l.contract) { setChatPeer(l.contract); navigateTo("/chat/r/"+l.contract); }
          else { navigateTo("/chat/"+l.id); if(role==="tenant") setChatOpenedListing(l); }
        }} onApply={()=>{_setView("contract-from-prop");navigate("/contract/"+effectiveListing.id);}} onNeedAuth={()=>openWallet("tenant")} onViewingRequested={(l)=>setViewingRequestedListing(l)} onOpenMyIntent={()=>navigateTo("/my-intent")}/>}
        {/* TASK 10AL: ChatPage/ContractFlow read listing.* with no null-check
            of their own — gate on effectiveListing so arc-mainnet never
            mounts them with a missing listing (fail-closed; same "don't
            render" pattern PropertyPage already used above, not new UI). */}
        {(view==="chat")&&effectiveListing&&<ChatPage listing={effectiveListing} role={role} onBack={()=>navigate(-1)} onContract={()=>navigateTo("/contract/"+effectiveListing.id)}/>}
        {view==="real-chat"&&user&&chatPeer&&<RealChatPage myAddr={user?.addr} peerAddr={chatPeer} role={role} suspended={!!suspendedInfo?.suspended} onBack={()=>{setChatPeer(null);navigate(-1);}} onContractComplete={(data)=>{saveContract({listing:{title:"On-chain Agreement",price:2,contract:chatPeer},role,signedAt:new Date().toISOString(),txHash:data.txHash,agreementId:data.agreementId,peerAddr:chatPeer});setChatPeer(null);navigateTo("/deals");}} onGoToContract={(peer)=>{setChatPeer(peer);navigateTo("/contract/r/"+peer);}}/>}
        {view==="real-contract"&&user&&chatPeer&&activeContractChecked&&!activeContract?.agreementId&&<ContractFlow listing={{title:"Rental Agreement",location:chatPeer.slice(0,6)+"…"+chatPeer.slice(-4),price:2,host:chatPeer.slice(0,6)+"…"+chatPeer.slice(-4),hostAvatar:"alex",contract:chatPeer,_realUser:true,beds:1,baths:1,sqm:50,amenities:["Smart Lock"],desc:"On-chain agreement"}} role={role} myAddr={user?.addr} peerAddr={chatPeer} onBack={()=>navigate(-1)} onComplete={(cd)=>{saveContract({listing:{title:"On-chain Agreement",price:2,contract:chatPeer},role,signedAt:new Date().toISOString(),txHash:cd?.txHash||"0x0",peerAddr:chatPeer,...cd});setChatPeer(null);navigateTo("/deals");}}/>}
        {view==="contract"&&effectiveListing&&<ContractFlow listing={effectiveListing} role={role} onBack={()=>navigate(-1)} onComplete={(cd)=>{const l=effectiveListing;setActiveContract({listing:l,role,signedAt:new Date(),txHash:hashGen(),...cd});navigateTo("/deals");}}/>}
        {view==="contract-from-prop"&&effectiveListing&&<ContractFlow listing={effectiveListing} role={role} onBack={()=>navigate(-1)} onComplete={(cd)=>{const l=effectiveListing;setActiveContract({listing:l,role,signedAt:new Date(),txHash:hashGen(),...cd});navigateTo("/deals");}}/>}
      </main>

      {/* Bottom nav — only when logged in; hidden only in wizard (full-screen flow) */}
      {user && view !== "create" && (
        <nav className="bnav">
          <button className={`bnav-btn ${nav==="feed"?"on":""}`} onClick={()=>setNav("feed")}>
            <span className="bnav-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            </span>
            {t("nav.explore")}
          </button>
          <button className={`bnav-btn ${nav==="inbox"?"on":""}`} onClick={()=>{dismissInbox();setNav("inbox");}}>
            <span className="bnav-icon" style={{position:"relative"}}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              {effectiveUnread>0&&<span style={{position:"absolute",top:-2,right:-4,width:8,height:8,background:"var(--color-danger)",borderRadius:"50%",border:"1.5px solid var(--color-bg-card)"}}/>}
            </span>
            {t("nav.inbox")}{effectiveUnread>0?` (${effectiveUnread})`:""}
          </button>
          <button className={`bnav-btn ${nav==="deals"?"on":""}`} onClick={()=>setNav("deals")}>
            <span className="bnav-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
            </span>
            {t("nav.deals")}
          </button>
          <button className={`bnav-btn ${nav==="account"?"on":""}`} onClick={()=>setNav("account")}>
            <span className="bnav-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            {t("nav.account")}
          </button>
        </nav>
      )}

      {showWallet&&<WalletModal hint={walletHint} onClose={()=>setShowWallet(false)} onConnected={handleConnected}/>}
      {showWalletPanel&&<WalletPanel onClose={()=>setShowWalletPanel(false)}/>}
      {archivePrint&&<PrintModal agreementId={archivePrint.agreementId} myAddr={archivePrint.myAddr} peerAddr={archivePrint.peerAddr} role={archivePrint.role} onClose={()=>setArchivePrint(null)} leaseTexts={LEASE_TEXTS} loadFinancialEvents={loadFinancialEvents}/>}
      {showSettings&&(
        <div className="modal-ov" onClick={e=>e.target===e.currentTarget&&setShowSettings(false)}>
          <div className="modal" style={{maxHeight:"85vh",overflowY:"auto"}}>
            <div className="modal-handle"/>
            <div className="modal-title">Settings</div>
            <SettingsNotifications user={user}/>
            <button className="btn-g" style={{marginTop:12}} onClick={()=>setShowSettings(false)}>{t("btn.close")}</button>
          </div>
        </div>
      )}
    </div>
    {/* Account dropdown — portal to body to escape overflow:clip */}
    {showUserMenu&&userMenuRect&&createPortal(
      <div onClick={()=>setShowUserMenu(false)} style={{position:"fixed",inset:0,zIndex:99998}}>
        <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top:userMenuRect.bottom+6,left:userMenuRect.right-200,width:200,background:"var(--color-glass-bg)",backdropFilter:"blur(24px) saturate(180%)",WebkitBackdropFilter:"blur(24px) saturate(180%)",border:"1px solid var(--color-glass-border)",borderRadius:12,boxShadow:"var(--color-glass-shadow)",zIndex:99999,overflow:"hidden",fontFamily:"var(--ff)"}}>
          <button onClick={()=>{setShowUserMenu(false);setNav("account");}}
            style={{width:"100%",padding:"11px 14px",background:"none",border:"none",borderBottom:"1px solid var(--color-border)",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,color:"var(--color-text-primary)",textAlign:"left",display:"flex",alignItems:"center",gap:8}}
            onMouseOver={e=>e.currentTarget.style.background="var(--color-bg-secondary)"}
            onMouseOut={e=>e.currentTarget.style.background="none"}
          >
            {Ic("user")} {t("menu.my_account")}
          </button>
          <button onClick={()=>{setShowUserMenu(false);setShowWalletPanel(true);}}
            style={{width:"100%",padding:"11px 14px",background:"none",border:"none",borderBottom:"1px solid var(--color-border)",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,color:"var(--color-text-primary)",textAlign:"left",display:"flex",alignItems:"center",gap:8}}
            onMouseOver={e=>e.currentTarget.style.background="var(--color-bg-secondary)"}
            onMouseOut={e=>e.currentTarget.style.background="none"}
          >
            {Ic("wallet")} {t("menu.wallet")}
          </button>
          {role==="landlord" && (
            <button onClick={()=>{setShowUserMenu(false);navigateTo("/my-listings");}}
              style={{width:"100%",padding:"11px 14px",background:"none",border:"none",borderBottom:"1px solid var(--color-border)",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,color:"var(--color-text-primary)",textAlign:"left",display:"flex",alignItems:"center",gap:8}}
              onMouseOver={e=>e.currentTarget.style.background="var(--color-bg-secondary)"}
              onMouseOut={e=>e.currentTarget.style.background="none"}
            >
              {Ic("home")} {t("menu.my_listings")}
            </button>
          )}
          {role==="tenant" && (
            <button onClick={()=>{setShowUserMenu(false);navigateTo("/my-intent");}}
              style={{width:"100%",padding:"11px 14px",background:"none",border:"none",borderBottom:"1px solid var(--color-border)",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,color:"var(--color-text-primary)",textAlign:"left",display:"flex",alignItems:"center",gap:8}}
              onMouseOver={e=>e.currentTarget.style.background="var(--color-bg-secondary)"}
              onMouseOut={e=>e.currentTarget.style.background="none"}
            >
              {Ic("search")} {t("menu.my_search")}
            </button>
          )}
          {false && <button onClick={()=>{setShowUserMenu(false);setShowSettings(true);}}
            style={{width:"100%",padding:"11px 14px",background:"none",border:"none",borderBottom:"1px solid var(--color-border)",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,color:"var(--color-text-primary)",textAlign:"left",display:"flex",alignItems:"center",gap:8}}
            onMouseOver={e=>e.currentTarget.style.background="var(--color-bg-secondary)"}
            onMouseOut={e=>e.currentTarget.style.background="none"}
          >
            {Ic("settings")} Settings
          </button>}
          {SHOW_RESET && <button onClick={async ()=>{
              setShowUserMenu(false);
              let addr = user?.addr;
              if (!addr || addr.includes("…") || addr.length < 42) {
                try { const accs = await window.ethereum?.request({method:"eth_accounts"}); if(accs?.[0]) addr=accs[0]; } catch{}
              }
              if (addr) {
                const key = addr.toLowerCase();
                const r = await resetAccount(key);
                if (r.status === 409) {
                  const body = await r.json().catch(()=>({}));
                  alert(body.error || "Active contract exists. Finish or archive contract before reset.");
                  return;
                }
                if (!r.ok) {
                  const body = await r.json().catch(()=>({}));
                  alert(body.error || "Reset failed");
                  return;
                }
                // Clear local state after successful server reset
                try { Object.keys(localStorage).filter(k => k.includes(key) || k.startsWith("pi2pi_user_") || k === "pi2pi_bookmarks").forEach(k => localStorage.removeItem(k)); } catch{}
                try { sessionStorage.clear(); } catch{}
              }
              disconnect();
              setTimeout(()=>openWallet(), 300);
            }}
            style={{width:"100%",padding:"11px 14px",background:"none",border:"none",borderBottom:"1px solid var(--color-border)",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,color:"var(--color-warning)",textAlign:"left",display:"flex",alignItems:"center",gap:8}}
            onMouseOver={e=>e.currentTarget.style.background="var(--color-bg-secondary)"}
            onMouseOut={e=>e.currentTarget.style.background="none"}
          >
            {Ic("refresh")} {t("menu.reset_account")}
          </button>}
          {SHOW_RESET && <button onClick={async ()=>{
              setShowUserMenu(false);
              try { await apiPost("/api/reset-all", {}); } catch{}
              try { localStorage.clear(); } catch{}
              disconnect();
              setTimeout(()=>openWallet(), 300);
            }}
            style={{width:"100%",padding:"11px 14px",background:"none",border:"none",borderBottom:"1px solid var(--color-border)",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,color:"var(--color-danger)",textAlign:"left",display:"flex",alignItems:"center",gap:8}}
            onMouseOver={e=>e.currentTarget.style.background="var(--color-bg-secondary)"}
            onMouseOut={e=>e.currentTarget.style.background="none"}
          >
            {Ic("trash")} Reset all (both accounts + server)
          </button>}
          <button onClick={()=>{setShowUserMenu(false);disconnect();}}
            style={{width:"100%",padding:"11px 14px",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,color:"var(--color-danger)",textAlign:"left",display:"flex",alignItems:"center",gap:8}}
            onMouseOver={e=>e.currentTarget.style.background="var(--color-bg-secondary)"}
            onMouseOut={e=>e.currentTarget.style.background="none"}
          >
            {Ic("logout")} {t("menu.disconnect")}
          </button>
        </div>
      </div>,
      document.body
    )}
    <ToastStack toasts={globalToasts} removeToast={removeGlobalToast} />
    </ErrorBoundary>
  );
}
