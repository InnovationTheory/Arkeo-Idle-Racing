export function normalizeHandle(handle?: string): string | undefined {
  if (!handle) return undefined;
  return handle.trim();
}

export function normalizeNickname(nickname?: string): string | undefined {
  if (!nickname) return undefined;
  const trimmed = nickname.trim();
  return trimmed.length ? trimmed : undefined;
}

export function normalizeNicknameKey(nickname?: string): string | undefined {
  if (!nickname) return undefined;
  const trimmed = nickname.trim().toLowerCase();
  return trimmed.length ? trimmed : undefined;
}

export function normalizeWalletAddress(address?: string): string | undefined {
  if (!address) return undefined;
  return address.trim().toLowerCase();
}

export function normalizeTxHash(hash?: string): string | undefined {
  if (!hash) return undefined;
  const trimmed = hash.trim();
  const withoutPrefix = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  return withoutPrefix.toUpperCase();
}
