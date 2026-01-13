import { describe, it, expect } from "vitest";
import { computePlacements } from "../finish";
import type { RaceRuntime, HorseRuntime } from "../types";

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

function createRuntime(horses: HorseRuntime[]): RaceRuntime {
  return {
    raceId: "test-race",
    tickMs: 1000,
    totalTicks: 100,
    currentTick: 100,
    voidFailureTicks: 0,
    thresholds: { latGood: 100, latBad: 500, latElim: 1000 },
    ramp: { type: "linear", start: 0.5, end: 1.0 },
    paceMult: 1.0,
    weatherBase: { latencyMult: 1.0, errorMult: 1.0, jitterMult: 1.0 },
    spikeSeconds: new Set(),
    horses,
    interval: null as unknown as NodeJS.Timeout,
  };
}

describe("computePlacements", () => {
  describe("category ordering", () => {
    it("places finished horses before active horses", () => {
      const horses = [
        createHorse("active", { position: 80, finishedTick: null, dnfTick: null }),
        createHorse("finished", { position: 100, finishedTick: 50, dnfTick: null }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("finished")).toBe(1);
      expect(placements.get("active")).toBe(2);
    });

    it("places finished horses before DNF horses", () => {
      const horses = [
        createHorse("dnf", { position: 90, finishedTick: null, dnfTick: 30 }),
        createHorse("finished", { position: 100, finishedTick: 50, dnfTick: null }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("finished")).toBe(1);
      expect(placements.get("dnf")).toBe(2);
    });

    it("places active horses before DNF horses", () => {
      const horses = [
        createHorse("dnf", { position: 70, finishedTick: null, dnfTick: 30 }),
        createHorse("active", { position: 50, finishedTick: null, dnfTick: null }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("active")).toBe(1);
      expect(placements.get("dnf")).toBe(2);
    });

    it("orders all three categories correctly", () => {
      const horses = [
        createHorse("dnf", { position: 70, finishedTick: null, dnfTick: 30 }),
        createHorse("active", { position: 50, finishedTick: null, dnfTick: null }),
        createHorse("finished", { position: 100, finishedTick: 80, dnfTick: null }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("finished")).toBe(1);
      expect(placements.get("active")).toBe(2);
      expect(placements.get("dnf")).toBe(3);
    });
  });

  describe("finished horses ordering", () => {
    it("orders by finishedTick (earlier finish = better)", () => {
      const horses = [
        createHorse("slow", { position: 100, finishedTick: 80 }),
        createHorse("fast", { position: 100, finishedTick: 60 }),
        createHorse("medium", { position: 100, finishedTick: 70 }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("fast")).toBe(1);
      expect(placements.get("medium")).toBe(2);
      expect(placements.get("slow")).toBe(3);
    });

    it("uses tiebreaker for same finishedTick (lower avgP95 = better)", () => {
      const horses = [
        createHorse("highP95", {
          position: 100,
          finishedTick: 60,
          metrics: { latencySum: 0, p95Sum: 500, errorSum: 0, perfSum: 0, count: 1 },
        }),
        createHorse("lowP95", {
          position: 100,
          finishedTick: 60,
          metrics: { latencySum: 0, p95Sum: 100, errorSum: 0, perfSum: 0, count: 1 },
        }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("lowP95")).toBe(1);
      expect(placements.get("highP95")).toBe(2);
    });
  });

  describe("active horses ordering", () => {
    it("orders by position (higher position = better)", () => {
      const horses = [
        createHorse("behind", { position: 50, finishedTick: null, dnfTick: null }),
        createHorse("ahead", { position: 80, finishedTick: null, dnfTick: null }),
        createHorse("middle", { position: 65, finishedTick: null, dnfTick: null }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("ahead")).toBe(1);
      expect(placements.get("middle")).toBe(2);
      expect(placements.get("behind")).toBe(3);
    });

    it("uses tiebreaker for same position", () => {
      const horses = [
        createHorse("highError", {
          position: 50,
          finishedTick: null,
          dnfTick: null,
          metrics: { latencySum: 0, p95Sum: 100, errorSum: 0.5, perfSum: 0, count: 1 },
        }),
        createHorse("lowError", {
          position: 50,
          finishedTick: null,
          dnfTick: null,
          metrics: { latencySum: 0, p95Sum: 100, errorSum: 0.1, perfSum: 0, count: 1 },
        }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("lowError")).toBe(1);
      expect(placements.get("highError")).toBe(2);
    });
  });

  describe("DNF horses ordering", () => {
    it("orders by position (higher position = better)", () => {
      const horses = [
        createHorse("dnf1", { position: 30, finishedTick: null, dnfTick: 20 }),
        createHorse("dnf2", { position: 50, finishedTick: null, dnfTick: 40 }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("dnf2")).toBe(1);
      expect(placements.get("dnf1")).toBe(2);
    });

    it("uses later dnfTick as tiebreaker for same position", () => {
      const horses = [
        createHorse("earlyDnf", { position: 40, finishedTick: null, dnfTick: 20 }),
        createHorse("lateDnf", { position: 40, finishedTick: null, dnfTick: 50 }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("lateDnf")).toBe(1);
      expect(placements.get("earlyDnf")).toBe(2);
    });
  });

  describe("tiebreaker logic", () => {
    it("uses avgP95 as primary tiebreaker (lower = better)", () => {
      const horses = [
        createHorse("a", {
          position: 100,
          finishedTick: 60,
          metrics: { latencySum: 0, p95Sum: 300, errorSum: 0, perfSum: 0, count: 1 },
        }),
        createHorse("b", {
          position: 100,
          finishedTick: 60,
          metrics: { latencySum: 0, p95Sum: 100, errorSum: 0, perfSum: 0, count: 1 },
        }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("b")).toBe(1);
      expect(placements.get("a")).toBe(2);
    });

    it("uses avgError as secondary tiebreaker (lower = better)", () => {
      const horses = [
        createHorse("a", {
          position: 100,
          finishedTick: 60,
          metrics: { latencySum: 0, p95Sum: 100, errorSum: 0.3, perfSum: 0, count: 1 },
        }),
        createHorse("b", {
          position: 100,
          finishedTick: 60,
          metrics: { latencySum: 0, p95Sum: 100, errorSum: 0.1, perfSum: 0, count: 1 },
        }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("b")).toBe(1);
      expect(placements.get("a")).toBe(2);
    });

    it("uses avgPerf as tertiary tiebreaker (higher = better)", () => {
      const horses = [
        createHorse("a", {
          position: 100,
          finishedTick: 60,
          metrics: { latencySum: 0, p95Sum: 100, errorSum: 0.1, perfSum: 0.5, count: 1 },
        }),
        createHorse("b", {
          position: 100,
          finishedTick: 60,
          metrics: { latencySum: 0, p95Sum: 100, errorSum: 0.1, perfSum: 0.9, count: 1 },
        }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("b")).toBe(1);
      expect(placements.get("a")).toBe(2);
    });

    it("handles horses with no metrics (count = 0)", () => {
      const horses = [
        createHorse("noMetrics", {
          position: 100,
          finishedTick: 60,
          metrics: { latencySum: 0, p95Sum: 0, errorSum: 0, perfSum: 0, count: 0 },
        }),
        createHorse("hasMetrics", {
          position: 100,
          finishedTick: 60,
          metrics: { latencySum: 0, p95Sum: 100, errorSum: 0, perfSum: 0.8, count: 1 },
        }),
      ];

      const placements = computePlacements(createRuntime(horses));

      // noMetrics gets infinity P95, so hasMetrics should win
      expect(placements.get("hasMetrics")).toBe(1);
      expect(placements.get("noMetrics")).toBe(2);
    });
  });

  describe("full race scenarios", () => {
    it("handles typical race with mixed outcomes", () => {
      const horses = [
        createHorse("winner", { position: 100, finishedTick: 50 }),
        createHorse("second", { position: 100, finishedTick: 55 }),
        createHorse("third", { position: 100, finishedTick: 60 }),
        createHorse("active1", { position: 85, finishedTick: null, dnfTick: null }),
        createHorse("active2", { position: 75, finishedTick: null, dnfTick: null }),
        createHorse("dnf1", { position: 40, finishedTick: null, dnfTick: 30 }),
        createHorse("dnf2", { position: 20, finishedTick: null, dnfTick: 15 }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("winner")).toBe(1);
      expect(placements.get("second")).toBe(2);
      expect(placements.get("third")).toBe(3);
      expect(placements.get("active1")).toBe(4);
      expect(placements.get("active2")).toBe(5);
      expect(placements.get("dnf1")).toBe(6);
      expect(placements.get("dnf2")).toBe(7);
    });

    it("handles race where all horses finish", () => {
      const horses = [
        createHorse("a", { position: 100, finishedTick: 80 }),
        createHorse("b", { position: 100, finishedTick: 60 }),
        createHorse("c", { position: 100, finishedTick: 70 }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("b")).toBe(1);
      expect(placements.get("c")).toBe(2);
      expect(placements.get("a")).toBe(3);
    });

    it("handles race where all horses DNF", () => {
      const horses = [
        createHorse("a", { position: 30, finishedTick: null, dnfTick: 20 }),
        createHorse("b", { position: 50, finishedTick: null, dnfTick: 40 }),
        createHorse("c", { position: 40, finishedTick: null, dnfTick: 35 }),
      ];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("b")).toBe(1);
      expect(placements.get("c")).toBe(2);
      expect(placements.get("a")).toBe(3);
    });

    it("handles single horse", () => {
      const horses = [createHorse("solo", { position: 100, finishedTick: 50 })];

      const placements = computePlacements(createRuntime(horses));

      expect(placements.get("solo")).toBe(1);
    });

    it("handles empty horse list", () => {
      const placements = computePlacements(createRuntime([]));

      expect(placements.size).toBe(0);
    });
  });
});
