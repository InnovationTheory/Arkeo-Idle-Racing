import { useEffect, useState, useCallback } from "react";
import { connectRaceWs } from "../ws";
import type { Race } from "./useRacePolling";

type TickUpdate = {
  tick: number;
  totalTicks: number;
  horses: {
    raceHorseId: string;
    position: number;
    metrics?: {
      latencyMs?: number | null;
      p95Ms?: number | null;
      errorRate?: number | null;
      perfScore?: number | null;
      errorType?: string | null;
    };
  }[];
};

export type RaceEvent = {
  eventType: string;
  raceHorseId?: string;
  horseName?: string;
  tick?: number;
  ticksRemaining?: number;
  horsesInContention?: number;
  gap?: number;
  reason?: string;
  timestamp: number;
};

type UseRaceWebSocketOptions = {
  raceId: string | null | undefined;
  onRaceUpdate: (updater: (prev: Race | null) => Race | null) => void;
  storeWsPositions: (horses: { raceHorseId: string; position: number; metrics?: Race["horses"][0]["metrics"] }[]) => void;
  mergeHorsePositions: (incoming: Race, previousHorses?: Race["horses"]) => Race;
};

const EVENT_DISPLAY_DURATION = 3000; // How long events stay visible

export function useRaceWebSocket({
  raceId,
  onRaceUpdate,
  storeWsPositions,
  mergeHorsePositions
}: UseRaceWebSocketOptions) {
  const [tick, setTick] = useState(0);
  const [totalTicks, setTotalTicks] = useState(0);
  const [finishRanks, setFinishRanks] = useState<Map<string, number>>(new Map());
  const [currentEvent, setCurrentEvent] = useState<RaceEvent | null>(null);

  // Reset state when race changes
  useEffect(() => {
    setFinishRanks(new Map());
    setCurrentEvent(null);
  }, [raceId]);

  // Auto-clear events after display duration
  useEffect(() => {
    if (!currentEvent) return;
    const timer = setTimeout(() => setCurrentEvent(null), EVENT_DISPLAY_DURATION);
    return () => clearTimeout(timer);
  }, [currentEvent]);

  useEffect(() => {
    if (!raceId) return;

    const connection = connectRaceWs(raceId, (message) => {
      if (message.type === "race_state") {
        onRaceUpdate((prev) => {
          if (!prev) return message.data;
          return mergeHorsePositions(message.data, prev.horses);
        });
      }

      if (message.type === "tick_update") {
        const update = message.data as TickUpdate;
        setTick(update.tick);
        setTotalTicks(update.totalTicks);

        // Store positions in ref for stable display (prevents polling from resetting positions)
        storeWsPositions(update.horses);

        onRaceUpdate((prev) => {
          if (!prev) return prev;
          const positions = new Map(
            update.horses.map((horse) => [horse.raceHorseId, horse.position])
          );
          const metrics = new Map(
            update.horses.map((horse) => [horse.raceHorseId, horse.metrics ?? null])
          );
          return {
            ...prev,
            horses: prev.horses.map((horse) => ({
              ...horse,
              position: positions.get(horse.raceHorseId) ?? horse.position ?? 0,
              metrics: metrics.get(horse.raceHorseId) ?? horse.metrics
            }))
          };
        });

        setFinishRanks((prev) => {
          let changed = false;
          const next = new Map(prev);
          for (const entry of update.horses) {
            if (entry.position >= 100 && !next.has(entry.raceHorseId)) {
              next.set(entry.raceHorseId, next.size + 1);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }

      // Handle race events (lead changes, phase transitions, etc.)
      if (message.type === "event") {
        const eventData = message.data as Omit<RaceEvent, "timestamp">;
        // Only show events we care about for the banner
        const showableEvents = [
          "race_started",
          "lead_change",
          "entering_stretch",
          "final_stretch",
          "photo_finish",
          "desperation_surge",
          "weather_spike"
        ];
        if (showableEvents.includes(eventData.eventType)) {
          setCurrentEvent({
            ...eventData,
            timestamp: Date.now()
          });
        }
      }
    });

    return () => connection.close();
  }, [raceId, onRaceUpdate, storeWsPositions, mergeHorsePositions]);

  return { tick, totalTicks, finishRanks, setFinishRanks, currentEvent };
}
