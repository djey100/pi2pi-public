import React, { useMemo } from 'react';
import { getAvatarForWallet } from '../utils/avatar.js';
import '../styles/avatar.css';

export default function UserAvatar({ walletAddress, avatarUrl, size = 40, shape = "round" }) {
  const defaultAvatar = useMemo(() => getAvatarForWallet(walletAddress), [walletAddress]);
  const src = avatarUrl || defaultAvatar?.url || "";
  const cls = `pi2pi-avatar pi2pi-avatar--${shape}`;

  return (
    <img src={src} alt="avatar" width={size} height={size} className={cls}
      style={{ width: size, height: size }}/>
  );
}
