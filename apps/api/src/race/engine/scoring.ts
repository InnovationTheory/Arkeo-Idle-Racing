import type { RampConfig } from "../../types/prisma-json";
import {
  ERR_BAD,
  STALE_LIMIT,
  PERF_WEIGHTS,
  PERF_SCORE_MIN,
  PERF_SCORE_MAX
} from "./constants";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

export function loadFactor(ramp: RampConfig, tick: number, totalTicks: number): number {
  const t = clamp(tick / totalTicks, 0, 1);
  if (ramp.type === "pulse") {
    const pulse = Math.abs(Math.sin(t * Math.PI * 2));
    return ramp.start + (ramp.end - ramp.start) * pulse;
  }
  return ramp.start + (ramp.end - ramp.start) * t;
}

export type PerfScoreParams = {
  okLatencies: number[];
  windowSize: number;
  errorCount: number;
  staleSeconds: number;
  thresholds: { latGood: number; latBad: number; latElim: number };
  weather: { latencyMult: number; errorMult: number };
};

export type PerfScoreResult = {
  perfScore: number;
  p95Latency: number;
  errorRate: number;
  freshnessScore: number;
};

export function computePerfScore(params: PerfScoreParams): PerfScoreResult {
  const { okLatencies, windowSize, errorCount, staleSeconds, thresholds, weather } = params;

  const p95Latency = okLatencies.length > 0 ? p95(okLatencies) : thresholds.latElim;
  const latencyPenalty = clamp01((p95Latency - thresholds.latGood) / (thresholds.latBad - thresholds.latGood));
  let latencyScore = 1 - latencyPenalty;
  latencyScore = clamp01(latencyScore * weather.latencyMult);

  const errorRate = windowSize > 0 ? errorCount / windowSize : 0;
  let errorScore = 1 - clamp01(errorRate / ERR_BAD);
  errorScore = clamp01(errorScore * weather.errorMult);

  const freshnessScore = staleSeconds > STALE_LIMIT ? 0.25 : 1.0;

  const perfScore = clamp(
    PERF_WEIGHTS.latency * latencyScore +
    PERF_WEIGHTS.error * errorScore +
    PERF_WEIGHTS.freshness * freshnessScore,
    PERF_SCORE_MIN,
    PERF_SCORE_MAX
  );

  return {
    perfScore,
    p95Latency,
    errorRate,
    freshnessScore
  };
}
