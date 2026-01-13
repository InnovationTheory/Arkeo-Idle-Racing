import { TrackSurface, RaceArchetype, Temperament, SurfaceAffinity } from "@prisma/client";
import { prisma } from "../db";

type TrackInfo = {
  surface: TrackSurface;
  durationSecs: number;
};

type HorseOddsInput = {
  raceHorseId: string;
  horseId: string;
  archetype: RaceArchetype;
  temperament: Temperament;
  surfaceAffinity: SurfaceAffinity;
};

type HorseRecord = {
  wins: number;
  places: number;
  shows: number;
  advances: number;
  races: number;
  dnfs: number;
};

function getDurationTier(durationSecs: number): "short" | "medium" | "long" {
  if (durationSecs < 90) return "short";
  if (durationSecs < 130) return "medium";
  return "long";
}

function getSurfaceBonus(affinity: SurfaceAffinity, surface: TrackSurface): number {
  // Amplified surface bonuses (3x base)
  if (affinity === "dirt_specialist" && surface === "dirt") return 36;
  if (affinity === "turf_specialist" && surface === "turf") return 45;
  if (affinity === "mud_lover" && surface === "dirt") return 24;
  if (affinity === "mud_lover" && surface === "turf") return 15;
  return 0;
}

function getArchetypeBonus(archetype: RaceArchetype, durationTier: "short" | "medium" | "long"): number {
  // Amplified archetype bonuses (3x base)
  if (archetype === "front_runner" && durationTier === "short") return 45;
  if (archetype === "burst" && durationTier === "short") return 30;
  if (archetype === "stalker" && durationTier === "short") return 15;
  if (archetype === "stalker" && durationTier === "medium") return 30;
  if (archetype === "grinder" && durationTier === "medium") return 15;
  if (archetype === "grinder" && durationTier === "long") return 45;
  if (archetype === "stretch_runner" && durationTier === "long") return 36;
  return 0;
}

function getTemperamentBonus(temperament: Temperament): number {
  // Amplified temperament bonuses (3x base)
  if (temperament === "calm") return 15;
  if (temperament === "volatile") return -9;
  return 0;
}

function getRecordBonus(record: HorseRecord): number {
  if (record.races === 0) return 0;

  // Win rate bonus: up to +60 for 100% win rate
  const winRateBonus = (record.wins / record.races) * 60;

  // Top 3 rate bonus: up to +30 for 100% top 3
  const top3Rate = (record.wins + record.places + record.shows) / record.races;
  const top3Bonus = top3Rate * 30;

  // DNF penalty: up to -50 for 100% DNF rate
  const dnfPenalty = (record.dnfs / record.races) * -50;

  // Experience bonus: up to +20 for 10+ races
  const expBonus = Math.min(record.races, 10) * 2;

  return winRateBonus + top3Bonus + dnfPenalty + expBonus;
}

function calculatePowerScore(
  horse: HorseOddsInput,
  record: HorseRecord,
  track: TrackInfo
): number {
  const durationTier = getDurationTier(track.durationSecs);

  const surfaceBonus = getSurfaceBonus(horse.surfaceAffinity, track.surface);
  const archetypeBonus = getArchetypeBonus(horse.archetype, durationTier);
  const temperamentBonus = getTemperamentBonus(horse.temperament);
  const recordBonus = getRecordBonus(record);

  const baseScore = 100 + surfaceBonus + archetypeBonus + temperamentBonus + recordBonus;

  // Square for exponential separation
  return Math.pow(baseScore, 2);
}

function powerScoreToOdds(score: number, totalScore: number): number {
  // Calculate odds-to-1
  const oddsTo1 = (totalScore / score) - 1;

  // Round to standard racing odds
  if (oddsTo1 <= 1) return 1; // Even money
  if (oddsTo1 <= 1.5) return 1.5; // 3-2
  if (oddsTo1 <= 2.5) return 2;
  if (oddsTo1 <= 3.5) return 3;
  if (oddsTo1 <= 4.5) return 4;
  if (oddsTo1 <= 5.5) return 5;
  if (oddsTo1 <= 6.5) return 6;
  if (oddsTo1 <= 9) return 8;
  if (oddsTo1 <= 14) return 12;
  if (oddsTo1 <= 24) return 20;
  if (oddsTo1 <= 39) return 30;
  return 50;
}

export async function calculateRaceOdds(raceId: string): Promise<void> {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    include: {
      track: true,
      raceHorses: {
        include: {
          horse: true
        }
      }
    }
  });

  if (!race) return;

  const track: TrackInfo = {
    surface: race.track.surface,
    durationSecs: race.track.durationSecs
  };

  // Calculate power scores for all horses
  const horseScores: Array<{ raceHorseId: string; powerScore: number }> = [];

  for (const raceHorse of race.raceHorses) {
    const horseInput: HorseOddsInput = {
      raceHorseId: raceHorse.id,
      horseId: raceHorse.horseId,
      archetype: raceHorse.archetype,
      temperament: raceHorse.temperament,
      surfaceAffinity: raceHorse.surfaceAffinity
    };

    const record: HorseRecord = {
      wins: raceHorse.horse.wins,
      places: raceHorse.horse.places,
      shows: raceHorse.horse.shows,
      advances: raceHorse.horse.advances,
      races: raceHorse.horse.races,
      dnfs: raceHorse.horse.dnfs
    };

    const powerScore = calculatePowerScore(horseInput, record, track);
    horseScores.push({ raceHorseId: raceHorse.id, powerScore });
  }

  // Calculate total score for odds calculation
  const totalScore = horseScores.reduce((sum, h) => sum + h.powerScore, 0);

  // Update each horse with their odds
  for (const { raceHorseId, powerScore } of horseScores) {
    const odds = powerScoreToOdds(powerScore, totalScore);
    await prisma.raceHorse.update({
      where: { id: raceHorseId },
      data: { odds }
    });
  }
}

export function formatOdds(odds: number): string {
  if (odds === 1) return "EVEN";
  if (odds === 1.5) return "3-2";
  return `${odds}-1`;
}
