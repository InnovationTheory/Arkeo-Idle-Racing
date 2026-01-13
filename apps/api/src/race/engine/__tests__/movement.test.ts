import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  racePhaseForPosition,
  archetypeSpeedMultiplier,
  temperamentNoise,
  updateMomentumAndFatigue,
  calculateStride,
} from "../movement";
import type { HorseRuntime } from "../types";

describe("racePhaseForPosition", () => {
  it("returns 'early' for positions 0-29", () => {
    expect(racePhaseForPosition(0)).toBe("early");
    expect(racePhaseForPosition(15)).toBe("early");
    expect(racePhaseForPosition(29)).toBe("early");
  });

  it("returns 'mid' for positions 30-69", () => {
    expect(racePhaseForPosition(30)).toBe("mid");
    expect(racePhaseForPosition(50)).toBe("mid");
    expect(racePhaseForPosition(69)).toBe("mid");
  });

  it("returns 'stretch' for positions 70+", () => {
    expect(racePhaseForPosition(70)).toBe("stretch");
    expect(racePhaseForPosition(85)).toBe("stretch");
    expect(racePhaseForPosition(100)).toBe("stretch");
  });

  it("handles boundary conditions exactly", () => {
    expect(racePhaseForPosition(29.9)).toBe("early");
    expect(racePhaseForPosition(69.9)).toBe("mid");
  });
});

describe("archetypeSpeedMultiplier", () => {
  describe("non-erratic archetypes", () => {
    it("returns correct multiplier for front_runner", () => {
      expect(archetypeSpeedMultiplier("front_runner", "early")).toBe(1.4);
      expect(archetypeSpeedMultiplier("front_runner", "mid")).toBe(1.0);
      expect(archetypeSpeedMultiplier("front_runner", "stretch")).toBe(0.5);
    });

    it("returns correct multiplier for stalker", () => {
      expect(archetypeSpeedMultiplier("stalker", "early")).toBe(1.0);
      expect(archetypeSpeedMultiplier("stalker", "mid")).toBe(1.05);  // Nerfed from 1.1
      expect(archetypeSpeedMultiplier("stalker", "stretch")).toBe(1.0);
    });

    it("returns correct multiplier for stretch_runner", () => {
      expect(archetypeSpeedMultiplier("stretch_runner", "early")).toBe(0.75);  // Buffed from 0.6
      expect(archetypeSpeedMultiplier("stretch_runner", "mid")).toBe(0.95);    // Buffed from 0.9
      expect(archetypeSpeedMultiplier("stretch_runner", "stretch")).toBe(1.6);
    });

    it("returns correct multiplier for grinder", () => {
      expect(archetypeSpeedMultiplier("grinder", "early")).toBe(0.9);
      expect(archetypeSpeedMultiplier("grinder", "mid")).toBe(1.0);
      expect(archetypeSpeedMultiplier("grinder", "stretch")).toBe(1.2);
    });

    it("returns correct multiplier for burst", () => {
      expect(archetypeSpeedMultiplier("burst", "early")).toBe(0.8);
      expect(archetypeSpeedMultiplier("burst", "mid")).toBe(1.4);
      expect(archetypeSpeedMultiplier("burst", "stretch")).toBe(0.7);
    });
  });

  describe("erratic archetype", () => {
    beforeEach(() => {
      vi.spyOn(Math, "random");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns value between 0.6 and 1.4 for erratic", () => {
      vi.mocked(Math.random).mockReturnValue(0.5);
      // 0.6 + 0.5 * 0.8 = 1.0
      expect(archetypeSpeedMultiplier("erratic", "early")).toBe(1.0);
    });

    it("returns minimum value when random is 0", () => {
      vi.mocked(Math.random).mockReturnValue(0);
      expect(archetypeSpeedMultiplier("erratic", "mid")).toBe(0.6);
    });

    it("returns maximum value when random is 1", () => {
      vi.mocked(Math.random).mockReturnValue(1);
      expect(archetypeSpeedMultiplier("erratic", "stretch")).toBe(1.4);
    });
  });
});

