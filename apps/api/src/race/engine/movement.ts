import { RaceArchetype, SurfaceAffinity, Temperament, TrackSurface } from "@prisma/client";
import type { RacePhase, HorseRuntime, RacingContext } from "./types";
import { clamp } from "./scoring";
import {
  archetypePhaseMultipliers,
  temperamentNoiseRange,
  archetypeModifiers,
  MOMENTUM_MIN,
  MOMENTUM_MAX,
  FATIGUE_MIN,
  FATIGUE_MAX,
  STRIDE_MIN_MULT,
  STRIDE_MAX_MULT,
  LEADER_FATIGUE_MULT,
  DRAFT_DISTANCE_MAX,
  DRAFT_DISTANCE_OPTIMAL,
  DRAFT_PERF_BONUS_MAX,
  DRAFT_PERF_BONUS_MIN,
  PACK_SPREAD_EARLY,
  PACK_SPREAD_MID,
  PACK_SPREAD_STRETCH,
  PRESSURE_POSITION_SPREAD,
  VOLATILE_PRESSURE_NOISE_MULT,
  DESPERATION_POSITION_THRESHOLD,
  DESPERATION_MOMENTUM_THRESHOLD,
  DESPERATION_STRIDE_BONUS,
  DESPERATION_FATIGUE_COST,
  DESPERATION_PROBABILITY,
  CLOSE_FINISH_TICKS,
  CLOSE_FINISH_STRIDE_MIN,
  CLOSE_FINISH_STRIDE_MAX,
  FINISHING_KICK_POSITION_THRESHOLD,
  archetypeKickStrength,
  positionMomentumMultiplier,
  archetypeDetermination,
  DETERMINATION_RANK_THRESHOLD,
  surfaceAffinityMultipliers
} from "./constants";

export function racePhaseForPosition(position: number): RacePhase {
  if (position < 30) return "early";
  if (position < 70) return "mid";
  return "stretch";
}

export function archetypeSpeedMultiplier(archetype: RaceArchetype, phase: RacePhase): number {
  if (archetype === "erratic") {
    return 0.6 + Math.random() * 0.8;
  }
  return archetypePhaseMultipliers[archetype][phase];
}

export function temperamentNoise(temperament: Temperament): number {
  const range = temperamentNoiseRange[temperament] ?? 0.06;
  return (Math.random() * 2 - 1) * range;
}

export type MomentumFatigueUpdate = {
  momentum: number;
  fatigue: number;
};

export function updateMomentumAndFatigue(
  horse: HorseRuntime,
  perfScore: number,
  phase: RacePhase,
  context?: RacingContext
): MomentumFatigueUpdate {
  let momentumGain = (perfScore - 0.75) * 0.02;
  let fatigueGain = (0.6 - perfScore) * 0.015;

  // Leader Fatigue: horse in 1st place tires faster
  if (context && context.currentRank === 1) {
    fatigueGain *= LEADER_FATIGUE_MULT;
  }

  // Position-based momentum boost (rubber-banding) - trailing horses gain momentum faster
  if (context) {
    const posMult = getPositionMomentumMultiplier(context.currentRank);
    momentumGain *= posMult;
  }

  // Archetype-specific modifiers
  if (horse.archetype === "front_runner") {
    fatigueGain *= archetypeModifiers.front_runner.fatigueMult;
  } else if (horse.archetype === "grinder") {
    fatigueGain *= archetypeModifiers.grinder.fatigueMult;
  }

  if (horse.archetype === "stretch_runner" && phase === "stretch") {
    momentumGain *= archetypeModifiers.stretch_runner.stretchMomentumMult;
  }
  if (
    horse.archetype === "burst" &&
    phase === "mid" &&
    perfScore > archetypeModifiers.burst.perfThreshold
  ) {
    momentumGain *= archetypeModifiers.burst.midMomentumMult;
  }

  return {
    momentum: clamp(horse.momentum + momentumGain, MOMENTUM_MIN, MOMENTUM_MAX),
    fatigue: clamp(horse.fatigue + fatigueGain, FATIGUE_MIN, FATIGUE_MAX)
  };
}

// Position-based momentum multiplier (rubber-banding for trailing horses)
export function getPositionMomentumMultiplier(rank: number): number {
  return positionMomentumMultiplier[Math.min(rank, 10)] ?? 1.5;
}

export function calculateStride(params: {
  baseStride: number;
  perfScore: number;
  phaseMult: number;
  momentum: number;
  fatigue: number;
  noise: number;
  context?: RacingContext;
}): number {
  const { baseStride, perfScore, phaseMult, momentum, fatigue, noise, context } = params;

  let stride =
    baseStride *
    perfScore *
    phaseMult *
    (1 + momentum) *
    (1 - fatigue) *
    (1 + noise);

  // Apply pack spread based on phase
  if (context) {
    stride *= packSpreadMultiplier(racePhaseForPosition(context.leaderPosition));
  }

  // Close Finish: tighter stride variance in final ticks
  if (context && isCloseFinish(context)) {
    const normalizedStride = stride / baseStride;
    const clampedStride = clamp(normalizedStride, CLOSE_FINISH_STRIDE_MIN, CLOSE_FINISH_STRIDE_MAX);
    stride = clampedStride * baseStride;
  }

  return clamp(stride, baseStride * STRIDE_MIN_MULT, baseStride * STRIDE_MAX_MULT);
}

