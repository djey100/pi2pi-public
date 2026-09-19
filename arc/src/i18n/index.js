// pi2pi i18n engine (ES module)
import { STRINGS_EN } from './en.js';
import { STRINGS_RU } from './ru.js';
import { STRINGS_KA } from './ka.js';
import { STRINGS_VI } from './vi.js';
import { STRINGS_ES } from './es.js';
import { STRINGS_PT } from './pt.js';
import { STRINGS_TH } from './th.js';
import { STRINGS_UK } from './uk.js';

export const STRINGS = { en: STRINGS_EN, ru: STRINGS_RU, ka: STRINGS_KA, vi: STRINGS_VI, es: STRINGS_ES, pt: STRINGS_PT, th: STRINGS_TH, uk: STRINGS_UK };

const _supportedCodes = ["en","ru","ka","vi","es","pt","th","uk"];
let _currentLang = (() => {
  try {
    const saved = localStorage.getItem("pi2pi-lang");
    if (saved && _supportedCodes.includes(saved)) return saved;
  } catch(e) {}
  // Auto-detect from device language
  try {
    const browserLang = (navigator.language || navigator.userLanguage || "en").toLowerCase();
    const short = browserLang.split("-")[0];
    if (_supportedCodes.includes(short)) return short;
    // Special cases: Georgian browser may report "ka-GE"
    if (browserLang.startsWith("ka")) return "ka";
    if (browserLang.startsWith("vi")) return "vi";
    if (browserLang.startsWith("uk")) return "uk";
    if (browserLang.startsWith("pt")) return "pt";
    if (browserLang.startsWith("th")) return "th";
  } catch(e) {}
  return "en";
})();

export function t(key, params) {
  let s = (STRINGS[_currentLang] && STRINGS[_currentLang][key]) || STRINGS.en[key] || key;
  if (params) Object.entries(params).forEach(([k,v]) => { s = s.replace(new RegExp(`\\{${k}\\}`, "g"), v); });
  return s;
}

export function setLang(lang) {
  _currentLang = lang;
  try { localStorage.setItem("pi2pi-lang", lang); } catch(e) {}
}

export function getLang() { return _currentLang; }

export const SUPPORTED_LANGS = [
  { code:"en", label:"English", native:"English" },
  { code:"ka", label:"Georgian", native:"ქართული" },
  { code:"uk", label:"Ukrainian", native:"Українська" },
  { code:"vi", label:"Vietnamese", native:"Tiếng Việt" },
  { code:"th", label:"Thai", native:"ภาษาไทย" },
  { code:"es", label:"Spanish", native:"Español" },
  { code:"pt", label:"Portuguese", native:"Português" },
  { code:"ru", label:"Russian", native:"Русский" },
];
