import { HandicapTier, ProbeType, RaceArchetype, SurfaceAffinity, Temperament, TrackSurface } from "@prisma/client";
import { Thresholds, RampConfig } from "../../types/prisma-json";

export type RacePhase = "early" | "mid" | "stretch";

export type HorseRuntime = {
  raceHorseId: string;
  horseId: string;
  displayName: string;
  handicapTier: HandicapTier;
  archetype: RaceArchetype;
  temperament: Temperament;
  surfaceAffinity: SurfaceAffinity;
  serviceTypeId: string;
  probeType: ProbeType;
  assignedProviderId: string | null;
  assignedProviderPubkey: string | null;
  position: number;
  previousPosition: number; // For passing detection
  previousRank: number; // For passing detection
  finishedTick: number | null;
  dnfTick: number | null;
  eliminationReason: string | null;
  consecutiveFailures: number;
  consecutiveLatencyElim: number;
  momentum: number;
  fatigue: number;
  staleSeconds: number;
  hasSuccessfulPoll: boolean;
  // Passing surge state
  passingSurgeTicksRemaining: number;
  passingSurgeCount: number;
  window: Array<{
    ok: boolean;
    latencyMs: number | null;
    errorType: string | null;
    headHeightDelta: number | null;
  }>;
  lastMetrics: {
    latencyMs: number;
    p95Ms: number;
    errorRate: number;
    perfScore: number;
    errorType?: string | null;
  };
  metrics: {
    latencySum: number;
    p95Sum: number;
    errorSum: number;
    perfSum: number;
    count: number;
  };
};

export type RaceRuntime = {
  raceId: string;
  tickMs: number;
  totalTicks: number;
  currentTick: number;
  voidFailureTicks: number;
  thresholds: Thresholds;
  ramp: RampConfig;
  paceMult: number;
  trackSurface: TrackSurface;
  weatherBase: { latencyMult: number; errorMult: number; jitterMult: number };
  spikeSeconds: Set<number>;
  horses: HorseRuntime[];
  interval: NodeJS.Timeout;
  // Event tracking state
  lastLeaderRaceHorseId: string | null;
  lastPhase: RacePhase | null;
  stretchAnnounced: boolean;
  finalTicksAnnounced: boolean;
};

export type WeatherState = {
  latencyMult: number;
  errorMult: number;
  jitterMult: number;
  isSpiking?: boolean;
};

// Racing context passed to movement calculations
export type RacingContext = {
  leaderPosition: number;
  positionSpread: number; // Difference between 1st and last active horse
  currentRank: number; // 1-based rank of this horse
  totalActive: number;
  currentTick: number;
  totalTicks: number;
  isSpiking: boolean;
};
