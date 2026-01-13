import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { apiGet } from "../api";
import { queryKeys, pollingIntervals } from "../queryClient";
import type { Race, RaceHorse, HorseRecord } from "../hooks/useRacePolling";

export type { Race, RaceHorse, HorseRecord };

const autoRaceEnabled = import.meta.env.VITE_AUTO_RACE_ENABLED === "1";

function mergeHorsePositions(incoming: Race, previousHorses?: Race["horses"]): Race {
  if (!incoming.horses?.length || !previousHorses?.length) return incoming;

  const prevPositions = new Map(
    previousHorses.map((horse) => [horse.raceHorseId, horse.position])
  );
  const prevMetrics = new Map(
    previousHorses.map((horse) => [horse.raceHorseId, horse.metrics])
  );

  return {
    ...incoming,
    horses: incoming.horses.map((horse) => {
      if (typeof horse.position === "number") return horse;
      const prevPosition = prevPositions.get(horse.raceHorseId);
      const prevMetric = prevMetrics.get(horse.raceHorseId);
      if (typeof prevPosition === "number") {
        return { ...horse, position: prevPosition, metrics: prevMetric ?? horse.metrics };
      }
      return { ...horse, metrics: prevMetric ?? horse.metrics };
    })
  };
}

async function fetchCurrentRace(): Promise<{ race: Race | null; isArchive: boolean }> {
  try {
    const data = await apiGet<Race>("/api/races/current");
    if (data?.raceId) {
      return { race: data, isArchive: false };
    }
    if (!autoRaceEnabled) {
      return { race: null, isArchive: false };
    }
  } catch {
    // Fall through to archive
  }

  if (!autoRaceEnabled) {
    return { race: null, isArchive: false };
  }

  try {
    const archive = await apiGet<{ races: Race[] }>("/api/races?limit=1");
    const latest = archive?.races?.[0];
    if (latest?.raceId) {
      return { race: latest, isArchive: true };
    }
  } catch {
    // Return null
  }

  return { race: null, isArchive: false };
}

export function useCurrentRace() {
  const queryClient = useQueryClient();
  const horsesCacheRef = useRef(new Map<string, Race["horses"]>());
  const lastHorsesRef = useRef<Race["horses"]>([]);
  // Store WebSocket positions separately to prevent polling from overwriting them
  const wsPositionsRef = useRef(new Map<string, { position: number; metrics?: Race["horses"][0]["metrics"] }>());

  const query = useQuery({
    queryKey: queryKeys.currentRace,
    queryFn: async () => {
      const result = await fetchCurrentRace();

      // Cache horses when we get new data
      if (result.race?.raceId && result.race.horses?.length) {
        horsesCacheRef.current.set(result.race.raceId, result.race.horses);
        lastHorsesRef.current = result.race.horses;
      } else if (!autoRaceEnabled && !result.race) {
        lastHorsesRef.current = [];
      }

      return result;
    },
    refetchInterval: pollingIntervals.currentRace,
    select: (data) => {
      // Merge with previous horse positions to preserve WebSocket updates
      const prevData = queryClient.getQueryData<{ race: Race | null; isArchive: boolean }>(
        queryKeys.currentRace
      );
      if (data.race && prevData?.race?.raceId === data.race.raceId) {
        return {
          ...data,
          race: mergeHorsePositions(data.race, prevData.race.horses)
        };
      }
      return data;
    }
  });

  const race = query.data?.isArchive ? null : query.data?.race ?? null;
  const archiveRace = query.data?.isArchive ? query.data.race : null;
  const displayRace = race ?? archiveRace;

  // Clear WebSocket positions when race changes
  // Only clear when we actually have a new race ID, not when displayRace is temporarily undefined
  const prevRaceIdRef = useRef<string | null>(null);
  if (displayRace?.raceId && displayRace.raceId !== prevRaceIdRef.current) {
    wsPositionsRef.current.clear();
    prevRaceIdRef.current = displayRace.raceId;
  }

  const displayHorses = useMemo(() => {
    let horses: Race["horses"] = [];
    if (displayRace?.horses?.length) {
      horses = displayRace.horses;
    } else if (!autoRaceEnabled && !displayRace?.raceId) {
      return [];
    } else if (displayRace?.raceId) {
      horses = horsesCacheRef.current.get(displayRace.raceId) ?? lastHorsesRef.current;
    } else {
      horses = lastHorsesRef.current;
    }

    // Apply WebSocket positions for running races (these are more up-to-date than polling)
    const wsSize = wsPositionsRef.current.size;
    const shouldApplyWsPositions = displayRace?.status === "running" && wsSize > 0;

    if (shouldApplyWsPositions) {
      return horses.map((horse) => {
        const wsData = wsPositionsRef.current.get(horse.raceHorseId);
        if (wsData) {
          return {
            ...horse,
            position: wsData.position,
            metrics: wsData.metrics ?? horse.metrics
          };
        }
        return horse;
      });
    }

    return horses;
  }, [displayRace?.raceId, displayRace?.horses, displayRace?.status]);

  // Function to update race from WebSocket
  const updateRace = useCallback(
    (updater: (prev: Race | null) => Race | null) => {
      queryClient.setQueryData<{ race: Race | null; isArchive: boolean }>(
        queryKeys.currentRace,
        (prev) => {
          if (!prev) return prev;
          const updatedRace = updater(prev.race);
          return { ...prev, race: updatedRace };
        }
      );
    },
    [queryClient]
  );

  // Function to store WebSocket positions (called from tick updates)
  const storeWsPositions = useCallback(
    (horses: { raceHorseId: string; position: number; metrics?: Race["horses"][0]["metrics"] }[]) => {
      for (const horse of horses) {
        wsPositionsRef.current.set(horse.raceHorseId, {
          position: horse.position,
          metrics: horse.metrics
        });
      }
    },
    []
  );

  return {
    race,
    archiveRace,
    displayRace,
    displayHorses,
    updateRace,
    storeWsPositions,
    mergeHorsePositions,
    isLoading: query.isLoading,
    error: query.error
  };
}
