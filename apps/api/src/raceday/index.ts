import { randomUUID } from "crypto";
import {
  RaceArchetype,
  RaceDayHeatStatus,
  RaceDayRoundStatus,
  RaceDayStatus,
  RaceStatus,
  SurfaceAffinity,
  Temperament,
  Prisma,
  Provider
} from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { startRaceEngine, forceEndRace } from "../race/engine";
import { getRaceWithRelations } from "../race/queries";
import { serializeRace } from "../race/serialize";
import { assignProviders, refreshProvidersCache } from "../scheduler";
import { refreshActiveSubscriberSnapshots } from "../subscriber/activeSnapshot";
import { fetchSubscriberServices } from "../subscriber/discovery";
import { broadcastToRace, broadcastToRaceDay } from "../ws";
import { NotFoundError, ValidationError } from "../errors";
import { HeatsConfig, HeatResult, HeatMetadata } from "../types/prisma-json";
import { raceDayLogger } from "../logger";
import { calculateRaceOdds } from "../race/odds";
import { sendArkeoReward } from "../arkeo/send";
import {
  ROUND_HEATS,
  HEAT_SIZE,
  ADVANCE_COUNT,
  HEAT_TIMEOUT_BUFFER_SECS,
  MIN_HORSES_FOR_RACEDAY,
  RACEDAY_HORSE_COUNT,
  PICK_CLOSE_DELAY_MS,
  HEAT_POLL_INTERVAL_MS,
  UNKNOWN_PLACEMENT,
  PODIUM_COUNT,
  RANDOM_PROVIDER_ROUND,
  FIXED_PROVIDER_ROUND
} from "./constants";

const archetypes: RaceArchetype[] = [
  "front_runner",
  "stalker",
  "stretch_runner",
  "grinder",
  "burst",
  "erratic"
];

const temperaments: Temperament[] = ["calm", "normal", "volatile"];

const surfaceAffinities: SurfaceAffinity[] = [
  "dirt_specialist",
  "turf_specialist",
  "mud_lover",
  "all_surface"
];

type ProviderStrategy =
  | { mode: "random" }
  | {
      mode: "single_provider";
      providerPubkey: string;
      providerMoniker: string | null;
      serviceTypeIds: string[];
    }
  | {
      mode: "single_provider_service";
      providerId: string;
      providerPubkey: string;
      providerMoniker: string | null;
      serviceTypeId: string;
    };

type RaceDayCreateInput = {
  name?: string;
  startAt?: string;
  tickMs?: number;
  raceDurationSecs?: number;
  pickWindowSecs?: number;
  bufferSecs?: number;
  maxParallelHeats?: number;
  poolCredits?: number;
};

type RaceDayHorseSummary = {
  raceDayHorseId: string;
  horseId: string;
  displayName: string;
  seedOrder: number;
  archetype: RaceArchetype | null;
  temperament: Temperament | null;
  surfaceAffinity: SurfaceAffinity | null;
  eliminatedRound: number | null;
  eliminatedHeat: number | null;
  finalPlacement: number | null;
};

type RaceDayHeatState = {
  heatId: string;
  roundNumber: number;
  heatNumber: number;
  status: RaceDayHeatStatus;
  raceId: string | null;
  startsAt: Date | null;
  pickCloseAt: Date | null;
  endsAt: Date | null;
  entrants: RaceDayHorseSummary[];
  advancers: RaceDayHorseSummary[];
  results: Array<{ raceDayHorseId: string; placement: number }>;
  metadata: HeatMetadata | null;
};

type RaceDayRoundState = {
  roundId: string;
  roundNumber: number;
  status: RaceDayRoundStatus;
  heatsCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  heats: RaceDayHeatState[];
};

export type RaceDayState = {
  raceDayId: string;
  name: string;
  status: RaceDayStatus;
  createdAt: Date;
  startAt: Date | null;
  tickMs: number;
  raceDurationSecs: number;
  pickWindowSecs: number;
  bufferSecs: number;
  totalRounds: number;
  poolCredits: number;
  heatsConfig: HeatsConfig | null;
  currentRound: number | null;
  currentHeat: number | null;
  rounds: RaceDayRoundState[];
};

const runtimeByRaceDayId = new Map<string, { running: boolean }>();

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function providerPool(providers: Provider[]): Provider[] {
  const filtered = providers.filter(
    (provider) =>
      provider.endpoint !== "sim" && !provider.providerPubkey.startsWith("sim-")
  );
  return filtered.length > 0 ? filtered : providers;
}