// Draft Effect: horses behind leader get performance boost (scales with distance)
export function applyDraftEffect(
  perfScore: number,
  horsePosition: number,
  leaderPosition: number
): number {
  const distanceBehind = leaderPosition - horsePosition;

  // Must be behind but within max draft distance
  if (distanceBehind <= 0 || distanceBehind > DRAFT_DISTANCE_MAX) {
    return perfScore;
  }

  // Scale bonus: max bonus at optimal distance, min bonus at max distance
  // Linear interpolation between optimal and max distance
  let bonus: number;
  if (distanceBehind <= DRAFT_DISTANCE_OPTIMAL) {
    // At or closer than optimal - get max bonus
    bonus = DRAFT_PERF_BONUS_MAX;
  } else {
    // Scale down linearly from max to min as distance increases
    const t = (distanceBehind - DRAFT_DISTANCE_OPTIMAL) / (DRAFT_DISTANCE_MAX - DRAFT_DISTANCE_OPTIMAL);
    bonus = DRAFT_PERF_BONUS_MAX - t * (DRAFT_PERF_BONUS_MAX - DRAFT_PERF_BONUS_MIN);
  }

  return perfScore * bonus;
}

// Pack Formation: compress or expand position changes based on phase
export function packSpreadMultiplier(phase: RacePhase): number {
  switch (phase) {
    case "early":
      return PACK_SPREAD_EARLY;
    case "mid":
      return PACK_SPREAD_MID;
    case "stretch":
      return PACK_SPREAD_STRETCH;
  }
}

// Temperament Under Pressure: volatile horses swing more when positions are tight
export function temperamentNoiseWithPressure(
  temperament: Temperament,
  context: RacingContext
): number {
  const range = temperamentNoiseRange[temperament] ?? 0.06;
  const baseNoise = (Math.random() * 2 - 1) * range;

  // Check if under pressure (tight pack)
  if (temperament === "volatile" && context.positionSpread <= PRESSURE_POSITION_SPREAD) {
    return baseNoise * VOLATILE_PRESSURE_NOISE_MULT;
  }

  return baseNoise;
}

// Desperation Surge: horses behind in stretch can surge with extra fatigue cost
export type DesperationResult = {
  strideBonus: number;
  extraFatigue: number;
  triggered: boolean;
};

export function checkDesperationSurge(
  horse: HorseRuntime,
  context: RacingContext,
  phase: RacePhase
): DesperationResult {
  // Must be in stretch phase
  if (phase !== "stretch") {
    return { strideBonus: 1, extraFatigue: 0, triggered: false };
  }

  // Must be behind threshold position (now triggers at 3rd place or worse)
  if (context.currentRank <= DESPERATION_POSITION_THRESHOLD) {
    return { strideBonus: 1, extraFatigue: 0, triggered: false };
  }

  // Momentum threshold now allows negative momentum (easier to trigger)
  if (horse.momentum < DESPERATION_MOMENTUM_THRESHOLD) {
    return { strideBonus: 1, extraFatigue: 0, triggered: false };
  }

  // Probability check (now 55% chance to trigger)
  if (Math.random() > DESPERATION_PROBABILITY) {
    return { strideBonus: 1, extraFatigue: 0, triggered: false };
  }

  return {
    strideBonus: DESPERATION_STRIDE_BONUS,
    extraFatigue: DESPERATION_FATIGUE_COST,
    triggered: true
  };
}

// Close Finish: check if we're in final ticks
export function isCloseFinish(context: RacingContext): boolean {
  const ticksRemaining = context.totalTicks - context.currentTick;
  return ticksRemaining <= CLOSE_FINISH_TICKS;
}

// Finishing Kick: late-race burst based on archetype and remaining stamina
export type FinishingKickResult = {
  kickMultiplier: number;
  triggered: boolean;
};

export function checkFinishingKick(
  horse: HorseRuntime,
  context: RacingContext
): FinishingKickResult {
  // Must be in final 15% of race (position >= 85)
  if (horse.position < FINISHING_KICK_POSITION_THRESHOLD) {
    return { kickMultiplier: 1, triggered: false };
  }

  // Get archetype kick strength
  let kickStrength = archetypeKickStrength[horse.archetype] ?? 0.1;

  // Erratic archetype has random kick strength (0.05-0.25)
  if (horse.archetype === "erratic") {
    kickStrength = 0.05 + Math.random() * 0.2;
  }

  // Kick power is reduced by fatigue (tired horses can't kick as hard)
  const staminaFactor = 1 - horse.fatigue;

  // Random factor for variability (0.8-1.2)
  const randomFactor = 0.8 + Math.random() * 0.4;

  // Calculate final kick multiplier
  const kickMultiplier = 1 + (kickStrength * staminaFactor * randomFactor);

  return {
    kickMultiplier,
    triggered: true
  };
}

// Determination: certain archetypes fight harder when behind
export type DeterminationResult = {
  bonus: number;
  triggered: boolean;
};

export function checkDetermination(
  horse: HorseRuntime,
  context: RacingContext,
  phase: RacePhase
): DeterminationResult {
  // Only applies in mid and stretch phases
  if (phase === "early") {
    return { bonus: 1, triggered: false };
  }

  // Must be behind (3rd place or worse)
  if (context.currentRank < DETERMINATION_RANK_THRESHOLD) {
    return { bonus: 1, triggered: false };
  }

  // Check if archetype has determination
  const determinationBonus = archetypeDetermination[horse.archetype];
  if (!determinationBonus) {
    return { bonus: 1, triggered: false };
  }

  // Erratic has random application (50% chance)
  if (horse.archetype === "erratic" && Math.random() > 0.5) {
    return { bonus: 1, triggered: false };
  }

  return {
    bonus: 1 + determinationBonus,
    triggered: true
  };
}

// Surface Affinity: how well a horse performs on a given track surface
export function getSurfaceAffinityMultiplier(
  surfaceAffinity: SurfaceAffinity,
  trackSurface: TrackSurface
): number {
  return surfaceAffinityMultipliers[surfaceAffinity]?.[trackSurface] ?? 1.0;
}
