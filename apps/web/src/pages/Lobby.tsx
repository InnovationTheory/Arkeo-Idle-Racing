import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import { useWalletState } from "../hooks/useWalletState";
import { useLockedSelection } from "../hooks/useLockedSelection";
import { useRaceDayTicketHorses } from "../hooks/useRaceDayTicketHorses";
import { useRaceHeader } from "../hooks/useRaceHeader";
import { usePrepBaselines, type Race } from "../queries";
import HorseCard from "../components/HorseCard";
import JerseyIcon from "../components/JerseyIcon";
import HorseSilhouette from "../components/HorseSilhouette";
import RaceHeader from "../components/RaceHeader";
import WalletSelectModal from "../components/WalletSelectModal";
import { serviceIconPath } from "../utils/serviceIcons";
import { horseStyle } from "../utils/horseStyle";
import { buildRaceDaySlotLabel } from "../utils/racedayLabels";

type SelectionResponse = {
  selection: { raceHorseId: string } | null;
};

type RaceDayHorse = {
  raceDayHorseId: string;
  horseId: string;
  displayName: string;
  seedOrder: number;
  archetype: string | null;
  temperament: string | null;
  surfaceAffinity: string | null;
  eliminatedRound: number | null;
  eliminatedHeat: number | null;
  finalPlacement: number | null;
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
  entrants: RaceDayHorse[];
  advancers: RaceDayHorse[];
  results: Array<{ raceDayHorseId: string; placement: number }>;
  metadata: Record<string, unknown> | null;
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
  createdAt: string;
  startAt: string | null;
  tickMs: number;
  raceDurationSecs: number;
  pickWindowSecs: number;
  bufferSecs: number;
  totalRounds: number;
  heatsConfig: Record<string, unknown> | null;
  currentRound: number | null;
  currentHeat: number | null;
  rounds: RaceDayRound[];
};

type RaceDaySelectionResponse = {
  selections: string[];
};

type RaceDayHorseDetail = {
  serviceType: { displayName: string; iconKey: string; colorHex?: string };
  providerMoniker: string | null;
  odds: number | null;
};

function formatOdds(odds: number | null | undefined): string {
  if (odds == null) return "";
  if (odds === 1) return "EVEN";
  if (odds === 1.5) return "3-2";
  return `${odds}-1`;
}

