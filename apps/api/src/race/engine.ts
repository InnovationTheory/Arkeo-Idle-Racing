import { RaceStatus } from "@prisma/client";
import { prisma } from "../db";
import { broadcastToRace } from "../ws";
import { getRaceWithRelations } from "./queries";
import type { RaceRuntime, HorseRuntime } from "./engine/types";
import type { Thresholds, RampConfig, WeatherModifiers } from "../types/prisma-json";
import { createTickHandler } from "./engine/tick";
import { finishRace } from "./engine/finish";
import { spikesToWindows, generateRandomizedSpikes } from "./engine/weather";

// Re-export types for external use
export type { RaceRuntime, HorseRuntime } from "./engine/types";

const runtimeByRaceId = new Map<string, RaceRuntime>();

const runtimeManager = {
  get: (raceId: string) => runtimeByRaceId.get(raceId),
  delete: (raceId: string) => runtimeByRaceId.delete(raceId)
};

export function isRaceRunning(raceId: string): boolean {
  return runtimeByRaceId.has(raceId);
}

export async function forceEndRace(raceId: string): Promise<void> {
  const runtime = runtimeByRaceId.get(raceId);
  if (runtime) {
    clearInterval(runtime.interval);
    runtimeByRaceId.delete(raceId);
    await finishRace(raceId, runtime);
    return;
  }

  const race = await getRaceWithRelations(raceId);
  if (!race) return;
  if (race.status === RaceStatus.finished || race.status === RaceStatus.voided) return;

  await prisma.race.update({
    where: { id: raceId },
    data: { status: RaceStatus.finished, endAt: new Date() }
  });
}

export async function voidRaceById(raceId: string, reason: string): Promise<void> {
  const runtime = runtimeByRaceId.get(raceId);
  if (runtime) {
    clearInterval(runtime.interval);
    runtimeByRaceId.delete(raceId);
  }

  const race = await prisma.race.findUnique({ where: { id: raceId } });
  if (!race || race.status === RaceStatus.voided) return;

  const tickets = await prisma.ticket.findMany({ where: { raceId } });

  await prisma.$transaction([
    prisma.race.update({
      where: { id: raceId },
      data: { status: RaceStatus.voided, endAt: new Date(), intakeCredits: 0, payoutBudgetCredits: 0 }
    }),
    prisma.raceEvent.create({
      data: { raceId, type: "race_voided", payloadJson: { raceId, reason } }
    }),
    ...tickets.map((ticket) =>
      prisma.payout.create({
        data: {
          raceId,
          userId: ticket.userId,
          amountCredits: ticket.costCredits,
          breakdownJson: { reason: "void_refund", ticketId: ticket.id }
        }
      })
    ),
    ...tickets.map((ticket) =>
      prisma.balance.update({
        where: { userId: ticket.userId },
        data: { credits: { increment: ticket.costCredits } }
      })
    )
  ]);

  broadcastToRace(raceId, {
    type: "event",
    data: { eventType: "race_voided", raceId, reason }
  });
}

export async function startRaceEngine(raceId: string): Promise<void> {
  if (runtimeByRaceId.has(raceId)) {
    console.log(`[RaceEngine] Engine already running for race ${raceId.slice(-6)}, skipping`);
    return;
  }
  console.log(`[RaceEngine] Starting engine for race ${raceId.slice(-6)}`);

  const race = await getRaceWithRelations(raceId);
  if (!race) return;

  const thresholds = race.track.thresholdsJson as Thresholds;
  const ramp = race.track.rampConfigJson as RampConfig;
  const totalTicks = Math.ceil((race.track.durationSecs * 1000) / race.track.tickMs);
  const weatherModifiers = race.weather.modifiersJson as WeatherModifiers;
  const paceMult =
    typeof ramp.paceMult === "number"
      ? ramp.paceMult
      : 1.15; // Default pace multiplier if not specified

  const horses: HorseRuntime[] = race.raceHorses.map((entry) => ({
    raceHorseId: entry.id,
    horseId: entry.horseId,
    displayName: entry.horse.displayName,
    handicapTier: entry.horse.handicapTier,
    archetype: entry.archetype,
    temperament: entry.temperament,
    surfaceAffinity: entry.surfaceAffinity,
    serviceTypeId: entry.serviceTypeId,
    probeType: entry.serviceType.probeType,
    assignedProviderId: entry.assignedProvider?.id ?? entry.assignedProviderId ?? null,
    assignedProviderPubkey: entry.assignedProvider?.providerPubkey ?? null,
    position: 0,
    previousPosition: 0,
    previousRank: 0,
    finishedTick: null,
    dnfTick: entry.eliminatedAtTick ?? null,
    eliminationReason: null,
    consecutiveFailures: 0,
    consecutiveLatencyElim: 0,
    momentum: 0,
    fatigue: 0,
    staleSeconds: 0,
    hasSuccessfulPoll: false,
    passingSurgeTicksRemaining: 0,
    passingSurgeCount: 0,
    window: [],
    lastMetrics: { latencyMs: 0, p95Ms: 0, errorRate: 0, perfScore: 0, errorType: null },
    metrics: { latencySum: 0, p95Sum: 0, errorSum: 0, perfSum: 0, count: 0 }
  }));

  const tickRace = createTickHandler(runtimeManager, voidRaceById);

  const runtime: RaceRuntime = {
    raceId,
    tickMs: race.track.tickMs,
    totalTicks,
    currentTick: 0,
    voidFailureTicks: 0,
    thresholds,
    ramp,
    paceMult,
    trackSurface: race.track.surface,
    weatherBase: {
      latencyMult: weatherModifiers.latencyMult ?? 1,
      errorMult: weatherModifiers.errorMult ?? 1,
      jitterMult: weatherModifiers.jitterMult ?? 1
    },
    spikeSeconds: new Set(
      Array.isArray(weatherModifiers.spikes) && weatherModifiers.spikes.length > 0
        ? generateRandomizedSpikes(
            spikesToWindows(weatherModifiers.spikes.map(Number)),
            race.track.durationSecs
          )
        : []
    ),
    horses,
    interval: setInterval(() => tickRace(raceId), race.track.tickMs),
    // Event tracking state
    lastLeaderRaceHorseId: null,
    lastPhase: null,
    stretchAnnounced: false,
    finalTicksAnnounced: false
  };

  runtimeByRaceId.set(raceId, runtime);
  console.log(`[RaceEngine] Started engine for race ${raceId.slice(-6)}, tickMs=${race.track.tickMs}, totalTicks=${totalTicks}`);
  broadcastToRace(raceId, {
    type: "event",
    data: { eventType: "race_started", raceId }
  });
}
