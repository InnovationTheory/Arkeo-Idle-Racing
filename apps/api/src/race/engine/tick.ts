import { Prisma } from "@prisma/client";
import { config } from "../../config";
import { prisma } from "../../db";
import { pollHorse } from "../../poller";
import { broadcastToRace } from "../../ws";
import { handicapPerformanceMods } from "../handicap";
import { raceLogger } from "../../logger";
import type { RaceRuntime, HorseRuntime } from "./types";
import {
  WINDOW_SIZE,
  ERR_ELIM,
  STALE_ELIM,
  thresholdsByProbeType,
  CONSECUTIVE_FAILURES_ELIM,
  CONSECUTIVE_LATENCY_ELIM,
  PERF_SCORE_MIN,
  PERF_SCORE_MAX,
  PHOTO_FINISH_THRESHOLD,
  FINAL_STRETCH_TICKS
} from "./constants";
import type { RacePhase } from "./types";
import { clamp, loadFactor, computePerfScore } from "./scoring";
import { weatherForTick } from "./weather";
import {
  racePhaseForPosition,
  archetypeSpeedMultiplier,
  temperamentNoiseWithPressure,
  updateMomentumAndFatigue,
  calculateStride,
  applyDraftEffect,
  checkDesperationSurge,
  checkFinishingKick,
  checkDetermination,
  getSurfaceAffinityMultiplier
} from "./movement";
import {
  PASSING_SURGE_BONUS,
  PASSING_SURGE_DURATION,
  PASSING_SURGE_MAX_COUNT
} from "./constants";
import type { RacingContext } from "./types";
import { finishRace } from "./finish";

type RuntimeManager = {
  get: (raceId: string) => RaceRuntime | undefined;
  delete: (raceId: string) => void;
};

type VoidRaceCallback = (raceId: string, reason: string) => Promise<void>;