function pickProviderGroup(
  providers: Provider[]
): { pubkey: string; moniker: string | null; providers: Provider[] } | null {
  const groups = new Map<string, Provider[]>();
  for (const provider of providers) {
    const list = groups.get(provider.providerPubkey) ?? [];
    list.push(provider);
    groups.set(provider.providerPubkey, list);
  }
  const pubkeys = Array.from(groups.keys());
  if (pubkeys.length === 0) return null;
  const pubkey = pickRandom(pubkeys);
  const list = groups.get(pubkey) ?? [];
  const moniker = list.find((entry) => entry.moniker)?.moniker ?? null;
  return { pubkey, moniker, providers: list };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_POOL_CREDITS = 5;

function raceDayDefaults(input: RaceDayCreateInput) {
  return {
    name: input.name,
    startAt: input.startAt ? new Date(input.startAt) : new Date(),
    tickMs: input.tickMs ?? config.raceDayTickMs,
    raceDurationSecs: input.raceDurationSecs ?? config.raceDayDurationSecs,
    pickWindowSecs: input.pickWindowSecs ?? config.raceDayPickWindowSecs,
    bufferSecs: input.bufferSecs ?? config.raceDayBufferSecs,
    maxParallelHeats: input.maxParallelHeats ?? config.raceDayMaxParallelHeats,
    poolCredits: input.poolCredits ?? DEFAULT_POOL_CREDITS
  };
}

function iconKeyForService(name: string): string {
  const value = name.toLowerCase();
  if (value.includes("eth") || value.includes("ethereum") || value.includes("base")) return "eth";
  if (value.includes("osmosis")) return "osmo";
  if (value.includes("arkeo")) return "arkeo";
  if (value.includes("bitcoin") || value.includes("btc")) return "btc";
  return "";
}

async function ensureServiceTypesFromSubscriber(): Promise<string[]> {
  const services = await fetchSubscriberServices();
  const allowlist = new Set(["ethereum_jsonrpc", "cosmos_rpc", "cosmos_rest"]);
  const eligible = services.filter(
    (service) => service.is_active && allowlist.has(service.service_type)
  );

  for (const service of eligible) {
    const iconKey = typeof service.metadata.iconKey === "string"
      ? (service.metadata.iconKey as string)
      : iconKeyForService(service.name);
    await prisma.serviceType.upsert({
      where: { id: service.service_id },
      update: {
        displayName: service.name,
        iconKey: iconKey || service.service_id,
        colorHex: (service.metadata.colorHex as string) ?? "#334155",
        probeType: service.service_type as "ethereum_jsonrpc" | "cosmos_rpc" | "cosmos_rest"
      },
      create: {
        id: service.service_id,
        displayName: service.name,
        iconKey: iconKey || service.service_id,
        colorHex: (service.metadata.colorHex as string) ?? "#334155",
        probeType: service.service_type as "ethereum_jsonrpc" | "cosmos_rpc" | "cosmos_rest"
      }
    });
  }

  return eligible.map((service) => service.service_id);
}

export async function createRaceDay(input: RaceDayCreateInput): Promise<string> {
  const defaults = raceDayDefaults(input);
  const name = defaults.name ?? `RaceDay ${defaults.startAt.toISOString().slice(0, 10)}`;
  const horses = await prisma.horse.findMany();

  // Fetch tracks for pre-assignment (exclude raceday-specific tracks)
  const tracks = (await prisma.track.findMany()).filter(
    (track) => !track.id.includes("-rd-")
  );

  // Deduplicate horses by displayName - keep only one horse per unique name
  const uniqueByName = new Map<string, typeof horses[0]>();
  for (const horse of horses) {
    if (!uniqueByName.has(horse.displayName)) {
      uniqueByName.set(horse.displayName, horse);
    }
  }
  const uniqueHorses = Array.from(uniqueByName.values());

  if (uniqueHorses.length < MIN_HORSES_FOR_RACEDAY) {
    throw new ValidationError("not_enough_horses");
  }

  // Split horses into veterans (have raced) and rookies (never raced)
  const veterans = uniqueHorses.filter((h) => h.races > 0);
  const rookies = uniqueHorses.filter((h) => h.races === 0);

  // Target 50% veterans, 50% rookies
  const targetVeterans = Math.min(Math.floor(RACEDAY_HORSE_COUNT / 2), veterans.length);
  const targetRookies = Math.min(RACEDAY_HORSE_COUNT - targetVeterans, rookies.length);

  // If not enough rookies, fill with more veterans (and vice versa)
  const actualVeterans = Math.min(RACEDAY_HORSE_COUNT - targetRookies, veterans.length);

  const selectedVeterans = shuffle(veterans).slice(0, actualVeterans);
  const selectedRookies = shuffle(rookies).slice(0, RACEDAY_HORSE_COUNT - selectedVeterans.length);

  const selected = shuffle([...selectedVeterans, ...selectedRookies]);
  const raceDayHorseEntries = selected.map((horse, index) => ({
    id: randomUUID(),
    raceDayId: "",
    horseId: horse.id,
    seedOrder: index + 1,
    archetype: pickRandom(archetypes),
    temperament: pickRandom(temperaments),
    surfaceAffinity: pickRandom(surfaceAffinities)
  }));

  const heatsConfig = {
    maxParallelHeats: defaults.maxParallelHeats
  };

  const raceDayId = await prisma.$transaction(async (tx) => {
    const raceDay = await tx.raceDay.create({
      data: {
        name,
        status: RaceDayStatus.scheduled,
        startAt: defaults.startAt,
        tickMs: defaults.tickMs,
        raceDurationSecs: defaults.raceDurationSecs,
        pickWindowSecs: defaults.pickWindowSecs,
        bufferSecs: defaults.bufferSecs,
        totalRounds: ROUND_HEATS.length,
        poolCredits: defaults.poolCredits,
        heatsConfigJson: heatsConfig as Prisma.InputJsonValue
      }
    });

    const horseRows = raceDayHorseEntries.map((entry) => ({
      ...entry,
      raceDayId: raceDay.id
    }));
    await tx.raceDayHorse.createMany({ data: horseRows });

    const heatTotalSecs = defaults.raceDurationSecs + defaults.bufferSecs;
    let heatOffset = 0;
    for (let roundIndex = 0; roundIndex < ROUND_HEATS.length; roundIndex += 1) {
      const heatsCount = ROUND_HEATS[roundIndex];
      const roundNumber = roundIndex + 1;
      await tx.raceDayRound.create({
        data: {
          raceDayId: raceDay.id,
          roundNumber,
          status: RaceDayRoundStatus.scheduled,
          heatsCount
        }
      });

      const entrants = roundNumber === 1
        ? chunk(horseRows.map((entry) => entry.id), HEAT_SIZE)
        : [];

      for (let heatNumber = 1; heatNumber <= heatsCount; heatNumber += 1) {
        const startAt = new Date(defaults.startAt.getTime() + heatOffset * 1000);
        const pickCloseAt = new Date(startAt.getTime() + defaults.pickWindowSecs * 1000);
        const endsAt = new Date(startAt.getTime() + defaults.raceDurationSecs * 1000);
        heatOffset += heatTotalSecs;

        // Pre-assign track for this heat (weather assigned at race creation)
        const assignedTrack = tracks.length > 0 ? pickRandom(tracks) : null;

        await tx.raceDayHeat.create({
          data: {
            raceDayId: raceDay.id,
            roundNumber,
            heatNumber,
            status: RaceDayHeatStatus.scheduled,
            startsAt: startAt,
            pickCloseAt,
            endsAt,
            entrantsJson: roundNumber === 1 ? entrants[heatNumber - 1] ?? [] : [],
            ...(assignedTrack && {
              metadataJson: {
                trackId: assignedTrack.id,
                trackName: assignedTrack.name,
                trackSurface: assignedTrack.surface,
                trackDurationSecs: assignedTrack.durationSecs
              }
            })
          }
        });
      }
    }

    return raceDay.id;
  });

  return raceDayId;
}

export async function startRaceDay(raceDayId: string): Promise<void> {
  if (runtimeByRaceDayId.has(raceDayId)) return;
  const raceDay = await prisma.raceDay.findUnique({ where: { id: raceDayId } });
  if (!raceDay) {
    throw new NotFoundError("raceday_not_found");
  }
  const terminalStatuses: RaceDayStatus[] = [
    RaceDayStatus.polling,
    RaceDayStatus.running,
    RaceDayStatus.complete,
    RaceDayStatus.canceled
  ];
  if (terminalStatuses.includes(raceDay.status)) {
    return;
  }

  runtimeByRaceDayId.set(raceDayId, { running: true });
  await prisma.raceDay.update({
    where: { id: raceDayId },
    data: { status: RaceDayStatus.polling, startAt: null }
  });
  await broadcastRaceDayState(raceDayId);
  broadcastToRaceDay(raceDayId, { type: "raceday_started", data: { raceDayId } });

  void runRaceDay(raceDayId).finally(() => {
    runtimeByRaceDayId.delete(raceDayId);
  });
}

export async function resetRaceDay(raceDayId: string, pickWindowSecs?: number): Promise<{ reset: boolean; message: string }> {
  if (runtimeByRaceDayId.has(raceDayId)) {
    return { reset: false, message: "raceday_already_running" };
  }

  const raceDay = await prisma.raceDay.findUnique({ where: { id: raceDayId } });
  if (!raceDay) {
    throw new NotFoundError("raceday_not_found");
  }

  // Only reset picking or running racedays
  if (raceDay.status !== RaceDayStatus.picking && raceDay.status !== RaceDayStatus.running) {
    return { reset: false, message: `cannot_reset_status_${raceDay.status}` };
  }

  const windowSecs = pickWindowSecs ?? raceDay.pickWindowSecs ?? 30;
  const newStartAt = new Date(Date.now() + windowSecs * 1000);

  // Check if any heats have completed - if so, we can't safely reset to picking
  const completedHeats = await prisma.raceDayHeat.count({
    where: { raceDayId, status: RaceDayHeatStatus.finished }
  });

  if (completedHeats > 0) {
    // Find the stuck heat (running or scheduled that should have started)
    const stuckHeat = await prisma.raceDayHeat.findFirst({
      where: {
        raceDayId,
        status: { in: [RaceDayHeatStatus.running, RaceDayHeatStatus.scheduled, RaceDayHeatStatus.picking] }
      },
      orderBy: [{ roundNumber: "asc" }, { heatNumber: "asc" }]
    });

    if (stuckHeat) {
      // Void the stuck race if it exists and is running
      if (stuckHeat.raceId) {
        const race = await prisma.race.findUnique({ where: { id: stuckHeat.raceId } });
        if (race?.status === RaceStatus.running) {
          await forceEndRace(stuckHeat.raceId);
        }
        // Reset the race to scheduled with new times
        await prisma.race.update({
          where: { id: stuckHeat.raceId },
          data: {
            status: RaceStatus.scheduled,
            pickCloseAt: newStartAt,
            startAt: new Date(newStartAt.getTime() + PICK_CLOSE_DELAY_MS)
          }
        });
      }

      // Reset this heat to scheduled
      await prisma.raceDayHeat.update({
        where: { id: stuckHeat.id },
        data: {
          status: RaceDayHeatStatus.scheduled,
          pickCloseAt: newStartAt,
          startsAt: new Date(newStartAt.getTime() + PICK_CLOSE_DELAY_MS)
        }
      });

      await broadcastRaceDayState(raceDayId);

      // Restart the runRaceDay loop - it will skip completed heats
      runtimeByRaceDayId.set(raceDayId, { running: true });
      void runRaceDay(raceDayId).finally(() => {
        runtimeByRaceDayId.delete(raceDayId);
      });

      return {
        reset: true,
        message: `heat_${stuckHeat.roundNumber}_${stuckHeat.heatNumber}_reset_${windowSecs}s`
      };
    }

    return { reset: false, message: "no_stuck_heat_found" };
  }

  // No heats completed yet - just reset the times on existing races
  // Update all round 1 heats and their races with new times
  const round1Heats = await prisma.raceDayHeat.findMany({
    where: { raceDayId, roundNumber: 1 },
    orderBy: { heatNumber: "asc" }
  });

  for (const heat of round1Heats) {
    const isFirstHeat = heat.heatNumber === 1;
    const heatStartAt = isFirstHeat
      ? new Date(newStartAt.getTime() + PICK_CLOSE_DELAY_MS)
      : newStartAt; // Non-first heats use buffer timing

    if (heat.raceId) {
      // Reset existing race - don't create new one
      await prisma.race.update({
        where: { id: heat.raceId },
        data: {
          status: isFirstHeat ? RaceStatus.picking : RaceStatus.scheduled,
          pickCloseAt: newStartAt,
          startAt: heatStartAt
        }
      });
    }

    await prisma.raceDayHeat.update({
      where: { id: heat.id },
      data: {
        status: isFirstHeat ? RaceDayHeatStatus.picking : RaceDayHeatStatus.scheduled,
        pickCloseAt: newStartAt,
        startsAt: heatStartAt
      }
    });
  }

  // Update raceday status - go straight to picking, skip polling
  runtimeByRaceDayId.set(raceDayId, { running: true });
  await prisma.raceDay.update({
    where: { id: raceDayId },
    data: { status: RaceDayStatus.picking, startAt: newStartAt }
  });

  await broadcastRaceDayState(raceDayId);
  broadcastToRaceDay(raceDayId, { type: "raceday_reset", data: { raceDayId, pickWindowSecs: windowSecs } });

  void runRaceDay(raceDayId).finally(() => {
    runtimeByRaceDayId.delete(raceDayId);
  });

  return { reset: true, message: `picking_phase_reset_${windowSecs}s` };
}

async function preflightRoundHeats(
  raceDay: {
    id: string;
    pickWindowSecs: number;
    raceDurationSecs: number;
    heatsConfigJson: Prisma.JsonValue | null;
    tickMs: number;
  },
  raceDayHorseById: Map<
    string,
    { id: string; horseId: string; archetype: RaceArchetype | null; temperament: Temperament | null; surfaceAffinity: SurfaceAffinity | null }
  >,
  roundNumber: number = 1
): Promise<void> {
  const heats = await prisma.raceDayHeat.findMany({
    where: { raceDayId: raceDay.id, roundNumber },
    orderBy: { heatNumber: "asc" }
  });
  const maxParallel = Math.max(
    1,
    Number((raceDay.heatsConfigJson as HeatsConfig | null)?.maxParallelHeats ?? 1)
  );

  const preflightHeat = async (heat: {
    id: string;
    roundNumber: number;
    heatNumber: number;
    entrantsJson: Prisma.JsonValue;
    raceId: string | null;
    metadataJson: Prisma.JsonValue;
  }) => {
    const entrants = Array.isArray(heat.entrantsJson) ? (heat.entrantsJson as string[]) : [];
    if (entrants.length === 0) {
      throw new ValidationError("heat_no_entrants");
    }

    const baseMetadata: HeatMetadata =
      typeof heat.metadataJson === "object" && heat.metadataJson !== null
        ? (heat.metadataJson as HeatMetadata)
        : {};

    let raceId = heat.raceId ?? null;
    let track = baseMetadata.trackId && baseMetadata.trackName
      ? {
          id: baseMetadata.trackId,
          name: baseMetadata.trackName,
          durationSecs: raceDay.raceDurationSecs
        }
      : null;
    let weather = baseMetadata.weatherId && baseMetadata.weatherName
      ? { id: baseMetadata.weatherId, name: baseMetadata.weatherName }
      : null;
    let providerStrategy = (baseMetadata.providerStrategy as ProviderStrategy | undefined) ?? {
      mode: "random"
    };

    if (!raceId) {
      const created = await createHeatRace({
        raceDay,
        heatId: heat.id,
        roundNumber: heat.roundNumber,
        entrants,
        raceDayHorseById
      });
      raceId = created.raceId;
      track = created.track;
      weather = created.weather;
      providerStrategy = created.providerStrategy;
    } else if (!track || !weather) {
      const race = await prisma.race.findUnique({
        where: { id: raceId },
        include: { track: true, weather: true }
      });
      if (race?.track) {
        track = { id: race.track.id, name: race.track.name, durationSecs: race.track.durationSecs };
      }
      if (race?.weather) {
        weather = { id: race.weather.id, name: race.weather.name };
      }
    }

    if (!raceId || !track || !weather) {
      throw new ValidationError("missing_race_config");
    }

    if (!baseMetadata.preflightCompleteAt) {
      await applyProviderStrategy({
        raceId,
        strategy: providerStrategy,
        broadcast: false,
        runPreflight: true
      });
    }

    await prisma.raceDayHeat.update({
      where: { id: heat.id },
      data: {
        raceId,
        metadataJson: {
          ...baseMetadata,
          trackId: track.id,
          trackName: track.name,
          weatherId: weather.id,
          weatherName: weather.name,
          providerStrategy,
          preflightCompleteAt: baseMetadata.preflightCompleteAt ?? new Date().toISOString()
        } as Prisma.InputJsonValue
      }
    });
  };

  // Count total horses for progress reporting
  const totalHorses = heats.reduce((sum, heat) => {
    const entrants = Array.isArray(heat.entrantsJson) ? (heat.entrantsJson as string[]) : [];
    return sum + entrants.length;
  }, 0);
  let completedHorses = 0;

  for (let i = 0; i < heats.length; i += maxParallel) {
    const batch = heats.slice(i, i + maxParallel);
    await Promise.all(batch.map((heat) => preflightHeat(heat)));

    // Update completed count and broadcast progress
    for (const heat of batch) {
      const entrants = Array.isArray(heat.entrantsJson) ? (heat.entrantsJson as string[]) : [];
      completedHorses += entrants.length;
    }
    broadcastToRaceDay(raceDay.id, {
      type: "preflight_progress",
      data: {
        raceDayId: raceDay.id,
        roundNumber,
        completedHorses,
        totalHorses,
        completedHeats: Math.min(i + maxParallel, heats.length),
        totalHeats: heats.length
      }
    });
  }
}

async function runRaceDay(raceDayId: string): Promise<void> {
  try {
    const raceDay = await prisma.raceDay.findUnique({
      where: { id: raceDayId },
      include: {
        horses: { include: { horse: true } }
      }
    });
    if (!raceDay) return;

    const raceDayHorseByHorseId = new Map(
      raceDay.horses.map((entry) => [entry.horseId, entry])
    );
    const raceDayHorseById = new Map(
      raceDay.horses.map((entry) => [entry.id, entry])
    );

    const latestStatus = await prisma.raceDay.findUnique({
      where: { id: raceDayId },
      select: { status: true }
    });
    if (latestStatus?.status === RaceDayStatus.polling) {
      await preflightRoundHeats(raceDay, raceDayHorseById, 1);
      const pickCloseAt = new Date(Date.now() + raceDay.pickWindowSecs * 1000);
      await prisma.raceDay.update({
        where: { id: raceDayId },
        data: { status: RaceDayStatus.picking, startAt: pickCloseAt }
      });
      await broadcastRaceDayState(raceDayId);
    }

    for (let roundNumber = 1; roundNumber <= raceDay.totalRounds; roundNumber += 1) {
      // Check if round is already complete (for resume scenarios)
      const existingRound = await prisma.raceDayRound.findUnique({
        where: { raceDayId_roundNumber: { raceDayId, roundNumber } }
      });
      if (existingRound?.status === RaceDayRoundStatus.complete) {
        raceDayLogger.info({ raceDayId, roundNumber }, "Skipping already completed round");
        continue;
      }

      await prisma.raceDayRound.update({
        where: { raceDayId_roundNumber: { raceDayId, roundNumber } },
        data: { status: RaceDayRoundStatus.running, startsAt: new Date() }
      });
      await broadcastRaceDayState(raceDayId);

      const heats = await prisma.raceDayHeat.findMany({
        where: { raceDayId, roundNumber },
        orderBy: { heatNumber: "asc" }
      });

      const maxParallel = Math.max(
        1,
        Number((raceDay.heatsConfigJson as HeatsConfig | null)?.maxParallelHeats ?? 1)
      );

      for (let i = 0; i < heats.length; i += maxParallel) {
        const batch = heats.slice(i, i + maxParallel);
        await Promise.all(
          batch.map((heat) => runHeat(raceDay, heat.id, raceDayHorseByHorseId, raceDayHorseById))
        );
      }

      await prisma.raceDayRound.update({
        where: { raceDayId_roundNumber: { raceDayId, roundNumber } },
        data: { status: RaceDayRoundStatus.complete, endsAt: new Date() }
      });
      await broadcastRaceDayState(raceDayId);

      broadcastToRaceDay(raceDayId, {
        type: "round_completed",
        data: { raceDayId, roundNumber }
      });

      if (roundNumber < raceDay.totalRounds) {
        const advancers = await collectRoundAdvancers(raceDayId, roundNumber);
        await seedNextRound(raceDayId, roundNumber + 1, advancers);
        // Preflight next round heats so users can see horses during countdown
        await preflightRoundHeats(raceDay, raceDayHorseById, roundNumber + 1);
        await broadcastRaceDayState(raceDayId);
      }
    }

    // Persist payouts before marking complete
    await persistRaceDayPayouts(raceDayId);

    await prisma.raceDay.update({
      where: { id: raceDayId },
      data: { status: RaceDayStatus.complete }
    });
    await broadcastRaceDayState(raceDayId);
    broadcastToRaceDay(raceDayId, { type: "raceday_completed", data: { raceDayId } });
  } catch (error) {
    raceDayLogger.error({ err: error, raceDayId }, "RaceDay failed");

    // Void all active races from this raceday
    await prisma.race.updateMany({
      where: {
        raceDayHeat: { raceDayId },
        status: { in: [RaceStatus.running, RaceStatus.scheduled, RaceStatus.picking] }
      },
      data: { status: RaceStatus.voided, endAt: new Date() }
    });

    // Void all non-finished heats
    await prisma.raceDayHeat.updateMany({
      where: {
        raceDayId,
        status: { notIn: [RaceDayHeatStatus.finished, RaceDayHeatStatus.voided] }
      },
      data: { status: RaceDayHeatStatus.voided }
    });

    await prisma.raceDay.update({
      where: { id: raceDayId },
      data: { status: RaceDayStatus.canceled }
    });
    await broadcastRaceDayState(raceDayId);
    broadcastToRaceDay(raceDayId, { type: "raceday_canceled", data: { raceDayId } });
  }
}

async function runHeat(
  raceDay: {
    id: string;
    tickMs: number;
    raceDurationSecs: number;
    pickWindowSecs: number;
    bufferSecs: number;
    totalRounds: number;
    startAt: Date | null;
    status: RaceDayStatus;
  },
  heatId: string,
  raceDayHorseByHorseId: Map<string, { id: string; horseId: string; archetype: RaceArchetype | null; temperament: Temperament | null; surfaceAffinity: SurfaceAffinity | null }>,
  raceDayHorseById: Map<string, { id: string; horseId: string; archetype: RaceArchetype | null; temperament: Temperament | null; surfaceAffinity: SurfaceAffinity | null }>
): Promise<void> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    const heat = await prisma.raceDayHeat.findUnique({ where: { id: heatId } });
    if (!heat) return;

    // Skip already finished or voided heats (for resume scenarios)
    if (heat.status === RaceDayHeatStatus.finished || heat.status === RaceDayHeatStatus.voided) {
      raceDayLogger.info({ heatId, status: heat.status }, "Skipping already completed heat");
      return;
    }

    const entrants = Array.isArray(heat.entrantsJson) ? (heat.entrantsJson as string[]) : [];
    if (entrants.length === 0) {
      throw new ValidationError("heat_no_entrants");
    }
    if (entrants.length !== HEAT_SIZE) {
      raceDayLogger.warn({ heatId, entrantCount: entrants.length, expected: HEAT_SIZE }, "Heat has unexpected entrant count");
    }

    const baseMetadata: HeatMetadata =
      typeof heat.metadataJson === "object" && heat.metadataJson !== null
        ? (heat.metadataJson as HeatMetadata)
        : {};
    let raceId = heat.raceId ?? null;
    let track = baseMetadata.trackId && baseMetadata.trackName
      ? {
          id: baseMetadata.trackId,
          name: baseMetadata.trackName,
          durationSecs: raceDay.raceDurationSecs
        }
      : null;
    let weather = baseMetadata.weatherId && baseMetadata.weatherName
      ? { id: baseMetadata.weatherId, name: baseMetadata.weatherName }
      : null;
    let runSecs = track?.durationSecs ?? raceDay.raceDurationSecs;
    let providerStrategy = (baseMetadata.providerStrategy as ProviderStrategy | undefined) ?? {
      mode: "random"
    };

    if (!raceId) {
      const created = await createHeatRace({
        raceDay,
        heatId,
        roundNumber: heat.roundNumber,
        entrants,
        raceDayHorseById
      });
      raceId = created.raceId;
      track = created.track;
      weather = created.weather;
      runSecs = created.runSecs;
      providerStrategy = created.providerStrategy;
    } else if (!track || !weather) {
      const race = await prisma.race.findUnique({
        where: { id: raceId },
        include: { track: true, weather: true }
      });
      if (race?.track) {
        track = { id: race.track.id, name: race.track.name, durationSecs: race.track.durationSecs };
        runSecs = race.track.durationSecs;
      }
      if (race?.weather) {
        weather = { id: race.weather.id, name: race.weather.name };
      }
    }

    if (!raceId || !track || !weather) {
      throw new ValidationError("missing_race_config");
    }

    const runPreflight = !baseMetadata.preflightCompleteAt;
    await applyProviderStrategy({
      raceId,
      strategy: providerStrategy,
      broadcast: false,
      runPreflight
    });
    const preflightCompleteAt =
      baseMetadata.preflightCompleteAt ?? (runPreflight ? new Date().toISOString() : undefined);

    const latestRaceDay = await prisma.raceDay.findUnique({
      where: { id: raceDay.id },
      select: { status: true, startAt: true }
    });
    const raceDayStartAt = latestRaceDay?.startAt ?? raceDay.startAt;
    const isFirstHeat = heat.roundNumber === 1 && heat.heatNumber === 1;
    const now = Date.now();

    let pickCloseAt: Date;
    let startAt: Date;
    let raceStatus: RaceStatus;
    let heatStatus: RaceDayHeatStatus;

    if (isFirstHeat) {
      pickCloseAt = raceDayStartAt ?? new Date(now + raceDay.pickWindowSecs * 1000);
      startAt = new Date(pickCloseAt.getTime() + PICK_CLOSE_DELAY_MS);
      raceStatus = RaceStatus.picking;
      heatStatus = RaceDayHeatStatus.picking;
    } else {
      pickCloseAt = new Date(now + raceDay.bufferSecs * 1000);
      startAt = new Date(pickCloseAt.getTime());
      raceStatus = RaceStatus.scheduled;
      heatStatus = RaceDayHeatStatus.scheduled;
    }

    const endAtFinal = new Date(startAt.getTime() + runSecs * 1000);

    await prisma.race.update({
      where: { id: raceId },
      data: { status: raceStatus, pickCloseAt, startAt, endAt: endAtFinal }
    });
    await prisma.raceDayHeat.update({
      where: { id: heatId },
      data: {
        status: heatStatus,
        raceId,
        startsAt: startAt,
        pickCloseAt,
        endsAt: endAtFinal,
        metadataJson: {
          ...baseMetadata,
          trackId: track.id,
          trackName: track.name,
          weatherId: weather.id,
          weatherName: weather.name,
          attempt,
          providerStrategy,
          ...(preflightCompleteAt ? { preflightCompleteAt } : {})
        } as Prisma.InputJsonValue
      }
    });

    const updatedRace = await getRaceWithRelations(raceId);
    if (updatedRace) {
      broadcastToRace(raceId, { type: "race_state", data: serializeRace(updatedRace) });
    }
    await broadcastRaceDayState(raceDay.id);

    broadcastToRaceDay(raceDay.id, {
      type: "heat_started",
      data: { raceDayId: raceDay.id, heatId, raceId }
    });

    const waitMs = Math.max(0, pickCloseAt.getTime() - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    const startDelayMs = Math.max(0, startAt.getTime() - Date.now());
    if (startDelayMs > 0) {
      await sleep(startDelayMs);
    }

    if (isFirstHeat) {
      await prisma.raceDay.update({
        where: { id: raceDay.id },
        data: { status: RaceDayStatus.running }
      });
      await broadcastRaceDayState(raceDay.id);
    }

    await prisma.race.update({
      where: { id: raceId },
      data: { status: RaceStatus.running, startAt, endAt: endAtFinal }
    });
    await prisma.raceDayHeat.update({
      where: { id: heatId },
      data: { status: RaceDayHeatStatus.running, startsAt: startAt, endsAt: endAtFinal }
    });
    await broadcastRaceDayState(raceDay.id);
    await startRaceEngine(raceId);

    const raceResult = await waitForRaceCompletion(raceId, runSecs + HEAT_TIMEOUT_BUFFER_SECS);
    if (!raceResult || raceResult.status === RaceStatus.voided) {
      await prisma.raceDayHeat.update({
        where: { id: heatId },
        data: {
          status: RaceDayHeatStatus.voided,
          metadataJson: {
            ...(typeof heat.metadataJson === "object" && heat.metadataJson !== null
              ? (heat.metadataJson as HeatMetadata)
              : {}),
            lastVoidAt: new Date().toISOString()
          } as Prisma.InputJsonValue
        }
      });
      await broadcastRaceDayState(raceDay.id);
      broadcastToRaceDay(raceDay.id, {
        type: "heat_voided",
        data: { raceDayId: raceDay.id, heatId, raceId }
      });
      continue;
    }

    await finalizeHeatResults({
      raceDayId: raceDay.id,
      heatId,
      raceId,
      roundNumber: heat.roundNumber,
      heatNumber: heat.heatNumber,
      isFinalRound: heat.roundNumber === raceDay.totalRounds,
      entrants,
      raceDayHorseByHorseId
    });
    await broadcastRaceDayState(raceDay.id);

    broadcastToRaceDay(raceDay.id, {
      type: "heat_finished",
      data: { raceDayId: raceDay.id, heatId, raceId }
    });

    // Broadcast next race state immediately so Lobby shows next race's horses during countdown
    await broadcastNextHeatRaceState(raceDay.id, heat.roundNumber, heat.heatNumber);

    return;
  }
}

