import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import { connectRaceDayWs } from "../ws";
import { useRaceCountdown } from "./useRaceCountdown";
import { useCurrentRace } from "../queries";

type HeatMetadata = {
  trackId?: string;
  trackName?: string;
  trackSurface?: string;
  trackDurationSecs?: number;
};

type RaceDayHeat = {
  heatId: string;
  roundNumber: number;
  heatNumber: number;
  status: string;
  raceId: string | null;
  startsAt: string | null;
  pickCloseAt: string | null;
  endsAt: string | null;
  metadata?: HeatMetadata | null;
};

type RaceDayRound = {
  roundId: string;
  roundNumber: number;
  status: string;
  heatsCount: number;
  startsAt: string | null;
  endsAt: string | null;
  heats: RaceDayHeat[];
};

type RaceDayState = {
  raceDayId: string;
  name: string;
  status: string;
  poolCredits: number;
  bufferSecs: number;
  rounds: RaceDayRound[];
};

export type CurrentHeatInfo = {
  round: number;
  heat: number;
  totalHeats: number;
  pickCloseAt: string | null;
  startsAt: string | null;
  trackName?: string | null;
  trackSurface?: string | null;
};

export type HeaderRace = {
  raceId: string;
  status: string;
  track?: { name: string; surface: string } | null;
  weather?: { condition: string } | null;
  racedayLevel: number;
  racedayHeatNumber: number;
  racedayHeatCount: number;
  racedayStatus: string;
  pickCloseAt?: string | null;
  startAt?: string | null;
};

// RaceDay statuses that indicate an active event
const ACTIVE_RACEDAY_STATUSES = ["scheduled", "polling", "picking", "running"];

/**
 * Shared hook for RaceHeader data across all tabs.
 * Provides consistent raceDay state, currentHeatInfo, and headerRace object.
 */
