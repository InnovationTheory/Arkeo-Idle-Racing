import { Router } from "express";
import { RaceStatus } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { createRaceNow } from "../scheduler";
import { getCurrentOrNextRace, getRaceWithRelations } from "../race/queries";
import { serializeRace } from "../race/serialize";
import { asyncHandler } from "./utils/asyncHandler";

const router = Router();

router.get(
  "/current",
  asyncHandler(async (_req, res) => {
    const include = {
      track: true,
      weather: true,
      raceDayHeat: {
        select: {
          roundNumber: true,
          heatNumber: true,
          round: { select: { heatsCount: true } },
          raceDay: { select: { status: true } }
        }
      },
      raceHorses: {
        include: {
          horse: true,
          serviceType: true,
          assignedProvider: true
        }
      }
    };

    let race = config.autoRaceEnabled
      ? await getCurrentOrNextRace()
      : // First try running races (highest priority)
        await prisma.race.findFirst({
          where: { status: "running", raceDayHeat: { isNot: null } },
          orderBy: { startAt: "desc" },
          include
        });

    // Then try picking races
    if (!race && !config.autoRaceEnabled) {
      race = await prisma.race.findFirst({
        where: { status: "picking", raceDayHeat: { isNot: null } },
        orderBy: { startAt: "asc" },
        include
      });
    }

    // Finally try scheduled races
    if (!race && !config.autoRaceEnabled) {
      race = await prisma.race.findFirst({
        where: { status: "scheduled", raceDayHeat: { isNot: null } },
        orderBy: { startAt: "asc" },
        include
      });
    }
    if (!race) {
      if (config.autoRaceEnabled) {
        await createRaceNow();
        race = await getCurrentOrNextRace();
      }
    }
    if (!race) {
      res.json({ raceId: null });
      return;
    }
    res.json(serializeRace(race));
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const limitRaw = req.query.limit as string | undefined;
    const offsetRaw = req.query.offset as string | undefined;
    const parsed = limitRaw ? Number(limitRaw) : 20;
    const offsetParsed = offsetRaw ? Number(offsetRaw) : 0;
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20;
    const offset = Number.isFinite(offsetParsed) ? Math.max(offsetParsed, 0) : 0;

    const totalCount = await prisma.race.count();
    const races = await prisma.race.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      include: {
        track: true,
        weather: true,
        raceDayHeat: {
          select: {
            roundNumber: true,
            heatNumber: true,
            round: { select: { heatsCount: true } },
            raceDay: { select: { status: true } }
          }
        },
        raceHorses: { include: { horse: true, serviceType: true } }
      }
    });

    res.json({
      totalCount,
      races: races.map((race) => ({
        raceId: race.id,
        status: race.status,
        track: race.track,
        weather: race.weather,
        createdAt: race.createdAt,
        pickCloseAt: race.pickCloseAt,
        startAt: race.startAt,
        endAt: race.endAt,
        intakeCredits: race.intakeCredits,
        payoutBudgetCredits: race.payoutBudgetCredits,
        racedayLevel: race.raceDayHeat?.roundNumber ?? null,
        racedayHeatNumber: race.raceDayHeat?.heatNumber ?? null,
        racedayHeatCount: race.raceDayHeat?.round?.heatsCount ?? null,
        racedayStatus: race.raceDayHeat?.raceDay?.status ?? null,
        horses: race.raceHorses.map((entry) => ({
          raceHorseId: entry.id,
          horseId: entry.horseId,
          displayName: entry.horse.displayName,
          placement: entry.placement,
          eliminatedAtTick: entry.eliminatedAtTick,
          serviceType: entry.serviceType
        }))
      }))
    });
  })
);

router.get(
  "/:raceId",
  asyncHandler(async (req, res) => {
    const race = await getRaceWithRelations(req.params.raceId);
    if (!race) {
      res.status(404).json({ error: "race_not_found" });
      return;
    }
    res.json(serializeRace(race));
  })
);

router.get(
  "/:raceId/polls",
  asyncHandler(async (req, res) => {
    const raceId = req.params.raceId;
    const phase = (req.query.phase as string | undefined) ?? "prep";
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    if (!race) {
      res.status(404).json({ error: "race_not_found" });
      return;
    }

    const rows = await prisma.raceHorsePoll.findMany({
      where: { raceId, phase },
      orderBy: { ts: "desc" }
    });

    const grouped = new Map<string, Array<{
      latencyMs: number;
      probeOk: boolean | null;
      errorType: string | null;
      ts: Date;
    }>>();

    for (const row of rows) {
      const list = grouped.get(row.raceHorseId) ?? [];
      if (list.length >= 3) continue;
      list.push({
        latencyMs: row.latencyMs,
        probeOk: row.probeOk ?? (row.errorType ? false : true),
        errorType: row.errorType ?? null,
        ts: row.ts
      });
      grouped.set(row.raceHorseId, list);
    }

    const polls: Record<
      string,
      Array<{
        latencyMs: number;
        probeOk: boolean | null;
        errorType: string | null;
        ts: Date;
      }>
    > = {};
    for (const [horseId, list] of grouped.entries()) {
      polls[horseId] = list.reverse();
    }

    res.json({ raceId, phase, polls });
  })
);

router.get(
  "/:raceId/providers",
  asyncHandler(async (req, res) => {
    const race = await prisma.race.findUnique({
      where: { id: req.params.raceId },
      include: {
        raceHorses: {
          include: { horse: true, serviceType: true, assignedProvider: true }
        }
      }
    });

    if (!race) {
      res.status(404).json({ error: "race_not_found" });
      return;
    }

    const assignments = race.raceHorses
      .filter((entry) => entry.assignedProviderId)
      .map((entry) => ({
        raceHorseId: entry.id,
        horseId: entry.horseId,
        horseName: entry.horse.displayName,
        serviceTypeId: entry.serviceTypeId,
        serviceTypeName: entry.serviceType.displayName,
        provider: entry.assignedProvider
          ? {
              id: entry.assignedProvider.id,
              providerPubkey: entry.assignedProvider.providerPubkey,
              moniker: entry.assignedProvider.moniker,
              endpoint: entry.assignedProvider.endpoint,
              region: entry.assignedProvider.region,
              reliabilityScore: entry.assignedProvider.reliabilityScore
            }
          : null
      }));

    res.json({ raceId: race.id, status: race.status, assignments });
  })
);

router.get(
  "/:raceId/results",
  asyncHandler(async (req, res) => {
    const race = await prisma.race.findUnique({
      where: { id: req.params.raceId },
      include: {
        raceHorses: {
          include: { horse: true, serviceType: true, assignedProvider: true }
        },
        payouts: true
      }
    });

    if (!race) {
      res.status(404).json({ error: "race_not_found" });
      return;
    }

    const placements = race.status === RaceStatus.voided
      ? []
      : race.raceHorses
          .map((entry) => ({
            raceHorseId: entry.id,
            displayName: entry.horse.displayName,
            placement: entry.placement,
            eliminatedAtTick: entry.eliminatedAtTick,
            serviceType: entry.serviceType,
            assignedProvider: entry.assignedProvider
          }))
          .sort((a, b) => (a.placement ?? 999) - (b.placement ?? 999));

    res.json({
      raceId: race.id,
      status: race.status,
      placements,
      payouts: race.payouts
    });
  })
);

export default router;
