import { describe, it, expect } from "vitest";
import { weatherForTick } from "../weather";
import type { RaceRuntime, WeatherState } from "../types";
import { spikeMultipliers } from "../constants";

function createRuntime(overrides: Partial<RaceRuntime> = {}): RaceRuntime {
  return {
    raceId: "test-race",
    tickMs: 1000,
    totalTicks: 100,
    currentTick: 0,
    voidFailureTicks: 0,
    thresholds: { latGood: 100, latBad: 500, latElim: 1000 },
    ramp: { type: "linear", start: 0.5, end: 1.0 },
    paceMult: 1.0,
    weatherBase: { latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0 },
    spikeSeconds: new Set<number>(),
    horses: [],
    interval: null as unknown as NodeJS.Timeout,
    ...overrides,
  };
}

describe("weatherForTick", () => {
  describe("no spikes", () => {
    it("returns base weather when spikeSeconds is empty", () => {
      const runtime = createRuntime({
        spikeSeconds: new Set(),
        weatherBase: { latencyMult: 0.8, errorMult: 0.9, jitterMult: 1.1 },
      });

      const result = weatherForTick(runtime);

      expect(result).toEqual({ latencyMult: 0.8, errorMult: 0.9, jitterMult: 1.1, isSpiking: false });
    });
  });

  describe("spike timing", () => {
    it("returns base weather when not at spike second", () => {
      const runtime = createRuntime({
        tickMs: 1000,
        currentTick: 5, // elapsed = 5 seconds
        spikeSeconds: new Set([10, 20, 30]),
        weatherBase: { latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0 },
      });

      const result = weatherForTick(runtime);

      expect(result).toEqual({ latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0, isSpiking: false });
    });

    it("returns spiked weather when at spike second", () => {
      const runtime = createRuntime({
        tickMs: 1000,
        currentTick: 10, // elapsed = 10 seconds
        spikeSeconds: new Set([10, 20, 30]),
        weatherBase: { latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0 },
      });

      const result = weatherForTick(runtime);

      expect(result).toEqual({
        latencyMult: 1.0 * spikeMultipliers.latency,
        errorMult: 1.0 * spikeMultipliers.error,
        jitterMult: 1.0 * spikeMultipliers.jitter,
        isSpiking: true,
      });
    });

    it("applies spike multipliers correctly", () => {
      const runtime = createRuntime({
        tickMs: 1000,
        currentTick: 20,
        spikeSeconds: new Set([20]),
        weatherBase: { latencyMult: 0.8, errorMult: 0.7, jitterMult: 0.9 },
      });

      const result = weatherForTick(runtime);

      expect(result.latencyMult).toBeCloseTo(0.8 * spikeMultipliers.latency, 5);
      expect(result.errorMult).toBeCloseTo(0.7 * spikeMultipliers.error, 5);
      expect(result.jitterMult).toBeCloseTo(0.9 * spikeMultipliers.jitter, 5);
      expect(result.isSpiking).toBe(true);
    });
  });

  describe("elapsed time calculation", () => {
    it("calculates elapsed seconds from ticks and tickMs", () => {
      // 500ms ticks, 10 ticks = 5 seconds
      const runtime = createRuntime({
        tickMs: 500,
        currentTick: 10,
        spikeSeconds: new Set([5]),
        weatherBase: { latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0 },
      });

      const result = weatherForTick(runtime);

      expect(result.latencyMult).toBe(1.0 * spikeMultipliers.latency);
    });

    it("floors elapsed seconds calculation", () => {
      // 300ms ticks, 5 ticks = 1.5 seconds -> floors to 1 second
      const runtime = createRuntime({
        tickMs: 300,
        currentTick: 5,
        spikeSeconds: new Set([1]),
        weatherBase: { latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0 },
      });

      const result = weatherForTick(runtime);

      expect(result.latencyMult).toBe(1.0 * spikeMultipliers.latency);
    });

    it("does not trigger spike when just under threshold", () => {
      // 300ms ticks, 3 ticks = 0.9 seconds -> floors to 0 seconds
      const runtime = createRuntime({
        tickMs: 300,
        currentTick: 3,
        spikeSeconds: new Set([1]),
        weatherBase: { latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0 },
      });

      const result = weatherForTick(runtime);

      expect(result.latencyMult).toBe(1.0);
    });
  });

  describe("multiple spikes", () => {
    it("triggers at each spike second", () => {
      const runtime = createRuntime({
        tickMs: 1000,
        spikeSeconds: new Set([5, 15, 25]),
        weatherBase: { latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0 },
      });

      // Before first spike
      runtime.currentTick = 4;
      expect(weatherForTick(runtime).latencyMult).toBe(1.0);

      // At first spike
      runtime.currentTick = 5;
      expect(weatherForTick(runtime).latencyMult).toBe(1.0 * spikeMultipliers.latency);

      // Between spikes
      runtime.currentTick = 10;
      expect(weatherForTick(runtime).latencyMult).toBe(1.0);

      // At second spike
      runtime.currentTick = 15;
      expect(weatherForTick(runtime).latencyMult).toBe(1.0 * spikeMultipliers.latency);

      // At third spike
      runtime.currentTick = 25;
      expect(weatherForTick(runtime).latencyMult).toBe(1.0 * spikeMultipliers.latency);
    });
  });

  describe("edge cases", () => {
    it("handles tick 0", () => {
      const runtime = createRuntime({
        tickMs: 1000,
        currentTick: 0,
        spikeSeconds: new Set([0]),
        weatherBase: { latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0 },
      });

      const result = weatherForTick(runtime);

      expect(result.latencyMult).toBe(1.0 * spikeMultipliers.latency);
    });

    it("handles single spike second", () => {
      const runtime = createRuntime({
        tickMs: 1000,
        currentTick: 50,
        spikeSeconds: new Set([50]),
        weatherBase: { latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0 },
      });

      const result = weatherForTick(runtime);

      expect(result.latencyMult).toBe(1.0 * spikeMultipliers.latency);
    });
  });
});
