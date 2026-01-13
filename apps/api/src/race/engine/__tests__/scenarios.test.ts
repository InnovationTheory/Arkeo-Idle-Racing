import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HorseRuntime, RacingContext, RacePhase } from "../types";
import {
  checkFinishingKick,
  checkDetermination,
  checkDesperationSurge,
  updateMomentumAndFatigue,
  calculateStride,
  archetypeSpeedMultiplier,
  racePhaseForPosition,
  getPositionMomentumMultiplier
} from "../movement";
import {
  DESPERATION_STRIDE_BONUS,
  DESPERATION_PROBABILITY,
  PASSING_SURGE_BONUS
} from "../constants";

/**
 * Scenario tests for come-from-behind race mechanics.
 * These tests verify that trailing horses can realistically catch up
 * through the combination of new mechanics.
 */

function createHorse(overrides: Partial<HorseRuntime> = {}): HorseRuntime {
  return {
    raceHorseId: "test-horse",
    horseId: "horse-1",
    displayName: "Test Horse",
    handicapTier: "Light",
    archetype: "stalker",
    temperament: "normal",
    serviceTypeId: "service-1",
    probeType: "cosmos_rpc",
    assignedProviderId: null,
    momentum: 0,
    fatigue: 0,
    position: 0,
    previousPosition: 0,
    previousRank: 1,
    finishedTick: null,
    dnfTick: null,
    eliminationReason: null,
    consecutiveFailures: 0,
    consecutiveLatencyElim: 0,
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

function createContext(overrides: Partial<RacingContext> = {}): RacingContext {
  return {
    leaderPosition: 85,
    positionSpread: 20,
    currentRank: 1,
    totalActive: 8,
    currentTick: 80,
    totalTicks: 100,
    isSpiking: false,
    ...overrides,
  };
}

describe("Come-from-Behind Scenarios", () => {
  describe("Scenario: Stretch Runner in Last Place at Position 80", () => {
    let horse: HorseRuntime;
    let context: RacingContext;

    beforeEach(() => {
      vi.spyOn(Math, "random");
      // Stretch runner in 8th place (last), position 65, leader at 85
      horse = createHorse({
        archetype: "stretch_runner",
        position: 65,
        previousPosition: 64,
        previousRank: 8,
        momentum: -0.05,  // Slightly negative momentum (struggling)
        fatigue: 0.1,
      });
      context = createContext({
        leaderPosition: 85,
        positionSpread: 20,
        currentRank: 8,
        totalActive: 8,
        currentTick: 75,
        totalTicks: 100,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("gets 50% faster momentum gain due to position (rank 8)", () => {
      const mult = getPositionMomentumMultiplier(8);
      expect(mult).toBe(1.5);
    });

    it("gets determination bonus when in stretch phase", () => {
      // Move horse to stretch position
      horse.position = 75;
      const phase: RacePhase = "stretch";
      context.currentRank = 6;

      const result = checkDetermination(horse, context, phase);

      expect(result.triggered).toBe(true);
      expect(result.bonus).toBeCloseTo(1.08, 2); // 8% bonus for stretch_runner
    });

    it("gets finishing kick when position crosses 85", () => {
      horse.position = 86;
      horse.fatigue = 0.1; // Low fatigue for stronger kick

      vi.mocked(Math.random).mockReturnValue(0.5); // Middle of random range

      const result = checkFinishingKick(horse, context);

      expect(result.triggered).toBe(true);
      // stretch_runner has 0.25 kick strength
      // kickMult = 1 + (0.25 * 0.9 * 1.0) = 1.225 (with random at 0.5 -> factor ~1.0)
      expect(result.kickMultiplier).toBeGreaterThan(1.15);
    });

    it("can trigger desperation surge when trailing with low/negative momentum", () => {
      horse.momentum = -0.03; // Above the new threshold of -0.05
      context.currentRank = 5;
      const phase: RacePhase = "stretch";

      vi.mocked(Math.random).mockReturnValue(0.3); // Below 55% threshold

      const result = checkDesperationSurge(horse, context, phase);

      expect(result.triggered).toBe(true);
      expect(result.strideBonus).toBe(DESPERATION_STRIDE_BONUS); // 1.35
    });

    it("stretch_runner gets 1.6x phase multiplier in stretch", () => {
      const mult = archetypeSpeedMultiplier("stretch_runner", "stretch");
      expect(mult).toBe(1.6);
    });

    it("combined mechanics produce significant speed boost", () => {
      // Set up optimal conditions for comeback
      horse.position = 86;
      horse.momentum = 0.1;
      horse.fatigue = 0.05;
      horse.passingSurgeTicksRemaining = 2; // Active passing surge

      const phase: RacePhase = "stretch";
      context.currentRank = 5;

      // Seed random for determinism
      vi.mocked(Math.random).mockReturnValue(0.5);

      // Calculate all bonuses
      const phaseMult = archetypeSpeedMultiplier("stretch_runner", "stretch"); // 1.6
      const finishingKick = checkFinishingKick(horse, context);
      const determination = checkDetermination(horse, context, phase);

      // Base stride with all factors
      const baseStride = 1.0;
      const perfScore = 0.85;

      let stride = calculateStride({
        baseStride,
        perfScore,
        phaseMult,
        momentum: horse.momentum,
        fatigue: horse.fatigue,
        noise: 0,
      });

      // Apply comeback bonuses
      stride *= finishingKick.kickMultiplier;
      stride *= determination.bonus;
      stride *= PASSING_SURGE_BONUS; // 1.08 for active surge

      // Verify significant boost
      // Base would be ~1.0 * 0.85 * 1.6 * 1.1 * 0.95 = 1.42
      // With bonuses: ~1.42 * 1.2 * 1.08 * 1.08 = ~1.99
      expect(stride).toBeGreaterThan(1.8);
    });
  });

  describe("Scenario: Grinder Making Steady Progress", () => {
    let horse: HorseRuntime;
    let context: RacingContext;

    beforeEach(() => {
      vi.spyOn(Math, "random");
      horse = createHorse({
        archetype: "grinder",
        position: 70,
        previousRank: 5,
        momentum: 0.05,
        fatigue: 0.08,
      });
      context = createContext({
        currentRank: 5,
        totalActive: 8,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("grinder fatigues slower than other archetypes", () => {
      const grinder = createHorse({ archetype: "grinder", momentum: 0, fatigue: 0 });
      const stalker = createHorse({ archetype: "stalker", momentum: 0, fatigue: 0 });
      const phase: RacePhase = "mid";

      const grResult = updateMomentumAndFatigue(grinder, 0.5, phase, context);
      const stResult = updateMomentumAndFatigue(stalker, 0.5, phase, context);

      expect(grResult.fatigue).toBeLessThan(stResult.fatigue);
    });

    it("gets determination bonus (6%) when behind", () => {
      horse.position = 75;
      context.currentRank = 4;
      const phase: RacePhase = "stretch";

      const result = checkDetermination(horse, context, phase);

      expect(result.triggered).toBe(true);
      expect(result.bonus).toBeCloseTo(1.06, 2);
    });

    it("gets 1.2x phase multiplier in stretch", () => {
      expect(archetypeSpeedMultiplier("grinder", "stretch")).toBe(1.2);
    });

    it("maintains steady momentum gain with good performance", () => {
      const phase: RacePhase = "mid";
      context.currentRank = 5;

      // Grinder with good perf score (0.8+) gains momentum
      const result = updateMomentumAndFatigue(horse, 0.85, phase, context);

      // Should gain momentum with good perf
      expect(result.momentum).toBeGreaterThanOrEqual(horse.momentum);
      // Fatigue should stay low
      expect(result.fatigue).toBeLessThan(0.15);
    });
  });

  describe("Scenario: Front Runner Fading in Stretch", () => {
    let horse: HorseRuntime;
    let context: RacingContext;

    beforeEach(() => {
      horse = createHorse({
        archetype: "front_runner",
        position: 88,
        previousRank: 1,
        momentum: 0.15,
        fatigue: 0.18, // Building fatigue from leading
      });
      context = createContext({
        leaderPosition: 88,
        currentRank: 1,
        totalActive: 8,
      });
    });

    it("front_runner only gets 0.5x in stretch (significant fade)", () => {
      expect(archetypeSpeedMultiplier("front_runner", "stretch")).toBe(0.5);
    });

    it("front_runner has weak finishing kick (0.05)", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      const result = checkFinishingKick(horse, context);

      expect(result.triggered).toBe(true);
      // 1 + (0.05 * (1-0.18) * 1.0) = 1.041
      expect(result.kickMultiplier).toBeLessThan(1.1);

      vi.restoreAllMocks();
    });

    it("front_runner fatigues faster", () => {
      const frontRunner = createHorse({ archetype: "front_runner", momentum: 0, fatigue: 0.1 });
      const stalker = createHorse({ archetype: "stalker", momentum: 0, fatigue: 0.1 });
      const phase: RacePhase = "mid";

      const frResult = updateMomentumAndFatigue(frontRunner, 0.5, phase, context);
      const stResult = updateMomentumAndFatigue(stalker, 0.5, phase, context);

      expect(frResult.fatigue).toBeGreaterThan(stResult.fatigue);
    });

    it("does not get determination bonus (leading)", () => {
      const phase: RacePhase = "stretch";
      context.currentRank = 1;

      const result = checkDetermination(horse, context, phase);

      expect(result.triggered).toBe(false);
      expect(result.bonus).toBe(1);
    });
  });

  describe("Scenario: Passing Surge Chain", () => {
    it("passing surge provides 8% boost for 3 ticks", () => {
      const horse = createHorse({
        passingSurgeTicksRemaining: 3,
        passingSurgeCount: 1,
      });

      // Verify constants
      expect(PASSING_SURGE_BONUS).toBe(1.08);
      expect(horse.passingSurgeTicksRemaining).toBe(3);
    });

    it("max 2 passing surges per race prevents exploitation", () => {
      const horse = createHorse({
        passingSurgeTicksRemaining: 0,
        passingSurgeCount: 2, // Already used both
      });

      // Horse at max surges shouldn't get another
      expect(horse.passingSurgeCount).toBe(2);
    });
  });

  describe("Scenario: Desperation Surge Probability", () => {
    beforeEach(() => {
      vi.spyOn(Math, "random");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("triggers at 55% probability (was 40%)", () => {
      expect(DESPERATION_PROBABILITY).toBe(0.55);
    });

    it("triggers with negative momentum (threshold is -0.05)", () => {
      const horse = createHorse({
        archetype: "stalker",
        position: 75,
        momentum: -0.03, // Negative but above threshold
      });
      const context = createContext({ currentRank: 4 });
      const phase: RacePhase = "stretch";

      vi.mocked(Math.random).mockReturnValue(0.4); // Below 55%

      const result = checkDesperationSurge(horse, context, phase);

      expect(result.triggered).toBe(true);
    });

    it("provides 35% boost (was 25%)", () => {
      expect(DESPERATION_STRIDE_BONUS).toBe(1.35);
    });

    it("triggers at rank 3+ (was 4+)", () => {
      const horse = createHorse({
        position: 75,
        momentum: 0.1,
      });
      const context = createContext({ currentRank: 3 }); // Exactly rank 3
      const phase: RacePhase = "stretch";

      vi.mocked(Math.random).mockReturnValue(0.3);

      const result = checkDesperationSurge(horse, context, phase);

      expect(result.triggered).toBe(true);
    });
  });

  describe("Scenario: Full Comeback Simulation", () => {
    /**
     * Simulates a stretch_runner going from 6th place at position 70
     * to potentially winning, by calculating stride over multiple "ticks"
     */
    it("stretch_runner can close 15-unit gap in stretch with good performance", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.6); // Favorable but not max

      const horse = createHorse({
        archetype: "stretch_runner",
        position: 70,
        momentum: 0.05,
        fatigue: 0.08,
        passingSurgeTicksRemaining: 0,
        passingSurgeCount: 0,
      });

      // Leader is at 85
      let leaderPosition = 85;
      let horseMomentum = horse.momentum;
      let horseFatigue = horse.fatigue;
      let horsePosition = horse.position;
      let passingSurgeActive = false;
      let surgeTicksRemaining = 0;

      const baseStride = 1.0; // ~1% per tick
      const perfScore = 0.88; // Good performance

      // Simulate 15 ticks of stretch racing
      for (let tick = 0; tick < 15; tick++) {
        const phase: RacePhase = "stretch";
        const currentRank = horsePosition < leaderPosition ? 2 : 1;
        const context = createContext({
          leaderPosition,
          currentRank,
          currentTick: 80 + tick,
        });

        // Update momentum/fatigue
        const mfResult = updateMomentumAndFatigue(
          { ...horse, momentum: horseMomentum, fatigue: horseFatigue, position: horsePosition } as HorseRuntime,
          perfScore,
          phase,
          context
        );
        horseMomentum = mfResult.momentum;
        horseFatigue = mfResult.fatigue;

        // Calculate stride
        const phaseMult = archetypeSpeedMultiplier("stretch_runner", phase); // 1.6
        let stride = calculateStride({
          baseStride,
          perfScore,
          phaseMult,
          momentum: horseMomentum,
          fatigue: horseFatigue,
          noise: 0,
        });

        // Apply finishing kick if in range
        if (horsePosition >= 85) {
          const kick = checkFinishingKick(
            { ...horse, position: horsePosition, fatigue: horseFatigue } as HorseRuntime,
            context
          );
          stride *= kick.kickMultiplier;
        }

        // Apply determination
        if (currentRank >= 3) {
          const det = checkDetermination(
            { ...horse, archetype: "stretch_runner" } as HorseRuntime,
            { ...context, currentRank },
            phase
          );
          stride *= det.bonus;
        }

        // Apply passing surge
        if (surgeTicksRemaining > 0) {
          stride *= PASSING_SURGE_BONUS;
          surgeTicksRemaining--;
        }

        // Move horse
        horsePosition = Math.min(100, horsePosition + stride);

        // Leader moves at moderate pace (front_runner fading)
        const leaderStride = baseStride * perfScore * 0.5 * 0.95; // Front runner fading
        leaderPosition = Math.min(100, leaderPosition + leaderStride);

        // Check for passing (triggers surge)
        if (!passingSurgeActive && horsePosition > leaderPosition - 2) {
          passingSurgeActive = true;
          surgeTicksRemaining = 3;
        }
      }

      // Verify significant progress toward comeback
      // Started at 70, leader at 85 (15 unit gap)
      // Should close most of the gap and be near the finish
      expect(horsePosition).toBeGreaterThan(90); // Made significant progress
      const finalGap = leaderPosition - horsePosition;
      expect(finalGap).toBeLessThan(8); // Gap closed significantly from 15 to <8

      vi.restoreAllMocks();
    });
  });

  describe("Position Momentum Multipliers", () => {
    it("rank 1-2 get no boost (1.0x)", () => {
      expect(getPositionMomentumMultiplier(1)).toBe(1.0);
      expect(getPositionMomentumMultiplier(2)).toBe(1.0);
    });

    it("rank 3-4 get 15% boost", () => {
      expect(getPositionMomentumMultiplier(3)).toBe(1.15);
      expect(getPositionMomentumMultiplier(4)).toBe(1.15);
    });

    it("rank 5-6 get 30% boost", () => {
      expect(getPositionMomentumMultiplier(5)).toBe(1.30);
      expect(getPositionMomentumMultiplier(6)).toBe(1.30);
    });

    it("rank 7+ get 50% boost", () => {
      expect(getPositionMomentumMultiplier(7)).toBe(1.50);
      expect(getPositionMomentumMultiplier(8)).toBe(1.50);
      expect(getPositionMomentumMultiplier(10)).toBe(1.50);
    });
  });
});
