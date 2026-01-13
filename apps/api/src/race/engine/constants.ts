import { ProbeType, RaceArchetype, SurfaceAffinity, Temperament, TrackSurface } from "@prisma/client";
import type { RacePhase } from "./types";

// Window and elimination thresholds
export const WINDOW_SIZE = 10;
export const ERR_BAD = 0.2;
export const ERR_ELIM = 0.7;
export const STALE_LIMIT = 30;
export const STALE_ELIM = 90;

// Elimination thresholds
export const CONSECUTIVE_FAILURES_ELIM = 5;
export const CONSECUTIVE_LATENCY_ELIM = 3;

// Placement rewards in Arkeo tokens
export const placementRewardsArkeo = [40, 25, 15, 10, 10];

// Archetype phase multipliers - how archetypes perform at different race phases
export const archetypePhaseMultipliers: Record<RaceArchetype, Record<RacePhase, number>> = {
  front_runner: { early: 1.4, mid: 1.0, stretch: 0.5 },
  stalker: { early: 1.0, mid: 1.05, stretch: 1.0 },  // Slight nerf to mid (was 1.1)
  stretch_runner: { early: 0.75, mid: 0.95, stretch: 1.6 },  // Less punishing early (was 0.6, 0.9)
  grinder: { early: 0.9, mid: 1.0, stretch: 1.2 },
  burst: { early: 0.8, mid: 1.4, stretch: 0.7 },
  erratic: { early: 1.0, mid: 1.0, stretch: 1.0 }
};

// Temperament noise ranges - how much random variation each temperament adds
export const temperamentNoiseRange: Record<Temperament, number> = {
  calm: 0.03,
  normal: 0.06,
  volatile: 0.12
};

// Latency thresholds by probe type
export const thresholdsByProbeType: Record<ProbeType, { latGood: number; latBad: number; latElim: number }> = {
  ethereum_jsonrpc: { latGood: 150, latBad: 1200, latElim: 2500 },
  cosmos_rpc: { latGood: 100, latBad: 900, latElim: 2000 },
  cosmos_rest: { latGood: 100, latBad: 900, latElim: 2000 }
};

// Weather spike multipliers
export const spikeMultipliers = {
  latency: 1.75,
  error: 1.75,
  jitter: 1.4
};

// Racing dynamics - Leader Fatigue
export const LEADER_FATIGUE_MULT = 1.2; // Leaders tire 20% faster

// Racing dynamics - Draft Effect (scaled by distance)
export const DRAFT_DISTANCE_MAX = 15; // Can draft up to 15 units behind leader
export const DRAFT_DISTANCE_OPTIMAL = 5; // Optimal drafting distance
export const DRAFT_PERF_BONUS_MAX = 1.08; // 8% at optimal distance
export const DRAFT_PERF_BONUS_MIN = 1.03; // 3% at max distance

// Racing dynamics - Pack Formation
export const PACK_SPREAD_EARLY = 0.75; // Compress positions early
export const PACK_SPREAD_MID = 1.0; // Normal spread mid-race
export const PACK_SPREAD_STRETCH = 0.85; // Compress in stretch for exciting finishes (was 1.25)

// Racing dynamics - Temperament Under Pressure
export const PRESSURE_POSITION_SPREAD = 12; // If horses within this range, pressure is on
export const VOLATILE_PRESSURE_NOISE_MULT = 2.5; // Volatile horses swing more under pressure

// Racing dynamics - Desperation Surge (Stretch Run Drama) - ENHANCED
export const DESPERATION_POSITION_THRESHOLD = 2; // Must be behind 2nd place (triggers at 3rd+)
export const DESPERATION_MOMENTUM_THRESHOLD = -0.05; // Allow negative momentum (easier to trigger)
export const DESPERATION_STRIDE_BONUS = 1.35; // 35% stride boost (was 25%)
export const DESPERATION_FATIGUE_COST = 0.08; // Costs extra fatigue
export const DESPERATION_PROBABILITY = 0.55; // 55% chance to trigger (was 40%)

// Racing dynamics - Close Finishes
export const CLOSE_FINISH_TICKS = 5; // Last 5 ticks
export const CLOSE_FINISH_STRIDE_MIN = 0.85; // Tighter stride range
export const CLOSE_FINISH_STRIDE_MAX = 1.15;

