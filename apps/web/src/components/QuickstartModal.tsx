import React, { useEffect, useMemo, useState } from "react";

type QuickstartModalProps = {
  open: boolean;
  onClose: () => void;
  onDontShowAgain: () => void;
};

export default function QuickstartModal({ open, onClose, onDontShowAgain }: QuickstartModalProps) {
  const slides = useMemo(
    () => [
      {
        title: "Connect Keplr",
        body:
          "Connect Keplr so we can verify your reward address. No funds needed — a fresh wallet is fine. Make sure the Arkeo network is enabled in Keplr.",
        link: { label: "Get Keplr", href: "https://www.keplr.app/" },
        image: "/assets/1-keplr-wallet.png"
      },
      {
        title: "Connect Your Wallet",
        body:
          "Use Connect Wallet to link your Keplr address or WalletConnect session. This ties your selections to your rewards.",
        image: "/assets/2-connect-wallet.png"
      },
      {
        title: "Add a Nickname",
        body: "Claim your racer name. It shows on your picks and on the leaderboards.",
        image: "/assets/3-choose-nickname.png"
      },
      {
        title: "Pick 3 Horses You Know Will Win",
        body:
          "You can only choose or change selections during the picking phase (the countdown to the race). Too early? Hang tight. Too late? Catch the next RaceDay. Choose up to three horses from the starting heats before Heat 1 starts.",
        image: "/assets/4-selected-racehorses.png"
      },
      {
        title: "What Is a Racehorse?",
        body:
          "Each racehorse is tied to a real provider + service route. It runs controlled probes like a load-testing bot to measure stability, latency, and freshness.",
        image: "/assets/5-single-racehorse.png"
      },
      {
        title: "What Do the Odds Mean?",
        body:
          "Odds are the hype meter. Lower odds like 2-1 or 4-1 are safer favorites with smaller rewards. Longshots like 12-1 or 20-1 need more luck but earn bigger rewards if they place. Check the Lobby Rules to learn how tracks, weather, horse types, and providers shape the odds.",
        image: "/assets/6-odds.png"
      },
      {
        title: "Watch & Win",
        body:
          "Sit back and watch the heats. Any top-5 finish earns rewards, and the final podium earns the biggest rewards. Rewards are sent after the event.",
        image: "/assets/7-race.png"
      },
      {
        title: "Why It Matters",
        body:
          "Every race is a live Arkeo Network testbed — stress‑testing subscribers and providers in real time and proving network strength under pressure.",
        image: "/assets/8-errors.png"
      },
      {
        title: "Thanks for Racing",
        body:
          "Have fun, race bold, and thanks for helping strengthen the Arkeo Network. We appreciate you being part of the community.",
        image: "/assets/9-raceday.png"
      }
    ],
    []
  );

  const [slideIndex, setSlideIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (open) {
      setSlideIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const totalSlides = slides.length;
  const slide = slides[slideIndex];
  const showPlaceholder = failedImages[slideIndex];

  const handleImageError = () => {
    setFailedImages((current) => ({ ...current, [slideIndex]: true }));
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-6 py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quickstart-title"
      onClick={onClose}
    >
      <div
        className="surface w-full max-w-2xl rounded-3xl p-6 md:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-xs uppercase tracking-[0.3em] text-slate">Quickstart</p>
        <h2
          id="quickstart-title"
          className="font-display text-3xl uppercase tracking-[0.1em] text-midnight"
        >
          Take Part in Arkeo Racing Rewards
        </h2>

        <div className="mt-6 rounded-3xl border border-midnight/10 bg-panel/90 p-5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate">
            <span>Quickstart Step</span>
            <span>{slideIndex + 1} / {totalSlides}</span>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-midnight/10 bg-white/70">
            {showPlaceholder ? (
              <div className="flex h-48 items-center justify-center text-xs uppercase tracking-[0.3em] text-slate">
                Screenshot Coming Soon
              </div>
            ) : (
              <img
                src={slide.image}
                alt={`${slide.title} screenshot`}
                className="h-48 w-full object-cover"
                onError={handleImageError}
              />
            )}
          </div>
          <div className="mt-5">
            <h3 className="font-display text-2xl uppercase tracking-[0.1em] text-midnight">
              {slide.title}
            </h3>
            <p className="mt-2 text-sm text-slate">{slide.body}</p>
            {"link" in slide && slide.link ? (
              <a
                href={slide.link.href}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent hover:text-accent/80"
              >
                {slide.link.label}
              </a>
            ) : null}
          </div>
          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setSlideIndex((current) => Math.max(0, current - 1))}
              disabled={slideIndex === 0}
              className="rounded-full border border-midnight/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-midnight transition disabled:opacity-40"
            >
              Back
            </button>
            <div className="flex items-center gap-2">
              {slides.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setSlideIndex(index)}
                  className={`h-2 w-2 rounded-full transition ${
                    index === slideIndex ? "bg-accent" : "bg-midnight/20"
                  }`}
                  aria-label={`Go to step ${index + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSlideIndex((current) => Math.min(totalSlides - 1, current + 1))}
              disabled={slideIndex === totalSlides - 1}
              className="rounded-full bg-accent px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onDontShowAgain}
            className="rounded-full border border-midnight/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-midnight transition hover:border-midnight/40"
          >
            Don&apos;t Show Again
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-accent px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:-translate-y-0.5"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