describe("temperamentNoise", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 0 when random returns 0.5 (centered)", () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    // (0.5 * 2 - 1) * range = 0 * range = 0
    expect(temperamentNoise("calm")).toBe(0);
    expect(temperamentNoise("normal")).toBe(0);
    expect(temperamentNoise("volatile")).toBe(0);
  });

  it("uses correct range for calm (0.03)", () => {
    vi.mocked(Math.random).mockReturnValue(1);
    // (1 * 2 - 1) * 0.03 = 0.03
    expect(temperamentNoise("calm")).toBe(0.03);

    vi.mocked(Math.random).mockReturnValue(0);
    // (0 * 2 - 1) * 0.03 = -0.03
    expect(temperamentNoise("calm")).toBe(-0.03);
  });

  it("uses correct range for normal (0.06)", () => {
    vi.mocked(Math.random).mockReturnValue(1);
    expect(temperamentNoise("normal")).toBe(0.06);

    vi.mocked(Math.random).mockReturnValue(0);
    expect(temperamentNoise("normal")).toBe(-0.06);
  });

  it("uses correct range for volatile (0.12)", () => {
    vi.mocked(Math.random).mockReturnValue(1);
    expect(temperamentNoise("volatile")).toBe(0.12);

    vi.mocked(Math.random).mockReturnValue(0);
    expect(temperamentNoise("volatile")).toBe(-0.12);
  });
});

describe("updateMomentumAndFatigue", () => {
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
      previousRank: 0,
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

  it("increases momentum with high perfScore", () => {
    const horse = createHorse({ momentum: 0, fatigue: 0 });
    const result = updateMomentumAndFatigue(horse, 0.9, "mid");
    expect(result.momentum).toBeGreaterThan(0);
  });

  it("decreases momentum with low perfScore", () => {
    const horse = createHorse({ momentum: 0.1, fatigue: 0 });
    const result = updateMomentumAndFatigue(horse, 0.5, "mid");
    expect(result.momentum).toBeLessThan(0.1);
  });

  it("increases fatigue with low perfScore", () => {
    const horse = createHorse({ momentum: 0, fatigue: 0 });
    const result = updateMomentumAndFatigue(horse, 0.4, "mid");
    expect(result.fatigue).toBeGreaterThan(0);
  });

  it("clamps momentum to bounds [-0.1, 0.2]", () => {
    const horse = createHorse({ momentum: 0.2, fatigue: 0 });
    const highPerf = updateMomentumAndFatigue(horse, 1.0, "mid");
    expect(highPerf.momentum).toBeLessThanOrEqual(0.2);

    const lowHorse = createHorse({ momentum: -0.1, fatigue: 0 });
    const lowPerf = updateMomentumAndFatigue(lowHorse, 0.3, "mid");
    expect(lowPerf.momentum).toBeGreaterThanOrEqual(-0.1);
  });

  it("clamps fatigue to bounds [0, 0.25]", () => {
    const horse = createHorse({ momentum: 0, fatigue: 0.25 });
    const result = updateMomentumAndFatigue(horse, 0.2, "mid");
    expect(result.fatigue).toBeLessThanOrEqual(0.25);

    const lowFatigue = createHorse({ momentum: 0, fatigue: 0 });
    const lowResult = updateMomentumAndFatigue(lowFatigue, 1.0, "mid");
    expect(lowResult.fatigue).toBeGreaterThanOrEqual(0);
  });

  describe("archetype-specific modifiers", () => {
    it("front_runner fatigues faster", () => {
      const frontRunner = createHorse({ archetype: "front_runner", momentum: 0, fatigue: 0 });
      const stalker = createHorse({ archetype: "stalker", momentum: 0, fatigue: 0 });

      const frResult = updateMomentumAndFatigue(frontRunner, 0.4, "mid");
      const stResult = updateMomentumAndFatigue(stalker, 0.4, "mid");

      expect(frResult.fatigue).toBeGreaterThan(stResult.fatigue);
    });

    it("grinder fatigues slower", () => {
      const grinder = createHorse({ archetype: "grinder", momentum: 0, fatigue: 0 });
      const stalker = createHorse({ archetype: "stalker", momentum: 0, fatigue: 0 });

      const grResult = updateMomentumAndFatigue(grinder, 0.4, "mid");
      const stResult = updateMomentumAndFatigue(stalker, 0.4, "mid");

      expect(grResult.fatigue).toBeLessThan(stResult.fatigue);
    });

    it("stretch_runner gains extra momentum in stretch", () => {
      const stretchRunner = createHorse({ archetype: "stretch_runner", momentum: 0, fatigue: 0 });
      const stalker = createHorse({ archetype: "stalker", momentum: 0, fatigue: 0 });

      const srResult = updateMomentumAndFatigue(stretchRunner, 0.85, "stretch");
      const stResult = updateMomentumAndFatigue(stalker, 0.85, "stretch");

      expect(srResult.momentum).toBeGreaterThan(stResult.momentum);
    });

    it("stretch_runner has normal momentum in non-stretch phases", () => {
      const stretchRunner = createHorse({ archetype: "stretch_runner", momentum: 0, fatigue: 0 });
      const stalker = createHorse({ archetype: "stalker", momentum: 0, fatigue: 0 });

      const srResult = updateMomentumAndFatigue(stretchRunner, 0.85, "early");
      const stResult = updateMomentumAndFatigue(stalker, 0.85, "early");

      expect(srResult.momentum).toBe(stResult.momentum);
    });

    it("burst gains extra momentum in mid phase with high perf", () => {
      const burst = createHorse({ archetype: "burst", momentum: 0, fatigue: 0 });
      const stalker = createHorse({ archetype: "stalker", momentum: 0, fatigue: 0 });

      // perfThreshold is 0.8, so 0.85 triggers bonus
      const burstResult = updateMomentumAndFatigue(burst, 0.85, "mid");
      const stResult = updateMomentumAndFatigue(stalker, 0.85, "mid");

      expect(burstResult.momentum).toBeGreaterThan(stResult.momentum);
    });

    it("burst has normal momentum when perfScore below threshold", () => {
      const burst = createHorse({ archetype: "burst", momentum: 0, fatigue: 0 });
      const stalker = createHorse({ archetype: "stalker", momentum: 0, fatigue: 0 });

      // 0.75 is below threshold of 0.8
      const burstResult = updateMomentumAndFatigue(burst, 0.75, "mid");
      const stResult = updateMomentumAndFatigue(stalker, 0.75, "mid");

      expect(burstResult.momentum).toBe(stResult.momentum);
    });
  });
});

