// =============================================================================
// LIT PROTOCOL — encrypted contract storage on IPFS
// Lazy-loads Lit SDK on first use, encrypts contract data so only tenant and
// landlord wallets can decrypt. Uploads to IPFS via our backend (which holds
// the Pinata JWT server-side).
// =============================================================================

import { getProvider } from '../wallet.js';
import { uploadIpfsJson } from '../api/client.js';

const LIT_NETWORK = "datil-test"; // Free tier test network
let __pi2piLitClient = null;
let __pi2piLitMods = null;

const _loadLitSDK = async () => {
  if (__pi2piLitMods) return __pi2piLitMods;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.textContent =
      "(async () => {\n" +
      "  try {\n" +
      "    const litMod = await import('https://esm.sh/@lit-protocol/lit-node-client@7.1.1?bundle-deps');\n" +
      "    const constMod = await import('https://esm.sh/@lit-protocol/constants@7.1.1');\n" +
      "    const authMod = await import('https://esm.sh/@lit-protocol/auth-helpers@7.1.1?bundle-deps');\n" +
      "    window.__pi2piLitMods = {\n" +
      "      LitNodeClient: litMod.LitNodeClient,\n" +
      "      encryptString: litMod.encryptString,\n" +
      "      decryptToString: litMod.decryptToString,\n" +
      "      LIT_NETWORK: constMod.LIT_NETWORK,\n" +
      "      createSiweMessageWithRecaps: authMod.createSiweMessageWithRecaps,\n" +
      "      generateAuthSig: authMod.generateAuthSig,\n" +
      "      LitAccessControlConditionResource: authMod.LitAccessControlConditionResource,\n" +
      "      LitAbility: authMod.LitAbility || (constMod.LIT_ABILITY && constMod.LIT_ABILITY.AccessControlConditionDecryption),\n" +
      "    };\n" +
      "    window.dispatchEvent(new CustomEvent('pi2pi-lit-loaded'));\n" +
      "  } catch (e) {\n" +
      "    console.error('[pi2pi/lit] load failed:', e && e.message ? e.message : e);\n" +
      "    window.__pi2piLitError = (e && e.message) ? e.message : String(e);\n" +
      "    window.dispatchEvent(new CustomEvent('pi2pi-lit-load-failed'));\n" +
      "  }\n" +
      "})();";
    const cleanup = () => {
      window.removeEventListener("pi2pi-lit-loaded", onSuccess);
      window.removeEventListener("pi2pi-lit-load-failed", onFail);
    };
    const onSuccess = () => { cleanup(); __pi2piLitMods = window.__pi2piLitMods; resolve(__pi2piLitMods); };
    const onFail = () => { cleanup(); reject(new Error("Lit SDK load failed: " + (window.__pi2piLitError || "unknown"))); };
    window.addEventListener("pi2pi-lit-loaded", onSuccess, { once: true });
    window.addEventListener("pi2pi-lit-load-failed", onFail, { once: true });
    setTimeout(() => { if (!__pi2piLitMods) onFail(); }, 60000);
    document.body.appendChild(script);
  });
};

const _ensureLitClient = async () => {
  if (__pi2piLitClient) return __pi2piLitClient;
  const mods = await _loadLitSDK();
  const client = new mods.LitNodeClient({ litNetwork: mods.LIT_NETWORK?.DatilTest || LIT_NETWORK, debug: false });
  await client.connect();
  __pi2piLitClient = client;
  return client;
};

// Build access control: only tenant OR landlord wallet can decrypt
const _buildAccessConditions = (tenantAddr, landlordAddr) => [
  {
    contractAddress: "",
    standardContractType: "",
    chain: "ethereum",
    method: "",
    parameters: [":userAddress"],
    returnValueTest: { comparator: "=", value: tenantAddr.toLowerCase() },
  },
  { operator: "or" },
  {
    contractAddress: "",
    standardContractType: "",
    chain: "ethereum",
    method: "",
    parameters: [":userAddress"],
    returnValueTest: { comparator: "=", value: landlordAddr.toLowerCase() },
  },
];

// Encrypt contract data and upload to IPFS via backend
// Returns { cid, dataToEncryptHash } — store these alongside the agreement
export const encryptAndUploadContract = async (contractData, tenantAddr, landlordAddr) => {
  try {
    const mods = await _loadLitSDK();
    const client = await _ensureLitClient();
    const accessControlConditions = _buildAccessConditions(tenantAddr, landlordAddr);
    const dataToEncrypt = JSON.stringify(contractData);
    const { ciphertext, dataToEncryptHash } = await mods.encryptString(
      { accessControlConditions, dataToEncrypt },
      client
    );
    const blob = { ciphertext, dataToEncryptHash, accessControlConditions };
    const j = await uploadIpfsJson({ content: blob, name: "pi2pi-contract-" + Date.now() });
    if (!j.cid) throw new Error(j.error || "IPFS upload failed");
    return { cid: j.cid, dataToEncryptHash };
  } catch (e) {
    console.error("[lit/upload]", e);
    throw e;
  }
};

// Fetch encrypted blob from IPFS, get auth from current wallet, decrypt
export const fetchAndDecryptContract = async (cid) => {
  try {
    const mods = await _loadLitSDK();
    const client = await _ensureLitClient();
    // Fetch blob via gateway (Pinata public gateway)
    const r = await fetch("https://gateway.pinata.cloud/ipfs/" + cid);
    if (!r.ok) throw new Error("IPFS fetch failed");
    const blob = await r.json();
    if (!blob.ciphertext || !blob.dataToEncryptHash || !blob.accessControlConditions) {
      throw new Error("Invalid encrypted blob format");
    }
    // Get user's wallet and create auth signature
    const accs = await (getProvider()||window.ethereum)?.request({ method: "eth_accounts" });
    const myAddr = accs?.[0];
    if (!myAddr) throw new Error("No wallet connected");
    // Create auth sig (sign SIWE message)
    const sessionSigs = await client.getSessionSigs({
      chain: "ethereum",
      resourceAbilityRequests: [{
        resource: new mods.LitAccessControlConditionResource("*"),
        ability: mods.LitAbility?.AccessControlConditionDecryption || "access-control-condition-decryption",
      }],
      authNeededCallback: async ({ uri, expiration, resourceAbilityRequests }) => {
        const toSign = await mods.createSiweMessageWithRecaps({
          uri, expiration, resources: resourceAbilityRequests,
          walletAddress: myAddr,
          nonce: await client.getLatestBlockhash(),
          litNodeClient: client,
        });
        return await mods.generateAuthSig({
          signer: { signMessage: async (msg) => await getProvider().request({ method: "personal_sign", params: [msg, myAddr] }), getAddress: async () => myAddr },
          toSign,
        });
      },
    });
    const decrypted = await mods.decryptToString({
      accessControlConditions: blob.accessControlConditions,
      ciphertext: blob.ciphertext,
      dataToEncryptHash: blob.dataToEncryptHash,
      sessionSigs,
      chain: "ethereum",
    }, client);
    return JSON.parse(decrypted);
  } catch (e) {
    console.error("[lit/decrypt]", e);
    throw e;
  }
};
