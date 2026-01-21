import React from "react";
import type { WalletType } from "../wallet";

type WalletSelectModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (type: WalletType) => void;
  loading: boolean;
  loadingType: WalletType | null;
};

export default function WalletSelectModal({
  isOpen,
  onClose,
  onSelect,
  loading,
  loadingType
}: WalletSelectModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="surface w-full max-w-md rounded-3xl p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-2xl uppercase tracking-[0.1em] text-ink">
            Connect Wallet
          </h2>
          {!loading && (
            <button
              onClick={onClose}
              className="text-slate hover:text-ink transition-colors"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6L18 18M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {/* Keplr Option */}
          <button
            onClick={() => onSelect("keplr")}
            disabled={loading}
            className={`flex items-center gap-4 rounded-2xl border border-midnight/10 bg-panel p-4 transition-all ${
              loading && loadingType !== "keplr"
                ? "opacity-50 cursor-not-allowed"
                : "hover:border-accent2 hover:bg-accent2/5"
            }`}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#7B3FE4]">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="white">
                <path d="M16 4c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12S22.627 4 16 4zm0 2c5.514 0 10 4.486 10 10s-4.486 10-10 10S6 21.514 6 16 10.486 6 16 6zm-2 4v8h4v-2h-2V10h-2zm4 10h-4v2h4v-2z" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-ink">Keplr</p>
              <p className="text-sm text-slate">Browser Extension</p>
            </div>
            {loading && loadingType === "keplr" ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent2 border-t-transparent" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-slate">
                <path
                  d="M7 4L13 10L7 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>

          {/* WalletConnect Option */}
          <button
            onClick={() => onSelect("walletconnect")}
            disabled={loading}
            className={`flex items-center gap-4 rounded-2xl border border-midnight/10 bg-panel p-4 transition-all ${
              loading && loadingType !== "walletconnect"
                ? "opacity-50 cursor-not-allowed"
                : "hover:border-accent2 hover:bg-accent2/5"
            }`}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#3B99FC]">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="white">
                <path d="M9.58 11.27c3.54-3.47 9.28-3.47 12.82 0l.43.42a.44.44 0 010 .63l-1.46 1.43a.23.23 0 01-.32 0l-.59-.58a6.48 6.48 0 00-8.94 0l-.63.62a.23.23 0 01-.32 0l-1.46-1.43a.44.44 0 010-.63l.47-.46zm15.83 2.96l1.3 1.27a.44.44 0 010 .63l-5.85 5.73a.46.46 0 01-.64 0l-4.15-4.07a.12.12 0 00-.16 0l-4.15 4.07a.46.46 0 01-.64 0L5.27 16.13a.44.44 0 010-.63l1.3-1.27a.46.46 0 01.64 0l4.15 4.07c.04.04.12.04.16 0l4.15-4.07a.46.46 0 01.64 0l4.15 4.07c.04.04.12.04.16 0l4.15-4.07a.46.46 0 01.64 0z" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-ink">WalletConnect</p>
              <p className="text-sm text-slate">Mobile Wallet via QR</p>
            </div>
            {loading && loadingType === "walletconnect" ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent2 border-t-transparent" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-slate">
                <path
                  d="M7 4L13 10L7 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-slate">
          Connect your wallet to place picks and earn rewards
        </p>
      </div>
    </div>
  );
}