export function createTickHandler(
  runtimeManager: RuntimeManager,
  voidRaceById: VoidRaceCallback
) {
  return async function tickRace(raceId: string): Promise<void> {
    const runtime = runtimeManager.get(raceId);
    if (!runtime) return;

    runtime.currentTick += 1;
    const load = loadFactor(runtime.ramp, runtime.currentTick, runtime.totalTicks);
    let allFailedThisTick = true;
    let polledCount = 0;
    const weather = weatherForTick(runtime);
    const pollRows: Prisma.RaceHorsePollCreateManyInput[] = [];
    const pollTimestamp = new Date();
    const baseStride = (100 / runtime.totalTicks) * runtime.paceMult;

    // Broadcast weather spike event if spiking
    if (weather.isSpiking) {
      broadcastToRace(raceId, {
        type: "event",
        data: {
          eventType: "weather_spike",
          tick: runtime.currentTick
        }
      });
    }

    // Calculate racing context for position-aware dynamics
    const activeHorses = runtime.horses.filter(
      (h) => h.finishedTick === null && h.dnfTick === null
    );
    const positions = activeHorses.map((h) => h.position).sort((a, b) => b - a);
    const leaderPosition = positions[0] ?? 0;
    const lastPosition = positions[positions.length - 1] ?? 0;
    const positionSpread = leaderPosition - lastPosition;

    // Store previous positions and ranks for passing detection, decrement passing surge timers
    for (const horse of runtime.horses) {
      horse.previousPosition = horse.position;
      horse.previousRank = positions.filter((p) => p > horse.position).length + 1;
      // Decrement passing surge timer
      if (horse.passingSurgeTicksRemaining > 0) {
        horse.passingSurgeTicksRemaining -= 1;
      }
    }

    for (const horse of runtime.horses) {
      if (horse.finishedTick !== null || horse.dnfTick !== null) continue;

      polledCount += 1;
      // Use longer timeout for first poll (contract initialization), shorter for subsequent
      const timeoutMs = horse.hasSuccessfulPoll ? config.pollTimeoutMs : config.firstPollTimeoutMs;
      const metrics = await pollHorse({
        serviceTypeId: horse.serviceTypeId,
        handicapTier: horse.handicapTier,
        weather,
        loadFactor: load,
        providerPubkey: horse.assignedProviderPubkey,
        timeoutMs
      });

      const ok = !metrics.errorType;
      if (ok) {
        allFailedThisTick = false;
        horse.hasSuccessfulPoll = true;
      }

      // Update stale seconds based on head height delta
      if (typeof metrics.headHeightDelta === "number") {
        if (metrics.headHeightDelta <= 0) {
          horse.staleSeconds += runtime.tickMs / 1000;
        } else {
          horse.staleSeconds = 0;
        }
      }

      // Update sliding window
      horse.window.push({
        ok,
        latencyMs: typeof metrics.latencyMs === "number" ? metrics.latencyMs : null,
        errorType: metrics.errorType ?? null,
        headHeightDelta: metrics.headHeightDelta ?? null
      });
      if (horse.window.length > WINDOW_SIZE) {
        horse.window.shift();
      }

      // Compute performance score
      const okLatencies = horse.window
        .filter((entry) => entry.ok && typeof entry.latencyMs === "number")
        .map((entry) => entry.latencyMs as number);
      const errorCount = horse.window.filter((entry) => !entry.ok).length;
      const windowSize = horse.window.length;
      const thresholds =
        thresholdsByProbeType[horse.probeType] ?? thresholdsByProbeType.cosmos_rpc;

      const perf = computePerfScore({
        okLatencies,
        windowSize,
        errorCount,
        staleSeconds: horse.staleSeconds,
        thresholds,
        weather
      });

      const mods = handicapPerformanceMods(horse.handicapTier);
      const perfScore = clamp(perf.perfScore * (1 / mods.rampMult), PERF_SCORE_MIN, PERF_SCORE_MAX);

      // Accumulate metrics
      horse.metrics.latencySum += metrics.latencyMs;
      horse.metrics.p95Sum += perf.p95Latency;
      horse.metrics.errorSum += perf.errorRate;
      horse.metrics.perfSum += perfScore;
      horse.metrics.count += 1;

      horse.lastMetrics = {
        latencyMs: metrics.latencyMs,
        p95Ms: perf.p95Latency,
        errorRate: perf.errorRate,
        perfScore,
        errorType: metrics.errorType ?? null
      };

      // Track consecutive failures for metrics (but no longer eliminate)
      horse.consecutiveFailures = ok ? 0 : horse.consecutiveFailures + 1;
      horse.consecutiveLatencyElim =
        perf.p95Latency >= thresholds.latElim ? horse.consecutiveLatencyElim + 1 : 0;

      // NOTE: Elimination logic removed - horses slow down in bad weather but don't DNF
      // Poor performance is reflected in reduced stride/speed, not elimination

      // Create poll row
      const pollRow = createPollRow(raceId, horse, runtime, metrics, perf, perfScore, load, weather, ok, pollTimestamp);
      pollRows.push(pollRow);

      // Calculate horse's current rank
      const currentRank = positions.filter((p) => p > horse.position).length + 1;

      // Build racing context for this horse
      const racingContext: RacingContext = {
        leaderPosition,
        positionSpread,
        currentRank,
        totalActive: activeHorses.length,
        currentTick: runtime.currentTick,
        totalTicks: runtime.totalTicks,
        isSpiking: weather.isSpiking ?? false
      };

      // Update position with all racing dynamics
      const positionResult = updateHorsePosition(horse, baseStride, perfScore, racingContext, runtime.trackSurface);

      // Calculate new rank after position update
      const newPositions = runtime.horses
        .filter((h) => h.finishedTick === null && h.dnfTick === null)
        .map((h) => h.position)
        .sort((a, b) => b - a);
      const newRank = newPositions.filter((p) => p > horse.position).length + 1;

      // Passing Detection: check if horse improved rank (passed someone)
      if (
        horse.previousRank > newRank &&
        horse.passingSurgeCount < PASSING_SURGE_MAX_COUNT &&
        horse.passingSurgeTicksRemaining === 0
      ) {
        // Trigger passing surge
        horse.passingSurgeTicksRemaining = PASSING_SURGE_DURATION;
        horse.passingSurgeCount += 1;

        broadcastToRace(raceId, {
          type: "event",
          data: {
            eventType: "passing_surge",
            raceHorseId: horse.raceHorseId,
            horseName: horse.displayName,
            newRank,
            previousRank: horse.previousRank,
            tick: runtime.currentTick
          }
        });
      }

      // Broadcast desperation surge event
      if (positionResult.desperationTriggered) {
        broadcastToRace(raceId, {
          type: "event",
          data: {
            eventType: "desperation_surge",
            raceHorseId: horse.raceHorseId,
            horseName: horse.displayName,
            tick: runtime.currentTick
          }
        });
      }

      // Broadcast finishing kick event (only first time triggered per horse)
      if (positionResult.finishingKickTriggered && horse.position >= 85 && horse.position < 87) {
        broadcastToRace(raceId, {
          type: "event",
          data: {
            eventType: "finishing_kick",
            raceHorseId: horse.raceHorseId,
            horseName: horse.displayName,
            tick: runtime.currentTick
          }
        });
      }

      // Broadcast determination event (occasional, not every tick)
      if (positionResult.determinationTriggered && Math.random() < 0.15) {
        broadcastToRace(raceId, {
          type: "event",
          data: {
            eventType: "determination",
            raceHorseId: horse.raceHorseId,
            horseName: horse.displayName,
            tick: runtime.currentTick
          }
        });
      }
    }

    // Broadcast race events after all position updates
    broadcastRaceEvents(raceId, runtime);

    // Persist poll rows
    if (pollRows.length > 0) {
      try {
        await prisma.raceHorsePoll.createMany({ data: pollRows });
      } catch (error) {
        raceLogger.warn({ err: error, raceId }, "Failed to persist poll rows");
      }
    }

    // Check void conditions
    if (
      config.racingMode === "live" &&
      runtime.currentTick <= config.voidFirstTicks &&
      polledCount > 0
    ) {
      if (allFailedThisTick) {
        runtime.voidFailureTicks += 1;
      }
      if (
        runtime.currentTick === config.voidFirstTicks &&
        runtime.voidFailureTicks === config.voidFirstTicks
      ) {
        await voidRaceById(raceId, "subscriber_unreachable");
        return;
      }
    }

    // Broadcast tick update
    broadcastTickUpdate(raceId, runtime);

    // Check if race should end
    const shouldEnd = checkRaceEnd(runtime);
    if (shouldEnd) {
      clearInterval(runtime.interval);
      runtimeManager.delete(raceId);
      await finishRace(raceId, runtime);
    }
  };
}

