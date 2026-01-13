import { HandicapTier } from "@prisma/client";

export function handicapMultiplier(tier: HandicapTier): number {
  switch (tier) {
    case HandicapTier.Heavy:
      return 1.15;
    case HandicapTier.Medium:
      return 1.0;
    case HandicapTier.Light:
    default:
      return 0.9;
  }
}

export function handicapPerformanceMods(tier: HandicapTier) {
  switch (tier) {
    case HandicapTier.Heavy:
      return { rampMult: 1.15, errorToleranceMult: 0.9, weatherSensitivityMult: 1.0 };
    case HandicapTier.Medium:
      return { rampMult: 1.0, errorToleranceMult: 1.0, weatherSensitivityMult: 1.0 };
    case HandicapTier.Light:
    default:
      return { rampMult: 0.9, errorToleranceMult: 1.1, weatherSensitivityMult: 1.0 };
  }
}
