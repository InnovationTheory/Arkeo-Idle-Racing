import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../api";
import { connectRaceDayWs } from "../ws";
import { horseStyle } from "../utils/horseStyle";
import { buildRaceDaySlotLabel } from "../utils/racedayLabels";

// Module-level cache for race data - persists across component remounts
const raceDataCache = new Map<string, { horses?: Array<{ horseId: string; odds?: number | null; serviceType: { displayName: string; iconKey: string }; assignedProvider?: { moniker?: string | null } | null }> }>();
const pendingRaceFetches = new Map<string, Promise<unknown>>();

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
  pickCloseAt: string | null;
  entrants: RaceDayHorse[];
  advancers: RaceDayHorse[];
};

type RaceDayRound = {
  roundNumber: number;
  status: string;
  heats: RaceDayHeat[];
};

type RaceDayState = {
  raceDayId: string;
  status: string;
  totalRounds: number;
  poolCredits: number;
  rounds: RaceDayRound[];
};

type RaceDaySelectionResponse = {
  selections: string[];
};

type HorseDetail = {
  serviceType: { displayName: string; iconKey: string };
  providerMoniker: string | null;
  odds: number | null;
};

type LeaderboardPlayer = {
  walletAddress: string | null;
  estimatedReward: number;
  paidReward?: number | null;
  paymentStatus?: "paid" | "pending" | "failed" | "no_wallet";
};

type TicketHorse = {
  raceHorseId: string;
  horseId: string;
  displayName: string;
  serviceType: { displayName: string; iconKey: string };
  providerMoniker?: string | null;
  odds?: number | null;
  jerseyColor?: string;
  slotNumber?: number;
  slotLabel?: string;
  roundNumber?: number;
  heatNumber?: number;
  status?: "pending" | "advancing" | "eliminated" | "winner";
};

