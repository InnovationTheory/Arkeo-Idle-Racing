import { jerseyPalette } from "./horseStyle";

function hashSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const result = [...items];
  const rand = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function buildRaceJerseyColors(
  raceId: string | null | undefined,
  horseIds: string[]
): Map<string, string> {
  if (horseIds.length === 0) {
    return new Map();
  }

  // Use raceId as seed, or fallback to a hash of the sorted horse IDs
  const seedValue = raceId ?? horseIds.slice().sort().join(",");
  const seed = hashSeed(seedValue);
  const palette = shuffle(jerseyPalette, seed);
  const uniqueHorseIds = Array.from(new Set(horseIds)).sort();
  const assignments = new Map<string, string>();

  uniqueHorseIds.forEach((horseId, index) => {
    assignments.set(horseId, palette[index % palette.length]);
  });

  return assignments;
}
