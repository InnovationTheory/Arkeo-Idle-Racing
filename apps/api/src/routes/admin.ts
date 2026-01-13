import { Router } from "express";
import { RaceStatus, RaceDayStatus, RaceDayHeatStatus, RaceDayRoundStatus } from "@prisma/client";
import { prisma } from "../db";
import { createRaceNow, forceStartRace, forceEndRaceNow } from "../scheduler";
import { voidRaceById } from "../race/engine";
import { asyncHandler } from "./utils/asyncHandler";
import { requireAdminKey } from "./utils/adminAuth";
import { fetchArkeoBalance } from "./utils/arkeo";
import { getHotWalletAddress } from "../arkeo/send";

const router = Router();

// All admin routes require API key authentication
router.use(requireAdminKey);

router.post(
  "/races/create-now",
  asyncHandler(async (_req, res) => {
    const raceId = await createRaceNow();
    res.json({ raceId });
  })
);

router.post(
  "/races/start-now",
  asyncHandler(async (req, res) => {
    const raceId = req.body?.raceId as string | undefined;
    if (!raceId) {
      res.status(400).json({ error: "raceId_required" });
      return;
    }
    await forceStartRace(raceId);
    res.json({ ok: true });
  })
);

router.post(
  "/races/end-now",
  asyncHandler(async (req, res) => {
    const raceId = req.body?.raceId as string | undefined;
    if (!raceId) {
      res.status(400).json({ error: "raceId_required" });
      return;
    }
    await forceEndRaceNow(raceId);
    res.json({ ok: true });
  })
);

router.post(
  "/races/void/:id",
  asyncHandler(async (req, res) => {
    const raceId = req.params.id;
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    if (!race) {
      res.status(404).json({ error: "race_not_found" });
      return;
    }
    await voidRaceById(raceId, "admin_void");
    res.json({ ok: true, raceId });
  })
);

router.delete(
  "/races/:id",
  asyncHandler(async (req, res) => {
    const raceId = req.params.id;
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    if (!race) {
      res.status(404).json({ error: "race_not_found" });
      return;
    }

    // Void first if still active
    if (race.status === RaceStatus.running || race.status === RaceStatus.picking || race.status === RaceStatus.scheduled) {
      await voidRaceById(raceId, "admin_delete");
    }

    // Delete related records in order
    await prisma.raceHorsePoll.deleteMany({ where: { raceId } });
    await prisma.raceEvent.deleteMany({ where: { raceId } });
    await prisma.raceHorse.deleteMany({ where: { raceId } });
    await prisma.pick.deleteMany({ where: { ticket: { raceId } } });
    await prisma.ticket.deleteMany({ where: { raceId } });
    await prisma.race.delete({ where: { id: raceId } });

    res.json({ ok: true, raceId, deleted: true });
  })
);

router.post(
  "/void-stuck-races",
  asyncHandler(async (_req, res) => {
    const stuckRaces = await prisma.race.findMany({
      where: {
        status: { in: [RaceStatus.running, RaceStatus.picking] },
        endAt: { lt: new Date() }
      }
    });

    const voided: string[] = [];
    for (const race of stuckRaces) {
      await voidRaceById(race.id, "admin_void");
      voided.push(race.id);
    }

    res.json({ ok: true, voidedCount: voided.length, voidedRaceIds: voided });
  })
);

router.post(
  "/reset-raceday/:id",
  asyncHandler(async (req, res) => {
    const raceDayId = req.params.id;
    const raceDay = await prisma.raceDay.findUnique({ where: { id: raceDayId } });
    if (!raceDay) {
      res.status(404).json({ error: "raceday_not_found" });
      return;
    }

    // Void any running races associated with this raceday
    const heatsWithRaces = await prisma.raceDayHeat.findMany({
      where: { raceDayId },
      select: { raceId: true }
    });
    for (const heat of heatsWithRaces) {
      if (heat.raceId) {
        const race = await prisma.race.findUnique({ where: { id: heat.raceId } });
        if (race && (race.status === RaceStatus.running || race.status === RaceStatus.picking || race.status === RaceStatus.scheduled)) {
          await voidRaceById(heat.raceId, "raceday_reset");
        }
      }
    }

    // Reset all heats
    await prisma.raceDayHeat.updateMany({
      where: { raceDayId },
      data: {
        status: RaceDayHeatStatus.scheduled,
        raceId: null,
        startsAt: null,
        pickCloseAt: null,
        endsAt: null,
        advancersJson: [],
        resultsJson: []
      }
    });

    // Reset all rounds
    await prisma.raceDayRound.updateMany({
      where: { raceDayId },
      data: {
        status: RaceDayRoundStatus.scheduled,
        startsAt: null,
        endsAt: null
      }
    });

    // Reset horses
    await prisma.raceDayHorse.updateMany({
      where: { raceDayId },
      data: {
        eliminatedRound: null,
        eliminatedHeat: null,
        finalPlacement: null
      }
    });

    // Reset raceday status
    await prisma.raceDay.update({
      where: { id: raceDayId },
      data: {
        status: RaceDayStatus.scheduled,
        startAt: null
      }
    });

    res.json({ ok: true, raceDayId });
  })
);

router.get(
  "/hot-wallet",
  asyncHandler(async (_req, res) => {
    const address = await getHotWalletAddress();
    if (!address) {
      res.json({
        address: null,
        balance: null,
        error: "hot_wallet_not_configured"
      });
      return;
    }
    try {
      const balance = await fetchArkeoBalance(address);
      res.json({
        address,
        balance: {
          amount: balance.amount,
          displayAmount: balance.displayAmount,
          ticker: balance.ticker,
          denom: balance.denom
        }
      });
    } catch {
      res.json({
        address,
        balance: null,
        error: "balance_unavailable"
      });
    }
  })
);

export default router;
