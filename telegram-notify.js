// =============================================================================
// TELEGRAM NOTIFICATIONS — sends alerts via Telegram Bot API
// Bot token stored in TELEGRAM_BOT_TOKEN env var (Fly.io secret)
// =============================================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;

// This runtime's own branded app URL (TASK 10P) — injected once by
// server-arc.js via initTelegramAppUrl(), using its own fail-closed
// APP_BASE_URL. Previously this file hardcoded "my.pi2pi.io" directly into
// notification text, which would silently point Testnet users at the
// Mainnet domain (or vice versa) once the two are split across separate
// custom domains. Falls back to the neutral marketing site (never a
// network-specific app domain) if this module is ever used before
// initialization, rather than guessing which network is active.
let APP_URL = null;
export function initTelegramAppUrl(appBaseUrl) {
  if (!appBaseUrl || typeof appBaseUrl !== "string") {
    throw new Error("initTelegramAppUrl: appBaseUrl is required");
  }
  APP_URL = appBaseUrl;
}
function appUrl() {
  return APP_URL || "https://pi2pi.io";
}

/**
 * Send a Telegram message to a chat_id
 * @param {string|number} chatId - Telegram chat ID
 * @param {string} text - Message text (supports Markdown)
 * @returns {Promise<boolean>} - true if sent
 */
export async function sendTelegramMessage(chatId, text) {
  if (!API || !chatId) return false;
  try {
    const r = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    const data = await r.json();
    if (!data.ok) console.warn("[telegram] send failed:", data.description);
    return !!data.ok;
  } catch (e) {
    console.warn("[telegram] send error:", e.message);
    return false;
  }
}

/**
 * Notify a user about an event (if they have Telegram connected)
 * @param {object} supabase - Supabase client
 * @param {string} addr - Wallet address of recipient
 * @param {string} type - Event type
 * @param {object} params - Event params (peer name, amount, etc)
 */
export async function notifyUser(supabase, addr, type, params = {}) {
  if (!API) return;
  try {
    const { data: user } = await supabase
      .from("users")
      .select("data")
      .eq("addr", addr.toLowerCase())
      .maybeSingle();
    const chatId = user?.data?.telegram_chat_id;
    if (!chatId) return;

    const name = params.peerName || params.fromName || "Someone";
    const messages = {
      message_received: `💬 *New message* from ${name}\n${params.preview ? `"${params.preview}"` : ""}`,
      viewing_request: `🏠 *Viewing request* from ${name}\n${params.listingTitle || ""}`,
      viewing_confirmed: `✅ *Viewing confirmed* by ${name}`,
      viewing_declined: `❌ *Viewing declined* by ${name}`,
      contract_proposal: `📋 *Contract proposal* from ${name}\nReview and sign on pi2pi.io`,
      contract_signed: `✅ *Contract signed!*\nAgreement is now active on-chain`,
      early_term_proposed: `⚠️ *Early termination proposed* by ${name}\n${params.reason || ""}`,
      early_term_accepted: `✅ *Early termination accepted* by ${name}`,
      rent_paid: `💰 *Rent paid* — ${params.amount || ""} USDC`,
      rent_overdue: `🔴 *Rent overdue!*\nPay now to avoid deposit penalties`,
      damage_claim: `⚠️ *Damage claim filed* — ${params.amount || ""} USDC`,
      deposit_returned: `💰 *Deposit returned* — ${params.amount || ""} USDC`,
    };

    const text = messages[type] || `📌 *pi2pi notification*\n${type}`;
    await sendTelegramMessage(chatId, text + `\n\n[Open pi2pi](${appUrl()})`);
  } catch (e) {
    console.warn("[telegram] notify error:", e.message);
  }
}

/**
 * Verify a Telegram connection request
 * Returns chat_id if the token matches, null otherwise
 * @param {string} token - One-time token from the app
 */
export async function handleBotUpdate(update) {
  if (!update?.message?.text) return null;
  const text = update.message.text.trim();
  const chatId = update.message.chat.id;
  const username = update.message.from?.username || "";

  // /start TOKEN — user clicked connect link from app
  if (text.startsWith("/start ")) {
    const token = text.replace("/start ", "").trim();
    return { type: "connect", chatId, username, token };
  }

  // /start — just opened bot
  if (text === "/start") {
    await sendTelegramMessage(chatId,
      "👋 *Welcome to pi2pi notifications!*\n\n" +
      "To connect your wallet, go to:\n" +
      `${new URL(appUrl()).host} → Account → Connect Telegram\n\n` +
      "You'll receive notifications about messages, viewings, and contracts."
    );
    return { type: "welcome", chatId };
  }

  return null;
}

export function isConfigured() {
  return !!API;
}
