import { DEFAULT_AVATARS } from '../data/defaultAvatars.js';

function hashWallet(address) {
  let h = 0;
  const s = (address || "").toLowerCase();
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getAvatarForWallet(address) {
  if (!address || !DEFAULT_AVATARS.length) return DEFAULT_AVATARS[0] || { url: "" };
  const index = hashWallet(address) % DEFAULT_AVATARS.length;
  return DEFAULT_AVATARS[index];
}

export function getAvatarById(id) {
  return DEFAULT_AVATARS.find(a => a.id === id) || DEFAULT_AVATARS[0];
}
