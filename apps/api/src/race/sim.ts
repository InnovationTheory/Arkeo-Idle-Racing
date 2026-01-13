import { HandicapTier } from "@prisma/client";
import { handicapPerformanceMods } from "./handicap";

export type WeatherModifiers = {
  latencyMult: number;
  errorMult: number;
  jitterMult: number;
  spikes?: number[];
};

type ServiceProfile = {
  baseLatencyMs: number;
  baseErrorRate: number;
  baseSpeed: number;
};

const defaultProfile: ServiceProfile = {
  baseLatencyMs: 220,
  baseErrorRate: 0.02,
  baseSpeed: 0.012
};

const serviceProfiles: Record<string, ServiceProfile> = {
  "ethereum-mainnet": { baseLatencyMs: 260, baseErrorRate: 0.025, baseSpeed: 0.011 },
  "osmosis-1": { baseLatencyMs: 190, baseErrorRate: 0.02, baseSpeed: 0.013 },
  "arkeo-mainnet": { baseLatencyMs: 170, baseErrorRate: 0.018, baseSpeed: 0.014 },
  "bitcoin-mainnet": { baseLatencyMs: 300, baseErrorRate: 0.03, baseSpeed: 0.01 }
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function jitter(range: number): number {
  return (Math.random() - 0.5) * 2 * range;
}

export type SimMetrics = {
  latencyMs: number;
  p95Ms: number;
  errorRate: number;
  speedFactor: number;
  headHeightDelta: number;
};

export function simulateMetrics(params: {
  serviceTypeId: string;
  handicapTier: HandicapTier;
  weather: WeatherModifiers;
  loadFactor: number;
}): SimMetrics {
  const profile = serviceProfiles[params.serviceTypeId] ?? defaultProfile;
  const mods = handicapPerformanceMods(params.handicapTier);
  const weatherMult = params.weather.latencyMult * mods.weatherSensitivityMult;
  const errorMult = params.weather.errorMult * mods.weatherSensitivityMult;
  const loadMult = 1 + params.loadFactor * 0.4 * mods.rampMult;

  const baseLatency = profile.baseLatencyMs * weatherMult * loadMult;
  const latencyMs = clamp(baseLatency + jitter(25 * params.weather.jitterMult), 80, 2000);
  const p95Ms = clamp(latencyMs * (1.2 + Math.random() * 0.4), latencyMs, 2500);

  const rawError = profile.baseErrorRate * errorMult * (1 + params.loadFactor * 0.6);
  const errorRate = clamp(rawError + Math.random() * 0.03, 0, 0.6);

  const speedFactor = clamp(profile.baseSpeed * (1 / (latencyMs / 200)) * (1 - errorRate), 0.002, 0.03);
  const headHeightDelta = Math.random() < 0.08 + errorRate * 0.2 ? 0 : 1;

  return { latencyMs, p95Ms, errorRate, speedFactor, headHeightDelta };
}
