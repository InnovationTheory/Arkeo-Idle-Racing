import React, { useEffect, useRef, useState } from "react";
import { useRaceHeader, useWalletState, useSound } from "../hooks";
import { useRaceDayTicketHorses } from "../hooks/useRaceDayTicketHorses";

export default function RaceNotification() {
  const { raceDay, currentHeatInfo, displayRace, nextHeatRace } = useRaceHeader();
  const { walletAddress } = useWalletState();
  const { soundEnabled } = useSound();
  const { ticketHorses } = useRaceDayTicketHorses(walletAddress);
  const [notification, setNotification] = useState<string | null>(null);
  const lastNotifiedRaceRef = useRef<string | null>(null);
  const neighRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const neigh = new Audio("/audio/horse-neigh.wav");
    neigh.volume = 0.6;
    neigh.preload = "auto";
    neighRef.current = neigh;
    return () => {
      neigh.pause();
      neighRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (raceDay?.status !== "running") {
      return;
    }

    const candidateRace = nextHeatRace?.raceId
      ? nextHeatRace
      : displayRace?.status === "scheduled"
        ? displayRace
        : null;

    if (!candidateRace?.raceId || !candidateRace.horses?.length) {
      return;
    }

    if (lastNotifiedRaceRef.current === candidateRace.raceId) {
      return;
    }

    const selectedHorseIds = new Set(ticketHorses.map((h) => h.horseId));
    const selectedHorseNames = new Set(ticketHorses.map((h) => h.displayName.toLowerCase()));

    const racingUserHorses = candidateRace.horses.filter((horse) => {
      if (selectedHorseIds.has(horse.horseId)) return true;
      return selectedHorseNames.has(horse.displayName.toLowerCase());
    });

    if (racingUserHorses.length > 0) {
      lastNotifiedRaceRef.current = candidateRace.raceId;
      const horseNames = racingUserHorses.map((h) => h.displayName).join(", ");
      setNotification(`Your horse is racing: ${horseNames}`);
    }
  }, [raceDay?.status, ticketHorses, nextHeatRace, displayRace]);

  useEffect(() => {
    if (!notification) return;
    if (soundEnabled && neighRef.current) {
      neighRef.current.currentTime = 0;
      void neighRef.current.play().catch(() => undefined);
    }
    const timeout = setTimeout(() => setNotification(null), 12000);
    return () => clearTimeout(timeout);
  }, [notification, soundEnabled]);

  if (!notification) return null;

  return (
    <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-pulse">
      <div className="flex items-center gap-3 rounded-full bg-accent px-6 py-3 shadow-lg">
        <div className="h-2 w-2 rounded-full bg-white" />
        <span className="text-sm font-semibold text-white">{notification}</span>
        <button
          type="button"
          onClick={() => setNotification(null)}
          className="ml-2 text-white/70 hover:text-white"
        >
          ×
        </button>
      </div>
    </div>
  );
}
