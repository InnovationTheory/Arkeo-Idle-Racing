import { RaceStatus, Prisma } from "@prisma/client";
import { config } from "../../config";
import { prisma } from "../../db";
import { sendArkeoReward } from "../../arkeo/send";
import { broadcastToRace } from "../../ws";
import { updateHorseHistory } from "../history";
import { getRaceWithRelations } from "../queries";
import type { RaceRuntime, HorseRuntime } from "./types";
import { placementRewardsArkeo } from "./constants";

type HorseStats = {
  avgP95: number;
  avgError: number;
  avgPerf: number;
};

function computeHorseStats(horse: HorseRuntime): HorseStats {
  const hasStats = horse.metrics.count > 0;
  return {
    avgP95: hasStats ? horse.metrics.p95Sum / horse.metrics.count : Number.POSITIVE_INFINITY,
    avgError: hasStats ? horse.metrics.errorSum / horse.metrics.count : 1,
    avgPerf: hasStats ? horse.metrics.perfSum / horse.metrics.count : 0
  };
}

function tieBreak(
  a: HorseRuntime,
  b: HorseRuntime,
  statsByHorseId: Map<string, HorseStats>
): number {
  const aStats = statsByHorseId.get(a.raceHorseId);
  const bStats = statsByHorseId.get(b.raceHorseId);
  if (aStats && bStats) {
    if (aStats.avgP95 !== bStats.avgP95) return aStats.avgP95 - bStats.avgP95;
    if (aStats.avgError !== bStats.avgError) return aStats.avgError - bStats.avgError;
    if (aStats.avgPerf !== bStats.avgPerf) return bStats.avgPerf - aStats.avgPerf;
  }
  return 0;
}

export function computePlacements(runtime: RaceRuntime): Map<string, number> {
  const statsByHorseId = new Map(
    runtime.horses.map((horse) => [horse.raceHorseId, computeHorseStats(horse)])
  );

  const sorted = [...runtime.horses].sort((a, b) => {
    const aFinished = a.finishedTick !== null;
    const bFinished = b.finishedTick !== null;
    const aDnf = a.dnfTick !== null;
    const bDnf = b.dnfTick !== null;

    const aCategory = aFinished ? 0 : aDnf ? 2 : 1;
    const bCategory = bFinished ? 0 : bDnf ? 2 : 1;

    if (aCategory !== bCategory) return aCategory - bCategory;

    if (aCategory === 0) {
      const tickDelta = (a.finishedTick ?? 0) - (b.finishedTick ?? 0);
      return tickDelta !== 0 ? tickDelta : tieBreak(a, b, statsByHorseId);
    }

    if (aCategory === 1) {
      const positionDelta = b.position - a.position;
      return positionDelta !== 0 ? positionDelta : tieBreak(a, b, statsByHorseId);
    }

    const positionDelta = b.position - a.position;
    if (positionDelta !== 0) return positionDelta;
    const dnfDelta = (b.dnfTick ?? 0) - (a.dnfTick ?? 0);
    return dnfDelta !== 0 ? dnfDelta : tieBreak(a, b, statsByHorseId);
  });

  const placements = new Map<string, number>();
  sorted.forEach((horse, index) => {
    placements.set(horse.raceHorseId, index + 1);
  });

  return placements;
}

type PayoutQueueItem = {
  payoutId: string;
  toAddress: string;
  amountUarkeo: bigint;
  breakdown: Prisma.JsonObject;
};

