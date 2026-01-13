import {
  Horse,
  Provider,
  Race,
  RaceHorse,
  ServiceType,
  Track,
  Weather
} from "@prisma/client";
import { handicapMultiplier } from "./handicap";

export type RaceWithRelations = Race & {
  track: Track;
  weather: Weather;
  raceDayHeat?: {
    roundNumber: number;
    heatNumber: number;
    round?: { heatsCount: number } | null;
    raceDay?: { status: string } | null;
  } | null;
  raceHorses: (RaceHorse & {
    horse: Horse;
    serviceType: ServiceType;
    assignedProvider: Provider | null;
  })[];
};

export function serializeRace(race: RaceWithRelations) {
  const revealProviders = true;
  return {
    raceId: race.id,
    status: race.status,
    track: race.track,
    weather: race.weather,
    createdAt: race.createdAt,
    pickCloseAt: race.pickCloseAt,
    startAt: race.startAt,
    endAt: race.endAt,
    intakeCredits: race.intakeCredits,
    payoutBudgetCredits: race.payoutBudgetCredits,
    racedayLevel: race.raceDayHeat?.roundNumber ?? null,
    racedayHeatNumber: race.raceDayHeat?.heatNumber ?? null,
    racedayHeatCount: race.raceDayHeat?.round?.heatsCount ?? null,
    racedayStatus: race.raceDayHeat?.raceDay?.status ?? null,
    horses: race.raceHorses
      .slice()
      .sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0))
      .map((entry) => ({
        raceHorseId: entry.id,
        horseId: entry.horseId,
        lane: entry.lane,
        displayName: entry.horse.displayName,
        handicapTier: entry.horse.handicapTier,
        formScore: entry.horse.formScore,
        difficultyMultiplier: handicapMultiplier(entry.horse.handicapTier),
        archetype: entry.archetype,
        temperament: entry.temperament,
        surfaceAffinity: entry.surfaceAffinity,
        odds: entry.odds,
        record: {
          wins: entry.horse.wins,
          places: entry.horse.places,
          shows: entry.horse.shows,
          advances: entry.horse.advances,
          races: entry.horse.races,
          dnfs: entry.horse.dnfs
        },
        serviceType: entry.serviceType,
        assignedProvider: revealProviders && entry.assignedProvider
          ? {
              id: entry.assignedProvider.id,
              providerPubkey: entry.assignedProvider.providerPubkey,
              moniker: entry.assignedProvider.moniker,
              endpoint: entry.assignedProvider.endpoint,
              region: entry.assignedProvider.region,
              reliabilityScore: entry.assignedProvider.reliabilityScore
            }
          : null,
        placement: entry.placement,
        eliminatedAtTick: entry.eliminatedAtTick
      }))
  };
}
