import React, { useEffect, useMemo, useState } from "react";
import TrackView from "../components/TrackView";
import RaceHeader from "../components/RaceHeader";
import RaceTicketCompact from "../components/RaceTicketCompact";
import { useWalletState, useRaceWebSocket, useRaceHeader } from "../hooks";
import { useRaceDayTicketHorses } from "../hooks/useRaceDayTicketHorses";
import { useRaceSelections, usePrepBaselines, type RaceSelection } from "../queries";
import { horseStyle } from "../utils/horseStyle";
import { buildRaceDaySlotLabel } from "../utils/racedayLabels";

export default function Race() {
  const walletState = useWalletState();
  const { ticketHorses, estimatedReward, poolSize: ticketPoolSize } = useRaceDayTicketHorses(walletState.walletAddress);

  // Shared RaceHeader data (raceDay, header, countdown, pool)
  const {
    headerRace,
    remainingMs,
    poolSize,
    racedayStatus,
    raceDay,
    currentHeatInfo,
    displayRace,
    displayHorses,
    race,
    updateRace,
    storeWsPositions,
    mergeHorsePositions
  } = useRaceHeader();

  // WebSocket for real-time updates - use displayRace to ensure connection even when race is null
  const { tick, totalTicks, finishRanks, setFinishRanks, currentEvent } = useRaceWebSocket({
    raceId: displayRace?.raceId,
    onRaceUpdate: updateRace,
    storeWsPositions,
    mergeHorsePositions
  });

  // Prep phase baselines for latency delta display
  const { baselineByHorseId: prepBaselineByHorseId, probesByHorse: prepProbesByHorse } =
    usePrepBaselines(displayRace?.raceId);

  // Race selections polling (used for selectedBy display on horse cards)
  const { selections } = useRaceSelections(displayRace?.raceId);

  // Jersey colors for horses - use horseId for consistency with Lobby.tsx
  const jerseyColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const horse of displayHorses) {
      if (horse.horseId) {
        map.set(horse.raceHorseId, horseStyle(horse.horseId).patternBaseColor);
      }
    }
    return map;
  }, [displayHorses]);

  // Buffer event state for between-heat transitions
  const [bufferEvent, setBufferEvent] = useState<{ eventType: string; timestamp: number } | null>(null);

  // Calculate buffer event based on timing
  useEffect(() => {
    // Only show buffer events when raceDay is running and we have a scheduled heat
    if (raceDay?.status !== "running" || !currentHeatInfo?.startsAt) {
      setBufferEvent(null);
      return;
    }

    // Check if current race is not running (we're in buffer)
    const currentRaceStatus = displayRace?.status ?? race?.status;
    const isInBuffer = currentRaceStatus === "finished" || currentRaceStatus === "scheduled";

    if (!isInBuffer) {
      setBufferEvent(null);
      return;
    }

    const updateEvent = () => {
      const startsAt = new Date(currentHeatInfo.startsAt!).getTime();
      const now = Date.now();
      const secondsUntilStart = Math.max(0, Math.floor((startsAt - now) / 1000));
      // Use half of buffer duration as the midpoint for switching messages
      const bufferMidpoint = Math.floor((raceDay.bufferSecs ?? 30) / 2);

      if (secondsUntilStart > bufferMidpoint) {
        setBufferEvent({ eventType: "horses_leaving", timestamp: now });
      } else if (secondsUntilStart > 0) {
        setBufferEvent({ eventType: "horses_entering", timestamp: now });
      } else {
        setBufferEvent(null);
      }
    };

    updateEvent();
    const interval = setInterval(updateEvent, 1000);
    return () => clearInterval(interval);
  }, [raceDay?.status, raceDay?.bufferSecs, currentHeatInfo?.startsAt, displayRace?.status, race?.status]);

  // Notification state for when user's horse is racing
  const [notification, setNotification] = useState<string | null>(null);
  const lastNotifiedHeatRef = React.useRef<string | null>(null);

  // Show notification when horses enter the gates (second half of buffer)
  useEffect(() => {
    // Only trigger during "horses_entering" phase
    if (bufferEvent?.eventType !== "horses_entering") {
      return;
    }

    // Create a unique key for this heat to prevent duplicate notifications
    const heatKey = currentHeatInfo
      ? `${currentHeatInfo.round}-${currentHeatInfo.heat}`
      : null;

    if (!heatKey || lastNotifiedHeatRef.current === heatKey) {
      return;
    }

    // Check if any of user's horses are in this race
    const userHorseNames = ticketHorses.map((h) => h.displayName.toLowerCase());
    const racingUserHorses = displayHorses.filter((h) =>
      userHorseNames.includes(h.displayName.toLowerCase())
    );

    if (racingUserHorses.length > 0) {
      lastNotifiedHeatRef.current = heatKey;
      const horseNames = racingUserHorses.map((h) => h.displayName).join(", ");
      setNotification(`Your horse is racing: ${horseNames}`);
    }
  }, [bufferEvent?.eventType, currentHeatInfo, displayHorses, ticketHorses]);

  // Auto-dismiss notification after 5 seconds
  useEffect(() => {
    if (!notification) return;
    const timeout = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timeout);
  }, [notification]);

  // Update finish ranks from race data when finished
  useEffect(() => {
    if (!race?.raceId || race.status !== "finished") return;
    const placements = new Map<string, number>();
    race.horses
      .filter((horse) => typeof horse.placement === "number")
      .sort((a, b) => (a.placement ?? 999) - (b.placement ?? 999))
      .forEach((horse) => {
        placements.set(horse.raceHorseId, horse.placement as number);
      });
    if (placements.size > 0) {
      setFinishRanks(placements);
    }
  }, [race?.raceId, race?.status, race?.horses, setFinishRanks]);

  // Calculate current rankings based on position
  const rankMap = useMemo(() => {
    if (!displayHorses.length) return new Map<string, number>();
    const ordered = [...displayHorses]
      .map((horse) => ({ ...horse, position: horse.position ?? 0 }))
      .sort((a, b) => b.position - a.position);
    const map = new Map<string, number>();
    ordered.forEach((horse, index) => {
      map.set(horse.raceHorseId, index + 1);
    });
    return map;
  }, [displayHorses]);

  // Format bettor display label
  const bettorLabel = (bettor: RaceSelection["bettor"]) => {
    if (bettor.nickname) return bettor.nickname;
    if (bettor.walletAddress) {
      const value = bettor.walletAddress;
      if (value.length <= 12) return value;
      return `${value.slice(0, 6)}...${value.slice(-4)}`;
    }
    return "Unknown";
  };

  // Map selections to horse IDs for display
  const selectedByMap = useMemo(() => {
    const map = new Map<string, string[]>();
    const byName = new Map(displayHorses.map((horse) => [horse.displayName, horse.raceHorseId]));
    selections.forEach((selection) => {
      const display = bettorLabel(selection.bettor);
      const nameKey = selection.picks[0]?.horseName;
      const horseId = selection.raceHorseId ?? (nameKey ? byName.get(nameKey) : undefined);
      if (!horseId) return;
      const list = map.get(horseId) ?? [];
      if (!list.includes(display)) {
        list.push(display);
        map.set(horseId, list);
      }
    });
    return map;
  }, [selections, displayHorses]);

  // Only show TrackView during running/finished phases, not during polling/picking
  const isPollingOrPicking = racedayStatus === "polling" || racedayStatus === "picking";

  const body =
    isPollingOrPicking ? (
      <div className="surface rounded-3xl p-8 text-center">
        <p className="text-lg font-semibold text-midnight">
          {racedayStatus === "polling" ? "Preparing Races" : "Selection Phase"}
        </p>
        <p className="mt-2 text-slate">
          {racedayStatus === "polling"
            ? "Horses are warming up..."
            : "Make your picks on the Lobby tab"}
        </p>
      </div>
    ) : !displayRace && displayHorses.length === 0 ? (
      <div className="surface rounded-3xl p-6 text-center text-slate">
        Waiting for race data...
      </div>
    ) : (
      <TrackView
        horses={displayHorses.map((horse, index) => {
          const baseline = prepBaselineByHorseId.get(horse.raceHorseId);
          const liveLatency = horse.metrics?.latencyMs;
          const deltaMs =
            typeof baseline === "number" && typeof liveLatency === "number"
              ? baseline - liveLatency
              : null;
          const prepProbes = prepProbesByHorse[horse.raceHorseId];
          const currentRace = displayRace ?? race;
          const isRaceDay = typeof currentRace?.racedayLevel === "number";
          const laneNumber = horse.lane ?? index + 1;
          const slotLabel = isRaceDay && currentRace?.racedayLevel && currentRace?.racedayHeatNumber
            ? buildRaceDaySlotLabel(currentRace.racedayLevel, currentRace.racedayHeatNumber, laneNumber)
            : undefined;
          const selectedBy = selectedByMap.get(horse.raceHorseId) ?? [];
          // During "horses_entering" phase, reset positions to starting line
          const isEnteringPhase = bufferEvent?.eventType === "horses_entering";
          const displayPosition = isEnteringPhase ? 0 : (horse.position ?? 0);
          return {
            raceHorseId: horse.raceHorseId,
            displayName: horse.displayName,
            position: displayPosition,
            rank: isEnteringPhase ? undefined : rankMap.get(horse.raceHorseId),
            finishRank: isEnteringPhase ? undefined : finishRanks.get(horse.raceHorseId),
            serviceIconKey: horse.serviceType?.iconKey,
            serviceName: horse.serviceType?.displayName,
            jerseyColor: jerseyColors.get(horse.raceHorseId),
            latencyDeltaMs: deltaMs,
            liveLatencyMs: typeof liveLatency === "number" ? liveLatency : null,
            errorType: horse.metrics?.errorType ?? null,
            selectionCount: selectedBy.length,
            card: {
              horse: {
                raceHorseId: horse.raceHorseId,
                displayName: horse.displayName,
                handicapTier: horse.handicapTier ?? "Light",
                formScore: horse.formScore ?? 0,
                difficultyMultiplier: horse.difficultyMultiplier ?? 1,
                archetype: horse.archetype,
                temperament: horse.temperament,
                surfaceAffinity: horse.surfaceAffinity,
                odds: horse.odds ?? null,
                record: horse.record,
                serviceType: horse.serviceType,
                assignedProvider: horse.assignedProvider
              },
              prepProbes,
              slotNumber: index + 1,
              slotLabel,
              jerseyColor: jerseyColors.get(horse.raceHorseId),
              selectedBy
            }
          };
        })}
        raceStatus={(displayRace ?? race)?.status}
        racedayLevel={(displayRace ?? race)?.racedayLevel ?? null}
        event={bufferEvent ?? currentEvent}
      />
    );

  return (
    <div className="flex flex-col gap-6">
      {/* Notification toast */}
      {notification && (
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
      )}
      <RaceHeader
        race={headerRace}
        remainingMs={remainingMs}
        poolSize={poolSize}
        racedayStatus={racedayStatus}
      />
      <RaceTicketCompact
        raceId={null}
        ticketHorses={ticketHorses}
        walletState={walletState}
        estimatedReward={estimatedReward}
      />
      {body}
    </div>
  );
}