// Race event thresholds
export const PHOTO_FINISH_THRESHOLD = 3; // Units between top horses to trigger photo finish
export const FINAL_STRETCH_TICKS = 10; // Ticks before end to announce final stretch

// Momentum and fatigue bounds
export const MOMENTUM_MIN = -0.1;
export const MOMENTUM_MAX = 0.2;
export const FATIGUE_MIN = 0;
export const FATIGUE_MAX = 0.25;

// Performance score weights
export const PERF_WEIGHTS = {
  latency: 0.5,
  error: 0.3,
  freshness: 0.2
};

// Performance score bounds
export const PERF_SCORE_MIN = 0.05;
export const PERF_SCORE_MAX = 1.1;

// Stride bounds (as multiplier of base stride)
export const STRIDE_MIN_MULT = 0.05;
export const STRIDE_MAX_MULT = 2;

// Archetype-specific modifiers
export const archetypeModifiers = {
  front_runner: { fatigueMult: 1.15 },
  grinder: { fatigueMult: 0.85 },
  stretch_runner: { stretchMomentumMult: 1.15 },
  burst: { midMomentumMult: 1.25, perfThreshold: 0.8 }
};

// Racing dynamics - Finishing Kick (late-race burst)
export const FINISHING_KICK_POSITION_THRESHOLD = 85; // Triggers at 85% of race (final 15%)
export const archetypeKickStrength: Record<RaceArchetype, number> = {
  stretch_runner: 0.25, // Born to close
  grinder: 0.18, // Relentless finisher
  stalker: 0.12, // Steady kick
  burst: 0.08, // Already spent mid-race
  erratic: 0.15, // Base value, actual is random 0.05-0.25
  front_runner: 0.05 // Exhausted, weak kick
};

// Racing dynamics - Position Momentum Boost (rubber-banding)
export const positionMomentumMultiplier: Record<number, number> = {
  1: 1.0, // Leader - normal
  2: 1.0, // 2nd - normal
  3: 1.15, // 15% faster momentum gain
  4: 1.15,
  5: 1.30, // 30% faster
  6: 1.30,
  7: 1.50, // 50% faster (and beyond)
  8: 1.50,
  9: 1.50,
  10: 1.50
};

// Racing dynamics - Passing Surge (momentum boost when overtaking)
export const PASSING_SURGE_BONUS = 1.08; // 8% speed boost
export const PASSING_SURGE_DURATION = 3; // Lasts 3 ticks
export const PASSING_SURGE_MAX_COUNT = 2; // Max 2 surges per horse per race

// Racing dynamics - Determination (archetypes that fight harder when behind)
export const archetypeDetermination: Partial<Record<RaceArchetype, number>> = {
  stretch_runner: 0.08, // 8% boost when rank >= 3
  grinder: 0.06, // 6% boost
  erratic: 0.04 // 4% boost (random application)
};
export const DETERMINATION_RANK_THRESHOLD = 3; // Must be 3rd place or worse

// Surface affinity multipliers - how each affinity performs on each track surface
// Values above 1.0 = bonus, below 1.0 = penalty
export const surfaceAffinityMultipliers: Record<SurfaceAffinity, Record<TrackSurface, number>> = {
  dirt_specialist: {
    dirt: 1.12,      // 12% bonus on preferred surface
    turf: 0.92,      // 8% penalty on non-preferred
    synthetic: 0.98  // Minor penalty on synthetic
  },
  turf_specialist: {
    dirt: 0.90,      // 10% penalty on dirt
    turf: 1.15,      // 15% bonus on preferred surface
    synthetic: 0.95  // 5% penalty on synthetic
  },
  mud_lover: {
    dirt: 1.08,      // Good on dirt (muddy conditions)
    turf: 1.05,      // Decent on wet turf
    synthetic: 0.95  // Worse on synthetic (no mud)
  },
  all_surface: {
    dirt: 1.0,       // No bonus or penalty
    turf: 1.0,
    synthetic: 1.02  // Slight bonus on synthetic (adaptable)
  }
};

// Surface affinity display labels
export const surfaceAffinityLabels: Record<SurfaceAffinity, string> = {
  dirt_specialist: "Dirt Specialist",
  turf_specialist: "Turf Specialist",
  mud_lover: "Mud Lover",
  all_surface: "All-Surface"
};

// Track surface display labels
export const trackSurfaceLabels: Record<TrackSurface, string> = {
  dirt: "Dirt",
  turf: "Turf",
  synthetic: "Synthetic"
};