async function createHeatRace(params: {
  raceDay: { id: string; tickMs: number; raceDurationSecs: number; pickWindowSecs: number };
  heatId: string;
  roundNumber: number;
  entrants: string[];
  raceDayHorseById: Map<
    string,
    { id: string; horseId: string; archetype: RaceArchetype | null; temperament: Temperament | null; surfaceAffinity: SurfaceAffinity | null }
  >;
}) {
  // Fetch heat record to get pre-assigned track from metadata
  const heat = await prisma.raceDayHeat.findUnique({ where: { id: params.heatId } });
  const heatMetadata = heat?.metadataJson as {
    trackId?: string;
    trackName?: string;
    trackSurface?: string;
    trackDurationSecs?: number;
  } | null;

  try {
    await refreshActiveSubscriberSnapshots();
  } catch (error) {
    raceDayLogger.warn({ err: error }, "Subscriber snapshot refresh failed before heat creation");
  }
  await refreshProvidersCache();

  const eligibleServiceTypeIds = await ensureServiceTypesFromSubscriber();
  const tracks = (await prisma.track.findMany()).filter(
    (track) => !track.id.includes("-rd-")
  );
  const weathers = await prisma.weather.findMany();
  const serviceTypes = eligibleServiceTypeIds.length
    ? await prisma.serviceType.findMany({ where: { id: { in: eligibleServiceTypeIds } } })
    : await prisma.serviceType.findMany();

  if (tracks.length === 0 || weathers.length === 0 || serviceTypes.length === 0) {
    throw new ValidationError("missing_race_config");
  }

  const providers = await prisma.provider.findMany({
    where: { serviceTypeId: { in: serviceTypes.map((entry) => entry.id) } }
  });
  const providerList = providerPool(providers);
  let providerStrategy: ProviderStrategy = { mode: "random" };
  let allowedServiceTypeIds: string[] | null = null;

  if (params.roundNumber === RANDOM_PROVIDER_ROUND) {
    const group = pickProviderGroup(providerList);
    if (group) {
      const serviceTypeIds = Array.from(
        new Set(group.providers.map((entry) => entry.serviceTypeId))
      );
      providerStrategy = {
        mode: "single_provider",
        providerPubkey: group.pubkey,
        providerMoniker: group.moniker,
        serviceTypeIds
      };
      allowedServiceTypeIds = serviceTypeIds;
    }
  } else if (params.roundNumber === FIXED_PROVIDER_ROUND) {
    const provider = providerList.length ? pickRandom(providerList) : null;
    if (provider) {
      providerStrategy = {
        mode: "single_provider_service",
        providerId: provider.id,
        providerPubkey: provider.providerPubkey,
        providerMoniker: provider.moniker ?? null,
        serviceTypeId: provider.serviceTypeId
      };
      allowedServiceTypeIds = [provider.serviceTypeId];
    }
  }

  const restrictedPool = allowedServiceTypeIds?.length
    ? serviceTypes.filter((entry) => allowedServiceTypeIds?.includes(entry.id))
    : serviceTypes;
  const serviceTypePool = restrictedPool.length > 0 ? restrictedPool : serviceTypes;
  if (restrictedPool.length === 0) {
    providerStrategy = { mode: "random" };
  }

  // Use pre-assigned track from heat metadata, or fall back to random
  const baseTrack = heatMetadata?.trackId
    ? tracks.find((t) => t.id === heatMetadata.trackId) ?? pickRandom(tracks)
    : pickRandom(tracks);
  const weather = pickRandom(weathers); // Weather is always random
  const trackId = baseTrack.id;
  const runSecs = baseTrack.durationSecs;

  const now = new Date();
  const placeholderPickCloseAt = new Date(now.getTime() + params.raceDay.pickWindowSecs * 1000 + PICK_CLOSE_DELAY_MS);
  const placeholderStartAt = new Date(placeholderPickCloseAt.getTime() + PICK_CLOSE_DELAY_MS);
  const placeholderEndAt = new Date(placeholderStartAt.getTime() + runSecs * 1000);

  const race = await prisma.race.create({
    data: {
      status: RaceStatus.scheduled,
      trackId,
      weatherId: weather.id,
      pickCloseAt: placeholderPickCloseAt,
      startAt: placeholderStartAt,
      endAt: placeholderEndAt,
      intakeCredits: 0,
      payoutBudgetCredits: 0
    }
  });

  await prisma.raceHorse.createMany({
    data: params.entrants.map((raceDayHorseId, index) => {
      const entry = params.raceDayHorseById.get(raceDayHorseId);
      if (!entry) {
        throw new NotFoundError("raceday_entrant_missing");
      }
      const horseId = entry.horseId;
      return {
        raceId: race.id,
        horseId,
        lane: index + 1,
        serviceTypeId: pickRandom(serviceTypePool).id,
        archetype: entry?.archetype ?? pickRandom(archetypes),
        temperament: entry?.temperament ?? pickRandom(temperaments),
        surfaceAffinity: entry?.surfaceAffinity ?? pickRandom(surfaceAffinities)
      };
    })
  });

  // Calculate and store odds for each horse based on track matchup + record
  await calculateRaceOdds(race.id);

  await prisma.raceDayHeat.update({
    where: { id: params.heatId },
    data: { raceId: race.id }
  });

  await prisma.raceEvent.create({
    data: {
      raceId: race.id,
      type: "raceday_heat_created",
      payloadJson: { raceId: race.id, raceDayId: params.raceDay.id, heatId: params.heatId }
    }
  });

  return {
    raceId: race.id,
    track: { id: trackId, name: baseTrack.name, durationSecs: baseTrack.durationSecs },
    weather: { id: weather.id, name: weather.name },
    runSecs,
    providerStrategy
  };
}

