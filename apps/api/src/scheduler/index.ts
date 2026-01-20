import { ProbeType, RaceStatus, Prisma, RaceArchetype, Temperament, SurfaceAffinity } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { fetchSubscriberServices, getSubscriberService } from "../subscriber/discovery";
import { refreshActiveSubscriberSnapshots } from "../subscriber/activeSnapshot";
import { loadProvidersFromActiveServices } from "../subscriber/activeServices";
import { JsonValue, probeListener, probeSubscriberApi } from "../subscriber/probe";
import { startRaceEngine, forceEndRace, voidRaceById, isRaceRunning } from "../race/engine";
import { getRaceWithRelations } from "../race/queries";
import { serializeRace } from "../race/serialize";
import { broadcastToRace } from "../ws";
import { startLeaderElection, stopLeaderElection } from "./leader";
import { schedulerLogger } from "../logger";
import { postSystemChatMessage } from "../chat/system";

let schedulerInterval: NodeJS.Timeout | null = null;
let transitionInterval: NodeJS.Timeout | null = null;
let bootResetDone = false;

async function resetRacesOnBoot(): Promise<void> {
  if (!config.resetRaceOnBoot || bootResetDone) return;
  try {
    const active = await prisma.race.findMany({
      where: { status: { in: [RaceStatus.scheduled, RaceStatus.picking, RaceStatus.running] } },
      select: { id: true }
    });

    for (const race of active) {
      await voidRaceById(race.id, "boot_reset");
    }

    bootResetDone = true;
  } catch (error) {
    schedulerLogger.error({ err: error }, "Boot reset failed");
  }
}

function iconKeyForService(name: string): string {
  const value = name.toLowerCase();
  if (value.includes("eth") || value.includes("ethereum") || value.includes("base")) return "eth";
  if (value.includes("osmosis")) return "osmo";
  if (value.includes("arkeo")) return "arkeo";
  if (value.includes("bitcoin") || value.includes("btc")) return "btc";
  return "";
}

function pickRandom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function pickMany<T>(list: T[], count: number): T[] {
  const copy = [...list];
  const result: T[] = [];
  while (copy.length > 0 && result.length < count) {
    const index = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(index, 1)[0]);
  }
  return result;
}

