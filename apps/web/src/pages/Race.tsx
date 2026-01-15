import React, { useCallback, useEffect, useMemo, useState } from "react";
import TrackView from "../components/TrackView";
import RaceHeader from "../components/RaceHeader";
import RaceTicketCompact from "../components/RaceTicketCompact";
import { useWalletState, useRaceWebSocket, useRaceHeader, useSound } from "../hooks";
import { useRaceDayTicketHorses } from "../hooks/useRaceDayTicketHorses";
import { useRaceSelections, usePrepBaselines, type RaceSelection, type Race } from "../queries";
import { horseStyle } from "../utils/horseStyle";
import { buildRaceDaySlotLabel } from "../utils/racedayLabels";
import { apiGet } from "../api";

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
    nextHeatRace,
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

  const raceStatus = displayRace?.status ?? race?.status ?? null;
  const raceId = displayRace?.raceId ?? race?.raceId ?? null;

  const { soundEnabled } = useSound();
  const bellRef = React.useRef<HTMLAudioElement | null>(null);
  const gallopRef = React.useRef<HTMLAudioElement | null>(null);
  const lastBellRaceIdRef = React.useRef<string | null>(null);
  const prevStatusRef = React.useRef<string | null>(null);

  const playBell = useCallback(() => {
    const bell = bellRef.current;
    if (!bell) return;
    bell.currentTime = 0;
    void bell.play().catch(() => undefined);
  }, []);

  const startGallop = useCallback(() => {
    const gallop = gallopRef.current;
    if (!gallop) return;
    if (gallop.paused) {
      void gallop.play().catch(() => undefined);
    }
  }, []);

  const stopGallop = useCallback(() => {
    const gallop = gallopRef.current;
    if (!gallop) return;
    gallop.pause();
    gallop.currentTime = 0;
  }, []);

  useEffect(() => {
    const bell = new Audio("/audio/race-bell.wav");
    bell.volume = 0.7;
    bell.preload = "auto";
    bellRef.current = bell;

    const gallop = new Audio("/audio/gallop-loop.wav");
    gallop.volume = 0.35;
    gallop.loop = true;
    gallop.preload = "auto";
    gallopRef.current = gallop;

    return () => {
      bell.pause();
      gallop.pause();
      bellRef.current = null;
      gallopRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!soundEnabled) {
      stopGallop();
      return;
    }
    if (raceStatus === "running") {
      startGallop();
    } else {
      stopGallop();
    }
  }, [soundEnabled, raceStatus, startGallop, stopGallop]);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    if (soundEnabled && raceStatus === "running" && prevStatus !== "running") {
      if (raceId && lastBellRaceIdRef.current !== raceId) {
        playBell();
        lastBellRaceIdRef.current = raceId;
      }
      startGallop();
    }
    prevStatusRef.current = raceStatus;
  }, [soundEnabled, raceStatus, raceId, playBell, startGallop]);

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

  // Store previous race's horses when race finishes (for "horses leaving" display)
  const [previousHorses, setPreviousHorses] = useState<typeof displayHorses | null>(null);
  const [previousFinishRanks, setPreviousFinishRanks] = useState<Map<string, number> | null>(null);
  const [previousHeatInfo, setPreviousHeatInfo] = useState<{ round: number | null; heat: number | null } | null>(null);
  const prevRaceIdRef = React.useRef<string | null>(null);

  // Store upcoming race's horses for "horses entering" display
  const [upcomingHorses, setUpcomingHorses] = useState<typeof displayHorses | null>(null);
  const [upcomingHeatInfo, setUpcomingHeatInfo] = useState<{ round: number | null; heat: number | null } | null>(null);
  const upcomingRaceIdRef = React.useRef<string | null>(null);

  // Find the next scheduled heat's raceId for prefetching upcoming horses
  const scheduledHeatRaceId = useMemo(() => {
    if (!raceDay?.rounds?.length) return null;
    let best: { round: number; heat: number; raceId: string | null } | null = null;
    for (const round of raceDay.rounds) {
      for (const heat of round.heats) {
        if (heat.status !== "scheduled" || !heat.raceId) continue;
        if (!best || round.roundNumber < best.round ||
          (round.roundNumber === best.round && heat.heatNumber < best.heat)) {
          best = { round: round.roundNumber, heat: heat.heatNumber, raceId: heat.raceId };
        }
      }
    }
    return best?.raceId ?? null;
  }, [raceDay?.rounds]);

  // Capture horses when race finishes
  useEffect(() => {
    const currentRaceId = displayRace?.raceId ?? race?.raceId;
    const currentStatus = displayRace?.status ?? race?.status;

    // When a race finishes, save its horses and finish ranks
    if (currentStatus === "finished" && currentRaceId && currentRaceId !== prevRaceIdRef.current) {
      setPreviousHorses([...displayHorses]);
      setPreviousFinishRanks(new Map(finishRanks));
      setPreviousHeatInfo({
        round: displayRace?.racedayLevel ?? race?.racedayLevel ?? currentHeatInfo?.round ?? null,
        heat: displayRace?.racedayHeatNumber ?? race?.racedayHeatNumber ?? currentHeatInfo?.heat ?? null
      });
      prevRaceIdRef.current = currentRaceId;
    }
  }, [
    displayRace?.raceId,
    displayRace?.status,
    race?.raceId,
    race?.status,
    displayHorses,
    finishRanks,
    displayRace?.racedayLevel,
    displayRace?.racedayHeatNumber,
    race?.racedayLevel,
    race?.racedayHeatNumber,
    currentHeatInfo?.round,
    currentHeatInfo?.heat
  ]);

  // Ensure previous race horses are captured during buffer (even if displayRace already advanced)
  useEffect(() => {
    if (bufferEvent?.eventType !== "horses_leaving") return;
    const finishedRaceId = currentHeatInfo?.raceId;
    if (!finishedRaceId) return;

    if (prevRaceIdRef.current === finishedRaceId && previousHorses?.length) {
      return;
    }

    const setRanksFromPlacement = (horses: typeof displayHorses) => {
      const ranks = new Map<string, number>();
      horses.forEach((horse) => {
        if (typeof horse.placement === "number") {
          ranks.set(horse.raceHorseId, horse.placement);
        }
      });
      if (ranks.size > 0) {
        setPreviousFinishRanks(ranks);
      } else if (finishRanks.size > 0) {
        setPreviousFinishRanks(new Map(finishRanks));
      }
    };

    if (displayRace?.raceId === finishedRaceId && displayHorses.length > 0) {
      setPreviousHorses([...displayHorses]);
      setRanksFromPlacement(displayHorses);
      setPreviousHeatInfo({
        round: displayRace?.racedayLevel ?? currentHeatInfo?.round ?? null,
        heat: displayRace?.racedayHeatNumber ?? currentHeatInfo?.heat ?? null
      });
      prevRaceIdRef.current = finishedRaceId;
      return;
    }

    let cancelled = false;
    const fetchFinished = async () => {
      try {
        const raceData = await apiGet<Race>(`/api/races/${finishedRaceId}`);
        if (cancelled) return;
        if (raceData?.horses?.length) {
          setPreviousHorses(raceData.horses);
          setRanksFromPlacement(raceData.horses);
          setPreviousHeatInfo({
            round: raceData.racedayLevel ?? currentHeatInfo?.round ?? null,
            heat: raceData.racedayHeatNumber ?? currentHeatInfo?.heat ?? null
          });
          prevRaceIdRef.current = finishedRaceId;
        }
      } catch {
        // Ignore fetch errors; buffer will fall back to current display.
      }
    };

    void fetchFinished();
    return () => {
      cancelled = true;
    };
  }, [
    bufferEvent?.eventType,
    currentHeatInfo?.raceId,
    displayRace?.raceId,
    displayHorses,
    previousHorses?.length,
    finishRanks,
    displayRace?.racedayLevel,
    displayRace?.racedayHeatNumber,
    currentHeatInfo?.round,
    currentHeatInfo?.heat
  ]);

  // Calculate buffer event based on timing
  useEffect(() => {
    // Use nextHeatStartsAt if available (when showing finished heat), otherwise startsAt
    const timingStartsAt = currentHeatInfo?.nextHeatStartsAt ?? currentHeatInfo?.startsAt;

    // Only show buffer events when raceDay is running and we have timing info
    if (raceDay?.status !== "running" || !timingStartsAt) {
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
      const startsAt = new Date(timingStartsAt).getTime();
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
  }, [raceDay?.status, raceDay?.bufferSecs, currentHeatInfo?.startsAt, currentHeatInfo?.nextHeatStartsAt, displayRace?.status, race?.status]);

  // Prefetch upcoming race's horses when a scheduled heat exists
  useEffect(() => {
    if (!scheduledHeatRaceId) {
      return;
    }

    // Don't re-fetch if we already have this race's horses
    if (upcomingRaceIdRef.current === scheduledHeatRaceId) {
      return;
    }

    // Don't fetch if displayRace already has the upcoming race
    if (displayRace?.raceId === scheduledHeatRaceId) {
      return;
    }

    let cancelled = false;
    const fetchUpcoming = async () => {
      try {
        const raceData = await apiGet<Race>(`/api/races/${scheduledHeatRaceId}`);
        if (cancelled) return;
        if (raceData?.horses) {
          setUpcomingHorses(raceData.horses);
          setUpcomingHeatInfo({
            round: raceData.racedayLevel ?? null,
            heat: raceData.racedayHeatNumber ?? null
          });
          upcomingRaceIdRef.current = scheduledHeatRaceId;
        }
      } catch {
        // Ignore fetch errors - will fall back to displayHorses
      }
    };

    void fetchUpcoming();
    return () => { cancelled = true; };
  }, [scheduledHeatRaceId, displayRace?.raceId]);

  // Use next heat snapshot from RaceDay WS when available
  useEffect(() => {
    if (!nextHeatRace?.raceId || !nextHeatRace.horses?.length) {
      return;
    }
    if (upcomingRaceIdRef.current === nextHeatRace.raceId) {
      return;
    }
    setUpcomingHorses(nextHeatRace.horses);
    setUpcomingHeatInfo({
      round: nextHeatRace.racedayLevel ?? null,
      heat: nextHeatRace.racedayHeatNumber ?? null
    });
    upcomingRaceIdRef.current = nextHeatRace.raceId;
  }, [nextHeatRace]);

  // Clear upcoming horses when race starts (displayRace takes over)
  useEffect(() => {
    if (displayRace?.raceId && displayRace.raceId === upcomingRaceIdRef.current) {
      setUpcomingHorses(null);
      setUpcomingHeatInfo(null);
      upcomingRaceIdRef.current = null;
    }
  }, [displayRace?.raceId]);

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

  const trackViewData = useMemo(() => {
    // During "horses_leaving" phase, show the previous race's horses at finish positions
    const isEnteringPhase = bufferEvent?.eventType === "horses_entering";
    const upcomingFromDisplay =
      isEnteringPhase &&
      currentHeatInfo?.raceId &&
      displayRace?.raceId === currentHeatInfo.raceId &&
      displayHorses.length > 0;
    const hasUpcoming = Boolean(upcomingHorses?.length) || upcomingFromDisplay;
    const fallbackToLeaving = isEnteringPhase && !hasUpcoming && previousHorses?.length;
    const isLeavingPhase =
      (bufferEvent?.eventType === "horses_leaving" || fallbackToLeaving) && Boolean(previousHorses?.length);
    const showEntering = isEnteringPhase && hasUpcoming;
    const enteringHorses = upcomingHorses?.length
      ? upcomingHorses
      : upcomingFromDisplay
        ? displayHorses
        : null;

    // Determine which horses to render based on buffer phase
    // - Leaving phase: show previous race's horses at finish line
    // - Entering phase: show upcoming race's horses at starting line
    // - Otherwise: show current displayHorses
    const horsesToRender = showEntering && enteringHorses
      ? enteringHorses
      : isLeavingPhase && previousHorses?.length
        ? previousHorses
        : displayHorses;
    const ranksToUse = isLeavingPhase && previousFinishRanks ? previousFinishRanks : finishRanks;
    const currentRace = displayRace ?? race;
    const trackViewLevel = showEntering
      ? (upcomingHeatInfo?.round ?? currentHeatInfo?.round ?? currentRace?.racedayLevel ?? null)
      : isLeavingPhase
        ? (previousHeatInfo?.round ?? currentRace?.racedayLevel ?? currentHeatInfo?.round ?? null)
        : (currentHeatInfo?.round ?? currentRace?.racedayLevel ?? null);

    return {
      racedayLevel: trackViewLevel,
      horses: horsesToRender.map((horse, index) => {
        const baseline = prepBaselineByHorseId.get(horse.raceHorseId);
        const liveLatency = horse.metrics?.latencyMs;
        const deltaMs =
          typeof baseline === "number" && typeof liveLatency === "number"
            ? baseline - liveLatency
            : null;
        const prepProbes = prepProbesByHorse[horse.raceHorseId];
        const labelRound = currentHeatInfo?.round ?? currentRace?.racedayLevel ?? null;
        const labelHeat = currentHeatInfo?.heat ?? currentRace?.racedayHeatNumber ?? null;
        const laneNumber = horse.lane ?? index + 1;
        const slotLabel =
          labelRound && labelHeat
            ? buildRaceDaySlotLabel(labelRound, labelHeat, laneNumber)
            : undefined;
        const selectedBy = selectedByMap.get(horse.raceHorseId) ?? [];

        // During "horses_entering" phase, reset positions to starting line
        // During "horses_leaving" phase, show horses at finish (position 100)
        const displayPosition = showEntering
          ? 0
          : isLeavingPhase
            ? 100
            : (horse.position ?? 0);

        const jerseyColor =
          jerseyColors.get(horse.raceHorseId) ??
          (horse.horseId ? horseStyle(horse.horseId).patternBaseColor : undefined);

        return {
          raceHorseId: horse.raceHorseId,
          horseId: horse.horseId,
          displayName: horse.displayName,
          position: displayPosition,
          rank: showEntering ? undefined : rankMap.get(horse.raceHorseId),
          finishRank: showEntering ? undefined : ranksToUse.get(horse.raceHorseId),
          serviceIconKey: horse.serviceType?.iconKey,
          serviceName: horse.serviceType?.displayName,
          jerseyColor,
          latencyDeltaMs: deltaMs,
          liveLatencyMs: typeof liveLatency === "number" ? liveLatency : null,
          errorType: horse.metrics?.errorType ?? null,
          selectionCount: selectedBy.length,
          card: {
            horse: {
              raceHorseId: horse.raceHorseId,
              horseId: horse.horseId,
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
            jerseyColor,
            selectedBy
          }
        };
      })
    };
  }, [
    bufferEvent?.eventType,
    currentHeatInfo?.raceId,
    currentHeatInfo?.round,
    currentHeatInfo?.heat,
    displayRace,
    race,
    displayHorses,
    previousHorses,
    upcomingHorses,
    previousFinishRanks,
    finishRanks,
    prepBaselineByHorseId,
    prepProbesByHorse,
    jerseyColors,
    rankMap,
    selectedByMap,
    previousHeatInfo,
    upcomingHeatInfo
  ]);

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
        horses={trackViewData.horses}
        raceStatus={(displayRace ?? race)?.status}
        racedayLevel={trackViewData.racedayLevel}
        event={bufferEvent ?? currentEvent}
      />
    );

  return (
    <div className="flex flex-col gap-6">
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
