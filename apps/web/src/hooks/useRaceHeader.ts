import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import { connectRaceDayWs } from "../ws";
import { useRaceCountdown } from "./useRaceCountdown";
import { useCurrentRace, type Race } from "../queries";

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
  raceId: string | null;
  trackName?: string | null;
  trackSurface?: string | null;
  // When showing a finished heat during buffer, this holds the next heat's startsAt for timing
  nextHeatStartsAt?: string | null;
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
  racedayName?: string | null;
  pickCloseAt?: string | null;
  startAt?: string | null;
};

// RaceDay statuses that indicate an active event
const ACTIVE_RACEDAY_STATUSES = ["scheduled", "polling", "picking", "running"];

export type PreflightProgress = {
  completedHorses: number;
  totalHorses: number;
  completedHeats: number;
  totalHeats: number;
};

/**
 * Shared hook for RaceHeader data across all tabs.
 * Provides consistent raceDay state, currentHeatInfo, and headerRace object.
 */
export function useRaceHeader() {
  const [raceDay, setRaceDay] = useState<RaceDayState | null>(null);
  const [preflightProgress, setPreflightProgress] = useState<PreflightProgress | null>(null);
  const [nextHeatRace, setNextHeatRace] = useState<Race | null>(null);

  // Get current race data for track/weather info and horse list
  const { displayRace, race, displayHorses, updateRace, storeWsPositions, mergeHorsePositions } = useCurrentRace();

  // Fetch raceDay data on mount and poll (only active racedays)
  useEffect(() => {
    let mounted = true;
    let interval: number | null = null;

    const fetchRaceDay = async () => {
      try {
        const data = await apiGet<{ latest: RaceDayState | null }>("/api/racedays");
        if (!mounted) return;
        // Only store active racedays - ignore completed/canceled
        const latest = data.latest;
        if (latest && ACTIVE_RACEDAY_STATUSES.includes(latest.status)) {
          setRaceDay(latest);
        } else {
          setRaceDay(null);
        }
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
        const updated = message.data as RaceDayState;
        // Clear raceDay if it's no longer active
        if (ACTIVE_RACEDAY_STATUSES.includes(updated.status)) {
          setRaceDay(updated);
          // Clear preflight progress when polling ends
          if (updated.status !== "polling") {
            setPreflightProgress(null);
          }
        } else {
          setRaceDay(null);
          setPreflightProgress(null);
        }
      } else if (message.type === "preflight_progress") {
        const progress = message.data as PreflightProgress & { raceDayId: string };
        setPreflightProgress({
          completedHorses: progress.completedHorses,
          totalHorses: progress.totalHorses,
          completedHeats: progress.completedHeats,
          totalHeats: progress.totalHeats
        });
      } else if (message.type === "next_race_state") {
        const nextRace = message.data as Race;
        if (nextRace?.raceId) {
          setNextHeatRace(nextRace);
        }
      }
    });

    return () => connection.close();
  }, [raceDay?.raceDayId]);

  // Clear next heat snapshot once the race begins
  useEffect(() => {
    if (displayRace?.raceId && nextHeatRace?.raceId && displayRace.raceId === nextHeatRace.raceId) {
      setNextHeatRace(null);
    }
  }, [displayRace?.raceId, nextHeatRace?.raceId]);

  // Find current active heat for header display
  const currentHeatInfo = useMemo((): CurrentHeatInfo | null => {
    if (!raceDay?.rounds) return null;

    // Only look for heats when raceDay is in an active state
    const activeStates = ["polling", "picking", "running"];
    if (!activeStates.includes(raceDay.status)) return null;

    // Helper to find heat with lowest heatNumber matching a status
    const findLowestHeat = (status: string): { round: typeof raceDay.rounds[0]; heat: RaceDayHeat } | null => {
      let best: { round: typeof raceDay.rounds[0]; heat: RaceDayHeat } | null = null;
      for (const round of raceDay.rounds) {
        for (const heat of round.heats) {
          if (heat.status === status) {
            if (!best || round.roundNumber < best.round.roundNumber ||
                (round.roundNumber === best.round.roundNumber && heat.heatNumber < best.heat.heatNumber)) {
              best = { round, heat };
            }
          }
        }
      }
      return best;
    };

    // Helper to find most recently finished heat (highest round/heat number among finished)
    const findMostRecentFinished = (): { round: typeof raceDay.rounds[0]; heat: RaceDayHeat } | null => {
      let best: { round: typeof raceDay.rounds[0]; heat: RaceDayHeat } | null = null;
      for (const round of raceDay.rounds) {
        for (const heat of round.heats) {
          if (heat.status === "finished") {
            if (!best || round.roundNumber > best.round.roundNumber ||
                (round.roundNumber === best.round.roundNumber && heat.heatNumber > best.heat.heatNumber)) {
              best = { round, heat };
            }
          }
        }
      }
      return best;
    };

    const buildHeatInfo = (
      round: typeof raceDay.rounds[0],
      heat: RaceDayHeat,
      nextHeatStartsAt?: string | null
    ): CurrentHeatInfo => ({
      round: round.roundNumber,
      heat: heat.heatNumber,
      totalHeats: round.heatsCount,
      pickCloseAt: heat.pickCloseAt,
      startsAt: heat.startsAt,
      raceId: heat.raceId,
      trackName: heat.metadata?.trackName ?? null,
      trackSurface: heat.metadata?.trackSurface ?? null,
      nextHeatStartsAt
    });

    // First look for running heat (lowest round/heat number)
    const running = findLowestHeat("running");
    if (running) return buildHeatInfo(running.round, running.heat);

    // Then look for picking heat
    const picking = findLowestHeat("picking");
    if (picking) return buildHeatInfo(picking.round, picking.heat);

    // During running phase, check if we're in first half of buffer (show finished heat)
    if (raceDay.status === "running") {
      const scheduled = findLowestHeat("scheduled");
      const finished = findMostRecentFinished();

      if (scheduled && finished && scheduled.heat.startsAt) {
        const now = Date.now();
        const nextStartsAt = new Date(scheduled.heat.startsAt).getTime();
        const secondsUntilStart = Math.max(0, Math.floor((nextStartsAt - now) / 1000));
        const bufferMidpoint = Math.floor((raceDay.bufferSecs ?? 30) / 2);

        // If we're in first half of buffer (more than midpoint seconds until next race), show finished heat
        // but include nextHeatStartsAt so buffer timing still works
        if (secondsUntilStart > bufferMidpoint) {
          return buildHeatInfo(finished.round, finished.heat, scheduled.heat.startsAt);
        }
      }

      // Otherwise show the scheduled heat (second half of buffer or no finished heat)
      if (scheduled) return buildHeatInfo(scheduled.round, scheduled.heat);
    }

    // For picking phase, just show scheduled heat
    if (raceDay.status === "picking") {
      const scheduled = findLowestHeat("scheduled");
      if (scheduled) return buildHeatInfo(scheduled.round, scheduled.heat);
    }

    return null;
  }, [raceDay]);

  // Build race object for header - only show data when there's an active raceDay
  const headerRace = useMemo((): HeaderRace | null => {
    // No active raceDay means no header data
    if (!raceDay) {
      return null;
    }

    // RaceDay exists but no current heat info yet (e.g., polling/scheduled phase)
    if (!currentHeatInfo) {
      return {
        raceId: "raceday",
        status: "scheduled",
        racedayLevel: 1,
        racedayHeatNumber: 1,
        racedayHeatCount: 8,
        racedayStatus: raceDay.status,
        racedayName: raceDay.name
      };
    }

    // Use track from displayRace if available, otherwise from heat metadata
    const track = displayRace?.track ?? (currentHeatInfo.trackName ? {
      name: currentHeatInfo.trackName,
      surface: currentHeatInfo.trackSurface ?? "dirt"
    } : null);

    // During buffer (scheduled race in running raceDay), prioritize currentHeatInfo
    // which comes from raceDay state and is more accurate than displayRace
    const isBufferPeriod = displayRace?.status === "scheduled" && raceDay.status === "running";
    const useHeatInfoPriority = isBufferPeriod || !displayRace?.racedayHeatNumber;

    return {
      raceId: displayRace?.raceId ?? "raceday",
      // Use actual race status when raceDay is running (allows "finished" during buffer)
      status: raceDay.status === "picking"
        ? "picking"
        : displayRace?.status ?? "scheduled",
      track,
      weather: displayRace?.weather, // Weather only available after race is created
      racedayLevel: useHeatInfoPriority ? currentHeatInfo.round : (displayRace?.racedayLevel ?? currentHeatInfo.round),
      racedayHeatNumber: useHeatInfoPriority ? currentHeatInfo.heat : (displayRace?.racedayHeatNumber ?? currentHeatInfo.heat),
      racedayHeatCount: useHeatInfoPriority ? currentHeatInfo.totalHeats : (displayRace?.racedayHeatCount ?? currentHeatInfo.totalHeats),
      racedayStatus: raceDay.status,
      racedayName: raceDay.name,
      pickCloseAt: useHeatInfoPriority ? currentHeatInfo.pickCloseAt : (displayRace?.pickCloseAt ?? currentHeatInfo.pickCloseAt),
      startAt: useHeatInfoPriority ? currentHeatInfo.startsAt : (displayRace?.startAt ?? currentHeatInfo.startsAt)
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

    // Preflight progress (during polling phase)
    preflightProgress,

    // Next heat snapshot (for buffer display)
    nextHeatRace,

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