function pickWeighted<T>(list: T[], weightFn: (item: T) => number): T {
  const weights = list.map((item) => Math.max(0, weightFn(item)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return list[Math.floor(Math.random() * list.length)];
  }
  let roll = Math.random() * total;
  for (let i = 0; i < list.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return list[i];
  }
  return list[list.length - 1];
}

const archetypes: RaceArchetype[] = [
  "front_runner",
  "stalker",
  "stretch_runner",
  "grinder",
  "burst",
  "erratic"
];

const temperaments: Temperament[] = ["calm", "normal", "volatile"];
const surfaceAffinities: SurfaceAffinity[] = ["dirt_specialist", "turf_specialist", "mud_lover", "all_surface"];

function pickArchetype(): RaceArchetype {
  return pickRandom(archetypes);
}

function pickTemperament(): Temperament {
  return pickRandom(temperaments);
}

function pickSurfaceAffinity(): SurfaceAffinity {
  return pickRandom(surfaceAffinities);
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

async function refreshProvidersFromActiveServices(): Promise<void> {
  const candidates = await loadProvidersFromActiveServices();
  if (candidates.length === 0) return;

  const uniqueServiceTypeIds = Array.from(new Set(candidates.map((entry) => entry.serviceTypeId)));
  const serviceTypes = await prisma.serviceType.findMany({
    where: { id: { in: uniqueServiceTypeIds } },
    select: { id: true }
  });
  const allowedServiceTypes = new Set(serviceTypes.map((entry) => entry.id));

  for (const candidate of candidates) {
    if (!allowedServiceTypes.has(candidate.serviceTypeId)) continue;
    const updateData: Prisma.ProviderUpdateInput = {
      endpoint: candidate.endpoint || "unknown",
      region: candidate.region ?? null,
      reliabilityScore: candidate.reliabilityScore
    };
    if (candidate.moniker) {
      updateData.moniker = candidate.moniker;
    }
    await prisma.provider.upsert({
      where: {
        serviceTypeId_providerPubkey: {
          serviceTypeId: candidate.serviceTypeId,
          providerPubkey: candidate.providerPubkey
        }
      },
      update: updateData,
      create: {
        serviceTypeId: candidate.serviceTypeId,
        providerPubkey: candidate.providerPubkey,
        moniker: candidate.moniker ?? null,
        endpoint: candidate.endpoint || "unknown",
        region: candidate.region ?? null,
        reliabilityScore: candidate.reliabilityScore
      }
    });
  }
}

export async function refreshProvidersCache(): Promise<void> {
  await refreshProvidersFromActiveServices();
}

async function preflightAssignedHorses(raceId: string): Promise<void> {
  if (config.racingMode !== "live") return;

  const raceHorses = await prisma.raceHorse.findMany({
    where: { raceId },
    include: { serviceType: true, horse: true }
  });

  for (const entry of raceHorses) {
    if (entry.eliminatedAtTick !== null) continue;
    const service = await getSubscriberService(entry.serviceTypeId);
    if (!service) {
      schedulerLogger.warn(
        { raceId, raceHorseId: entry.id, horseName: entry.horse.displayName },
        "Preflight: listener missing"
      );
      await disqualifyHorse(raceId, entry.id, "listener_missing");
      continue;
    }

    const healthMethod = service.health_method ?? "POST";
    const healthPayload = service.health_payload ?? '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}';
    const latencies: number[] = [];
    const probes: Array<{
      attempt: number;
      ok: boolean;
      latencyMs: number;
      errorType: string | null;
      errorMessage: string | null;
      request: {
        url: string;
        method: string;
        payload?: JsonValue;
      };
      ts: string;
    }> = [];
    let okCount = 0;
    let errorType: string | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      // First two preflight attempts use longer timeout for contract initialization
      const timeoutMs = attempt <= 1 ? config.firstPollTimeoutMs : config.pollTimeoutMs;
      const probe = service.listener_port
        ? await probeListener({ listenerPort: service.listener_port, healthMethod, healthPayload, timeoutMs })
        : await probeSubscriberApi({ serviceId: entry.serviceTypeId, healthMethod, healthPayload, timeoutMs });

      const latencyMs = Math.round(probe.latencyMs);
      if (attempt > 0) {
        latencies.push(latencyMs);
        probes.push({
          attempt: attempt + 1,
          ok: probe.ok,
          latencyMs,
          errorType: probe.errorType ?? null,
          errorMessage: probe.errorMessage ?? null,
          request: probe.request,
          ts: new Date().toISOString()
        });
        if (probe.ok) {
          okCount += 1;
        } else if (!errorType) {
          errorType = probe.errorType ?? "listener_down";
        }
      }
    }

    schedulerLogger.debug(
      { raceHorseId: entry.id, horseName: entry.horse.displayName, latencies },
      "Preflight: latency probes complete"
    );

    if (probes.length > 0) {
      try {
        await prisma.raceHorsePoll.createMany({
          data: probes.map((probe) => ({
            raceId,
            raceHorseId: entry.id,
            providerId: entry.assignedProviderId ?? null,
            tick: null,
            prepAttempt: probe.attempt,
            phase: "prep",
            ts: new Date(probe.ts),
            mode: config.racingMode,
            latencyMs: probe.latencyMs,
            errorType: probe.errorType ?? null,
            errorMessage: probe.errorMessage ?? null,
            probeOk: probe.ok,
            probeRequestJson: {
              url: probe.request.url,
              method: probe.request.method,
              payload:
                probe.request.payload === undefined
                  ? null
                  : (probe.request.payload as Prisma.InputJsonValue)
            }
          }))
        });
      } catch (error) {
        schedulerLogger.warn({ err: error, raceId, raceHorseId: entry.id }, "Failed to persist preflight probes");
      }
    }

    if (okCount < 2) {
      await disqualifyHorse(raceId, entry.id, errorType ?? "listener_down");
      continue;
    }
  }
}

async function disqualifyHorse(
  raceId: string,
  raceHorseId: string,
  errorType: string
): Promise<void> {
  await prisma.raceHorse.update({
    where: { id: raceHorseId },
    data: { eliminatedAtTick: -1 }
  });

  await prisma.raceEvent.create({
    data: {
      raceId,
      type: "horse_disqualified",
      payloadJson: { raceId, raceHorseId, reason: "dns", errorType }
    }
  });

  broadcastToRace(raceId, {
    type: "event",
    data: { eventType: "horse_disqualified", raceHorseId, reason: "dns", errorType }
  });
}

async function createRace(): Promise<string | null> {
  try {
    await refreshActiveSubscriberSnapshots();
  } catch (error) {
    schedulerLogger.warn({ err: error }, "Subscriber snapshot refresh failed before race creation");
  }
  const eligibleServiceTypeIds = await ensureServiceTypesFromSubscriber();

  const tracks = await prisma.track.findMany();
  const weathers = await prisma.weather.findMany();
  const horses = await prisma.horse.findMany();
  const serviceTypes = eligibleServiceTypeIds.length
    ? await prisma.serviceType.findMany({ where: { id: { in: eligibleServiceTypeIds } } })
    : await prisma.serviceType.findMany();

  if (tracks.length === 0 || weathers.length === 0 || horses.length === 0 || serviceTypes.length === 0) {
    return null;
  }

  const track = pickRandom(tracks);
  const weather = pickRandom(weathers);
  const selectedHorses = pickMany(horses, config.horsesPerRace);

  const now = Date.now();
  const placeholderPickCloseAt = new Date(now + config.pickWindowSecs * 1000 + 5000);
  const placeholderStartAt = new Date(placeholderPickCloseAt.getTime() + 5000);
  const placeholderEndAt = new Date(
    placeholderStartAt.getTime() + track.durationSecs * 1000
  );

  const race = await prisma.race.create({
    data: {
      status: RaceStatus.scheduled,
      trackId: track.id,
      weatherId: weather.id,
      pickCloseAt: placeholderPickCloseAt,
      startAt: placeholderStartAt,
      endAt: placeholderEndAt,
      intakeCredits: 0,
      payoutBudgetCredits: 0
    }
  });

  await prisma.raceHorse.createMany({
    data: selectedHorses.map((horse) => ({
      raceId: race.id,
      horseId: horse.id,
      serviceTypeId: pickRandom(serviceTypes).id,
      archetype: pickArchetype(),
      temperament: pickTemperament(),
      surfaceAffinity: pickSurfaceAffinity()
    }))
  });

  await prisma.raceEvent.create({
    data: {
      raceId: race.id,
      type: "race_created",
      payloadJson: { raceId: race.id }
    }
  });

  try {
    await assignProviders(race.id, {
      assignOnlyMissing: true,
      runPreflight: true,
      broadcast: false,
      emitEvent: false
    });
  } catch (error) {
    schedulerLogger.warn({ err: error, raceId: race.id }, "Provider assignment failed");
  }

  const bettingStart = Date.now();
  const pickCloseAt = new Date(bettingStart + config.pickWindowSecs * 1000);
  const startAt = new Date(pickCloseAt.getTime() + 5000);
  const endAt = new Date(startAt.getTime() + track.durationSecs * 1000);

  await prisma.race.update({
    where: { id: race.id },
    data: { status: RaceStatus.picking, pickCloseAt, startAt, endAt }
  });

  const updated = await getRaceWithRelations(race.id);
  if (updated) {
    broadcastToRace(race.id, { type: "race_state", data: serializeRace(updated) });
  }

  return race.id;
}

type AssignProvidersOptions = {
  assignOnlyMissing?: boolean;
  broadcast?: boolean;
  runPreflight?: boolean;
  emitEvent?: boolean;
};

export async function assignProviders(
  raceId: string,
  options: AssignProvidersOptions = {}
): Promise<void> {
  const {
    assignOnlyMissing = false,
    broadcast = true,
    runPreflight = true,
    emitEvent = broadcast
  } = options;
  await refreshProvidersFromActiveServices();
  const raceHorses = await prisma.raceHorse.findMany({
    where: { raceId },
    include: { assignedProvider: true }
  });
  if (raceHorses.length === 0) return;

  const serviceTypeIds = Array.from(new Set(raceHorses.map((entry) => entry.serviceTypeId)));
  const providers = await prisma.provider.findMany({
    where: { serviceTypeId: { in: serviceTypeIds } }
  });
  const providersByService = new Map<string, typeof providers>();
  for (const provider of providers) {
    const list = providersByService.get(provider.serviceTypeId) ?? [];
    list.push(provider);
    providersByService.set(provider.serviceTypeId, list);
  }

  const simProviders = new Map<string, typeof providers[number]>();

  const assignments: Array<{
    raceHorseId: string;
    horseId: string;
    serviceTypeId: string;
    providerId: string;
    providerPubkey: string;
    moniker: string | null;
    endpoint: string;
    reliabilityScore: number;
  }> = [];

  for (const entry of raceHorses) {
    const list = providersByService.get(entry.serviceTypeId) ?? [];
    const hasAssignedId = Boolean(entry.assignedProviderId);
    let provider = entry.assignedProvider ?? null;
    const shouldAssign = !assignOnlyMissing || !hasAssignedId || !provider;

    if (shouldAssign) {
      provider = list.length
        ? pickWeighted(list, (item) => Math.pow(Math.max(item.reliabilityScore, 0.01), 2))
        : simProviders.get(entry.serviceTypeId) ?? null;

      if (!provider) {
        const simPubkey = `sim-${entry.serviceTypeId}`;
        provider = await prisma.provider.upsert({
          where: {
            serviceTypeId_providerPubkey: {
              serviceTypeId: entry.serviceTypeId,
              providerPubkey: simPubkey
            }
          },
          update: { reliabilityScore: 0.9, moniker: `Sim ${entry.serviceTypeId}` },
          create: {
            serviceTypeId: entry.serviceTypeId,
            providerPubkey: simPubkey,
            moniker: `Sim ${entry.serviceTypeId}`,
            endpoint: "sim",
            reliabilityScore: 0.9
          }
        });
        simProviders.set(entry.serviceTypeId, provider);
      }

      await prisma.raceHorse.update({
        where: { id: entry.id },
        data: { assignedProviderId: provider.id }
      });
    } else if (!provider && entry.assignedProviderId) {
      provider = await prisma.provider.findUnique({ where: { id: entry.assignedProviderId } });
    }

    if (!provider) {
      continue;
    }

    assignments.push({
      raceHorseId: entry.id,
      horseId: entry.horseId,
      serviceTypeId: entry.serviceTypeId,
      providerId: provider.id,
      providerPubkey: provider.providerPubkey,
      moniker: provider.moniker ?? null,
      endpoint: provider.endpoint,
      reliabilityScore: provider.reliabilityScore
    });
  }

  if (emitEvent) {
    await prisma.raceEvent.create({
      data: {
        raceId,
        type: "providers_assigned",
        payloadJson: { raceId, assignments }
      }
    });
  }

  if (runPreflight) {
    await preflightAssignedHorses(raceId);
  }

  if (broadcast) {
    const race = await getRaceWithRelations(raceId);
    if (race) {
      broadcastToRace(raceId, { type: "race_state", data: serializeRace(race) });
    }
  }

  schedulerLogger.info({ raceId, assignmentCount: assignments.length }, "Providers assigned");

  if (emitEvent) {
    broadcastToRace(raceId, {
      type: "event",
      data: { eventType: "provider_assigned", raceId, assignments }
    });
  }
}

async function checkTransitions(): Promise<void> {
  const now = new Date();
  const races = await prisma.race.findMany({
    where: { status: { in: [RaceStatus.picking, RaceStatus.running] }, raceDayHeat: null },
    include: { track: true }
  });

  for (const race of races) {
    if (
      race.status === RaceStatus.picking &&
      now.getTime() > race.pickCloseAt.getTime() + config.voidStartGraceSecs * 1000
    ) {
      await voidRaceById(race.id, "start_missed");
      continue;
    }

    if (race.status === RaceStatus.picking && now >= race.pickCloseAt) {
      await assignProviders(race.id, {
        assignOnlyMissing: true,
        runPreflight: false,
        broadcast: true,
        emitEvent: true
      });
      if (now >= race.startAt) {
        await prisma.race.update({
          where: { id: race.id },
          data: {
            status: RaceStatus.running,
            startAt: race.startAt,
            endAt: new Date(race.startAt.getTime() + race.track.durationSecs * 1000)
          }
        });
        await startRaceEngine(race.id);
        postSystemChatMessage(`🏇 Race started! Good luck to all riders!`).catch(() => {});
      }
    }

    if (race.status === RaceStatus.running) {
      if (!isRaceRunning(race.id) && now < race.endAt) {
        await startRaceEngine(race.id);
      }
      if (now >= race.endAt) {
        await forceEndRace(race.id);
      }
    }
  }
}

async function ensureNextRace(): Promise<void> {
  const active = await prisma.race.findFirst({
    where: { status: { in: [RaceStatus.scheduled, RaceStatus.picking, RaceStatus.running] } },
    orderBy: { startAt: "asc" }
  });

  if (active) return;
  await createRace();
}

export async function createRaceNow(): Promise<string | null> {
  return createRace();
}

export async function forceStartRace(raceId: string): Promise<void> {
  const race = await prisma.race.findUnique({ where: { id: raceId }, include: { track: true } });
  if (!race) return;
  if (race.status === RaceStatus.running) return;

  await assignProviders(raceId, {
    assignOnlyMissing: true,
    runPreflight: false,
    broadcast: true,
    emitEvent: true
  });
  const now = new Date();
  await prisma.race.update({
    where: { id: raceId },
    data: { status: RaceStatus.running, startAt: now, endAt: new Date(now.getTime() + race.track.durationSecs * 1000) }
  });
  await startRaceEngine(raceId);
}

export async function forceEndRaceNow(raceId: string): Promise<void> {
  await forceEndRace(raceId);
}

export async function initScheduler(): Promise<void> {
  await startLeaderElection({
    onLeader: async () => {
      if (schedulerInterval || transitionInterval) return;
      await resetRacesOnBoot();
      await ensureNextRace();
      await checkTransitions();
      schedulerInterval = setInterval(ensureNextRace, config.raceIntervalSecs * 1000);
      transitionInterval = setInterval(checkTransitions, 1000);
    },
    onFollower: async () => {
      stopSchedulerLoops();
    }
  });
}

export async function stopScheduler(): Promise<void> {
  stopSchedulerLoops();
  await stopLeaderElection();
}

function stopSchedulerLoops(): void {
  if (schedulerInterval) clearInterval(schedulerInterval);
  if (transitionInterval) clearInterval(transitionInterval);
  schedulerInterval = null;
  transitionInterval = null;
}
