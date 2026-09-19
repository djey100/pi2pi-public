import React from 'react';
import UserAvatar from './UserAvatar.jsx';

export default function AvatarBox({ id, size=40, radius=50, walletAddr }) {
  return <UserAvatar walletAddress={walletAddr || id || "default"} size={size} shape={radius >= 50 ? "round" : "square"}/>;
}
