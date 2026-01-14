import { Router } from "express";
import {
  createRaceDay,
  startRaceDay,
  resetRaceDay,
  getRaceDayState,
  getRaceDayHeatState,
  getLatestRaceDay
} from "../raceday";
import { asyncHandler } from "./utils/asyncHandler";
import { validate } from "./utils/zodValidate";
import {
  createRaceDaySchema,
  deleteRaceDaySelectionSchema,
  startRaceDaySchema,
  getRaceDaySchema,
  getRaceDayHeatSchema,
  getRaceDaySelectionSchema,
  setRaceDaySelectionSchema,
  getRaceDayLeaderboardSchema,
  getRaceDayPayoutsSchema
} from "./schemas/racedays";
import { prisma } from "../db";
import { RaceDayHeatStatus, RaceDayStatus, RaceStatus } from "@prisma/client";
import { requireSessionUser } from "./utils/session";
import { requireAdminKey } from "./utils/adminAuth";

const router = Router();
const lockedHeatStatuses = new Set<RaceDayHeatStatus>([
  RaceDayHeatStatus.running,
  RaceDayHeatStatus.finished,
  RaceDayHeatStatus.voided
]);
const lockedRaceDayStatuses = new Set<RaceDayStatus>([
  RaceDayStatus.complete,
  RaceDayStatus.canceled
]);

function isSelectionWindowOpen(raceDay: { status: RaceDayStatus; startAt: Date | null }) {
  if (raceDay.status !== RaceDayStatus.picking) return false;
  if (!raceDay.startAt) return true;
  return Date.now() < raceDay.startAt.getTime();
}

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const latest = await getLatestRaceDay();
    res.json({ latest });
  })
);

router.get(
  "/list",
  asyncHandler(async (_req, res) => {
    const racedays = await prisma.raceDay.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        startAt: true
      }
    });
    res.json({
      racedays: racedays.map((rd) => ({
        raceDayId: rd.id,
        name: rd.name,
        status: rd.status,
        createdAt: rd.createdAt.toISOString(),
        startAt: rd.startAt?.toISOString() ?? null
      }))
    });
  })
);

router.post(
  "/create",
  requireAdminKey,
  validate(createRaceDaySchema),
  asyncHandler(async (req, res) => {
    const raceDayId = await createRaceDay(req.body ?? {});
    res.json({ raceDayId });
  })
);

router.post(
  "/:id/start",
  requireAdminKey,
  validate(startRaceDaySchema),
  asyncHandler(async (req, res) => {
    await startRaceDay(req.params.id);
    res.json({ ok: true });
  })
);

router.post(
  "/:id/reset",
  requireAdminKey,
  validate(startRaceDaySchema),
  asyncHandler(async (req, res) => {
    const { pickWindowSecs } = req.body as { pickWindowSecs?: number };
    const result = await resetRaceDay(req.params.id, pickWindowSecs);
    res.json(result);
  })
);

router.post(
  "/:id/cancel",
  requireAdminKey,
  validate(startRaceDaySchema),
  asyncHandler(async (req, res) => {
    const raceDay = await prisma.raceDay.findUnique({ where: { id: req.params.id } });
    if (!raceDay) {
      res.status(404).json({ error: "raceday_not_found" });
      return;
    }
    if (raceDay.status === RaceDayStatus.complete || raceDay.status === RaceDayStatus.canceled) {
      res.json({ completed: false, message: `already_${raceDay.status}` });
      return;
    }

    // Void all active races from this raceday to prevent them interfering with future races
    await prisma.race.updateMany({
      where: {
        raceDayHeat: { raceDayId: req.params.id },
        status: { in: [RaceStatus.running, RaceStatus.scheduled, RaceStatus.picking] }
      },
      data: { status: RaceStatus.voided, endAt: new Date() }
    });

    // Void all non-finished heats
    await prisma.raceDayHeat.updateMany({
      where: {
        raceDayId: req.params.id,
        status: { notIn: [RaceDayHeatStatus.finished, RaceDayHeatStatus.voided] }
      },
      data: { status: RaceDayHeatStatus.voided }
    });

    // Mark raceday as complete
    await prisma.raceDay.update({
      where: { id: req.params.id },
      data: { status: RaceDayStatus.complete }
    });
    res.json({ completed: true, message: "raceday_completed" });
  })
);

