import { describe, it, expect } from "vitest";
import { getEliminationReason, checkRaceEnd } from "../tick";
import type { RaceRuntime, HorseRuntime } from "../types";
import {
  CONSECUTIVE_FAILURES_ELIM,
  CONSECUTIVE_LATENCY_ELIM,
  ERR_ELIM,
  STALE_ELIM,
} from "../constants";

function createHorse(id: string, overrides: Partial<HorseRuntime> = {}): HorseRuntime {
  return {
    raceHorseId: id,
    horseId: `horse-${id}`,
    displayName: `Horse ${id}`,
    handicapTier: "Light",
    archetype: "stalker",
    temperament: "normal",
    serviceTypeId: "service-1",
    probeType: "cosmos_rpc",
    assignedProviderId: null,
    position: 0,
    previousPosition: 0,
    previousRank: 0,
    finishedTick: null,
    dnfTick: null,
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
    lastMetrics: { latencyMs: 100, p95Ms: 100, errorRate: 0, perfScore: 1 },
    metrics: { latencySum: 0, p95Sum: 0, errorSum: 0, perfSum: 0, count: 0 },
    ...overrides,
  } as HorseRuntime;
}

function createRuntime(horses: HorseRuntime[], overrides: Partial<RaceRuntime> = {}): RaceRuntime {
  return {
    raceId: "test-race",
    tickMs: 1000,
    totalTicks: 100,
    currentTick: 50,
    voidFailureTicks: 0,
    thresholds: { latGood: 100, latBad: 500, latElim: 1000 },
    ramp: { type: "linear", start: 0.5, end: 1.0 },
    paceMult: 1.0,
    weatherBase: { latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0 },
    spikeSeconds: new Set(),
    horses,
    interval: null as unknown as NodeJS.Timeout,
    ...overrides,
  };
}

describe("getEliminationReason", () => {
  const latElim = 1000;

  it("returns 'failures' when consecutiveFailures reaches threshold", () => {
    const horse = createHorse("test", {
      consecutiveFailures: CONSECUTIVE_FAILURES_ELIM,
      consecutiveLatencyElim: 0,
      staleSeconds: 0,
    });

    expect(getEliminationReason(horse, 0, latElim)).toBe("failures");
  });

  it("returns 'error_rate' when errorRate exceeds threshold", () => {
    const horse = createHorse("test", {
      consecutiveFailures: 0,
      consecutiveLatencyElim: 0,
      staleSeconds: 0,
    });

    // ERR_ELIM is 0.7, so 0.75 should trigger
    expect(getEliminationReason(horse, 0.75, latElim)).toBe("error_rate");
  });

  it("returns 'latency' when consecutiveLatencyElim reaches threshold", () => {
    const horse = createHorse("test", {
      consecutiveFailures: 0,
      consecutiveLatencyElim: CONSECUTIVE_LATENCY_ELIM,
      staleSeconds: 0,
    });

    expect(getEliminationReason(horse, 0, latElim)).toBe("latency");
  });

  it("returns 'stale_height' as fallback", () => {
    const horse = createHorse("test", {
      consecutiveFailures: 0,
      consecutiveLatencyElim: 0,
      staleSeconds: STALE_ELIM, // Stale but not hitting other thresholds
    });

    expect(getEliminationReason(horse, 0, latElim)).toBe("stale_height");
  });

  it("prioritizes failures over error_rate", () => {
    const horse = createHorse("test", {
      consecutiveFailures: CONSECUTIVE_FAILURES_ELIM,
      consecutiveLatencyElim: 0,
    });

    // Both conditions true, but failures is checked first
    expect(getEliminationReason(horse, ERR_ELIM, latElim)).toBe("failures");
  });

  it("prioritizes error_rate over latency", () => {
    const horse = createHorse("test", {
      consecutiveFailures: 0,
      consecutiveLatencyElim: CONSECUTIVE_LATENCY_ELIM,
    });

    expect(getEliminationReason(horse, ERR_ELIM, latElim)).toBe("error_rate");
  });
});