async function applyProviderStrategy(params: {
  raceId: string;
  strategy: ProviderStrategy | undefined;
  broadcast?: boolean;
  runPreflight?: boolean;
}) {
  const strategy = params.strategy ?? { mode: "random" };
  const broadcast = params.broadcast ?? true;
  const runPreflight = params.runPreflight ?? true;

  if (strategy.mode === "single_provider") {
    const raceHorses = await prisma.raceHorse.findMany({ where: { raceId: params.raceId } });
    const providers = await prisma.provider.findMany({
      where: { providerPubkey: strategy.providerPubkey }
    });
    const providersByService = new Map(
      providers.map((provider) => [provider.serviceTypeId, provider])
    );
    for (const entry of raceHorses) {
      const provider = providersByService.get(entry.serviceTypeId);
      if (!provider) continue;
      await prisma.raceHorse.update({
        where: { id: entry.id },
        data: { assignedProviderId: provider.id }
      });
    }
  } else if (strategy.mode === "single_provider_service") {
    await prisma.raceHorse.updateMany({
      where: { raceId: params.raceId },
      data: { assignedProviderId: strategy.providerId }
    });
  }

  await assignProviders(params.raceId, {
    assignOnlyMissing: true,
    runPreflight,
    broadcast,
    emitEvent: true
  });
}