export function getEliminationReason(
  horse: HorseRuntime,
  errorRate: number,
  latElim: number
): string {
  if (horse.consecutiveFailures >= CONSECUTIVE_FAILURES_ELIM) return "failures";
  if (errorRate >= ERR_ELIM) return "error_rate";
  if (horse.consecutiveLatencyElim >= CONSECUTIVE_LATENCY_ELIM) return "latency";
  return "stale_height";
}

function createPollRow(
  raceId: string,
  horse: HorseRuntime,
  runtime: RaceRuntime,
  metrics: { latencyMs: number; headHeightDelta?: number | null; errorType?: string | null; errorMessage?: string | null; request?: { url: string; method: string; payload?: unknown } },
  perf: { p95Latency: number; errorRate: number },
  perfScore: number,
  load: number,
  weather: { latencyMult: number; errorMult: number; jitterMult: number },
  ok: boolean,
  pollTimestamp: Date
): Prisma.RaceHorsePollCreateManyInput {
  const pollRow: Prisma.RaceHorsePollCreateManyInput = {
    raceId,
    raceHorseId: horse.raceHorseId,
    providerId: horse.assignedProviderId ?? null,
    tick: runtime.currentTick,
    phase: "live",
    ts: pollTimestamp,
    mode: config.racingMode,
    latencyMs: metrics.latencyMs,
    p95Ms: perf.p95Latency,
    errorRate: perf.errorRate,
    speedFactor: perfScore,
    headHeightDelta: metrics.headHeightDelta,
    errorType: metrics.errorType ?? null,
    errorMessage: metrics.errorMessage ?? null,
    loadFactor: load,
    weatherJson: weather as Prisma.InputJsonValue,
    probeOk: ok
  };

  if (metrics.request) {
    pollRow.probeRequestJson = {
      url: metrics.request.url,
      method: metrics.request.method,
      payload:
        metrics.request.payload === undefined
          ? null
          : (metrics.request.payload as Prisma.InputJsonValue)
    };
  }

  return pollRow;
}