router.get(
  "/:id/selection",
  validate(getRaceDaySelectionSchema),
  asyncHandler(async (req, res) => {
    const user = await requireSessionUser(req, res);
    if (!user) return;
    if (!user.walletAddress) {
      res.json({ selection: null });
      return;
    }

    const selections = await prisma.raceDaySelection.findMany({
      where: { raceDayId: req.params.id, userId: user.id },
      orderBy: { createdAt: "asc" }
    });

    res.json({
      selections: selections.map((selection) => selection.raceDayHorseId)
    });
  })
);

router.post(
  "/:id/selection",
  validate(setRaceDaySelectionSchema),
  asyncHandler(async (req, res) => {
    const user = await requireSessionUser(req, res);
    if (!user) return;
    if (!user.walletAddress) {
      res.status(400).json({ error: "wallet_not_linked" });
      return;
    }

    const raceDay = await prisma.raceDay.findUnique({
      where: { id: req.params.id },
      include: { heats: true }
    });
    if (!raceDay) {
      res.status(404).json({ error: "raceday_not_found" });
      return;
    }

    const heatStarted = raceDay.heats.some((heat) => lockedHeatStatuses.has(heat.status));
    const selectionLocked = heatStarted || lockedRaceDayStatuses.has(raceDay.status) || !isSelectionWindowOpen(raceDay);
    if (selectionLocked) {
      res.status(400).json({ error: "selection_locked" });
      return;
    }

    const { raceDayHorseId } = req.body as { raceDayHorseId: string };
    const raceDayHorse = await prisma.raceDayHorse.findFirst({
      where: { id: raceDayHorseId, raceDayId: raceDay.id }
    });
    if (!raceDayHorse) {
      res.status(400).json({ error: "invalid_pick" });
      return;
    }

    const existing = await prisma.raceDaySelection.findMany({
      where: { raceDayId: raceDay.id, userId: user.id },
      orderBy: { createdAt: "asc" }
    });
    const alreadySelected = existing.find((entry) => entry.raceDayHorseId === raceDayHorseId);

    if (alreadySelected) {
      await prisma.raceDaySelection.delete({ where: { id: alreadySelected.id } });
      const remaining = existing
        .filter((entry) => entry.raceDayHorseId !== raceDayHorseId)
        .map((entry) => entry.raceDayHorseId);
      res.json({ selections: remaining });
      return;
    }

    if (existing.length >= 3) {
      res.status(400).json({ error: "selection_limit" });
      return;
    }

    const created = await prisma.raceDaySelection.create({
      data: { raceDayId: raceDay.id, userId: user.id, raceDayHorseId }
    });

    res.json({ selections: [...existing.map((entry) => entry.raceDayHorseId), created.raceDayHorseId] });
  })
);

router.delete(
  "/:id/selection",
  validate(deleteRaceDaySelectionSchema),
  asyncHandler(async (req, res) => {
    const user = await requireSessionUser(req, res);
    if (!user) return;
    if (!user.walletAddress) {
      res.json({ selection: null });
      return;
    }

    const raceDay = await prisma.raceDay.findUnique({
      where: { id: req.params.id },
      include: { heats: true }
    });
    if (!raceDay) {
      res.status(404).json({ error: "raceday_not_found" });
      return;
    }

    const heatStarted = raceDay.heats.some((heat) => lockedHeatStatuses.has(heat.status));
    const selectionLocked = heatStarted || lockedRaceDayStatuses.has(raceDay.status) || !isSelectionWindowOpen(raceDay);
    if (selectionLocked) {
      res.status(400).json({ error: "selection_locked" });
      return;
    }

    const existing = await prisma.raceDaySelection.findMany({
      where: { raceDayId: raceDay.id, userId: user.id }
    });

    if (!existing.length) {
      res.json({ selections: [] });
      return;
    }

    await prisma.raceDaySelection.deleteMany({
      where: { raceDayId: raceDay.id, userId: user.id }
    });
    res.json({ selections: [] });
  })
);

