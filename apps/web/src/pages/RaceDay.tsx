import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import RaceHeader from "../components/RaceHeader";
import RaceTicketCompact from "../components/RaceTicketCompact";
import HorseSilhouette from "../components/HorseSilhouette";
import JerseyIcon from "../components/JerseyIcon";
import { useWalletState } from "../hooks/useWalletState";
import { useRaceCountdown } from "../hooks/useRaceCountdown";
import { useRaceDayTicketHorses } from "../hooks/useRaceDayTicketHorses";
import { contrastColor, horseStyle } from "../utils/horseStyle";
import { buildRaceDaySlotLabel } from "../utils/racedayLabels";
import { archetypeLabels, temperamentLabels } from "../utils/archetypes";

function formatOdds(odds: number | null | undefined): string {
  if (odds == null) return "";
  if (odds === 1) return "EVEN";
  if (odds === 1.5) return "3-2";
  return `${odds}-1`;
}

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

type HorseDetail = {
  serviceType: { displayName: string; iconKey: string };
  providerMoniker: string | null;
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
  poolCredits: number;
  heatsConfig: Record<string, unknown> | null;
  currentRound: number | null;
  currentHeat: number | null;
  rounds: RaceDayRound[];
};

type RaceDaySelectionResponse = {
  selections: string[];
};

type RaceDayListItem = {
  raceDayId: string;
  name: string;
  status: string;
  createdAt: string;
  startAt: string | null;
};

type RoundReward = {
  round: number | string;
  reward: number;
  label: string;
};

type LeaderboardSelection = {
  raceDayHorseId: string;
  displayName: string;
  eliminated: boolean;
  eliminatedRound: number | null;
  finalPlacement: number | null;
  estimatedReward: number;
  roundRewards?: RoundReward[];
};

type LeaderboardPlayer = {
  userId: string;
  nickname: string | null;
  walletAddress: string | null;
  selections: LeaderboardSelection[];
  advancingCount: number;
  topPlacement: number;
  estimatedReward: number;
};

type ServiceStats = {
  serviceTypeId: string;
  serviceTypeName: string;
  serviceTypeIcon: string;
  totalProbes: number;
  successfulProbes: number;
  successRate: number;
  errors: Array<{ errorType: string; count: number; sampleMessage: string | null }>;
};

type ProviderStats = {
  providerPubkey: string;
  providerMoniker: string;
  services: ServiceStats[];
};

