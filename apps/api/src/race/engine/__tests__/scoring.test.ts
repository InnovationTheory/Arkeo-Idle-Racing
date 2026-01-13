import { describe, it, expect } from "vitest";
import { clamp, clamp01, p95, loadFactor, computePerfScore } from "../scoring";

describe("clamp", () => {
  it("returns value when within bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it("clamps to min when value is below", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(-100, 0, 1)).toBe(0);
  });

  it("clamps to max when value is above", () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(100, 0, 1)).toBe(1);
  });

  it("handles edge cases at boundaries", () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("handles negative ranges", () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
    expect(clamp(0, -10, -1)).toBe(-1);
    expect(clamp(-15, -10, -1)).toBe(-10);
  });
});

describe("clamp01", () => {
  it("returns value when within 0-1", () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(0.1)).toBe(0.1);
    expect(clamp01(0.99)).toBe(0.99);
  });

  it("clamps to 0 when negative", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(-100)).toBe(0);
  });

  it("clamps to 1 when above 1", () => {
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(100)).toBe(1);
  });

  it("handles boundaries", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
  });
});

describe("p95", () => {
  it("returns 0 for empty array", () => {
    expect(p95([])).toBe(0);
  });

  it("returns the only value for single-element array", () => {
    expect(p95([100])).toBe(100);
  });

  it("calculates 95th percentile for sorted array", () => {
    // For 10 elements, 95th percentile is at index ceil(10 * 0.95) - 1 = 9
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(p95(values)).toBe(10);
  });

  it("calculates 95th percentile for unsorted array", () => {
    const values = [5, 3, 9, 1, 7, 2, 8, 4, 10, 6];
    expect(p95(values)).toBe(10);
  });

  it("handles 20 elements correctly", () => {
    // For 20 elements, 95th percentile is at index ceil(20 * 0.95) - 1 = 18
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    expect(p95(values)).toBe(190);
  });

  it("does not mutate the original array", () => {
    const values = [5, 3, 9, 1, 7];
    const copy = [...values];
    p95(values);
    expect(values).toEqual(copy);
  });
});

describe("loadFactor", () => {
  describe("linear ramp", () => {
    it("returns start value at tick 0", () => {
      const ramp = { type: "linear" as const, start: 0.5, end: 1.0 };
      expect(loadFactor(ramp, 0, 100)).toBe(0.5);
    });

    it("returns end value at final tick", () => {
      const ramp = { type: "linear" as const, start: 0.5, end: 1.0 };
      expect(loadFactor(ramp, 100, 100)).toBe(1.0);
    });

    it("interpolates linearly at midpoint", () => {
      const ramp = { type: "linear" as const, start: 0.0, end: 1.0 };
      expect(loadFactor(ramp, 50, 100)).toBe(0.5);
    });

    it("handles decreasing ramp", () => {
      const ramp = { type: "linear" as const, start: 1.0, end: 0.0 };
      expect(loadFactor(ramp, 50, 100)).toBe(0.5);
      expect(loadFactor(ramp, 100, 100)).toBe(0.0);
    });
  });

  describe("pulse ramp", () => {
    it("returns start value at tick 0", () => {
      const ramp = { type: "pulse" as const, start: 0.5, end: 1.0 };
      // sin(0) = 0, so pulse = 0, result = start
      expect(loadFactor(ramp, 0, 100)).toBe(0.5);
    });

    it("oscillates between start and end", () => {
      const ramp = { type: "pulse" as const, start: 0.0, end: 1.0 };
      // At t=0.25, sin(0.25 * 2 * PI) = sin(PI/2) = 1, abs = 1
      const result = loadFactor(ramp, 25, 100);
      expect(result).toBeCloseTo(1.0, 5);
    });

    it("returns to start at midpoint", () => {
      const ramp = { type: "pulse" as const, start: 0.5, end: 1.0 };
      // At t=0.5, sin(0.5 * 2 * PI) = sin(PI) = 0, abs = 0
      expect(loadFactor(ramp, 50, 100)).toBeCloseTo(0.5, 5);
    });
  });

  describe("edge cases", () => {
    it("clamps negative tick to 0", () => {
      const ramp = { type: "linear" as const, start: 0.0, end: 1.0 };
      expect(loadFactor(ramp, -10, 100)).toBe(0.0);
    });

    it("clamps tick beyond total to 1", () => {
      const ramp = { type: "linear" as const, start: 0.0, end: 1.0 };
      expect(loadFactor(ramp, 150, 100)).toBe(1.0);
    });
  });
});