type PositionUpdateResult = {
  desperationTriggered: boolean;
  finishingKickTriggered: boolean;
  determinationTriggered: boolean;
};

function updateHorsePosition(horse: HorseRuntime, baseStride: number, perfScore: number, context: RacingContext, trackSurface: import("@prisma/client").TrackSurface): PositionUpdateResult {
  const phase = racePhaseForPosition(horse.position);

  // Apply Draft Effect: boost performance when drafting behind leader
  let adjustedPerfScore = applyDraftEffect(perfScore, horse.position, context.leaderPosition);

  // Update momentum and fatigue (includes leader fatigue and position-based momentum boost)
  const { momentum, fatigue } = updateMomentumAndFatigue(horse, adjustedPerfScore, phase, context);
  horse.momentum = momentum;
  horse.fatigue = fatigue;

  // Check for Desperation Surge in stretch
  const desperation = checkDesperationSurge(horse, context, phase);
  if (desperation.extraFatigue > 0) {
    horse.fatigue = Math.min(0.25, horse.fatigue + desperation.extraFatigue);
  }

  // Check for Finishing Kick in final 15% of race
  const finishingKick = checkFinishingKick(horse, context);

  // Check for Determination bonus when behind
  const determination = checkDetermination(horse, context, phase);

  const phaseMult = archetypeSpeedMultiplier(horse.archetype, phase);

  // Use pressure-aware temperament noise
  const noise = temperamentNoiseWithPressure(horse.temperament, context);

  let stride = calculateStride({
    baseStride,
    perfScore: adjustedPerfScore,
    phaseMult,
    momentum: horse.momentum,
    fatigue: horse.fatigue,
    noise,
    context
  });

  // Apply desperation surge bonus
  stride *= desperation.strideBonus;

  // Apply finishing kick bonus
  stride *= finishingKick.kickMultiplier;

  // Apply determination bonus
  stride *= determination.bonus;

  // Apply surface affinity modifier (how well horse performs on this track surface)
  const surfaceAffinityMult = getSurfaceAffinityMultiplier(horse.surfaceAffinity, trackSurface);
  stride *= surfaceAffinityMult;

  // Apply passing surge bonus if active
  if (horse.passingSurgeTicksRemaining > 0) {
    stride *= PASSING_SURGE_BONUS;
  }

  horse.position = Math.min(100, horse.position + stride);
  if (horse.position >= 100 && horse.finishedTick === null) {
    horse.finishedTick = context.currentTick;
  }

  return {
    desperationTriggered: desperation.triggered,
    finishingKickTriggered: finishingKick.triggered,
    determinationTriggered: determination.triggered
  };
}

