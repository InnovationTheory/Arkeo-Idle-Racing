import { config } from "../../config";

export function isValidHandle(handle: string): boolean {
  if (handle.length < 3 || handle.length > 20) return false;
  return /^[A-Za-z0-9_-]+$/.test(handle);
}

export function isValidNickname(nickname: string): boolean {
  if (nickname.length < 3 || nickname.length > 24) return false;
  return /^[A-Za-z0-9 _-]+$/.test(nickname);
}

export function isValidWalletAddress(address: string): boolean {
  const prefix = config.arkeoBech32Prefix.toLowerCase();
  if (!address.startsWith(`${prefix}1`)) return false;
  if (address.length < prefix.length + 10) return false;
  return /^[a-z0-9]+$/.test(address);
}

export function isValidTxHash(hash: string): boolean {
  return /^[A-F0-9]{64}$/.test(hash);
}