export function useRaceHeader() {
  const [raceDay, setRaceDay] = useState<RaceDayState | null>(null);

  // Get current race data for track/weather info and horse list
  const { displayRace, race, displayHorses, updateRace, storeWsPositions, mergeHorsePositions } = useCurrentRace();

  // Fetch raceDay data on mount and poll
  useEffect(() => {
    let mounted = true;
    let interval: number | null = null;

    const fetchRaceDay = async () => {
      try {
        const data = await apiGet<{ latest: RaceDayState | null }>("/api/racedays");
        if (!mounted) return;
        setRaceDay(data.latest ?? null);
      } catch {
        if (!mounted) return;
        setRaceDay(null);
      }
    };

    void fetchRaceDay();
    interval = window.setInterval(fetchRaceDay, 10000);

    return () => {
      mounted = false;
      if (interval) window.clearInterval(interval);
    };
  }, []);

  // WebSocket for real-time raceDay updates
  useEffect(() => {
    if (!raceDay?.raceDayId) return;

    const connection = connectRaceDayWs(raceDay.raceDayId, (message) => {
      if (message.type === "raceday_state") {
        setRaceDay(message.data as RaceDayState);
      }
    });

    return () => connection.close();
  }, [raceDay?.raceDayId]);

  // Find current active heat for header display
  const currentHeatInfo = useMemo((): CurrentHeatInfo | null => {
    if (!raceDay?.rounds) return null;

    // Only look for heats when raceDay is in an active state
    const activeStates = ["polling", "picking", "running"];
    if (!activeStates.includes(raceDay.status)) return null;

    // First look for running heat
    for (const round of raceDay.rounds) {
      const runningHeat = round.heats.find((heat) => heat.status === "running");
      if (runningHeat) {
        return {
          round: round.roundNumber,
          heat: runningHeat.heatNumber,
          totalHeats: round.heatsCount,
          pickCloseAt: runningHeat.pickCloseAt,
          startsAt: runningHeat.startsAt,
          trackName: runningHeat.metadata?.trackName ?? null,
          trackSurface: runningHeat.metadata?.trackSurface ?? null
        };
      }
    }

    // Then look for picking heat
    for (const round of raceDay.rounds) {
      const pickingHeat = round.heats.find((heat) => heat.status === "picking");
      if (pickingHeat) {
        return {
          round: round.roundNumber,
          heat: pickingHeat.heatNumber,
          totalHeats: round.heatsCount,
          pickCloseAt: pickingHeat.pickCloseAt,
          startsAt: pickingHeat.startsAt,
          trackName: pickingHeat.metadata?.trackName ?? null,
          trackSurface: pickingHeat.metadata?.trackSurface ?? null
        };
      }
    }

    // Then look for scheduled heat (next up) - during picking or running phases
    if (raceDay.status === "running" || raceDay.status === "picking") {
      for (const round of raceDay.rounds) {
        const scheduledHeat = round.heats.find((heat) => heat.status === "scheduled");
        if (scheduledHeat) {
          return {
            round: round.roundNumber,
            heat: scheduledHeat.heatNumber,
            totalHeats: round.heatsCount,
            pickCloseAt: scheduledHeat.pickCloseAt,
            startsAt: scheduledHeat.startsAt,
            trackName: scheduledHeat.metadata?.trackName ?? null,
            trackSurface: scheduledHeat.metadata?.trackSurface ?? null
          };
        }
      }
    }

    return null;
  }, [raceDay]);

  // Build race object for header - prefer raceDay data when available
  const headerRace = useMemo((): HeaderRace | null => {
    if (!currentHeatInfo || !raceDay) {
      // Fall back to displayRace if no raceDay active
      if (displayRace) {
        return {
          raceId: displayRace.raceId,
          status: displayRace.status,
          track: displayRace.track,
          weather: displayRace.weather,
          racedayLevel: displayRace.racedayLevel ?? 1,
          racedayHeatNumber: displayRace.racedayHeatNumber ?? 1,
          racedayHeatCount: displayRace.racedayHeatCount ?? 1,
          racedayStatus: raceDay?.status ?? displayRace.status,
          pickCloseAt: displayRace.pickCloseAt,
          startAt: displayRace.startAt
        };
      }
      // If raceDay exists and is active (not complete/canceled), return fallback
      if (raceDay && ACTIVE_RACEDAY_STATUSES.includes(raceDay.status)) {
        return {
          raceId: "raceday",
          status: "scheduled",
          racedayLevel: 1,
          racedayHeatNumber: 1,
          racedayHeatCount: 8,
          racedayStatus: raceDay.status
        };
      }
      return null;
    }

    // Use track from displayRace if available, otherwise from heat metadata
    const track = displayRace?.track ?? (currentHeatInfo.trackName ? {
      name: currentHeatInfo.trackName,
      surface: currentHeatInfo.trackSurface ?? "dirt"
    } : null);

    // Prefer displayRace values for heat info since that's the actual race being displayed
    // This ensures consistency when running parallel heats
    return {
      raceId: displayRace?.raceId ?? "raceday",
      // Use actual race status when raceDay is running (allows "finished" during buffer)
      status: raceDay.status === "picking"
        ? "picking"
        : displayRace?.status ?? "scheduled",
      track,
      weather: displayRace?.weather, // Weather only available after race is created
      racedayLevel: displayRace?.racedayLevel ?? currentHeatInfo.round,
      racedayHeatNumber: displayRace?.racedayHeatNumber ?? currentHeatInfo.heat,
      racedayHeatCount: displayRace?.racedayHeatCount ?? currentHeatInfo.totalHeats,
      racedayStatus: raceDay.status,
      pickCloseAt: displayRace?.pickCloseAt ?? currentHeatInfo.pickCloseAt,
      startAt: displayRace?.startAt ?? currentHeatInfo.startsAt
    };
  }, [currentHeatInfo, raceDay, displayRace]);

  // Countdown timer
  const remainingMs = useRaceCountdown(
    currentHeatInfo?.pickCloseAt ?? displayRace?.pickCloseAt
  );

  // Pool size from raceDay (only for active raceDays)
  const isActiveRaceDay = raceDay && ACTIVE_RACEDAY_STATUSES.includes(raceDay.status);
  const poolSize = isActiveRaceDay ? raceDay.poolCredits : 0;

  // RaceDay status for components that need it (only for active raceDays)
  const racedayStatus = isActiveRaceDay ? raceDay.status : null;

  // Is raceDay actively racing (not picking)?
  const raceDayRacing = raceDay?.status === "running";

  // Is raceDay in selection phase?
  const raceDaySelectionActive = raceDay?.status === "polling" || raceDay?.status === "picking";

  return {
    // Core header data
    headerRace,
    remainingMs,
    poolSize,
    racedayStatus,

    // RaceDay state
    raceDay,
    currentHeatInfo,

    // Computed flags
    raceDayRacing,
    raceDaySelectionActive,

    // Race data from useCurrentRace (for pages that need it)
    displayRace,
    displayHorses,
    race,

    // Race update functions (for Race.tsx WebSocket)
    updateRace,
    storeWsPositions,
    mergeHorsePositions
  };
}