describe("calculateStride", () => {
  const baseParams = {
    baseStride: 1.0,
    perfScore: 1.0,
    phaseMult: 1.0,
    momentum: 0,
    fatigue: 0,
    noise: 0,
  };

  it("returns baseStride with neutral parameters", () => {
    expect(calculateStride(baseParams)).toBe(1.0);
  });

  it("multiplies by perfScore", () => {
    const result = calculateStride({ ...baseParams, perfScore: 0.5 });
    expect(result).toBe(0.5);
  });

  it("multiplies by phaseMult", () => {
    const result = calculateStride({ ...baseParams, phaseMult: 1.5 });
    expect(result).toBe(1.5);
  });

  it("applies positive momentum bonus", () => {
    const result = calculateStride({ ...baseParams, momentum: 0.1 });
    expect(result).toBeCloseTo(1.1, 5);
  });

  it("applies negative momentum penalty", () => {
    const result = calculateStride({ ...baseParams, momentum: -0.1 });
    expect(result).toBeCloseTo(0.9, 5);
  });

  it("applies fatigue penalty", () => {
    const result = calculateStride({ ...baseParams, fatigue: 0.1 });
    expect(result).toBeCloseTo(0.9, 5);
  });

  it("applies noise modifier", () => {
    const positiveNoise = calculateStride({ ...baseParams, noise: 0.05 });
    expect(positiveNoise).toBeCloseTo(1.05, 5);

    const negativeNoise = calculateStride({ ...baseParams, noise: -0.05 });
    expect(negativeNoise).toBeCloseTo(0.95, 5);
  });

  it("combines all factors multiplicatively", () => {
    const result = calculateStride({
      baseStride: 2.0,
      perfScore: 0.8,
      phaseMult: 1.2,
      momentum: 0.1,
      fatigue: 0.1,
      noise: 0.05,
    });

    // 2.0 * 0.8 * 1.2 * 1.1 * 0.9 * 1.05 = 1.99584
    expect(result).toBeCloseTo(1.99584, 4);
  });

  it("clamps to minimum stride (baseStride * 0.05)", () => {
    const result = calculateStride({
      ...baseParams,
      perfScore: 0.01,
      phaseMult: 0.1,
    });
    expect(result).toBe(0.05); // 1.0 * 0.05
  });

  it("clamps to maximum stride (baseStride * 2)", () => {
    const result = calculateStride({
      baseStride: 1.0,
      perfScore: 1.0,
      phaseMult: 2.0,
      momentum: 0.2,
      fatigue: 0,
      noise: 0.1,
    });
    expect(result).toBe(2.0); // max = 1.0 * 2
  });

  it("respects different baseStride values", () => {
    const result = calculateStride({
      baseStride: 0.5,
      perfScore: 1.0,
      phaseMult: 1.0,
      momentum: 0,
      fatigue: 0,
      noise: 0,
    });
    expect(result).toBe(0.5);

    // Clamps should also scale with baseStride
    const minResult = calculateStride({
      baseStride: 0.5,
      perfScore: 0.01,
      phaseMult: 0.1,
      momentum: -0.1,
      fatigue: 0.25,
      noise: -0.1,
    });
    expect(minResult).toBe(0.025); // 0.5 * 0.05
  });
});