async function waitForRaceCompletion(raceId: string, timeoutSecs: number) {
  const deadline = Date.now() + timeoutSecs * 1000;
  while (Date.now() < deadline) {
    const race = await prisma.race.findUnique({ where: { id: raceId } });
    if (!race) return null;
    if (race.status === RaceStatus.finished || race.status === RaceStatus.voided) {
      return race;
    }
    await sleep(HEAT_POLL_INTERVAL_MS);
  }
  await forceEndRace(raceId);
  return prisma.race.findUnique({ where: { id: raceId } });
}

async function finalizeHeatResults(params: {
  raceDayId: string;
  heatId: string;
  raceId: string;
  roundNumber: number;
  heatNumber: number;
  isFinalRound: boolean;
  entrants: string[];
  raceDayHorseByHorseId: Map<string, { id: string; horseId: string }>;
}) {
  const raceHorses = await prisma.raceHorse.findMany({
    where: { raceId: params.raceId }
  });
  const placements = raceHorses
    .filter((entry) => typeof entry.placement === "number")
    .sort((a, b) => (a.placement ?? UNKNOWN_PLACEMENT) - (b.placement ?? UNKNOWN_PLACEMENT));

  const results = placements.map((entry) => ({
    raceDayHorseId: params.raceDayHorseByHorseId.get(entry.horseId)?.id ?? entry.horseId,
    placement: entry.placement ?? 0
  }));

  const advancingHorses = placements.slice(0, ADVANCE_COUNT);
  const advancers = advancingHorses.map((entry) => {
    return params.raceDayHorseByHorseId.get(entry.horseId)?.id ?? entry.horseId;
  });

  // Increment 'advances' counter for horses that advance to next round
  if (!params.isFinalRound && advancingHorses.length > 0) {
    const advancingHorseIds = advancingHorses.map((entry) => entry.horseId);
    await prisma.horse.updateMany({
      where: { id: { in: advancingHorseIds } },
      data: { advances: { increment: 1 } }
    });
  }

  const advancedSet = new Set(advancers);
  const eliminatedIds = params.entrants.filter((id) => !advancedSet.has(id));

  if (eliminatedIds.length > 0) {
    await prisma.raceDayHorse.updateMany({
      where: { id: { in: eliminatedIds } },
      data: { eliminatedRound: params.roundNumber, eliminatedHeat: params.heatNumber }
    });
  }

  if (params.isFinalRound) {
    const podium = results.slice(0, PODIUM_COUNT);
    for (const entry of podium) {
      await prisma.raceDayHorse.update({
        where: { id: entry.raceDayHorseId },
        data: { finalPlacement: entry.placement }
      });
    }
    const nonPodium = params.entrants.filter(
      (id) => !podium.find((podiumEntry) => podiumEntry.raceDayHorseId === id)
    );
    if (nonPodium.length > 0) {
      await prisma.raceDayHorse.updateMany({
        where: { id: { in: nonPodium } },
        data: { eliminatedRound: params.roundNumber, eliminatedHeat: params.heatNumber }
      });
    }
  }

  await prisma.raceDayHeat.update({
    where: { id: params.heatId },
    data: {
      status: RaceDayHeatStatus.finished,
      advancersJson: advancers as Prisma.InputJsonValue,
      resultsJson: results as Prisma.InputJsonValue
    }
  });
}

