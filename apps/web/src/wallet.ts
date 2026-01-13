import { connectKeplr, sendStakePayment as sendKeplrPayment } from "./keplr";
import {
  connectWalletConnect,
  disconnectWalletConnect,
  restoreWalletConnectSession,
  sendWalletConnectPayment,
  isWalletConnectConnected
} from "./walletConnect";

export type WalletType = "keplr" | "walletconnect";

const STORAGE_KEY_WALLET_TYPE = "arkeo_wallet_type";

export function getSavedWalletType(): WalletType | null {
  const saved = localStorage.getItem(STORAGE_KEY_WALLET_TYPE);
  if (saved === "keplr" || saved === "walletconnect") {
    return saved;
  }
  return null;
}

export function saveWalletType(type: WalletType): void {
  localStorage.setItem(STORAGE_KEY_WALLET_TYPE, type);
}

export function clearWalletType(): void {
  localStorage.removeItem(STORAGE_KEY_WALLET_TYPE);
}

export async function connectWallet(type: WalletType): Promise<string> {
  let address: string;

  if (type === "keplr") {
    address = await connectKeplr();
  } else {
    address = await connectWalletConnect();
  }

  saveWalletType(type);
  return address;
}

export async function disconnectWallet(type: WalletType): Promise<void> {
  if (type === "walletconnect") {
    await disconnectWalletConnect();
  }
  // Keplr doesn't have a disconnect API - just clear local state
  clearWalletType();
}

export async function restoreWalletSession(): Promise<{
  address: string;
  type: WalletType;
} | null> {
  const savedType = getSavedWalletType();

  if (!savedType) return null;

  if (savedType === "walletconnect") {
    const address = await restoreWalletConnectSession();
    if (address) {
      return { address, type: "walletconnect" };
    }
    // Session expired, clear saved type
    clearWalletType();
    return null;
  }

  // For Keplr, we can't auto-restore - user needs to click connect again
  // But we remember the preference
  return null;
}

export async function sendPayment(
  type: WalletType,
  toAddress: string,
  amount: string
): Promise<string> {
  if (type === "keplr") {
    return sendKeplrPayment(toAddress, amount);
  } else {
    return sendWalletConnectPayment(toAddress, amount);
  }
}

export function isConnected(type: WalletType): boolean {
  if (type === "walletconnect") {
    return isWalletConnectConnected();
  }
  // For Keplr, we rely on the address state in the hook
  return false;
}

export { arkeoChainMeta, arkeoChainInfo } from "./keplr";