describe("checkRaceEnd", () => {
  describe("all horses done", () => {
    it("returns true when all horses have finished", () => {
      const horses = [
        createHorse("1", { finishedTick: 50 }),
        createHorse("2", { finishedTick: 55 }),
        createHorse("3", { finishedTick: 60 }),
      ];

      const runtime = createRuntime(horses, { currentTick: 70, totalTicks: 100 });

      expect(checkRaceEnd(runtime)).toBe(true);
    });

    it("returns false when all horses have DNF but time remains (wait for time to expire)", () => {
      const horses = [
        createHorse("1", { dnfTick: 30 }),
        createHorse("2", { dnfTick: 40 }),
        createHorse("3", { dnfTick: 50 }),
      ];

      const runtime = createRuntime(horses, { currentTick: 60, totalTicks: 100 });

      // Changed behavior: don't end race early just because all DNF'd
      // Wait for time to expire so horses can be ranked by position
      expect(checkRaceEnd(runtime)).toBe(false);
    });

    it("returns true when all horses have DNF and time has expired", () => {
      const horses = [
        createHorse("1", { dnfTick: 30 }),
        createHorse("2", { dnfTick: 40 }),
        createHorse("3", { dnfTick: 50 }),
      ];

      const runtime = createRuntime(horses, { currentTick: 100, totalTicks: 100 });

      expect(checkRaceEnd(runtime)).toBe(true);
    });

    it("returns true when all horses either finished or DNF", () => {
      const horses = [
        createHorse("1", { finishedTick: 50 }),
        createHorse("2", { dnfTick: 40 }),
        createHorse("3", { finishedTick: 60 }),
        createHorse("4", { dnfTick: 45 }),
      ];

      const runtime = createRuntime(horses, { currentTick: 70, totalTicks: 100 });

      expect(checkRaceEnd(runtime)).toBe(true);
    });
  });

  describe("time limit reached with minimum finishers", () => {
    it("returns true when totalTicks reached and 5+ horses finished", () => {
      const horses = [
        createHorse("1", { finishedTick: 50 }),
        createHorse("2", { finishedTick: 55 }),
        createHorse("3", { finishedTick: 60 }),
        createHorse("4", { finishedTick: 65 }),
        createHorse("5", { finishedTick: 70 }),
        createHorse("6", { position: 80 }), // Still active
        createHorse("7", { position: 75 }), // Still active
      ];

      const runtime = createRuntime(horses, { currentTick: 100, totalTicks: 100 });

      expect(checkRaceEnd(runtime)).toBe(true);
    });

    it("returns false when totalTicks reached but fewer than 5 finished", () => {
      const horses = [
        createHorse("1", { finishedTick: 50 }),
        createHorse("2", { finishedTick: 55 }),
        createHorse("3", { finishedTick: 60 }),
        createHorse("4", { finishedTick: 65 }),
        createHorse("5", { position: 80 }), // Still active
        createHorse("6", { position: 75 }), // Still active
      ];

      const runtime = createRuntime(horses, { currentTick: 100, totalTicks: 100 });

      expect(checkRaceEnd(runtime)).toBe(false);
    });
  });

  describe("race continues", () => {
    it("returns false when horses still active and time remaining", () => {
      const horses = [
        createHorse("1", { finishedTick: 50 }),
        createHorse("2", { finishedTick: 55 }),
        createHorse("3", { position: 80 }),
        createHorse("4", { position: 70 }),
      ];

      const runtime = createRuntime(horses, { currentTick: 60, totalTicks: 100 });

      expect(checkRaceEnd(runtime)).toBe(false);
    });

    it("returns false when only some horses done before time limit", () => {
      const horses = [
        createHorse("1", { finishedTick: 50 }),
        createHorse("2", { dnfTick: 40 }),
        createHorse("3", { position: 60 }),
      ];

      const runtime = createRuntime(horses, { currentTick: 55, totalTicks: 100 });

      expect(checkRaceEnd(runtime)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty horse list - waits for time to expire", () => {
      const runtime = createRuntime([], { currentTick: 50, totalTicks: 100 });

      // No horses means allDone=true but finishedCount=0, so wait for time
      expect(checkRaceEnd(runtime)).toBe(false);
    });

    it("handles empty horse list - ends when time expires", () => {
      const runtime = createRuntime([], { currentTick: 100, totalTicks: 100 });

      expect(checkRaceEnd(runtime)).toBe(true);
    });

    it("handles single horse finished", () => {
      const horses = [createHorse("1", { finishedTick: 50 })];
      const runtime = createRuntime(horses, { currentTick: 60, totalTicks: 100 });

      expect(checkRaceEnd(runtime)).toBe(true);
    });

    it("handles exactly 5 finishers at time limit", () => {
      const horses = [
        createHorse("1", { finishedTick: 50 }),
        createHorse("2", { finishedTick: 55 }),
        createHorse("3", { finishedTick: 60 }),
        createHorse("4", { finishedTick: 65 }),
        createHorse("5", { finishedTick: 70 }),
        createHorse("6", { position: 90 }),
      ];

      const runtime = createRuntime(horses, { currentTick: 100, totalTicks: 100 });

      expect(checkRaceEnd(runtime)).toBe(true);
    });

    it("returns false just before time limit with 5 finishers", () => {
      const horses = [
        createHorse("1", { finishedTick: 50 }),
        createHorse("2", { finishedTick: 55 }),
        createHorse("3", { finishedTick: 60 }),
        createHorse("4", { finishedTick: 65 }),
        createHorse("5", { finishedTick: 70 }),
        createHorse("6", { position: 90 }),
      ];

      const runtime = createRuntime(horses, { currentTick: 99, totalTicks: 100 });

      expect(checkRaceEnd(runtime)).toBe(false);
    });
  });
});