async function collectRoundAdvancers(raceDayId: string, roundNumber: number): Promise<string[]> {
  const heats = await prisma.raceDayHeat.findMany({
    where: { raceDayId, roundNumber, status: RaceDayHeatStatus.finished },
    orderBy: { heatNumber: "asc" }
  });
  const advancers: string[] = [];
  for (const heat of heats) {
    const entries = Array.isArray(heat.advancersJson) ? (heat.advancersJson as string[]) : [];
    advancers.push(...entries);
  }
  return advancers;
}

async function seedNextRound(raceDayId: string, roundNumber: number, advancers: string[]) {
  const heats = await prisma.raceDayHeat.findMany({
    where: { raceDayId, roundNumber },
    orderBy: { heatNumber: "asc" }
  });
  const entrants = chunk(advancers, HEAT_SIZE);
  for (let i = 0; i < heats.length; i += 1) {
    await prisma.raceDayHeat.update({
      where: { id: heats[i].id },
      data: {
        entrantsJson: entrants[i] ?? [],
        status: RaceDayHeatStatus.scheduled
      }
    });
  }
}

export async function getRaceDayState(raceDayId: string): Promise<RaceDayState | null> {
  const raceDay = await prisma.raceDay.findUnique({
    where: { id: raceDayId },
    include: {
      rounds: { include: { heats: true } },
      horses: { include: { horse: true } }
    }
  });
  if (!raceDay) return null;

  const horseById = new Map<string, RaceDayHorseSummary>();
  for (const entry of raceDay.horses) {
    horseById.set(entry.id, {
      raceDayHorseId: entry.id,
      horseId: entry.horseId,
      displayName: entry.horse.displayName,
      seedOrder: entry.seedOrder,
      archetype: entry.archetype ?? null,
      temperament: entry.temperament ?? null,
      surfaceAffinity: entry.surfaceAffinity ?? null,
      eliminatedRound: entry.eliminatedRound ?? null,
      eliminatedHeat: entry.eliminatedHeat ?? null,
      finalPlacement: entry.finalPlacement ?? null
    });
  }

  const rounds: RaceDayRoundState[] = raceDay.rounds
    .sort((a, b) => a.roundNumber - b.roundNumber)
    .map((round) => ({
      roundId: round.id,
      roundNumber: round.roundNumber,
      status: round.status,
      heatsCount: round.heatsCount,
      startsAt: round.startsAt,
      endsAt: round.endsAt,
      heats: round.heats
        .sort((a, b) => a.heatNumber - b.heatNumber)
        .map((heat) => {
          const entrants = Array.isArray(heat.entrantsJson)
            ? (heat.entrantsJson as string[]).map((id) => horseById.get(id)).filter(Boolean)
            : [];
          const advancers = Array.isArray(heat.advancersJson)
            ? (heat.advancersJson as string[]).map((id) => horseById.get(id)).filter(Boolean)
            : [];
          const results = Array.isArray(heat.resultsJson)
            ? (heat.resultsJson as HeatResult[])
            : [];
          return {
            heatId: heat.id,
            roundNumber: heat.roundNumber,
            heatNumber: heat.heatNumber,
            status: heat.status,
            raceId: heat.raceId ?? null,
            startsAt: heat.startsAt ?? null,
            pickCloseAt: heat.pickCloseAt ?? null,
            endsAt: heat.endsAt ?? null,
            entrants: entrants as RaceDayHorseSummary[],
            advancers: advancers as RaceDayHorseSummary[],
            results,
            metadata: heat.metadataJson as HeatMetadata | null
          };
        })
    }));

  let currentRound: number | null = null;
  let currentHeat: number | null = null;
  const activeHeatStatuses: RaceDayHeatStatus[] = [
    RaceDayHeatStatus.picking,
    RaceDayHeatStatus.running
  ];
  for (const round of rounds) {
    const heat = round.heats.find((entry) => activeHeatStatuses.includes(entry.status));
    if (heat) {
      currentRound = round.roundNumber;
      currentHeat = heat.heatNumber;
      break;
    }
  }

  return {
    raceDayId: raceDay.id,
    name: raceDay.name,
    status: raceDay.status,
    createdAt: raceDay.createdAt,
    startAt: raceDay.startAt,
    tickMs: raceDay.tickMs,
    raceDurationSecs: raceDay.raceDurationSecs,
    pickWindowSecs: raceDay.pickWindowSecs,
    bufferSecs: raceDay.bufferSecs,
    totalRounds: raceDay.totalRounds,
    poolCredits: raceDay.poolCredits,
    heatsConfig: raceDay.heatsConfigJson as HeatsConfig | null,
    currentRound,
    currentHeat,
    rounds
  };
}

