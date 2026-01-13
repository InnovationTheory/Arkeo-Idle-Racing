import { HandicapTier, Horse, Prisma } from "@prisma/client";
import { HorseHistoryEntry, HorseHistory } from "../types/prisma-json";

export type { HorseHistoryEntry };

const HISTORY_LIMIT = 10;

function computeHandicap(entries: HorseHistoryEntry[]): { formScore: number; tier: HandicapTier } {
  if (entries.length < 3) {
    return { formScore: 0, tier: HandicapTier.Light };
  }

  let winCount = 0;
  let podiumCount = 0;
  let dnfCount = 0;

  for (const entry of entries) {
    if (entry.placement === 1) winCount += 1;
    if (entry.placement !== null && entry.placement <= 3) podiumCount += 1;
    if (entry.eliminatedAtTick !== null) dnfCount += 1;
  }

  const formScore = winCount * 3 + podiumCount * 1 - dnfCount * 2;

  if (formScore >= 12) {
    return { formScore, tier: HandicapTier.Heavy };
  }

  if (formScore >= 6) {
    return { formScore, tier: HandicapTier.Medium };
  }

  return { formScore, tier: HandicapTier.Light };
}

export function updateHorseHistory(horse: Horse, entry: HorseHistoryEntry) {
  const history = (horse.historyJson as HorseHistory | null) ?? { races: [] };
  const races = Array.isArray(history.races) ? history.races : [];

  const updated = [entry, ...races].slice(0, HISTORY_LIMIT);
  const handicap = computeHandicap(updated);

  return {
    historyJson: { races: updated } as Prisma.InputJsonValue,
    formScore: handicap.formScore,
    handicapTier: handicap.tier
  };
}
