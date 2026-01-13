import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../api";

export type HorseRecord = {
  wins: number;
  places: number;
  shows: number;
  advances: number;
  races: number;
  dnfs: number;
};

export type RaceHorse = {
  raceHorseId: string;
  horseId: string;
  lane?: number;
  displayName: string;
  position?: number;
  placement?: number | null;
  handicapTier?: string;
  formScore?: number;
  difficultyMultiplier?: number;
  archetype?: "front_runner" | "stalker" | "stretch_runner" | "grinder" | "burst" | "erratic";
  temperament?: "calm" | "normal" | "volatile";
  surfaceAffinity?: "dirt_specialist" | "turf_specialist" | "mud_lover" | "all_surface";
  odds?: number | null;
  record?: HorseRecord;
  metrics?: {
    latencyMs?: number | null;
    p95Ms?: number | null;
    errorRate?: number | null;
    perfScore?: number | null;
    errorType?: string | null;
  };
  serviceType: { colorHex: string; iconKey: string; displayName: string };
  assignedProvider?: { providerPubkey: string; moniker?: string | null } | null;
};

export type Race = {
  raceId: string;
  status: string;
  track: { name: string };
  weather: { name: string };
  pickCloseAt?: string;
  startAt?: string;
  racedayLevel?: number | null;
  racedayHeatNumber?: number | null;
  racedayHeatCount?: number | null;
  racedayStatus?: string | null;
  horses: RaceHorse[];
};

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

export function useRacePolling() {
  const [race, setRace] = useState<Race | null>(null);
  const [archiveRace, setArchiveRace] = useState<Race | null>(null);
  const horsesByRaceIdRef = useRef(new Map<string, Race["horses"]>());
  const lastHorsesRef = useRef<Race["horses"]>([]);

  const displayRace = race?.raceId ? race : archiveRace;

  const displayHorses = useMemo(() => {
    if (displayRace?.horses?.length) {
      return displayRace.horses;
    }
    if (displayRace?.raceId) {
      return horsesByRaceIdRef.current.get(displayRace.raceId) ?? lastHorsesRef.current;
    }
    return lastHorsesRef.current;
  }, [displayRace?.raceId, displayRace?.horses]);

  // Expose setRace for WebSocket updates
  const updateRace = (updater: (prev: Race | null) => Race | null) => {
    setRace(updater);
  };

  useEffect(() => {
    let mounted = true;
    let interval: number | null = null;

    const cacheHorses = (nextRace: Race | null | undefined) => {
      if (!nextRace?.raceId || !nextRace.horses?.length) return;
      horsesByRaceIdRef.current.set(nextRace.raceId, nextRace.horses);
      lastHorsesRef.current = nextRace.horses;
    };

    const fetchRace = async () => {
      try {
        const data = await apiGet<Race>("/api/races/current");
        if (!mounted) return;
        if (data?.raceId) {
          setRace((prev) => {
            if (!prev || prev.raceId !== data.raceId) {
              const merged = mergeHorsePositions(data);
              cacheHorses(merged);
              return merged;
            }
            if (data.horses && data.horses.length > 0) {
              const merged = mergeHorsePositions(data, prev.horses);
              cacheHorses(merged);
              return merged;
            }
            return prev;
          });
          setArchiveRace(null);
          return;
        }
        const archive = await apiGet<{ races: Race[] }>("/api/races?limit=1");
        const latest = archive?.races?.[0];
        if (!mounted) return;
        if (latest?.raceId) {
          cacheHorses(latest);
          setArchiveRace(latest);
        } else {
          setArchiveRace(null);
        }
      } catch {
        if (!mounted) return;
        try {
          const archive = await apiGet<{ races: Race[] }>("/api/races?limit=1");
          const latest = archive?.races?.[0];
          if (!mounted) return;
          if (latest?.raceId) {
            cacheHorses(latest);
            setArchiveRace(latest);
          }
        } catch {
          // Keep the last known horses on screen if the API blips.
        }
      }
    };

    void fetchRace();
    interval = window.setInterval(fetchRace, 2000);

    return () => {
      mounted = false;
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [race?.raceId]);

  return {
    race,
    archiveRace,
    displayRace,
    displayHorses,
    updateRace,
    mergeHorsePositions
  };
}