export default function Lobby() {
  const walletState = useWalletState();
  const {
    raceCredits,
    walletAddress,
    walletBalance,
    walletType,
    walletSelectOpen,
    connectingType,
    nickname,
    setNickname,
    isNicknameEditing,
    walletMessage,
    nicknameMessage,
    walletLoading,
    nicknameSaving,
    connectWallet,
    disconnectWallet,
    openWalletSelect,
    closeWalletSelect,
    handleNicknameAction,
    cancelNicknameEdit
  } = walletState;
  const hasNickname = Boolean(nickname?.trim());

  // Shared RaceHeader data (raceDay, header, countdown, pool)
  const {
    headerRace,
    remainingMs,
    poolSize,
    racedayStatus,
    raceDay,
    raceDayRacing,
    raceDaySelectionActive,
    preflightProgress,
    displayRace,
    displayHorses
  } = useRaceHeader();

  // Locked selection context (persists across tabs)
  const { lockedHorse, raceId: lockedRaceId, lockSelection, clearSelection } = useLockedSelection();

  const [selected, setSelected] = useState<string[]>([]);
  const [savedSelection, setSavedSelection] = useState<string | null>(null);
  const [raceDaySelections, setRaceDaySelections] = useState<string[]>([]);
  const [raceDaySelectionLoading, setRaceDaySelectionLoading] = useState(false);
  const [raceDaySelectionError, setRaceDaySelectionError] = useState<string | null>(null);
  const [heatIndex, setHeatIndex] = useState(0);
  const [activeHeatRace, setActiveHeatRace] = useState<Race | null>(null);
  const [raceDayHorseDetails, setRaceDayHorseDetails] = useState<Record<string, RaceDayHorseDetail>>({});
  const [myEstimatedReward, setMyEstimatedReward] = useState<number>(0);

  const lastRaceIdRef = useRef<string | null>(null);
  const lastWalletRef = useRef<string | null>(null);
  const lastRaceDayIdRef = useRef<string | null>(null);

  const raceId = displayRace?.raceId ?? null;
  const horsesForDisplay = displayHorses;

  const jerseyColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const horse of horsesForDisplay) {
      if (horse.horseId) {
        map.set(horse.raceHorseId, horseStyle(horse.horseId).patternBaseColor);
      }
    }
    return map;
  }, [horsesForDisplay]);

  useEffect(() => {
    if (!raceDay?.raceDayId || !walletAddress) {
      setRaceDaySelections([]);
      return;
    }
    let mounted = true;
    setRaceDaySelectionLoading(true);
    apiGet<RaceDaySelectionResponse>(`/api/racedays/${raceDay.raceDayId}/selection`)
      .then((data) => {
        if (!mounted) return;
        setRaceDaySelections(data.selections ?? []);
        setRaceDaySelectionError(null);
      })
      .catch((err) => {
        if (!mounted) return;
        setRaceDaySelections([]);
        setRaceDaySelectionError(err instanceof Error ? err.message : "request_failed");
      })
      .finally(() => {
        if (mounted) setRaceDaySelectionLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [raceDay?.raceDayId, walletAddress]);

  // Fetch leaderboard to get user's estimated reward
  useEffect(() => {
    // Reset immediately when raceDay changes - reward is per-raceday, not cumulative
    setMyEstimatedReward(0);

    if (!raceDay?.raceDayId || !walletAddress) {
      return;
    }
    let mounted = true;
    const fetchLeaderboard = async () => {
      try {
        const data = await apiGet<{
          players: Array<{
            walletAddress: string | null;
            estimatedReward: number;
            paidReward?: number | null;
            paymentStatus?: "paid" | "pending" | "failed" | "no_wallet";
          }>;
        }>(`/api/racedays/${raceDay.raceDayId}/leaderboard`);
        if (!mounted) return;
        const myEntry = data.players?.find((p) => p.walletAddress === walletAddress);
        const reward = myEntry?.paymentStatus === "paid" && typeof myEntry.paidReward === "number"
          ? myEntry.paidReward
          : myEntry?.estimatedReward ?? 0;
        setMyEstimatedReward(reward);
      } catch {
        if (mounted) setMyEstimatedReward(0);
      }
    };
    void fetchLeaderboard();
    return () => {
      mounted = false;
    };
  }, [raceDay?.raceDayId, raceDay?.status, walletAddress]);

  const fetchExistingSelection = useCallback(async () => {
    if (!raceId || !walletAddress) {
      setSavedSelection(null);
      return;
    }

    try {
      const data = await apiGet<SelectionResponse>(`/api/races/${raceId}/selection`);
      const selection = data?.selection;
      if (!selection) {
        setSavedSelection(null);
        return;
      }
      setSavedSelection(selection.raceHorseId);
      setSelected([selection.raceHorseId]);
    } catch {
      setSavedSelection(null);
    }
  }, [raceId, walletAddress]);

  // Reset selection state when race changes
  useEffect(() => {
    if (!raceId) {
      lastRaceIdRef.current = null;
      return;
    }
    if (lastRaceIdRef.current && lastRaceIdRef.current !== raceId) {
      setSelected([]);
      setSavedSelection(null);
      // Clear locked selection if race changed
      if (lockedRaceId && lockedRaceId !== raceId) {
        clearSelection();
      }
    }
    lastRaceIdRef.current = raceId;
  }, [raceId, lockedRaceId, clearSelection]);

  useEffect(() => {
    if (lastRaceDayIdRef.current && lastRaceDayIdRef.current !== raceDay?.raceDayId) {
      setRaceDayHorseDetails({});
    }
    lastRaceDayIdRef.current = raceDay?.raceDayId ?? null;
  }, [raceDay?.raceDayId]);

  useEffect(() => {
    if (lastWalletRef.current && lastWalletRef.current !== walletAddress) {
      setSavedSelection(null);
    }
    lastWalletRef.current = walletAddress ?? null;
  }, [walletAddress]);

  useEffect(() => {
    void fetchExistingSelection();
  }, [fetchExistingSelection]);

  useEffect(() => {
    if (selected.length > 1) {
      setSelected(selected.slice(0, 1));
    }
  }, [selected]);

  const levelOne = raceDay?.rounds.find((round) => round.roundNumber === 1) ?? null;
  const levelOneHeats = levelOne?.heats ?? [];
  const activeHeat = levelOneHeats[heatIndex] ?? levelOneHeats[0] ?? null;
  const totalHorsesRound1 = levelOneHeats.reduce((sum, heat) => sum + (heat.entrants?.length ?? 0), 0);
  const raceDayPickCloseAt = raceDay?.startAt ? new Date(raceDay.startAt).getTime() : null;
  const raceDaySelectionOpen = Boolean(
    raceDay?.status === "picking" && (!raceDayPickCloseAt || Date.now() < raceDayPickCloseAt)
  );
  const raceDaySelectionLocked = !raceDaySelectionOpen;
  const raceDayTicketActive = Boolean(raceDay?.raceDayId);
  const prepRaceId = raceDaySelectionActive
    ? activeHeat?.raceId ?? null
    : displayRace?.raceId ?? null;

  // Prep probes from React Query
  const { probesByHorse: prepProbesByHorse } = usePrepBaselines(prepRaceId);

  useEffect(() => {
    if (!raceDaySelectionActive || !activeHeat?.raceId) {
      setActiveHeatRace(null);
      return;
    }
    let mounted = true;
    const fetchActiveHeat = async () => {
      try {
        const data = await apiGet<Race>(`/api/races/${activeHeat.raceId}`);
        if (!mounted) return;
        setActiveHeatRace(data);
      } catch {
        if (!mounted) return;
        setActiveHeatRace(null);
      }
    };
    void fetchActiveHeat();
    return () => {
      mounted = false;
    };
  }, [activeHeat?.raceId, raceDaySelectionActive]);

  const raceHorseIdByHorseId = useMemo(() => {
    const map = new Map<string, string>();
    const sourceRace = raceDaySelectionActive ? activeHeatRace : displayRace;
    if (!sourceRace?.horses) return map;
    sourceRace.horses.forEach((horse) => {
      if (horse.horseId) {
        map.set(horse.horseId, horse.raceHorseId);
      }
    });
    return map;
  }, [activeHeatRace, displayRace, raceDaySelectionActive]);

  useEffect(() => {
    if (heatIndex >= levelOneHeats.length && levelOneHeats.length > 0) {
      setHeatIndex(0);
    }
  }, [heatIndex, levelOneHeats.length]);

  const raceReady = Boolean(raceId);
  const lineupReady = raceDaySelectionActive ? raceDaySelectionOpen : raceReady;
  const selectionLocked = raceDayTicketActive
    ? true
    : !raceReady
      ? true
      : displayRace?.status
        ? ["running", "finished", "voided"].includes(displayRace.status)
        : false;
  const raceDayHorseMap = useMemo(() => {
    const map = new Map<string, RaceDayHorse>();
    if (!raceDay?.rounds) return map;
    raceDay.rounds.forEach((round) => {
      round.heats.forEach((heat) => {
        heat.entrants.forEach((horse) => {
          map.set(horse.raceDayHorseId, horse);
        });
      });
    });
    return map;
  }, [raceDay]);
  const raceDayHorseIdByHorseId = useMemo(() => {
    const map = new Map<string, string>();
    raceDayHorseMap.forEach((entry, raceDayHorseId) => {
      map.set(entry.horseId, raceDayHorseId);
    });
    return map;
  }, [raceDayHorseMap]);
  const raceDaySlotMeta = useMemo(() => {
    const map = new Map<string, { roundNumber: number; heatNumber: number; slotNumber: number }>();
    if (!raceDay?.rounds) return map;
    raceDay.rounds.forEach((round) => {
      round.heats.forEach((heat) => {
        heat.entrants.forEach((horse, index) => {
          const existing = map.get(horse.raceDayHorseId);
          if (!existing || round.roundNumber >= existing.roundNumber) {
            map.set(horse.raceDayHorseId, {
              roundNumber: round.roundNumber,
              heatNumber: heat.heatNumber,
              slotNumber: index + 1
            });
          }
        });
      });
    });
    return map;
  }, [raceDay]);

  const levelOneHeatRaceIds = useMemo(() => {
    const map = new Map<number, string>();
    levelOneHeats.forEach((heat) => {
      if (heat.raceId) {
        map.set(heat.heatNumber, heat.raceId);
      }
    });
    return map;
  }, [levelOneHeats]);
  // Map raceDayHorseId -> Round 1 heat number (for looking up race details)
  const raceDayHorseRound1Heat = useMemo(() => {
    const map = new Map<string, number>();
    const levelOne = raceDay?.rounds.find((round) => round.roundNumber === 1);
    if (!levelOne) return map;
    levelOne.heats.forEach((heat) => {
      heat.entrants.forEach((horse) => {
        map.set(horse.raceDayHorseId, heat.heatNumber);
      });
    });
    return map;
  }, [raceDay]);
  useEffect(() => {
    if (!activeHeatRace?.horses?.length) return;
    setRaceDayHorseDetails((prev) => {
      const next = { ...prev };
      activeHeatRace.horses.forEach((horse) => {
        if (!horse.horseId) return;
        const raceDayHorseId = raceDayHorseIdByHorseId.get(horse.horseId);
        if (!raceDayHorseId) return;
        next[raceDayHorseId] = {
          serviceType: horse.serviceType,
          providerMoniker: horse.assignedProvider?.moniker ?? null,
          odds: horse.odds ?? null
        };
      });
      return next;
    });
  }, [activeHeatRace, raceDayHorseIdByHorseId]);
  useEffect(() => {
    if (!raceDaySelections.length) return;
    const pending = raceDaySelections.filter((id) => !raceDayHorseDetails[id]);
    if (!pending.length) return;
    let cancelled = false;
    const fetchDetails = async () => {
      const updates: Record<string, RaceDayHorseDetail> = {};
      const raceCache = new Map<string, Race>();
      for (const raceDayHorseId of pending) {
        const raceDayHorse = raceDayHorseMap.get(raceDayHorseId);
        if (!raceDayHorse) continue;
        // Use the Round 1 heat number to find the correct race
        const round1HeatNumber = raceDayHorseRound1Heat.get(raceDayHorseId);
        if (!round1HeatNumber) continue;
        const raceId = levelOneHeatRaceIds.get(round1HeatNumber);
        if (!raceId) continue;
        let race = raceCache.get(raceId);
        if (!race) {
          try {
            race = await apiGet<Race>(`/api/races/${raceId}`);
            raceCache.set(raceId, race);
          } catch {
            continue;
          }
        }
        const raceHorse = race.horses?.find((horse) => horse.horseId === raceDayHorse.horseId);
        if (!raceHorse) continue;
        updates[raceDayHorseId] = {
          serviceType: raceHorse.serviceType,
          providerMoniker: raceHorse.assignedProvider?.moniker ?? null,
          odds: raceHorse.odds ?? null
        };
      }
      if (cancelled) return;
      if (Object.keys(updates).length > 0) {
        setRaceDayHorseDetails((prev) => ({ ...prev, ...updates }));
      }
    };
    void fetchDetails();
    return () => {
      cancelled = true;
    };
  }, [raceDaySelections, raceDayHorseDetails, raceDayHorseMap, raceDayHorseRound1Heat, levelOneHeatRaceIds]);
  const raceDayAdvancerIds = useMemo(() => {
    const ids = new Set<string>();
    raceDay?.rounds.forEach((round) => {
      round.heats.forEach((heat) => {
        heat.advancers.forEach((horse) => {
          ids.add(horse.raceDayHorseId);
        });
      });
    });
    return ids;
  }, [raceDay]);

  const raceDayTicketHorses = useMemo(() => {
    if (!raceDaySelections.length) return [];
    const isTournamentComplete = raceDay?.status === "complete";
    const totalRounds = raceDay?.totalRounds ?? 4;
    return raceDaySelections
      .map((id) => {
        const entry = raceDayHorseMap.get(id);
        if (!entry) return null;
        const visual = horseStyle(entry.horseId);
        const slotMeta = raceDaySlotMeta.get(entry.raceDayHorseId);
        const slotLabel = slotMeta
          ? buildRaceDaySlotLabel(slotMeta.roundNumber, slotMeta.heatNumber, slotMeta.slotNumber)
          : undefined;
        const roundNumber = slotMeta?.roundNumber;
        const heatNumber = slotMeta?.heatNumber;
        const detail = raceDayHorseDetails[entry.raceDayHorseId];
        const serviceType = detail?.serviceType ?? {
          displayName: "RaceDay",
          iconKey: "arkeo",
          colorHex: "#F26A3D"
        };

        let status: "pending" | "advancing" | "eliminated" | "winner" = "pending";
        if (entry.eliminatedRound !== null) {
          status = "eliminated";
        } else if (isTournamentComplete && entry.finalPlacement !== null && entry.finalPlacement <= 3) {
          status = "winner";
        } else if (raceDayAdvancerIds.has(entry.raceDayHorseId)) {
          status = "advancing";
        }

        return {
          raceHorseId: entry.raceDayHorseId,
          horseId: entry.horseId,
          displayName: entry.displayName,
          serviceType,
          providerMoniker: detail?.providerMoniker ?? null,
          odds: detail?.odds ?? null,
          jerseyColor: visual.patternBaseColor,
          slotNumber: entry.seedOrder,
          slotLabel,
          roundNumber,
          heatNumber,
          status
        };
      })
      .filter(Boolean) as Array<{
        raceHorseId: string;
        horseId: string;
        displayName: string;
        serviceType: { displayName: string; iconKey: string; colorHex?: string };
        providerMoniker?: string | null;
        odds?: number | null;
        jerseyColor?: string;
        slotNumber?: number;
        slotLabel?: string;
        roundNumber?: number;
        heatNumber?: number;
        status?: "pending" | "advancing" | "eliminated" | "winner";
      }>;
  }, [raceDaySelections, raceDayHorseMap, raceDaySlotMeta, raceDayHorseDetails, raceDayAdvancerIds, raceDay]);
  const selectionRaceHorseId =
    selected[0] ?? lockedHorse?.raceHorseId ?? savedSelection ?? null;
  const selectionHorse = selectionRaceHorseId
    ? horsesForDisplay.find((horse) => horse.raceHorseId === selectionRaceHorseId) ?? null
    : null;
  const ticketHorse = selectionHorse
    ? {
        raceHorseId: selectionHorse.raceHorseId,
        horseId: selectionHorse.horseId,
        displayName: selectionHorse.displayName,
        serviceType: {
          displayName: selectionHorse.serviceType.displayName,
          iconKey: selectionHorse.serviceType.iconKey
        },
        providerMoniker: selectionHorse.assignedProvider?.moniker ?? null,
        jerseyColor: jerseyColors.get(selectionHorse.raceHorseId),
        slotNumber:
          horsesForDisplay.findIndex(
            (horse) => horse.raceHorseId === selectionHorse.raceHorseId
          ) + 1,
        slotLabel: undefined,
        status: "pending" as const
      }
    : lockedHorse
      ? {
          raceHorseId: lockedHorse.raceHorseId,
          horseId: lockedHorse.horseId,
          displayName: lockedHorse.displayName,
          serviceType: lockedHorse.serviceType,
          providerMoniker: lockedHorse.providerMoniker ?? null,
          jerseyColor: lockedHorse.jerseyColor,
          slotNumber: lockedHorse.slotNumber ?? null,
          slotLabel: lockedHorse.slotLabel,
          status: "pending" as const
        }
      : null;

  const toggleHorse = (raceHorseId: string) => {
    if (selectionLocked || !walletAddress || !hasNickname) return;
    setSelected((prev) => {
      if (prev.includes(raceHorseId)) return [];
      return [raceHorseId];
    });
  };

  const confirmSelection = useCallback(async (raceHorseId: string) => {
    if (!raceId || selectionLocked || !walletAddress || !hasNickname) return;
    const horseIndex = horsesForDisplay.findIndex((h) => h.raceHorseId === raceHorseId);
    const horse = horseIndex >= 0 ? horsesForDisplay[horseIndex] : null;
    if (!horse) return;

    // Lock in the selection locally
    const jerseyColor = jerseyColors.get(raceHorseId);
    setSelected([raceHorseId]);
    lockSelection({
      raceHorseId: horse.raceHorseId,
      horseId: horse.horseId,
      displayName: horse.displayName,
      serviceType: {
        displayName: horse.serviceType.displayName,
        iconKey: horse.serviceType.iconKey
      },
      jerseyColor,
      providerMoniker: horse.assignedProvider?.moniker,
      slotNumber: horseIndex + 1
    }, raceId);

    // Also save to API if wallet connected
    if (walletAddress) {
      try {
        const payload = await apiPost<SelectionResponse>(`/api/races/${raceId}/selection`, {
          raceHorseId
        });
        const nextSelection = payload?.selection?.raceHorseId ?? raceHorseId;
        setSavedSelection(nextSelection);
      } catch {
        // Selection errors are handled silently - the local selection is already locked
      }
    }
  }, [raceId, selectionLocked, horsesForDisplay, jerseyColors, lockSelection, walletAddress, hasNickname]);

  const handleRaceDaySelectHorse = useCallback(async (raceDayHorseId: string) => {
    if (!raceDay?.raceDayId || raceDaySelectionLocked || !walletAddress || !hasNickname) return;
    if (!raceDaySelections.includes(raceDayHorseId) && raceDaySelections.length >= 3) {
      setRaceDaySelectionError("Selection limit reached.");
      return;
    }
    setRaceDaySelectionLoading(true);
    setRaceDaySelectionError(null);
    try {
      const payload = await apiPost<RaceDaySelectionResponse>(
        `/api/racedays/${raceDay.raceDayId}/selection`,
        { raceDayHorseId }
      );
      setRaceDaySelections(payload.selections ?? []);
    } catch (err) {
      setRaceDaySelectionError(err instanceof Error ? err.message : "request_failed");
    } finally {
      setRaceDaySelectionLoading(false);
    }
  }, [raceDay?.raceDayId, raceDaySelectionLocked, walletAddress, raceDaySelections, hasNickname]);

  const clearSelectionChoice = useCallback(async () => {
    setSelected([]);
    setSavedSelection(null);
    clearSelection();

    if (!raceId || !walletAddress) return;
    try {
      await apiDelete(`/api/races/${raceId}/selection`);
    } catch {
      // Ignore clear errors to avoid blocking UI state reset
    }
  }, [raceId, walletAddress, clearSelection]);

  return (
    <div className="flex flex-col gap-7">
      <RaceHeader
        race={headerRace}
        remainingMs={remainingMs}
        poolSize={poolSize}
        racedayStatus={racedayStatus}
      />

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-4">
          {/* Status block - shown during scheduled, polling, and picking phases */}
          {(raceDay?.status === "scheduled" || raceDay?.status === "polling" || raceDay?.status === "picking") && (
            <div className="surface relative flex flex-col gap-3 md:gap-4 rounded-3xl p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">
                    {raceDay?.status === "picking" ? "Choose Your Racehorses" : "Preparing Races"}
                  </p>
                  <h3 className="font-display text-xl md:text-3xl uppercase tracking-[0.1em] text-ink">
                    {raceDay?.status === "scheduled"
                      ? "Waiting for event to start"
                      : raceDay?.status === "polling"
                        ? preflightProgress
                          ? `Warming Up ${preflightProgress.completedHorses} of ${preflightProgress.totalHorses} Racehorses`
                          : `Warming Up ${totalHorsesRound1 > 0 ? `${totalHorsesRound1} Racehorses` : ""}`
                        : "Make Your Picks"}
                  </h3>
                </div>
              </div>
              {/* Heat selector buttons - shown during picking phase */}
              {raceDay?.status === "picking" && levelOneHeats.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {levelOneHeats.map((heat, idx) => (
                    <button
                      key={heat.heatId}
                      type="button"
                      onClick={() => setHeatIndex(idx)}
                      className={`rounded-full px-3 py-1.5 md:px-4 md:py-2 text-[10px] md:text-xs font-semibold uppercase tracking-[0.15em] transition ${
                        heatIndex === idx
                          ? "bg-accent text-white"
                          : "bg-midnight/10 text-midnight hover:bg-midnight/20"
                      }`}
                    >
                      Heat {heat.heatNumber}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Go watch the race - shown during running phase */}
          {raceDay?.status === "running" && (
            <div className="surface relative flex flex-col gap-3 md:gap-4 rounded-3xl p-4 md:p-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">Race In Progress</p>
                  <h3 className="font-display text-xl md:text-3xl uppercase tracking-[0.1em] text-ink">
                    Go Watch the Race
                  </h3>
                </div>
                <a
                  href="/race"
                  className="rounded-full bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:-translate-y-0.5"
                >
                  Watch Now
                </a>
              </div>
            </div>
          )}
          {/* Horse Lineup - ONLY shown during picking phase */}
          {raceDaySelectionOpen ? (
            <>
              <div className="flex flex-col gap-3">
                {activeHeat?.entrants?.length ? (
                  activeHeat.entrants.map((entry, entryIndex) => {
                    const isSelected = raceDaySelections.includes(entry.raceDayHorseId);
                    const limitReached = raceDaySelections.length >= 3;
                    const visual = horseStyle(entry.horseId);
                    const slotLabel = activeHeat?.roundNumber && activeHeat?.heatNumber
                      ? buildRaceDaySlotLabel(activeHeat.roundNumber, activeHeat.heatNumber, entryIndex + 1)
                      : undefined;
                    const raceHorseDetail =
                      activeHeatRace?.horses?.find((horse) => horse.horseId === entry.horseId) ??
                      null;
                    const raceHorseId =
                      raceHorseDetail?.raceHorseId ?? raceHorseIdByHorseId.get(entry.horseId) ?? null;
                    const serviceType = raceHorseDetail?.serviceType ?? {
                      displayName: "RaceDay",
                      iconKey: "arkeo",
                      colorHex: "#F26A3D"
                    };
                    return (
                      <HorseCard
                        key={entry.raceDayHorseId}
                        horse={{
                          raceHorseId: entry.raceDayHorseId,
                          horseId: entry.horseId,
                          displayName: entry.displayName,
                          handicapTier: "Light",
                          formScore: 0,
                          difficultyMultiplier: 1,
                          archetype: entry.archetype ?? undefined,
                          temperament: entry.temperament ?? undefined,
                          surfaceAffinity: entry.surfaceAffinity ?? undefined,
                          odds: raceHorseDetail?.odds ?? null,
                          record: raceHorseDetail?.record,
                          serviceType,
                          assignedProvider: raceHorseDetail?.assignedProvider ?? null
                        }}
                        slotLabel={slotLabel}
                        jerseyColor={visual.patternBaseColor}
                        prepProbes={raceHorseId ? prepProbesByHorse[raceHorseId] : undefined}
                        raceStatus={activeHeatRace?.status ?? displayRace?.status}
                        selected={isSelected}
                        locked={
                          raceDaySelectionLoading ||
                          !walletAddress ||
                          !hasNickname ||
                          (!isSelected && limitReached)
                        }
                        onToggle={handleRaceDaySelectHorse}
                        onConfirmSelection={handleRaceDaySelectHorse}
                        interactive
                      />
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-midnight/10 bg-panel/90 px-4 py-3 text-sm text-slate">
                    No entrants loaded for this heat yet.
                  </div>
                )}
              </div>
              {raceDaySelectionError && (
                <div className="text-xs uppercase tracking-[0.2em] text-warning">
                  {raceDaySelectionError}
                </div>
              )}
              {!walletAddress ? (
                <div className="text-xs uppercase tracking-[0.2em] text-slate">
                  Connect your wallet to select a horse.
                </div>
              ) : !hasNickname ? (
                <div className="text-xs uppercase tracking-[0.2em] text-slate">
                  Add a nickname to select a horse.
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <section className="surface relative overflow-hidden rounded-3xl border border-midnight/10 bg-[#FBF6EF] p-6">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-midnight/5" />
            <div className="pointer-events-none absolute left-8 top-0 h-full border-l border-dashed border-midnight/20" />
            <div className="pointer-events-none absolute left-4 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90 text-[10px] uppercase tracking-[0.4em] text-slate">
              Race Ticket
            </div>

            <div className="relative z-10 pl-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">Race Ticket</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {!walletAddress ? (
                      <h3 className="font-display text-3xl uppercase tracking-[0.1em] text-ink">
                        Connect a Wallet
                      </h3>
                    ) : isNicknameEditing ? (
                      <>
                        <input
                          className="w-48 rounded-xl border border-midnight/10 bg-panel/90 px-4 py-2 text-2xl uppercase tracking-[0.1em]"
                          placeholder="Add Nickname"
                          value={nickname}
                          onChange={(event) => setNickname(event.target.value)}
                        />
                        <button
                          type="button"
                          onClick={handleNicknameAction}
                          disabled={nicknameSaving}
                          className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.2em] transition ${
                            nicknameSaving
                              ? "bg-ink/10 text-slate"
                              : "bg-accent text-white hover:-translate-y-0.5"
                          }`}
                        >
                          {nicknameSaving ? "Saving" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelNicknameEdit}
                          disabled={nicknameSaving}
                          className="rounded-full border border-midnight/20 px-3 py-2 text-xs uppercase tracking-[0.2em] text-midnight transition disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <h3 className="font-display text-3xl uppercase tracking-[0.1em] text-ink">
                          {nickname || "Add Nickname"}
                        </h3>
                        {walletAddress && (
                          <button
                            type="button"
                            onClick={handleNicknameAction}
                            disabled={nicknameSaving}
                            className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] transition ${
                              nicknameSaving
                                ? "bg-ink/10 text-slate"
                                : "bg-accent text-white hover:-translate-y-0.5"
                            }`}
                          >
                            {nicknameSaving ? "Saving" : "Edit"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {nicknameMessage && (
                    <p className="mt-2 rounded-xl bg-midnight/5 px-3 py-2 text-xs text-slate">
                      {nicknameMessage}
                    </p>
                  )}
                  {typeof myEstimatedReward === "number" && myEstimatedReward > 0 && (
                    <p className="mt-1 text-sm font-semibold text-accent2">
                      Rewards: {myEstimatedReward.toFixed(8)} ARKEO
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 border-t border-dashed border-midnight/20 pt-4">
                <p className="mb-3 text-xs uppercase tracking-[0.3em] text-slate">Your Selections</p>
                <p className="mb-3 text-xs text-slate">
                  Pick up to 3 racehorses for your ticket.
                </p>
                <div className="flex flex-col gap-3">
                  {raceDayTicketActive && raceDayTicketHorses.length > 0 ? (
                    raceDayTicketHorses.map((horse) => {
                      const visual = horseStyle(horse.horseId);
                      const coatColor = visual.coatColor;
                      const ticketIcon = horse.serviceType?.iconKey
                        ? serviceIconPath(horse.serviceType.iconKey, horse.serviceType.displayName)
                        : null;
                      const horseStatus = horse.status ?? "pending";
                      const isEliminated = horseStatus === "eliminated";
                      const isAdvancing = horseStatus === "advancing" || horseStatus === "winner";
                      const borderClass = isEliminated
                        ? "border-2 border-warning"
                        : isAdvancing
                          ? "border-2 border-accent2"
                          : "border border-midnight/10";
                      return (
                        <div
                          key={horse.raceHorseId}
                          className={`group relative flex w-full items-center gap-2 rounded-2xl bg-panel/80 px-3 py-3 ${borderClass}`}
                        >
                          <div className={`flex flex-1 items-center gap-2 ${isEliminated ? "grayscale" : ""}`}>
                            <div className="flex flex-col items-center">
                              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center" style={{ marginTop: -4 }}>
                                <HorseSilhouette
                                  width={42}
                                  height={42}
                                  className="drop-shadow-sm"
                                  style={{ color: coatColor }}
                                />
                                {ticketIcon && (
                                  <div
                                    className="absolute z-20 flex items-center justify-center overflow-hidden rounded-full border border-midnight/10 bg-panel shadow-sm"
                                    style={{
                                      width: 18,
                                      height: 18,
                                      top: -2,
                                      left: "50%",
                                      transform: "translateX(-50%) translateX(-2px)"
                                    }}
                                  >
                                    <img
                                      src={ticketIcon}
                                      alt=""
                                      className="h-full w-full rounded-full object-cover"
                                    />
                                  </div>
                                )}
                                {horse.jerseyColor && (
                                  <div
                                    className="absolute left-1/2 top-1/2 z-10"
                                    style={{ transform: "translate(-50%, -50%) translateX(-2px)" }}
                                  >
                                    <JerseyIcon
                                      seed={horse.horseId ?? horse.raceHorseId}
                                      width={12}
                                      height={20}
                                      shape="square"
                                      baseColor={horse.jerseyColor}
                                      className="rounded-sm shadow-sm"
                                    />
                                  </div>
                                )}
                              </div>
                              {(horseStatus !== "pending" || horse.slotLabel) && (
                                <div className="flex items-center gap-1">
                                  {horseStatus !== "pending" && (
                                    <div
                                      className={`flex h-4 w-4 items-center justify-center rounded-full ${
                                        isEliminated ? "bg-warning" : "bg-accent2"
                                      }`}
                                    >
                                      {isEliminated ? (
                                        <svg width="8" height="8" viewBox="0 0 12 12" fill="none" className="text-white">
                                          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                        </svg>
                                      ) : (
                                        <svg width="8" height="8" viewBox="0 0 12 12" fill="none" className="text-white">
                                          <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      )}
                                    </div>
                                  )}
                                  {horse.slotLabel && (
                                    <span className="text-[8px] font-semibold uppercase tracking-wide text-slate whitespace-nowrap" style={{ marginTop: 1 }}>
                                      {horse.slotLabel.replace(/\n/g, " ")}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold leading-tight text-ink">
                                {horse.displayName}
                                {horse.odds != null && (
                                  <span className="ml-2 text-green-600">{formatOdds(horse.odds)}</span>
                                )}
                              </p>
                              <p className="text-[10px] uppercase tracking-[0.2em] text-slate">
                                {horse.serviceType?.displayName ?? "RaceDay"}
                              </p>
                              {(horse.providerMoniker || horse.roundNumber || horse.heatNumber) && (
                                <div className="mt-1 flex flex-col items-start gap-1">
                                  {horse.providerMoniker && (
                                    <span className="inline-flex rounded-full bg-midnight/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-midnight">
                                      {horse.providerMoniker}
                                    </span>
                                  )}
                                  {(typeof horse.roundNumber === "number" || typeof horse.heatNumber === "number") && (
                                    <div className="flex flex-wrap items-center gap-1">
                                      {typeof horse.roundNumber === "number" && (
                                        <span className="inline-flex rounded-full bg-accent2/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-accent2">
                                          Round {horse.roundNumber}
                                        </span>
                                      )}
                                      {typeof horse.heatNumber === "number" && (
                                        <span className="inline-flex rounded-full bg-accent2/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-accent2">
                                          Heat {horse.heatNumber}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          {!raceDaySelectionLocked && (
                            <button
                              type="button"
                              onClick={() => handleRaceDaySelectHorse(horse.raceHorseId)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-warning/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-white opacity-0 transition hover:bg-warning group-hover:opacity-100"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      );
                    })
                  ) : ticketHorse ? (
                    (() => {
                      const visual = horseStyle(ticketHorse.horseId);
                      const coatColor = visual.coatColor;
                      const ticketIcon = ticketHorse.serviceType?.iconKey
                        ? serviceIconPath(ticketHorse.serviceType.iconKey, ticketHorse.serviceType.displayName)
                        : null;
                      return (
                        <div className="group relative flex w-full items-center gap-2 rounded-2xl border border-midnight/10 bg-panel/80 px-3 py-3">
                          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center" style={{ marginTop: -12 }}>
                            <HorseSilhouette
                              width={42}
                              height={42}
                              className="drop-shadow-sm"
                              style={{ color: coatColor }}
                            />
                            {ticketIcon && (
                              <div
                                className="absolute z-20 flex items-center justify-center overflow-hidden rounded-full border border-midnight/10 bg-panel shadow-sm"
                                style={{
                                  width: 18,
                                  height: 18,
                                  top: -2,
                                  left: "50%",
                                  transform: "translateX(-50%) translateX(-2px)"
                                }}
                              >
                                <img
                                  src={ticketIcon}
                                  alt=""
                                  className="h-full w-full rounded-full object-cover"
                                />
                              </div>
                            )}
                            {ticketHorse.jerseyColor && (
                              <div
                                className="absolute left-1/2 top-1/2 z-10"
                                style={{ transform: "translate(-50%, -50%) translateX(-2px)" }}
                              >
                                <JerseyIcon
                                  seed={ticketHorse.horseId ?? ticketHorse.raceHorseId}
                                  width={12}
                                  height={20}
                                  shape="square"
                                  baseColor={ticketHorse.jerseyColor}
                                  className="rounded-sm shadow-sm"
                                />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold leading-tight text-ink">{ticketHorse.displayName}</p>
                            <p className="text-[10px] uppercase tracking-[0.2em] text-slate">
                              {ticketHorse.serviceType?.displayName ?? "RaceDay"}
                            </p>
                            {(ticketHorse.providerMoniker || ticketHorse.roundNumber || ticketHorse.heatNumber) && (
                              <div className="mt-1 flex flex-col items-start gap-1">
                                {ticketHorse.providerMoniker && (
                                  <span className="inline-flex rounded-full bg-midnight/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-midnight">
                                    {ticketHorse.providerMoniker}
                                  </span>
                                )}
                                {(typeof ticketHorse.roundNumber === "number" || typeof ticketHorse.heatNumber === "number") && (
                                  <div className="flex flex-wrap items-center gap-1">
                                    {typeof ticketHorse.roundNumber === "number" && (
                                      <span className="inline-flex rounded-full bg-accent2/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-accent2">
                                        Round {ticketHorse.roundNumber}
                                      </span>
                                    )}
                                    {typeof ticketHorse.heatNumber === "number" && (
                                      <span className="inline-flex rounded-full bg-accent2/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-accent2">
                                        Heat {ticketHorse.heatNumber}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          {!selectionLocked && (
                            <button
                              type="button"
                              onClick={clearSelectionChoice}
                              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-warning/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-white opacity-0 transition hover:bg-warning group-hover:opacity-100"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <div className="text-sm text-slate">No horses selected yet.</div>
                  )}
                </div>
              </div>

              <div className="mt-4 border-t border-midnight/10 pt-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate">Wallet</p>
                <div className="mt-3 flex flex-col gap-3">
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={walletAddress ? disconnectWallet : openWalletSelect}
                      disabled={walletLoading}
                      className={`rounded-full px-4 py-2 text-xs uppercase tracking-[0.2em] transition ${
                        walletLoading
                          ? "bg-ink/10 text-slate"
                          : "bg-accent text-white hover:-translate-y-0.5"
                      }`}
                    >
                      {walletAddress ? "Disconnect Wallet" : "Connect Wallet"}
                    </button>
                  </div>

                  <div className="rounded-xl border border-midnight/10 bg-panel/90 px-3 py-2 text-center text-xs text-slate">
                    {walletAddress ? (
                      <>
                        <p className="text-ink">Address: <span className="font-mono">{walletAddress.slice(0, 10)}...{walletAddress.slice(-6)}</span></p>
                        <p className="text-ink">Balance: {walletBalance ?? "--"}</p>
                      </>
                    ) : (
                      <p>Not connected.</p>
                    )}
                  </div>

                  {walletMessage && (
                    <p className="rounded-xl bg-midnight/5 px-3 py-2 text-xs text-slate">
                      {walletMessage}
                    </p>
                  )}
                </div>
              </div>

            </div>
          </section>

          <div className="surface relative flex h-fit flex-col gap-4 rounded-3xl p-6">
            <div
              className="pointer-events-none absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  "radial-gradient(circle at top, rgba(230,184,92,0.18), transparent 60%)"
              }}
            />
            <div className="relative z-10">
              <p className="text-xs uppercase tracking-[0.3em] text-slate">How to play</p>
              <h3 className="font-display text-3xl uppercase tracking-[0.1em] text-ink">
                The Rules
              </h3>
            </div>

            <div className="relative z-10 flex flex-col gap-3 border-t border-dashed border-midnight/20 pt-4">
              <div className="flex flex-col gap-4 text-sm text-ink/80">
                <div className="pt-1">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">How It Works</p>
                  <p className="mt-2">
                    Pick up to 3 horses to support across the tournament. Participation is free.
                    No payment or staking is required.
                  </p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>Connect your wallet.</li>
                    <li>Add a nickname to your account.</li>
                    <li>Select up to 3 horses from the Round 1 heats.</li>
                    <li>Watch the races unfold across 4 rounds.</li>
                    <li>Top 5 horses advance in each race. In the final race, the top 3 win.</li>
                    <li>Earn rewards as your horses advance and finish in the top 3.</li>
                  </ol>
                </div>

                <div className="border-t border-dashed border-midnight/20 pt-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">Track Types</p>
                  <p className="mt-2">
                    Tracks vary by length, pace, and surface. Short tracks favor fast starts,
                    long tracks reward stamina and late surges.
                  </p>
                  <ul className="mt-2 space-y-1 pl-4">
                    <li>Short: fast ticks, quick races, early speed matters.</li>
                    <li>Medium: balanced pace, steady performance wins.</li>
                    <li>Long: more ticks, endurance and late moves matter.</li>
                    <li>Surface: dirt, turf, or synthetic can shift performance.</li>
                  </ul>
                </div>

                <div className="border-t border-dashed border-midnight/20 pt-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">Weather</p>
                  <p className="mt-2">
                    Weather adds unpredictable pressure to the race. It can increase latency,
                    jitter, and error rates, creating spikes and shakeups mid‑race.
                  </p>
                  <ul className="mt-2 space-y-1 pl-4">
                    <li>Clear: stable conditions and smoother pacing.</li>
                    <li>Haze/Winds: moderate jitter and occasional spikes.</li>
                    <li>Storms: higher error pressure and volatility.</li>
                  </ul>
                </div>

                <div className="border-t border-dashed border-midnight/20 pt-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">Horse Types</p>
                  <p className="mt-2">
                    Every horse has a racing style that shapes how it performs across the race.
                  </p>
                  <ul className="mt-2 space-y-1 pl-4">
                    <li>Front Runner: fast start, can fade late.</li>
                    <li>Stalker: steady and consistent, stays in range.</li>
                    <li>Stretch Runner: slow early, strong late finish.</li>
                    <li>Grinder: durable, gains late through stamina.</li>
                    <li>Burst: one big surge, high variance.</li>
                    <li>Erratic: unpredictable spikes and drops.</li>
                  </ul>
                  <p className="mt-2 text-xs text-slate">
                    Temperament controls volatility: calm, normal, or volatile.
                  </p>
                </div>

                <div className="border-t border-dashed border-midnight/20 pt-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">Odds</p>
                  <p className="mt-2">
                    Odds are the pre-race hype meter based on archetype, temperament, surface,
                    and past performance. Lower odds signal a stronger favorite; higher odds mean
                    a longer shot.
                  </p>
                  <ul className="mt-2 space-y-1 pl-4">
                    <li>EVEN, 3‑2, 4‑1: safer favorites with smaller rewards.</li>
                    <li>12‑1 or 20‑1: longshots that need more luck but pay bigger.</li>
                  </ul>
                  <p className="mt-2 text-xs text-slate">
                    Odds weight rewards. Bigger odds earn a larger share if they place.
                  </p>
                </div>

                <div className="border-t border-dashed border-midnight/20 pt-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">
                    Reward Distribution
                  </p>
                  <p className="mt-2">
                    The reward pool is split among qualifying selections at each stage.
                  </p>
                  <p className="mt-2 font-semibold">Advancement Rewards:</p>
                  <ul className="mt-1 space-y-0.5 pl-4">
                    <li>Round 2: 1/9 of pool</li>
                    <li>Round 3: 2/9 of pool</li>
                  </ul>
                  <p className="mt-2 font-semibold">Final Placements (Round 4):</p>
                  <ul className="mt-1 space-y-0.5 pl-4">
                    <li>1st Place: 3/9 of pool</li>
                    <li>2nd Place: 2/9 of pool</li>
                    <li>3rd Place: 1/9 of pool</li>
                  </ul>
                  <p className="mt-2 text-xs text-slate">
                    Rewards stack. A 1st place finisher earns R2 + R3 + placement rewards.
                  </p>
                </div>

                <div className="border-t border-dashed border-midnight/20 pt-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">
                    Free to Participate
                  </p>
                  <p className="mt-2">
                    No purchase, payment, or staking is required to join. Selections do not
                    involve wagering or risk of loss.
                  </p>
                </div>

              </div>
            </div>

          </div>
        </div>
      </section>

      <WalletSelectModal
        isOpen={walletSelectOpen}
        onClose={closeWalletSelect}
        onSelect={connectWallet}
        loading={walletLoading}
        loadingType={connectingType}
      />
    </div>
  );
}