export async function getRaceDayHeatState(raceDayId: string, heatId: string) {
  const state = await getRaceDayState(raceDayId);
  if (!state) return null;
  for (const round of state.rounds) {
    const heat = round.heats.find((entry) => entry.heatId === heatId);
    if (heat) return heat;
  }
  return null;
}

export async function getLatestRaceDay(): Promise<RaceDayState | null> {
  const latest = await prisma.raceDay.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (!latest) return null;
  return getRaceDayState(latest.id);
}

async function broadcastRaceDayState(raceDayId: string) {
  const state = await getRaceDayState(raceDayId);
  if (!state) return;
  broadcastToRaceDay(raceDayId, { type: "raceday_state", data: state });
}

async function broadcastNextHeatRaceState(
  raceDayId: string,
  currentRound: number,
  currentHeat: number
): Promise<void> {
  // Find the next heat after the current one
  const raceDay = await prisma.raceDay.findUnique({
    where: { id: raceDayId },
    select: { totalRounds: true }
  });
  if (!raceDay) return;

  // Try next heat in same round first
  let nextHeat = await prisma.raceDayHeat.findFirst({
    where: {
      raceDayId,
      roundNumber: currentRound,
      heatNumber: currentHeat + 1
    }
  });

  // If no next heat in same round, try first heat of next round
  if (!nextHeat && currentRound < raceDay.totalRounds) {
    nextHeat = await prisma.raceDayHeat.findFirst({
      where: {
        raceDayId,
        roundNumber: currentRound + 1,
        heatNumber: 1
      }
    });
  }

  if (!nextHeat?.raceId) return;

  // Fetch and broadcast the next race state
  const race = await getRaceWithRelations(nextHeat.raceId);
  if (race) {
    const serialized = serializeRace(race);
    broadcastToRaceDay(raceDayId, { type: "next_race_state", data: serialized });
    broadcastToRace(nextHeat.raceId, { type: "race_state", data: serialized });
  }
}