describe("computePerfScore", () => {
  const defaultThresholds = { latGood: 100, latBad: 500, latElim: 1000 };
  const defaultWeather = { latencyMult: 1.0, errorMult: 1.0 };

  it("returns high score for perfect latencies and no errors", () => {
    const result = computePerfScore({
      okLatencies: [50, 60, 70, 80, 90],
      windowSize: 5,
      errorCount: 0,
      staleSeconds: 0,
      thresholds: defaultThresholds,
      weather: defaultWeather,
    });

    expect(result.perfScore).toBeGreaterThan(0.9);
    expect(result.errorRate).toBe(0);
    expect(result.freshnessScore).toBe(1.0);
  });

  it("penalizes high latencies", () => {
    const goodResult = computePerfScore({
      okLatencies: [50],
      windowSize: 1,
      errorCount: 0,
      staleSeconds: 0,
      thresholds: defaultThresholds,
      weather: defaultWeather,
    });

    const badResult = computePerfScore({
      okLatencies: [400],
      windowSize: 1,
      errorCount: 0,
      staleSeconds: 0,
      thresholds: defaultThresholds,
      weather: defaultWeather,
    });

    expect(goodResult.perfScore).toBeGreaterThan(badResult.perfScore);
  });

  it("penalizes high error rate", () => {
    const noErrors = computePerfScore({
      okLatencies: [100],
      windowSize: 10,
      errorCount: 0,
      staleSeconds: 0,
      thresholds: defaultThresholds,
      weather: defaultWeather,
    });

    const highErrors = computePerfScore({
      okLatencies: [100],
      windowSize: 10,
      errorCount: 5,
      staleSeconds: 0,
      thresholds: defaultThresholds,
      weather: defaultWeather,
    });

    expect(noErrors.perfScore).toBeGreaterThan(highErrors.perfScore);
    expect(highErrors.errorRate).toBe(0.5);
  });

  it("reduces freshness score when stale", () => {
    const fresh = computePerfScore({
      okLatencies: [100],
      windowSize: 1,
      errorCount: 0,
      staleSeconds: 0,
      thresholds: defaultThresholds,
      weather: defaultWeather,
    });

    const stale = computePerfScore({
      okLatencies: [100],
      windowSize: 1,
      errorCount: 0,
      staleSeconds: 60, // > STALE_LIMIT (30)
      thresholds: defaultThresholds,
      weather: defaultWeather,
    });

    expect(fresh.freshnessScore).toBe(1.0);
    expect(stale.freshnessScore).toBe(0.25);
    expect(fresh.perfScore).toBeGreaterThan(stale.perfScore);
  });

  it("applies weather multipliers", () => {
    const normalWeather = computePerfScore({
      okLatencies: [200],
      windowSize: 5,
      errorCount: 1,
      staleSeconds: 0,
      thresholds: defaultThresholds,
      weather: { latencyMult: 1.0, errorMult: 1.0 },
    });

    const harshWeather = computePerfScore({
      okLatencies: [200],
      windowSize: 5,
      errorCount: 1,
      staleSeconds: 0,
      thresholds: defaultThresholds,
      weather: { latencyMult: 0.5, errorMult: 0.5 },
    });

    expect(normalWeather.perfScore).toBeGreaterThan(harshWeather.perfScore);
  });

  it("uses latElim when no latencies available", () => {
    const result = computePerfScore({
      okLatencies: [],
      windowSize: 5,
      errorCount: 5,
      staleSeconds: 0,
      thresholds: defaultThresholds,
      weather: defaultWeather,
    });

    expect(result.p95Latency).toBe(1000); // latElim
  });

  it("clamps perfScore to bounds", () => {
    // Best case - should not exceed max
    const best = computePerfScore({
      okLatencies: [10, 10, 10],
      windowSize: 3,
      errorCount: 0,
      staleSeconds: 0,
      thresholds: defaultThresholds,
      weather: { latencyMult: 2.0, errorMult: 2.0 },
    });

    // Worst case - should not go below min
    const worst = computePerfScore({
      okLatencies: [2000],
      windowSize: 10,
      errorCount: 10,
      staleSeconds: 100,
      thresholds: defaultThresholds,
      weather: { latencyMult: 0.1, errorMult: 0.1 },
    });

    expect(best.perfScore).toBeLessThanOrEqual(1.1); // PERF_SCORE_MAX
    expect(worst.perfScore).toBeGreaterThanOrEqual(0.05); // PERF_SCORE_MIN
  });

  it("returns correct p95Latency", () => {
    const result = computePerfScore({
      okLatencies: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
      windowSize: 10,
      errorCount: 0,
      staleSeconds: 0,
      thresholds: defaultThresholds,
      weather: defaultWeather,
    });

    expect(result.p95Latency).toBe(1000);
  });
});