router.get(
  "/:id/leaderboard",
  validate(getRaceDayLeaderboardSchema),
  asyncHandler(async (req, res) => {
    const raceDay = await prisma.raceDay.findUnique({
      where: { id: req.params.id },
      include: {
        rounds: {
          select: {
            roundNumber: true,
            status: true
          }
        },
        horses: {
          select: {
            id: true,
            eliminatedRound: true,
            eliminatedHeat: true,
            finalPlacement: true
          }
        },
        selections: {
          include: {
            user: {
              select: {
                id: true,
                nickname: true,
                walletAddress: true
              }
            },
            raceDayHorse: {
              select: {
                id: true,
                eliminatedRound: true,
                eliminatedHeat: true,
                finalPlacement: true,
                horse: {
                  select: {
                    displayName: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!raceDay) {
      res.status(404).json({ error: "raceday_not_found" });
      return;
    }

    // Reward pool allocation (fractions of 9)
    // Round 1: 0
    // Round 2: 1/9 (split among advancers)
    // Round 3: 2/9 (split among advancers)
    // Round 4 placements (6/9 total): 1st=3/9, 2nd=2/9, 3rd=1/9
    const POOL_SIZE = raceDay.poolCredits;
    const ROUND_ALLOCATIONS: Record<number, number> = {
      2: 1 / 9,
      3: 2 / 9
      // Round 4 rewards are via placements only
    };
    const PLACEMENT_ALLOCATIONS: Record<number, number> = {
      1: 3 / 9,
      2: 2 / 9,
      3: 1 / 9
    };

    // Determine which rounds are complete
    const completedRounds = new Set(
      raceDay.rounds
        .filter((r) => r.status === "complete")
        .map((r) => r.roundNumber)
    );

    // Helper to check if a horse advanced to a specific round
    // A horse has advanced to round N if:
    // 1. Round N-1 is complete (so advancement has happened), AND
    // 2. They weren't eliminated before round N
    const advancedToRound = (eliminatedRound: number | null, round: number): boolean => {
      // Round N-1 must be complete for anyone to have advanced to round N
      if (!completedRounds.has(round - 1)) return false;
      // If not eliminated, they've advanced
      if (eliminatedRound === null) return true;
      // If eliminated in round N or later, they advanced to round N
      return eliminatedRound >= round;
    };

    // Helper to check if horse is in winning circle (top 3 finishers)
    const isInWinningCircle = (finalPlacement: number | null): boolean => {
      return finalPlacement !== null && finalPlacement >= 1 && finalPlacement <= 3;
    };

    // Count selections that advanced to each round (Round 4 is via placements only)
    const selectionsPerRound: Record<number, number> = { 2: 0, 3: 0 };
    const selectionsPerPlacement: Record<number, number> = { 1: 0, 2: 0, 3: 0 };

    for (const selection of raceDay.selections) {
      const horse = selection.raceDayHorse;
      for (const round of [2, 3]) {
        if (advancedToRound(horse.eliminatedRound, round)) {
          selectionsPerRound[round]++;
        }
      }
      if (isInWinningCircle(horse.finalPlacement)) {
        selectionsPerPlacement[horse.finalPlacement!]++;
      }
    }

    // Calculate reward per selection for each tier
    const rewardPerSelectionPerRound: Record<number, number> = {};
    for (const round of [2, 3]) {
      const count = selectionsPerRound[round];
      rewardPerSelectionPerRound[round] = count > 0
        ? (POOL_SIZE * ROUND_ALLOCATIONS[round]) / count
        : 0;
    }
    const rewardPerPlacement: Record<number, number> = {};
    for (const placement of [1, 2, 3]) {
      const count = selectionsPerPlacement[placement];
      rewardPerPlacement[placement] = count > 0
        ? (POOL_SIZE * PLACEMENT_ALLOCATIONS[placement]) / count
        : 0;
    }

    // Group selections by user and calculate rewards
    const userMap = new Map<
      string,
      {
        userId: string;
        nickname: string | null;
        walletAddress: string | null;
        selections: Array<{
          raceDayHorseId: string;
          displayName: string;
          eliminated: boolean;
          eliminatedRound: number | null;
          finalPlacement: number | null;
          estimatedReward: number;
        }>;
        estimatedReward: number;
      }
    >();

    for (const selection of raceDay.selections) {
      const user = selection.user;
      const horse = selection.raceDayHorse;
      const isEliminated = horse.eliminatedRound !== null;

      // Calculate reward for this selection with per-round breakdown
      let selectionReward = 0;
      const roundRewards: Array<{ round: number | string; reward: number; label: string }> = [];

      // Check winning circle first (highest value)
      if (isInWinningCircle(horse.finalPlacement)) {
        const placementLabels: Record<number, string> = { 1: "1st Place", 2: "2nd Place", 3: "3rd Place" };
        const placementReward = rewardPerPlacement[horse.finalPlacement!];
        roundRewards.push({
          round: "final",
          reward: placementReward,
          label: placementLabels[horse.finalPlacement!] || `${horse.finalPlacement}th Place`
        });
        selectionReward += placementReward;
      }

      // Then rounds in descending order (3, 2) - Round 4 rewards are via placements only
      for (const round of [3, 2]) {
        if (advancedToRound(horse.eliminatedRound, round)) {
          roundRewards.push({
            round,
            reward: rewardPerSelectionPerRound[round],
            label: `Round ${round}`
          });
          selectionReward += rewardPerSelectionPerRound[round];
        }
      }

      const entry = {
        raceDayHorseId: horse.id,
        displayName: horse.horse.displayName,
        eliminated: isEliminated,
        eliminatedRound: horse.eliminatedRound,
        finalPlacement: horse.finalPlacement,
        estimatedReward: selectionReward,
        roundRewards
      };

      if (!userMap.has(user.id)) {
        userMap.set(user.id, {
          userId: user.id,
          nickname: user.nickname,
          walletAddress: user.walletAddress,
          selections: [],
          estimatedReward: 0
        });
      }
      const userData = userMap.get(user.id)!;
      userData.selections.push(entry);
      userData.estimatedReward += selectionReward;
    }

    // Sort users by estimated reward descending, then by top placement
    const players = Array.from(userMap.values())
      .map((player) => {
        const advancingCount = player.selections.filter((s) => !s.eliminated).length;
        const topPlacement = Math.min(
          ...player.selections
            .filter((s) => s.finalPlacement !== null && s.finalPlacement > 0)
            .map((s) => s.finalPlacement!),
          999
        );
        return {
          ...player,
          advancingCount,
          topPlacement
        };
      })
      .sort((a, b) => {
        // Sort by estimated reward descending
        if (b.estimatedReward !== a.estimatedReward) {
          return b.estimatedReward - a.estimatedReward;
        }
        // Then by advancing count descending
        if (b.advancingCount !== a.advancingCount) {
          return b.advancingCount - a.advancingCount;
        }
        // Then by top placement ascending
        return a.topPlacement - b.topPlacement;
      });

    // Calculate unclaimed/rollover rewards
    let rolloverRewards = 0;
    for (const placement of [1, 2, 3]) {
      if (selectionsPerPlacement[placement] === 0) {
        rolloverRewards += POOL_SIZE * PLACEMENT_ALLOCATIONS[placement];
      }
    }
    for (const round of [2, 3]) {
      if (selectionsPerRound[round] === 0) {
        rolloverRewards += POOL_SIZE * ROUND_ALLOCATIONS[round];
      }
    }

    res.json({
      players,
      poolSize: POOL_SIZE,
      selectionsPerRound,
      selectionsPerPlacement,
      rolloverRewards
    });
  })
);

router.get(
  "/:id",
  validate(getRaceDaySchema),
  asyncHandler(async (req, res) => {
    const state = await getRaceDayState(req.params.id);
    if (!state) {
      res.status(404).json({ error: "raceday_not_found" });
      return;
    }
    res.json(state);
  })
);

router.get(
  "/:id/heats/:heatId",
  validate(getRaceDayHeatSchema),
  asyncHandler(async (req, res) => {
    const heat = await getRaceDayHeatState(req.params.id, req.params.heatId);
    if (!heat) {
      res.status(404).json({ error: "heat_not_found" });
      return;
    }
    res.json(heat);
  })
);

router.get(
  "/:id/payouts",
  validate(getRaceDayPayoutsSchema),
  asyncHandler(async (req, res) => {
    const raceDay = await prisma.raceDay.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        status: true,
        poolCredits: true
      }
    });

    if (!raceDay) {
      res.status(404).json({ error: "raceday_not_found" });
      return;
    }

    const payouts = await prisma.raceDayPayout.findMany({
      where: { raceDayId: req.params.id },
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            walletAddress: true
          }
        }
      },
      orderBy: [{ totalReward: "desc" }, { createdAt: "asc" }]
    });

    // Group payouts by user for easier display
    const userPayouts = new Map<
      string,
      {
        userId: string;
        nickname: string | null;
        walletAddress: string | null;
        totalReward: number;
        horses: Array<{
          raceDayHorseId: string;
          displayName: string;
          reward: number;
          breakdown: unknown;
        }>;
      }
    >();

    for (const payout of payouts) {
      if (!userPayouts.has(payout.userId)) {
        userPayouts.set(payout.userId, {
          userId: payout.userId,
          nickname: payout.user.nickname,
          walletAddress: payout.user.walletAddress,
          totalReward: 0,
          horses: []
        });
      }
      const entry = userPayouts.get(payout.userId)!;
      entry.totalReward += payout.totalReward;
      entry.horses.push({
        raceDayHorseId: payout.raceDayHorseId,
        displayName: payout.horseDisplayName,
        reward: payout.totalReward,
        breakdown: payout.breakdownJson
      });
    }

    res.json({
      raceDayId: raceDay.id,
      name: raceDay.name,
      status: raceDay.status,
      poolCredits: raceDay.poolCredits,
      players: Array.from(userPayouts.values()).sort(
        (a, b) => b.totalReward - a.totalReward
      )
    });
  })
);

// Get error statistics for a raceday, grouped by service type and provider
router.get(
  "/:id/errors",
  validate(getRaceDaySchema),
  asyncHandler(async (req, res) => {
    // Get all race IDs for this raceday
    const heats = await prisma.raceDayHeat.findMany({
      where: { raceDayId: req.params.id, raceId: { not: null } },
      select: { raceId: true }
    });

    const raceIds = heats.map((h) => h.raceId).filter((id): id is string => id !== null);

    if (raceIds.length === 0) {
      res.json({ providers: [] });
      return;
    }

    // Query all polls for these races with their service type and provider info
    const polls = await prisma.raceHorsePoll.findMany({
      where: { raceId: { in: raceIds } },
      select: {
        errorType: true,
        errorMessage: true,
        probeOk: true,
        raceHorse: {
          select: {
            serviceType: {
              select: { id: true, displayName: true, iconKey: true }
            },
            assignedProvider: {
              select: { id: true, moniker: true, providerPubkey: true }
            }
          }
        }
      }
    });

    // Group by provider pubkey, then by service type
    const providerMap = new Map<
      string,
      {
        providerPubkey: string;
        providerMoniker: string;
        services: Map<
          string,
          {
            serviceTypeId: string;
            serviceTypeName: string;
            serviceTypeIcon: string;
            totalProbes: number;
            successfulProbes: number;
            errors: Map<string, { count: number; sampleMessage: string | null }>;
          }
        >;
      }
    >();

    for (const poll of polls) {
      const serviceType = poll.raceHorse.serviceType;
      const provider = poll.raceHorse.assignedProvider;
      const providerPubkey = provider?.providerPubkey ?? "unknown";
      const providerMoniker = provider?.moniker ?? "Unknown Provider";

      if (!providerMap.has(providerPubkey)) {
        providerMap.set(providerPubkey, {
          providerPubkey,
          providerMoniker,
          services: new Map()
        });
      }

      const providerEntry = providerMap.get(providerPubkey)!;

      if (!providerEntry.services.has(serviceType.id)) {
        providerEntry.services.set(serviceType.id, {
          serviceTypeId: serviceType.id,
          serviceTypeName: serviceType.displayName,
          serviceTypeIcon: serviceType.iconKey,
          totalProbes: 0,
          successfulProbes: 0,
          errors: new Map()
        });
      }

      const serviceEntry = providerEntry.services.get(serviceType.id)!;
      serviceEntry.totalProbes++;

      if (poll.probeOk !== false && !poll.errorType) {
        serviceEntry.successfulProbes++;
      } else if (poll.errorType) {
        const existing = serviceEntry.errors.get(poll.errorType);
        if (existing) {
          existing.count++;
        } else {
          serviceEntry.errors.set(poll.errorType, {
            count: 1,
            sampleMessage: poll.errorMessage ?? null
          });
        }
      }
    }

    // Convert to response format
    const providers = Array.from(providerMap.values()).map((provider) => ({
      providerPubkey: provider.providerPubkey,
      providerMoniker: provider.providerMoniker,
      services: Array.from(provider.services.values()).map((service) => ({
        serviceTypeId: service.serviceTypeId,
        serviceTypeName: service.serviceTypeName,
        serviceTypeIcon: service.serviceTypeIcon,
        totalProbes: service.totalProbes,
        successfulProbes: service.successfulProbes,
        successRate: service.totalProbes > 0
          ? Math.round((service.successfulProbes / service.totalProbes) * 100)
          : 0,
        errors: Array.from(service.errors.entries())
          .map(([errorType, { count, sampleMessage }]) => ({ errorType, count, sampleMessage }))
          .sort((a, b) => b.count - a.count)
      }))
    }));

    res.json({ providers });
  })
);

export default router;