export function useRaceDayTicketHorses(walletAddress?: string | null, raceDayId?: string | null) {
  const [raceDay, setRaceDay] = useState<RaceDayState | null>(null);
  const [selections, setSelections] = useState<string[]>([]);
  const [horseDetails, setHorseDetails] = useState<Record<string, HorseDetail>>({});
  const [estimatedReward, setEstimatedReward] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    let interval: number | null = null;
    const fetchRaceDay = async () => {
      try {
        if (raceDayId) {
          const data = await apiGet<RaceDayState>(`/api/racedays/${raceDayId}`);
          if (!mounted) return;
          setRaceDay(data ?? null);
        } else {
          const data = await apiGet<{ latest: RaceDayState | null }>("/api/racedays");
          if (!mounted) return;
          setRaceDay(data.latest ?? null);
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
  }, [raceDayId]);

  // WebSocket for real-time updates
  useEffect(() => {
    if (!raceDay?.raceDayId) return;
    const connection = connectRaceDayWs(raceDay.raceDayId, (message) => {
      if (message.type === "raceday_state") {
        setRaceDay(message.data as RaceDayState);
      }
    });
    return () => connection.close();
  }, [raceDay?.raceDayId]);

  useEffect(() => {
    setSelections([]);
    setHorseDetails({});
  }, [raceDay?.raceDayId]);

  useEffect(() => {
    if (!raceDay?.raceDayId || !walletAddress) {
      setSelections([]);
      return;
    }
    let mounted = true;
    apiGet<RaceDaySelectionResponse>(`/api/racedays/${raceDay.raceDayId}/selection`)
      .then((data) => {
        if (!mounted) return;
        setSelections(data.selections ?? []);
      })
      .catch(() => {
        if (!mounted) return;
        setSelections([]);
      });
    return () => {
      mounted = false;
    };
  }, [raceDay?.raceDayId, walletAddress]);

  // Manual refetch for selections (call after making selection)
  const refetchSelections = useCallback(async () => {
    if (!raceDay?.raceDayId || !walletAddress) return;
    try {
      const data = await apiGet<RaceDaySelectionResponse>(`/api/racedays/${raceDay.raceDayId}/selection`);
      setSelections(data.selections ?? []);
    } catch {
      // Ignore errors on manual refetch
    }
  }, [raceDay?.raceDayId, walletAddress]);

  // Fetch leaderboard for estimated reward
  useEffect(() => {
    // Reset values when raceDay changes
    setEstimatedReward(0);

    if (!raceDay?.raceDayId || !walletAddress) {
      return;
    }
    let mounted = true;
    const fetchLeaderboard = async () => {
      try {
        const data = await apiGet<{ players: LeaderboardPlayer[] }>(
          `/api/racedays/${raceDay.raceDayId}/leaderboard`
        );
        if (!mounted) return;
        const myEntry = data.players?.find((p) => p.walletAddress === walletAddress);
        const reward = myEntry?.paymentStatus === "paid" && typeof myEntry.paidReward === "number"
          ? myEntry.paidReward
          : myEntry?.estimatedReward ?? 0;
        setEstimatedReward(reward);
      } catch {
        if (mounted) {
          setEstimatedReward(0);
        }
      }
    };
    void fetchLeaderboard();
    return () => {
      mounted = false;
    };
  }, [raceDay?.raceDayId, raceDay?.status, walletAddress]);

  // Track which horse IDs we've already processed to avoid re-fetching
  const fetchedHorseIds = useRef(new Set<string>());

  // Reset fetched tracking when raceDay changes
  useEffect(() => {
    fetchedHorseIds.current.clear();
  }, [raceDay?.raceDayId]);

  // Fetch horse details from races - uses module-level cache
  useEffect(() => {
    if (!raceDay?.rounds) return;
    let mounted = true;

    const fetchHorseDetails = async () => {
      const updates: Record<string, HorseDetail> = {};

      // Collect all unique race IDs we need
      const raceIdsNeeded = new Set<string>();
      for (const round of raceDay.rounds) {
        for (const heat of round.heats) {
          if (heat.raceId) raceIdsNeeded.add(heat.raceId);
        }
      }

      // Fetch any races not in cache (with deduplication of concurrent requests)
      const fetchPromises: Promise<void>[] = [];
      for (const raceId of raceIdsNeeded) {
        if (raceDataCache.has(raceId)) continue;

        // Check if there's already a pending fetch for this race
        let pending = pendingRaceFetches.get(raceId);
        if (!pending) {
          pending = apiGet(`/api/races/${raceId}`)
            .then((data) => {
              if (data) raceDataCache.set(raceId, data as typeof raceDataCache extends Map<string, infer V> ? V : never);
            })
            .catch(() => {
              // Ignore errors - we'll just not have details for this race
            })
            .finally(() => {
              pendingRaceFetches.delete(raceId);
            });
          pendingRaceFetches.set(raceId, pending);
        }
        fetchPromises.push(pending as Promise<void>);
      }

      // Wait for all race fetches to complete
      if (fetchPromises.length > 0) {
        await Promise.all(fetchPromises);
      }

      if (!mounted) return;

      // Now extract horse details from cached race data
      for (const round of raceDay.rounds) {
        for (const heat of round.heats) {
          if (!heat.raceId) continue;
          const race = raceDataCache.get(heat.raceId);
          if (!race?.horses) continue;

          for (const entrant of heat.entrants) {
            // Skip if we've already fetched this horse's details
            if (fetchedHorseIds.current.has(entrant.raceDayHorseId)) continue;

            const raceHorse = race.horses.find((h) => h.horseId === entrant.horseId);
            if (raceHorse) {
              updates[entrant.raceDayHorseId] = {
                serviceType: raceHorse.serviceType,
                providerMoniker: raceHorse.assignedProvider?.moniker ?? null,
                odds: raceHorse.odds ?? null
              };
              fetchedHorseIds.current.add(entrant.raceDayHorseId);
            }
          }
        }
      }

      if (!mounted) return;
      if (Object.keys(updates).length > 0) {
        setHorseDetails((prev) => ({ ...prev, ...updates }));
      }
    };

    void fetchHorseDetails();
    return () => { mounted = false; };
  }, [raceDay?.rounds]); // Removed horseDetails from deps - use ref tracking instead

  const raceDayHorseMap = useMemo(() => {
    const map = new Map<string, RaceDayHorse>();
    raceDay?.rounds.forEach((round) => {
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
    raceDay?.rounds.forEach((round) => {
      round.heats.forEach((heat) => {
        heat.entrants.forEach((horse, index) => {
          map.set(horse.raceDayHorseId, {
            roundNumber: round.roundNumber,
            heatNumber: heat.heatNumber,
            slotNumber: index + 1
          });
        });
      });
    });
    return map;
  }, [raceDay]);

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

  const ticketHorses = useMemo(() => {
    const isTournamentComplete = raceDay?.status === "complete";
    const totalRounds = raceDay?.totalRounds ?? 4;
    return selections
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

        let status: TicketHorse["status"] = "pending";
        if (entry.eliminatedRound !== null) {
          status = "eliminated";
        } else if (isTournamentComplete && entry.finalPlacement !== null && entry.finalPlacement <= 3) {
          status = "winner";
        } else if (advancerIds.has(entry.raceDayHorseId)) {
          const advancedToFinal = raceDay?.rounds.some((round) =>
            round.roundNumber === totalRounds &&
            round.heats.some((heat) =>
              heat.entrants.some((h) => h.raceDayHorseId === entry.raceDayHorseId)
            )
          );
          status = advancedToFinal ? "advancing" : "advancing";
        }

        const detail = horseDetails[entry.raceDayHorseId];
        return {
          raceHorseId: entry.raceDayHorseId,
          horseId: entry.horseId,
          displayName: entry.displayName,
          serviceType: detail?.serviceType ?? { displayName: "Loading...", iconKey: "arkeo" },
          providerMoniker: detail?.providerMoniker ?? null,
          odds: detail?.odds ?? null,
          jerseyColor: visual.patternBaseColor,
          slotNumber: entry.seedOrder,
          slotLabel,
          roundNumber,
          heatNumber,
          status
        } as TicketHorse;
      })
      .filter(Boolean) as TicketHorse[];
  }, [selections, raceDayHorseMap, raceDaySlotMeta, advancerIds, raceDay, horseDetails]);

  return { raceDay, selections, ticketHorses, estimatedReward, poolSize: raceDay?.poolCredits ?? 0, horseDetails, refetchSelections };
}