export default function RaceDay() {
  const [searchParams] = useSearchParams();
  const raceDayIdParam = searchParams.get("id");
  const [raceDayList, setRaceDayList] = useState<RaceDayListItem[]>([]);
  const [selectedRaceDayId, setSelectedRaceDayId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [heatIndex, setHeatIndex] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardPlayer[]>([]);
  const [providerStats, setProviderStats] = useState<ProviderStats[]>([]);
  const [hoveredHorse, setHoveredHorse] = useState<RaceDayHorse | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const walletState = useWalletState();

  // Use shared hook for raceDay data, selections, ticketHorses, and horseDetails
  const targetRaceDayId = selectedRaceDayId ?? raceDayIdParam ?? undefined;
  const {
    raceDay,
    selections,
    ticketHorses,
    estimatedReward: myEstimatedReward,
    horseDetails,
    refetchSelections
  } = useRaceDayTicketHorses(walletState.walletAddress, targetRaceDayId);

  // Fetch list of all racedays
  useEffect(() => {
    let mounted = true;
    const fetchList = async () => {
      try {
        const data = await apiGet<{ racedays: RaceDayListItem[] }>("/api/racedays/list");
        if (!mounted) return;
        setRaceDayList(data.racedays ?? []);
      } catch {
        if (!mounted) return;
        setRaceDayList([]);
      }
    };
    void fetchList();
    return () => {
      mounted = false;
    };
  }, []);

  // Fetch leaderboard (full display, not just user's reward)
  useEffect(() => {
    // Clear previous data immediately when raceDayId changes
    setLeaderboard([]);

    if (!raceDay?.raceDayId) {
      return;
    }
    let mounted = true;
    const fetchLeaderboard = async () => {
      try {
        const data = await apiGet<{ players: LeaderboardPlayer[] }>(
          `/api/racedays/${raceDay.raceDayId}/leaderboard`
        );
        if (!mounted) return;
        setLeaderboard(data.players ?? []);
      } catch {
        if (!mounted) return;
        setLeaderboard([]);
      }
    };
    void fetchLeaderboard();
    return () => {
      mounted = false;
    };
  }, [raceDay?.raceDayId, raceDay?.status]);

  // Fetch provider statistics with auto-refresh during active raceday
  useEffect(() => {
    setProviderStats([]);

    if (!raceDay?.raceDayId) {
      return;
    }
    let mounted = true;
    const fetchStats = async () => {
      try {
        const data = await apiGet<{ providers: ProviderStats[] }>(
          `/api/racedays/${raceDay.raceDayId}/errors`
        );
        if (!mounted) return;
        setProviderStats(data.providers ?? []);
      } catch {
        if (!mounted) return;
        setProviderStats([]);
      }
    };
    void fetchStats();

    // Auto-refresh every 5 seconds during active raceday phases
    const isActive = ["polling", "picking", "running"].includes(raceDay.status);
    const interval = isActive ? setInterval(fetchStats, 5000) : null;

    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
  }, [raceDay?.raceDayId, raceDay?.status]);

  const levelOne = raceDay?.rounds.find((round) => round.roundNumber === 1) ?? null;
  const levelOneHeats = levelOne?.heats ?? [];
  const activeHeat = levelOneHeats[heatIndex] ?? levelOneHeats[0] ?? null;
  const heatLocked = raceDay?.rounds.some((round) =>
    round.heats.some((heat) => ["running", "finished", "voided"].includes(heat.status))
  );
  const selectionLocked = Boolean(
    heatLocked || ["complete", "canceled"].includes(raceDay?.status ?? "")
  );
  const displayStatus = useMemo(() => {
    if (!raceDay?.status) return "Idle";
    if (raceDay.status === "polling") return "Polling";
    if (raceDay.status === "picking") return "Picking";
    if (raceDay.status === "running") {
      const hasRunningHeat = raceDay.rounds.some((round) =>
        round.heats.some((heat) => heat.status === "running")
      );
      if (hasRunningHeat) return "Racing";
      const hasScheduledHeat = raceDay.rounds.some((round) =>
        round.heats.some((heat) => heat.status === "scheduled")
      );
      return hasScheduledHeat ? "Preparing Next Heat" : "Racing";
    }
    if (raceDay.status === "complete") return "Complete";
    if (raceDay.status === "canceled") return "Canceled";
    return "Scheduled";
  }, [raceDay]);

  // Find current active heat for header display
  // Only show heat info when raceDay is actively running (not just scheduled)
  const currentHeatInfo = useMemo(() => {
    if (!raceDay?.rounds) return null;
    // Only look for heats when raceDay is in an active state
    const activeStates = ["polling", "picking", "running"];
    if (!activeStates.includes(raceDay.status)) return null;

    type HeatMetadata = { trackName?: string; trackSurface?: string; weatherName?: string };

    // First look for running heat
    for (const round of raceDay.rounds) {
      const runningHeat = round.heats.find((heat) => heat.status === "running");
      if (runningHeat) {
        const meta = runningHeat.metadata as HeatMetadata | null;
        return {
          round: round.roundNumber,
          heat: runningHeat.heatNumber,
          totalHeats: round.heatsCount,
          pickCloseAt: runningHeat.pickCloseAt,
          startsAt: runningHeat.startsAt,
          trackName: meta?.trackName ?? null,
          trackSurface: meta?.trackSurface ?? null,
          weatherName: meta?.weatherName ?? null
        };
      }
    }
    // Then look for picking heat
    for (const round of raceDay.rounds) {
      const pickingHeat = round.heats.find((heat) => heat.status === "picking");
      if (pickingHeat) {
        const meta = pickingHeat.metadata as HeatMetadata | null;
        return {
          round: round.roundNumber,
          heat: pickingHeat.heatNumber,
          totalHeats: round.heatsCount,
          pickCloseAt: pickingHeat.pickCloseAt,
          startsAt: pickingHeat.startsAt,
          trackName: meta?.trackName ?? null,
          trackSurface: meta?.trackSurface ?? null,
          weatherName: meta?.weatherName ?? null
        };
      }
    }
    // Then look for scheduled heat (next up) - only when raceDay is running
    if (raceDay.status === "running") {
      for (const round of raceDay.rounds) {
        const scheduledHeat = round.heats.find((heat) => heat.status === "scheduled");
        if (scheduledHeat) {
          const meta = scheduledHeat.metadata as HeatMetadata | null;
          return {
            round: round.roundNumber,
            heat: scheduledHeat.heatNumber,
            totalHeats: round.heatsCount,
            pickCloseAt: scheduledHeat.pickCloseAt,
            startsAt: scheduledHeat.startsAt,
            trackName: meta?.trackName ?? null,
            trackSurface: meta?.trackSurface ?? null,
            weatherName: meta?.weatherName ?? null
          };
        }
      }
    }
    return null;
  }, [raceDay]);

  // Countdown for pick close
  const remainingMs = useRaceCountdown(currentHeatInfo?.pickCloseAt);

  const handleHorseHover = (horse: RaceDayHorse | null, event?: React.MouseEvent) => {
    if (horse && event) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
      setHoveredHorse(horse);
    } else {
      setHoveredHorse(null);
      setTooltipPos(null);
    }
  };

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

  const finalPlacements = useMemo(() => {
    if (!raceDay?.rounds?.length) return [];
    const finalRound = raceDay.rounds[raceDay.rounds.length - 1];
    const finalHeat = finalRound?.heats[0] ?? null;
    if (!finalHeat) return [];
    return [...finalHeat.results]
      .sort((a, b) => a.placement - b.placement)
      .slice(0, 3)
      .map((entry) => {
        const horse = raceDayHorseMap.get(entry.raceDayHorseId);
        return {
          placement: entry.placement,
          raceDayHorseId: entry.raceDayHorseId,
          name: horse?.displayName ?? "—",
          horse
        };
      });
  }, [raceDay, raceDayHorseMap]);

  const advancerIds = useMemo(() => {
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

  const handleSelectHorse = async (raceDayHorseId: string) => {
    if (!raceDay?.raceDayId || selectionLocked || !walletState.walletAddress) return;
    setSelectionLoading(true);
    setSelectionError(null);
    try {
      await apiPost<RaceDaySelectionResponse>(
        `/api/racedays/${raceDay.raceDayId}/selection`,
        { raceDayHorseId }
      );
      await refetchSelections();
    } catch (err) {
      setSelectionError(err instanceof Error ? err.message : "request_failed");
    } finally {
      setSelectionLoading(false);
    }
  };

  useEffect(() => {
    if (heatIndex >= levelOneHeats.length && levelOneHeats.length > 0) {
      setHeatIndex(0);
    }
  }, [heatIndex, levelOneHeats.length]);

  const handleCreateRaceDay = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await apiPost<{ raceDayId: string }>("/api/racedays/create", {});
      if (created?.raceDayId) {
        await apiPost(`/api/racedays/${created.raceDayId}/start`, {});

        // Reset UI state and switch to new raceday (hook will fetch data)
        setHeatIndex(0);
        setSelectionError(null);
        setSelectedRaceDayId(created.raceDayId);

        // Refresh the raceday list
        const listData = await apiGet<{ racedays: RaceDayListItem[] }>("/api/racedays/list");
        setRaceDayList(listData.racedays ?? []);
      }
    } catch (err) {
      console.error("Failed to create raceday:", err);
    } finally {
      setCreating(false);
    }
  };

  if (!raceDay) {
    return (
      <div className="flex flex-col gap-6">
        <RaceHeader
          race={null}
          remainingMs={0}
          poolSize={0}
          racedayStatus={null}
        />
        <div className="surface rounded-3xl p-6 text-center text-slate">
          No tournament available.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <RaceHeader
        race={currentHeatInfo ? {
          raceId: "raceday",
          status: raceDay.status === "picking" ? "picking" : raceDay.status === "running" ? "running" : "scheduled",
          track: currentHeatInfo.trackName ? {
            name: currentHeatInfo.trackName,
            surface: currentHeatInfo.trackSurface ?? undefined
          } : undefined,
          weather: currentHeatInfo.weatherName ? { name: currentHeatInfo.weatherName } : undefined,
          racedayLevel: currentHeatInfo.round,
          racedayHeatNumber: currentHeatInfo.heat,
          racedayHeatCount: currentHeatInfo.totalHeats,
          racedayStatus: raceDay.status,
          pickCloseAt: currentHeatInfo.pickCloseAt ?? undefined,
          startAt: currentHeatInfo.startsAt ?? undefined
        } : {
          raceId: "raceday",
          status: "scheduled",
          racedayLevel: 1,
          racedayHeatNumber: 1,
          racedayHeatCount: 8,
          racedayStatus: raceDay.status
        }}
        remainingMs={remainingMs}
        poolSize={raceDay.poolCredits}
        racedayStatus={raceDay.status}
      />

      <RaceTicketCompact
        raceId={null}
        ticketHorses={ticketHorses}
        walletState={walletState}
        estimatedReward={myEstimatedReward}
      />

      {/* Tournament Navigation */}
      <div className="surface rounded-3xl p-4 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            const currentIndex = raceDayList.findIndex((rd) => rd.raceDayId === raceDay.raceDayId);
            if (currentIndex > 0) {
              const prevRaceDay = raceDayList[currentIndex - 1];
              setSelectedRaceDayId(prevRaceDay.raceDayId);
            }
          }}
          disabled={raceDayList.findIndex((rd) => rd.raceDayId === raceDay.raceDayId) <= 0}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-midnight/10 bg-panel/80 text-midnight transition hover:bg-midnight/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="min-w-[80px] text-center text-xs uppercase tracking-[0.2em] text-slate">
          {(() => {
            const idx = raceDayList.findIndex((rd) => rd.raceDayId === raceDay.raceDayId);
            const position = idx >= 0 ? idx + 1 : 1;
            const total = raceDayList.length || 1;
            return `${position} / ${total}`;
          })()}
        </span>
        <button
          type="button"
          onClick={() => {
            const currentIndex = raceDayList.findIndex((rd) => rd.raceDayId === raceDay.raceDayId);
            if (currentIndex < raceDayList.length - 1) {
              const nextRaceDay = raceDayList[currentIndex + 1];
              setSelectedRaceDayId(nextRaceDay.raceDayId);
            }
          }}
          disabled={raceDayList.findIndex((rd) => rd.raceDayId === raceDay.raceDayId) >= raceDayList.length - 1}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-midnight/10 bg-panel/80 text-midnight transition hover:bg-midnight/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="surface rounded-3xl border border-midnight/10 p-6">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { label: "1st Place", rank: 1, bgColor: "bg-[#FFD700]", textColor: "text-black" },
            { label: "2nd Place", rank: 2, bgColor: "bg-[#C0C0C0]", textColor: "text-black" },
            { label: "3rd Place", rank: 3, bgColor: "bg-[#CD7F32]", textColor: "text-white" }
          ].map((slot) => {
            const entry = finalPlacements.find((placement) => placement.placement === slot.rank);
            const visual = entry?.raceDayHorseId ? horseStyle(entry.raceDayHorseId) : null;
            return (
              <div
                key={slot.label}
                className="rounded-2xl border border-midnight/10 p-4"
              >
                <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.2em] ${slot.bgColor} ${slot.textColor}`}>{slot.label}</span>
                {entry?.horse ? (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
                      <HorseSilhouette
                        width={46}
                        height={46}
                        className="drop-shadow-sm"
                        style={{ color: visual?.coatColor ?? "#1E1E1E" }}
                      />
                      {visual?.patternBaseColor && (
                        <div
                          className="absolute left-1/2 top-1/2 z-10"
                          style={{ transform: "translate(-50%, -50%) translateX(-2px)" }}
                        >
                          <JerseyIcon
                            seed={entry.name}
                            width={12}
                            height={22}
                            shape="square"
                            baseColor={visual.patternBaseColor}
                            className="rounded-sm shadow-sm"
                          />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold leading-tight text-ink">{entry.name}</p>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate">
                        {horseDetails[entry.raceDayHorseId]?.serviceType.displayName ?? "Loading..."}
                      </p>
                      {horseDetails[entry.raceDayHorseId]?.providerMoniker && (
                        <span className="mt-0.5 inline-flex rounded-full bg-accent2/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-accent2">
                          {horseDetails[entry.raceDayHorseId].providerMoniker}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-lg font-semibold text-ink">—</p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-4">
          {raceDay.rounds.map((round) => (
            <div
              key={round.roundId}
              className="flex flex-col gap-4 rounded-2xl border border-midnight/10 p-4"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm uppercase tracking-[0.3em] text-slate">
                  Round {round.roundNumber}
                </h4>
              </div>
              {round.heats.map((heat) => {
                const showPickingForRoundOne =
                  raceDay?.status === "picking" && round.roundNumber === 1;
                const heatStatus = showPickingForRoundOne ? "picking" : heat.status;
                const resultsMap = new Map(
                  heat.results.map((entry) => [entry.raceDayHorseId, entry.placement])
                );
                return (
                  <div key={heat.heatId} className="rounded-2xl border border-midnight/10 p-4">
                    {(heat.metadata as { trackName?: string })?.trackName && (
                      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.3em] text-ink">
                        {(heat.metadata as { trackName?: string }).trackName}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-[0.3em] text-slate">
                        Heat {heat.heatNumber}
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                          heatStatus === "finished"
                            ? "bg-green-600/15 text-green-600"
                            : "bg-ink/5 text-ink/70"
                        }`}
                      >
                        {heatStatus}
                      </span>
                    </div>
                    <div className="mt-3 text-xs uppercase tracking-[0.2em] text-slate">
                      Entrants
                    </div>
                    <div className="mt-2 flex flex-col gap-1 text-sm text-ink">
                      {heat.entrants.map((horse) => {
                        const placement = resultsMap.get(horse.raceDayHorseId);
                        const isAdvancing = heat.advancers.some(
                          (entry) => entry.raceDayHorseId === horse.raceDayHorseId
                        );
                        return (
                          <div
                            key={horse.raceDayHorseId}
                            className={`flex items-center gap-2 cursor-pointer hover:bg-ink/5 rounded px-1 -mx-1 ${
                              isAdvancing
                                ? "text-accent2 font-semibold"
                                : placement
                                  ? "text-ink/40 line-through"
                                  : "text-ink"
                            }`}
                            onMouseEnter={(e) => handleHorseHover(horse, e)}
                            onMouseLeave={() => handleHorseHover(null)}
                          >
                            <span className="truncate">{horse.displayName}</span>
                          </div>
                        );
                      })}
                      {heat.entrants.length === 0 && (
                        <span className="text-xs text-slate">Awaiting advancers</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {leaderboard.length > 0 && (
        <div className="surface rounded-3xl border border-midnight/10 p-6">
          <h3 className="text-xs uppercase tracking-[0.3em] text-slate">
            Leaderboard
          </h3>
          <div className="mt-4 flex flex-col gap-3">
            {leaderboard.map((player, index) => (
              <div
                key={player.userId}
                className="rounded-2xl border border-midnight/10 bg-panel/80 overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-midnight/10">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-midnight/10 text-sm font-semibold text-midnight">
                      {index + 1}
                    </span>
                    <p className="font-semibold text-ink">
                      {player.nickname || player.walletAddress?.slice(0, 8) || "Anonymous"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-accent2">
                      {(player.estimatedReward ?? 0).toFixed(2)} ARKEO
                    </p>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate">
                      Total Score
                    </p>
                  </div>
                </div>
                <div className="px-4 py-2 flex flex-col gap-2">
                  {player.selections.map((selection) => (
                    <div
                      key={selection.raceDayHorseId}
                      className="flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                              selection.eliminated ? "bg-warning/20" : "bg-accent2/20"
                            }`}
                          >
                            {selection.eliminated ? (
                              <svg
                                width="8"
                                height="8"
                                viewBox="0 0 12 12"
                                fill="none"
                                className="text-warning"
                              >
                                <path
                                  d="M2 2L10 10M10 2L2 10"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                />
                              </svg>
                            ) : (
                              <svg
                                width="8"
                                height="8"
                                viewBox="0 0 12 12"
                                fill="none"
                                className="text-accent2"
                              >
                                <path
                                  d="M2 6L5 9L10 3"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </div>
                          <span
                            className={`text-sm font-semibold ${
                              selection.eliminated ? "text-slate" : "text-ink"
                            }`}
                          >
                            {selection.displayName}
                          </span>
                        </div>
                        <span
                          className={`text-sm font-bold ${
                            (selection.estimatedReward ?? 0) > 0 ? "text-accent2" : "text-slate"
                          }`}
                        >
                          {(selection.estimatedReward ?? 0) > 0
                            ? `+${(selection.estimatedReward ?? 0).toFixed(2)}`
                            : "0.00"}
                        </span>
                      </div>
                      {selection.roundRewards && selection.roundRewards.length > 0 && (
                        <div className="ml-6 flex flex-col gap-0.5">
                          {selection.roundRewards.map((rr) => (
                            <div
                              key={`${selection.raceDayHorseId}-${rr.round}`}
                              className="flex items-center justify-between text-xs"
                            >
                              <span className="text-slate">{rr.label}</span>
                              <span className="text-accent2/80">+{rr.reward.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Provider Statistics Log */}
      <div className="surface rounded-3xl border border-midnight/10 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-[0.3em] text-slate">
            Provider Statistics
          </h3>
          {providerStats.length > 0 && (() => {
            const totals = providerStats.reduce(
              (acc, provider) => {
                provider.services.forEach((service) => {
                  acc.total += service.totalProbes;
                  acc.success += service.successfulProbes;
                });
                return acc;
              },
              { total: 0, success: 0 }
            );
            const successRate = totals.total > 0 ? Math.round((totals.success / totals.total) * 100) : 0;
            return (
              <div className="flex items-center gap-4">
                <span className="text-sm text-slate">
                  {totals.total.toLocaleString()} Transactions
                </span>
                <span className={`text-sm font-bold ${successRate >= 95 ? "text-accent2" : successRate >= 80 ? "text-amber-600" : "text-warning"}`}>
                  Success: {successRate}%
                </span>
              </div>
            );
          })()}
        </div>
        {providerStats.length === 0 ? (
          <p className="mt-4 text-sm text-slate">No race data yet. Statistics will appear after races run.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {providerStats.map((provider) => (
              <div key={provider.providerPubkey} className="rounded-2xl border border-midnight/10 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-semibold uppercase tracking-[0.2em] text-midnight">
                    {provider.providerMoniker}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {provider.services.map((service) => {
                    const hasErrors = service.errors.length > 0;
                    return (
                      <div
                        key={service.serviceTypeId}
                        className="rounded-xl border border-midnight/10 bg-panel/50 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-ink">
                              {service.serviceTypeName}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={`text-sm font-bold ${
                                service.successRate >= 95
                                  ? "text-accent2"
                                  : service.successRate >= 80
                                    ? "text-amber-600"
                                    : "text-warning"
                              }`}
                            >
                              {service.successRate}% success
                            </span>
                            <span className="text-xs text-slate">
                              {service.successfulProbes}/{service.totalProbes} probes
                            </span>
                          </div>
                        </div>
                        {hasErrors && (
                          <div className="mt-2 flex flex-col gap-1">
                            {service.errors.map((error) => (
                              <div
                                key={error.errorType}
                                className="flex items-center gap-2"
                              >
                                <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-warning">
                                  {error.errorType}: {error.count}
                                </span>
                                {error.sampleMessage && (
                                  <span className="text-[10px] text-slate">
                                    {error.sampleMessage}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Horse Details Tooltip */}
      {hoveredHorse && tooltipPos && (() => {
        const visual = horseStyle(hoveredHorse.raceDayHorseId);
        const slotMeta = raceDaySlotMeta.get(hoveredHorse.raceDayHorseId);
        const jerseyColor = visual.patternBaseColor;
        const numberColor = jerseyColor ? contrastColor(jerseyColor) : "#1E1E1E";
        const slotLabel = slotMeta
          ? buildRaceDaySlotLabel(slotMeta.roundNumber, slotMeta.heatNumber, slotMeta.slotNumber)
          : undefined;
        const slotLines = slotLabel ? slotLabel.split("\n") : [];
        return (
          <div
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-2xl border border-midnight/10 bg-panel shadow-xl"
            style={{ left: tooltipPos.x, top: tooltipPos.y - 12, minWidth: 280 }}
          >
            <div className="relative flex items-start gap-4 p-4 pl-12">
              <div
                className="absolute inset-y-0 left-0 w-9 rounded-l-2xl"
                style={{ backgroundColor: jerseyColor ?? visual.coatColor }}
              />
              {slotLines.length > 0 && (
                <div
                  className={`absolute top-1/2 left-0 flex w-9 -translate-y-1/2 items-center justify-center font-semibold ${
                    slotLines.length > 1 ? "flex-col text-[10px] leading-[1.1]" : "text-[10px]"
                  }`}
                  style={{ color: numberColor }}
                >
                  {slotLines.length > 1
                    ? slotLines.map((line, index) => <span key={index}>{line}</span>)
                    : slotLines[0]}
                </div>
              )}
              <div className="relative flex w-16 shrink-0 items-center justify-center">
                <HorseSilhouette
                  width={60}
                  height={60}
                  className="drop-shadow-sm"
                  style={{ color: visual.coatColor }}
                />
                {jerseyColor && (
                  <div
                    className="absolute left-1/2 top-1/2 z-10"
                    style={{ transform: "translate(-50%, -50%) translateX(-2px)" }}
                  >
                    <JerseyIcon
                      seed={hoveredHorse.raceDayHorseId}
                      width={14}
                      height={24}
                      shape="square"
                      baseColor={jerseyColor}
                      className="rounded-sm shadow-sm"
                    />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <p className="text-lg font-semibold leading-tight text-ink">
                  {hoveredHorse.displayName}
                  {horseDetails[hoveredHorse.raceDayHorseId]?.odds != null && (
                    <span className="ml-2 text-green-600">{formatOdds(horseDetails[hoveredHorse.raceDayHorseId]?.odds)}</span>
                  )}
                </p>
                <p className="text-xs uppercase tracking-[0.2em] text-slate">
                  {horseDetails[hoveredHorse.raceDayHorseId]?.serviceType.displayName ?? "Loading..."}
                </p>
                {horseDetails[hoveredHorse.raceDayHorseId]?.providerMoniker && (
                  <span className="mt-0.5 inline-flex rounded-full bg-accent2/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-accent2">
                    {horseDetails[hoveredHorse.raceDayHorseId].providerMoniker}
                  </span>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink/70">
                    {hoveredHorse.archetype ? archetypeLabels[hoveredHorse.archetype as keyof typeof archetypeLabels] ?? hoveredHorse.archetype : "Unknown"}
                  </span>
                  <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink/70">
                    {hoveredHorse.temperament ? temperamentLabels[hoveredHorse.temperament as keyof typeof temperamentLabels] ?? hoveredHorse.temperament : "Normal"}
                  </span>
                </div>
                {hoveredHorse.eliminatedRound && (
                  <p className="mt-2 text-xs text-warning">Eliminated Round {hoveredHorse.eliminatedRound}</p>
                )}
                {hoveredHorse.finalPlacement && (
                  <p className="mt-2 text-xs text-accent2">Finished #{hoveredHorse.finalPlacement}</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
