// =============================================================================
// TEXT FILTER — blocks URLs/links in user-generated content
// Used in chat messages to prevent spam, phishing, and external redirects.
// Server-side enforcement (frontend also validates for UX).
// =============================================================================

// Match common URL patterns: http(s)://, www., domain.tld, IP addresses
const URL_PATTERNS = [
  /https?:\/\/\S+/i,
  /www\.\S+/i,
  /\b[a-z0-9-]+\.(com|org|net|io|co|me|app|dev|xyz|info|biz|pro|tech|site|online|store|shop|link|click|top|icu|buzz|fun|live|space|cloud|gg|cc|tv|fm|ly|to|gl|bit|goo|tinyurl|t\.co)\b/i,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\bt\.me\/\S+/i,
  /\btelegram\.me\/\S+/i,
  /\bwa\.me\/\S+/i,
];

/**
 * Check if text contains a URL or link.
 * @param {string} text
 * @returns {{ blocked: boolean, reason: string|null }}
 */
function checkText(text) {
  if (!text || typeof text !== "string") return { blocked: false, reason: null };
  for (const pattern of URL_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason: "links_not_allowed" };
    }
  }
  return { blocked: false, reason: null };
}

export { checkText };