async function persistRaceDayPayouts(raceDayId: string): Promise<void> {
  const raceDay = await prisma.raceDay.findUnique({
    where: { id: raceDayId },
    include: {
      horses: { include: { horse: true } },
      selections: {
        include: {
          user: true,
          raceDayHorse: { include: { horse: true } }
        }
      },
      rounds: true,
      heats: {
        where: { roundNumber: 1 },
        include: {
          race: {
            include: {
              raceHorses: true
            }
          }
        }
      }
    }
  });

  if (!raceDay) return;

  // Build a map of horseId -> opening odds from Round 1 races
  const horseOddsMap = new Map<string, number>();
  for (const heat of raceDay.heats) {
    if (heat.race?.raceHorses) {
      for (const raceHorse of heat.race.raceHorses) {
        // Use odds from Round 1 as the "opening odds" for payout calculations
        // Default to 1 (EVEN) if odds not set
        if (!horseOddsMap.has(raceHorse.horseId)) {
          horseOddsMap.set(raceHorse.horseId, raceHorse.odds ?? 1);
        }
      }
    }
  }

  // Helper to get odds for a raceDayHorse
  const getOdds = (raceDayHorse: { horse: { id: string } }): number => {
    return horseOddsMap.get(raceDayHorse.horse.id) ?? 1;
  };

  // Reward pool allocation (fractions of 9)
  const POOL_SIZE = raceDay.poolCredits;
  const ROUND_ALLOCATIONS: Record<number, number> = {
    2: 1 / 9,
    3: 2 / 9
  };
  const PLACEMENT_ALLOCATIONS: Record<number, number> = {
    1: 3 / 9,
    2: 2 / 9,
    3: 1 / 9
  };

  // Determine completed rounds
  const completedRounds = new Set(
    raceDay.rounds
      .filter((r) => r.status === "complete")
      .map((r) => r.roundNumber)
  );

  const advancedToRound = (eliminatedRound: number | null, round: number): boolean => {
    if (!completedRounds.has(round - 1)) return false;
    if (eliminatedRound === null) return true;
    return eliminatedRound >= round;
  };

  const isInWinningCircle = (finalPlacement: number | null): boolean => {
    return finalPlacement !== null && finalPlacement >= 1 && finalPlacement <= 3;
  };

  // Calculate total odds for each qualifying tier (for odds-weighted payout)
  // Formula: baseFactor = poolSlice / totalOdds, playerReward = baseFactor × playerOdds
  const oddsPerRound: Record<number, number> = { 2: 0, 3: 0 };
  const oddsPerPlacement: Record<number, number> = { 1: 0, 2: 0, 3: 0 };

  for (const selection of raceDay.selections) {
    const horse = selection.raceDayHorse;
    const odds = getOdds(horse);

    for (const round of [2, 3]) {
      if (advancedToRound(horse.eliminatedRound, round)) {
        oddsPerRound[round] += odds;
      }
    }
    if (isInWinningCircle(horse.finalPlacement)) {
      oddsPerPlacement[horse.finalPlacement!] += odds;
    }
  }

  // Calculate base factor (credits per odds point) for each tier
  const baseFactorPerRound: Record<number, number> = {};
  for (const round of [2, 3]) {
    const totalOdds = oddsPerRound[round];
    const poolSlice = POOL_SIZE * ROUND_ALLOCATIONS[round];
    baseFactorPerRound[round] = totalOdds > 0 ? poolSlice / totalOdds : 0;
  }
  const baseFactorPerPlacement: Record<number, number> = {};
  for (const placement of [1, 2, 3]) {
    const totalOdds = oddsPerPlacement[placement];
    const poolSlice = POOL_SIZE * PLACEMENT_ALLOCATIONS[placement];
    baseFactorPerPlacement[placement] = totalOdds > 0 ? poolSlice / totalOdds : 0;
  }

  // Build and persist payouts
  const payoutRows: Prisma.RaceDayPayoutCreateManyInput[] = [];

  for (const selection of raceDay.selections) {
    const horse = selection.raceDayHorse;
    const odds = getOdds(horse);
    let totalReward = 0;
    const roundRewards: Array<{ round: number | string; label: string; reward: number; odds: number }> = [];

    // Winning circle rewards (odds-weighted)
    if (isInWinningCircle(horse.finalPlacement)) {
      const placementLabels: Record<number, string> = { 1: "1st Place", 2: "2nd Place", 3: "3rd Place" };
      const baseFactor = baseFactorPerPlacement[horse.finalPlacement!];
      const reward = baseFactor * odds;
      roundRewards.push({
        round: "final",
        label: placementLabels[horse.finalPlacement!],
        reward,
        odds
      });
      totalReward += reward;
    }

    // Round advancement rewards (odds-weighted)
    for (const round of [3, 2]) {
      if (advancedToRound(horse.eliminatedRound, round)) {
        const baseFactor = baseFactorPerRound[round];
        const reward = baseFactor * odds;
        roundRewards.push({
          round,
          label: `Round ${round}`,
          reward,
          odds
        });
        totalReward += reward;
      }
    }

    if (totalReward > 0) {
      payoutRows.push({
        raceDayId,
        userId: selection.userId,
        raceDayHorseId: horse.id,
        horseDisplayName: horse.horse.displayName,
        totalReward,
        breakdownJson: { roundRewards, horseOdds: odds } as Prisma.InputJsonValue
      });
    }
  }

  if (payoutRows.length > 0) {
    await prisma.raceDayPayout.createMany({ data: payoutRows });
    raceDayLogger.info({ raceDayId, payoutCount: payoutRows.length }, "Persisted RaceDay payouts");

    // Send ARKEO rewards automatically if hot wallet is configured
    if (config.hotWalletEnabled) {
      await sendRaceDayRewards(raceDayId, raceDay.name);
    } else {
      raceDayLogger.warn({ raceDayId }, "Hot wallet not configured, skipping automatic reward distribution");
    }
  }
}

/**
 * Send ARKEO rewards to users after a raceday completes
 */
async function sendRaceDayRewards(raceDayId: string, raceDayName: string): Promise<void> {
  // Fetch payouts with user wallet addresses
  const payouts = await prisma.raceDayPayout.findMany({
    where: { raceDayId, paidAt: null },
    include: {
      user: {
        select: { id: true, walletAddress: true, nickname: true }
      }
    }
  });

  if (payouts.length === 0) {
    raceDayLogger.info({ raceDayId }, "No unpaid payouts to process");
    return;
  }

  // Group payouts by user
  const userPayoutMap = new Map<string, {
    walletAddress: string | null;
    nickname: string | null;
    totalReward: number;
    payoutIds: string[];
  }>();

  for (const payout of payouts) {
    const existing = userPayoutMap.get(payout.userId);
    if (existing) {
      existing.totalReward += payout.totalReward;
      existing.payoutIds.push(payout.id);
    } else {
      userPayoutMap.set(payout.userId, {
        walletAddress: payout.user.walletAddress,
        nickname: payout.user.nickname,
        totalReward: payout.totalReward,
        payoutIds: [payout.id]
      });
    }
  }

  // Safety check: verify total rewards don't exceed pool
  const raceDay = await prisma.raceDay.findUnique({
    where: { id: raceDayId },
    select: { poolCredits: true }
  });

  if (!raceDay) {
    raceDayLogger.error({ raceDayId }, "RaceDay not found for reward validation");
    return;
  }

  const totalRewards = payouts.reduce((sum, p) => sum + p.totalReward, 0);
  if (totalRewards > raceDay.poolCredits) {
    raceDayLogger.error(
      { raceDayId, totalRewards, poolCredits: raceDay.poolCredits },
      "SECURITY: Total rewards exceed pool! Aborting payout to prevent over-distribution."
    );
    return;
  }

  raceDayLogger.info(
    { raceDayId, totalRewards, poolCredits: raceDay.poolCredits, userCount: userPayoutMap.size },
    "Pool validation passed, proceeding with reward distribution"
  );

  const arkeoMultiplier = BigInt(10 ** config.arkeoDecimals);
  let paidCount = 0;
  let failedCount = 0;
  let noWalletCount = 0;

  for (const [userId, userPayout] of userPayoutMap) {
    // Skip if user has no wallet address
    if (!userPayout.walletAddress) {
      noWalletCount++;
      raceDayLogger.debug({ raceDayId, userId }, "User has no wallet address, skipping reward");
      continue;
    }

    // Convert ARKEO to uarkeo (multiply by 10^8)
    const amountUarkeo = BigInt(Math.floor(userPayout.totalReward * Number(arkeoMultiplier)));

    // Send ARKEO reward
    const sendResult = await sendArkeoReward({
      toAddress: userPayout.walletAddress,
      amountUarkeo,
      memo: `Arkeo Racing: ${raceDayName}`
    });

    if (sendResult.ok) {
      // Update all payout records for this user
      await prisma.raceDayPayout.updateMany({
        where: { id: { in: userPayout.payoutIds } },
        data: {
          paidAt: new Date(),
          txHash: sendResult.txHash
        }
      });
      paidCount++;
      raceDayLogger.info(
        { raceDayId, userId, walletAddress: userPayout.walletAddress, amount: userPayout.totalReward, txHash: sendResult.txHash },
        "Sent ARKEO reward"
      );
    } else {
      // Record the error
      await prisma.raceDayPayout.updateMany({
        where: { id: { in: userPayout.payoutIds } },
        data: { errorMessage: sendResult.error }
      });
      failedCount++;
      raceDayLogger.error(
        { raceDayId, userId, walletAddress: userPayout.walletAddress, error: sendResult.error },
        "Failed to send ARKEO reward"
      );
    }
  }

  raceDayLogger.info(
    { raceDayId, paid: paidCount, failed: failedCount, noWallet: noWalletCount },
    "Completed reward distribution"
  );
}