function broadcastRaceEvents(raceId: string, runtime: RaceRuntime): void {
  // Get active horses sorted by position (leader first)
  const activeHorses = runtime.horses
    .filter((h) => h.finishedTick === null && h.dnfTick === null)
    .sort((a, b) => b.position - a.position);

  if (activeHorses.length === 0) return;

  const leader = activeHorses[0];
  const leaderPhase = racePhaseForPosition(leader.position);

  // Lead Change Detection
  if (runtime.lastLeaderRaceHorseId !== null && runtime.lastLeaderRaceHorseId !== leader.raceHorseId) {
    broadcastToRace(raceId, {
      type: "event",
      data: {
        eventType: "lead_change",
        raceHorseId: leader.raceHorseId,
        horseName: leader.displayName,
        tick: runtime.currentTick
      }
    });
  }
  runtime.lastLeaderRaceHorseId = leader.raceHorseId;

  // Phase Transition: Entering Stretch
  if (!runtime.stretchAnnounced && leaderPhase === "stretch") {
    runtime.stretchAnnounced = true;
    broadcastToRace(raceId, {
      type: "event",
      data: {
        eventType: "entering_stretch",
        tick: runtime.currentTick
      }
    });
  }

  // Final Ticks Announcement
  const ticksRemaining = runtime.totalTicks - runtime.currentTick;
  if (!runtime.finalTicksAnnounced && ticksRemaining <= FINAL_STRETCH_TICKS && ticksRemaining > 0) {
    runtime.finalTicksAnnounced = true;
    broadcastToRace(raceId, {
      type: "event",
      data: {
        eventType: "final_stretch",
        ticksRemaining,
        tick: runtime.currentTick
      }
    });
  }

  // Photo Finish Detection (top 2 or 3 horses very close)
  if (activeHorses.length >= 2 && leaderPhase === "stretch") {
    const secondPlace = activeHorses[1];
    const gap = leader.position - secondPlace.position;

    if (gap <= PHOTO_FINISH_THRESHOLD && gap > 0) {
      // Check if third place is also in contention
      const thirdInContention = activeHorses.length >= 3 &&
        (leader.position - activeHorses[2].position) <= PHOTO_FINISH_THRESHOLD;

      broadcastToRace(raceId, {
        type: "event",
        data: {
          eventType: "photo_finish",
          horsesInContention: thirdInContention ? 3 : 2,
          gap,
          tick: runtime.currentTick
        }
      });
    }
  }

  // Update last phase
  runtime.lastPhase = leaderPhase;
}

function broadcastTickUpdate(raceId: string, runtime: RaceRuntime): void {
  const update = {
    tick: runtime.currentTick,
    totalTicks: runtime.totalTicks,
    horses: runtime.horses.map((horse) => ({
      raceHorseId: horse.raceHorseId,
      position: horse.position,
      eliminatedAtTick: horse.dnfTick,
      metrics: horse.lastMetrics
    }))
  };

  raceLogger.debug({ raceId: raceId.slice(-6), tick: runtime.currentTick, totalTicks: runtime.totalTicks }, "Broadcasting tick_update");
  broadcastToRace(raceId, { type: "tick_update", data: update });
}

export function checkRaceEnd(runtime: RaceRuntime): boolean {
  const finishedCount = runtime.horses.filter((horse) => horse.finishedTick !== null).length;
  const dnfCount = runtime.horses.filter((horse) => horse.dnfTick !== null).length;
  const activeCount = runtime.horses.length - finishedCount - dnfCount;

  // Race ends when:
  // 1. At least one horse finished AND all horses are done (finished or DNF)
  // 2. OR time has expired and at least 5 horses finished
  // 3. OR time has expired (regardless of finishers - prevents infinite races)
  const allDone = activeCount === 0;
  const timeExpired = runtime.currentTick >= runtime.totalTicks;

  // Don't end early just because all horses DNF'd - wait for time to expire
  // This allows eliminated horses to still be ranked by position
  if (allDone && finishedCount === 0) {
    return timeExpired;
  }

  return allDone || (timeExpired && finishedCount >= 5);
}
