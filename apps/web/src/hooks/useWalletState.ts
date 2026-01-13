import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, clearStoredSession } from "../api";
import {
  connectWallet as connectWalletByType,
  disconnectWallet as disconnectWalletByType,
  restoreWalletSession,
  getSavedWalletType,
  type WalletType
} from "../wallet";

type MeResponse = {
  userId: string;
  nickname?: string | null;
  walletAddress?: string | null;
  balance: number;
};

type WalletBalanceResponse = {
  address: string;
  displayAmount: string;
  ticker: string;
};

export function useWalletState() {
  const [raceCredits, setRaceCredits] = useState<number | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [walletType, setWalletType] = useState<WalletType | null>(null);
  const [walletSelectOpen, setWalletSelectOpen] = useState(false);
  const [connectingType, setConnectingType] = useState<WalletType | null>(null);
  const [nickname, setNickname] = useState("");
  const [isNicknameEditing, setIsNicknameEditing] = useState(true);
  const [walletMessage, setWalletMessage] = useState<string | null>(null);
  const [nicknameMessage, setNicknameMessage] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [nicknameSaving, setNicknameSaving] = useState(false);
  // Skip balance fetch when we just connected (Safari cookie timing workaround)
  const skipBalanceFetch = useRef(false);

  useEffect(() => {
    // Restore session from API
    apiGet<MeResponse>("/api/me")
      .then((me) => {
        setRaceCredits(me.balance);
        if (me.nickname) {
          setNickname(me.nickname);
          setIsNicknameEditing(false);
          setNicknameMessage(null);
        } else {
          setIsNicknameEditing(true);
        }
        if (me.walletAddress) {
          setWalletAddress(me.walletAddress);
          // Restore wallet type from localStorage
          const savedType = getSavedWalletType();
          if (savedType) setWalletType(savedType);
        }
      })
      .catch(() => {});

    // Try to restore WalletConnect session
    restoreWalletSession().then((restored) => {
      if (restored) {
        setWalletType(restored.type);
        // WalletConnect session restored, but we still need API sync
        // The API will be synced when user interacts
      }
    });
  }, []);

  useEffect(() => {
    if (!walletAddress) return;
    // Skip if we just connected (balance already set from POST response)
    if (skipBalanceFetch.current) {
      skipBalanceFetch.current = false;
      return;
    }
    apiGet<WalletBalanceResponse>("/api/me/wallet/balance")
      .then((data) => setWalletBalance(`${data.displayAmount} ${data.ticker}`))
      .catch(() => setWalletBalance(null));
  }, [walletAddress]);

  const connectWallet = useCallback(async (type: WalletType) => {
    setWalletMessage(null);
    setNicknameMessage(null);
    setWalletLoading(true);
    setConnectingType(type);
    try {
      const address = await connectWalletByType(type);
      const response = await apiPost<{
        walletAddress: string;
        nickname?: string | null;
        credits: number;
        onchainBalance?: { displayAmount: string; ticker: string } | null;
      }>("/api/me/wallet", {
        walletAddress: address
      });

      // Use data from POST response directly (avoids Safari cookie timing issues)
      // Set flag to skip balance useEffect (we already have balance from POST)
      skipBalanceFetch.current = true;
      setWalletAddress(response.walletAddress || address);
      setWalletType(type);
      setWalletSelectOpen(false);
      setRaceCredits(response.credits);
      if (response.onchainBalance) {
        setWalletBalance(`${response.onchainBalance.displayAmount} ${response.onchainBalance.ticker}`);
      }
      if (response.nickname) {
        setNickname(response.nickname);
        setIsNicknameEditing(false);
      } else {
        setIsNicknameEditing(true);
      }
      setWalletMessage("Wallet linked.");
    } catch (error: any) {
      // If we got a 401, disconnect the wallet provider too
      if (type === "walletconnect") {
        try {
          await disconnectWalletByType(type);
        } catch {
          // Ignore disconnect errors
        }
      }
      const code = error?.message;
      const next =
        code === "keplr_not_found"
          ? "Install Keplr to connect."
          : code === "walletconnect_no_uri"
            ? "WalletConnect connection failed."
            : code === "walletconnect_no_address"
              ? "No address received from wallet."
              : code === "invalid_wallet_address"
                ? "Wallet address is invalid."
                : code === "invalid_nickname"
                  ? "Nickname must be 3-24 chars: letters, numbers, space, _ or -."
                  : code === "profanity_detected"
                    ? "Nickname contains blocked words. Choose another."
                    : code === "nickname_taken"
                      ? "Nickname already taken. Pick another."
                      : code === "wallet_in_use"
                        ? "Wallet already linked to another player."
                        : error?.message || "Wallet connect failed";
      setWalletMessage(next);
      setWalletSelectOpen(false);
    } finally {
      setWalletLoading(false);
      setConnectingType(null);
    }
  }, []);

  const disconnectWallet = useCallback(async () => {
    setWalletMessage(null);
    setNicknameMessage(null);
    setWalletLoading(true);
    try {
      // Disconnect from wallet provider first
      if (walletType) {
        await disconnectWalletByType(walletType);
      }
      // Then disconnect from API
      await apiPost("/api/me/wallet/disconnect");
      // Clear stored session token (Safari fallback)
      clearStoredSession();
      setWalletAddress(null);
      setWalletBalance(null);
      setWalletType(null);
      setNickname("");
      setIsNicknameEditing(true);
      setRaceCredits(null);
      setWalletMessage("Wallet disconnected.");
    } catch (error: any) {
      setWalletMessage(error?.message || "Wallet disconnect failed.");
    } finally {
      setWalletLoading(false);
    }
  }, [walletType]);

  const saveNickname = useCallback(async () => {
    setNicknameMessage(null);
    setNicknameSaving(true);
    try {
      const response = await apiPost<{ nickname: string }>("/api/me/nickname", {
        nickname
      });
      setNickname(response.nickname);
      setIsNicknameEditing(false);
      setNicknameMessage("Nickname saved.");
    } catch (error: any) {
      const code = error?.message;
      const next =
        code === "session_required"
          ? "Connect your wallet to save a nickname."
          : code === "session_invalid"
            ? "Session expired. Refresh and try again."
            : code === "invalid_nickname"
              ? "Nickname must be 3-24 chars: letters, numbers, space, _ or -."
              : code === "profanity_detected"
                ? "Nickname contains blocked words. Choose another."
            : code === "nickname_taken"
              ? "Nickname already taken. Pick another."
            : error?.message || "Nickname save failed.";
      setNicknameMessage(next);
    } finally {
      setNicknameSaving(false);
    }
  }, [nickname]);

  const handleNicknameAction = useCallback(() => {
    if (nicknameSaving) return;
    if (!isNicknameEditing) {
      setIsNicknameEditing(true);
      return;
    }
    void saveNickname();
  }, [nicknameSaving, isNicknameEditing, saveNickname]);

  const openWalletSelect = useCallback(() => {
    setWalletSelectOpen(true);
    setWalletMessage(null);
  }, []);

  const closeWalletSelect = useCallback(() => {
    setWalletSelectOpen(false);
  }, []);

  return {
    raceCredits,
    setRaceCredits,
    walletAddress,
    walletBalance,
    walletType,
    walletSelectOpen,
    connectingType,
    nickname,
    setNickname,
    isNicknameEditing,
    walletMessage,
    nicknameMessage,
    walletLoading,
    nicknameSaving,
    connectWallet,
    disconnectWallet,
    openWalletSelect,
    closeWalletSelect,
    handleNicknameAction
  };
}