export async function finishRace(raceId: string, runtime: RaceRuntime): Promise<void> {
  const placements = computePlacements(runtime);

  const race = await getRaceWithRelations(raceId);
  if (!race) return;

  const runtimeByRaceHorseId = new Map(
    runtime.horses.map((horse) => [horse.raceHorseId, horse])
  );

  const raceHorseUpdates = runtime.horses.map((horse) => {
    const avgLatency = horse.metrics.count ? horse.metrics.latencySum / horse.metrics.count : 0;
    const avgP95 = horse.metrics.count ? horse.metrics.p95Sum / horse.metrics.count : 0;
    const avgError = horse.metrics.count ? horse.metrics.errorSum / horse.metrics.count : 0;

    return {
      raceHorseId: horse.raceHorseId,
      placement: placements.get(horse.raceHorseId) ?? null,
      eliminatedAtTick: horse.dnfTick,
      avgLatency,
      avgP95,
      avgError
    };
  });

  const raceHorseUpdateMap = new Map(
    raceHorseUpdates.map((update) => [update.raceHorseId, update])
  );

  const rewardUnit = 10n ** BigInt(config.arkeoDecimals);
  const payoutQueue: PayoutQueueItem[] = [];

  const didFinish = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${raceId}))`;
    const currentRace = await tx.race.findUnique({ where: { id: raceId } });
    if (
      !currentRace ||
      currentRace.status === RaceStatus.finished ||
      currentRace.status === RaceStatus.voided
    ) {
      return false;
    }

    for (const update of raceHorseUpdates) {
      await tx.raceHorse.update({
        where: { id: update.raceHorseId },
        data: {
          placement: update.placement,
          eliminatedAtTick: update.eliminatedAtTick
        }
      });
    }

    for (const entry of race.raceHorses) {
      const update = raceHorseUpdateMap.get(entry.id);
      if (!update) continue;
      const runtimeHorse = runtimeByRaceHorseId.get(entry.id);

      const historyUpdate = updateHorseHistory(entry.horse, {
        raceId,
        placement: update.placement,
        eliminatedAtTick: runtimeHorse?.dnfTick ?? null,
        totalTicks: runtime.totalTicks,
        avgLatencyMs: update.avgLatency,
        avgP95Ms: update.avgP95,
        avgErrorRate: update.avgError,
        ts: new Date().toISOString()
      });

      // Update career record (W-P-S-A)
      const placement = update.placement;
      const isDnf = runtimeHorse?.dnfTick !== null;
      const recordUpdate: Record<string, { increment: number }> = {
        races: { increment: 1 }
      };
      if (isDnf) {
        recordUpdate.dnfs = { increment: 1 };
      } else if (placement === 1) {
        recordUpdate.wins = { increment: 1 };
      } else if (placement === 2) {
        recordUpdate.places = { increment: 1 };
      } else if (placement === 3) {
        recordUpdate.shows = { increment: 1 };
      }

      await tx.horse.update({
        where: { id: entry.horseId },
        data: {
          historyJson: historyUpdate.historyJson,
          formScore: historyUpdate.formScore,
          handicapTier: historyUpdate.handicapTier,
          ...recordUpdate
        }
      });
    }

    const selections = await tx.raceSelection.findMany({
      where: { raceId },
      include: {
        user: true,
        raceHorse: { include: { horse: true } }
      }
    });

    for (const selection of selections) {
      const placement = placements.get(selection.raceHorseId);
      if (!placement) continue;
      const rewardArkeo = placementRewardsArkeo[placement - 1];
      if (!rewardArkeo) continue;
      const walletAddress = selection.user.walletAddress;
      if (!walletAddress) continue;

      const amountUarkeo = BigInt(rewardArkeo) * rewardUnit;
      const breakdown: Prisma.JsonObject = {
        status: "pending",
        placement,
        rewardArkeo,
        rewardUarkeo: amountUarkeo.toString(),
        raceHorseId: selection.raceHorseId,
        horseName: selection.raceHorse.horse.displayName,
        walletAddress
      };

      const payout = await tx.payout.create({
        data: {
          raceId,
          userId: selection.userId,
          amountCredits: rewardArkeo,
          breakdownJson: breakdown
        },
        select: { id: true }
      });

      payoutQueue.push({
        payoutId: payout.id,
        toAddress: walletAddress,
        amountUarkeo,
        breakdown
      });
    }

    await tx.race.update({
      where: { id: raceId },
      data: {
        status: RaceStatus.finished,
        endAt: new Date(),
        intakeCredits: 0,
        payoutBudgetCredits: 0
      }
    });

    await tx.raceEvent.create({
      data: {
        raceId,
        type: "results_ready",
        payloadJson: { raceId }
      }
    });

    return true;
  });

  if (!didFinish) return;

  await processPayouts(raceId, payoutQueue);

  broadcastToRace(raceId, { type: "results_ready", data: { raceId } });
}

async function processPayouts(raceId: string, payoutQueue: PayoutQueueItem[]): Promise<void> {
  if (payoutQueue.length === 0) return;

  for (const payout of payoutQueue) {
    const base = payout.breakdown;
    if (!config.hotWalletEnabled) {
      await prisma.payout.update({
        where: { id: payout.payoutId },
        data: { breakdownJson: { ...base, status: "skipped", error: "hot_wallet_disabled" } }
      });
      continue;
    }

    const sendResult = await sendArkeoReward({
      toAddress: payout.toAddress,
      amountUarkeo: payout.amountUarkeo,
      memo: `Arkeo Racing reward ${raceId}`
    });

    await prisma.payout.update({
      where: { id: payout.payoutId },
      data: {
        breakdownJson: {
          ...base,
          status: sendResult.ok ? "sent" : "failed",
          txHash: sendResult.txHash,
          ...(sendResult.ok ? {} : { error: sendResult.error })
        }
      }
    });
  }
}
