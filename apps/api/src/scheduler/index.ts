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

/**
 * Pick a provider with diversity weighting to spread horses across different providers
 * and avoid duplicate provider+serviceType combinations.
 *
 * Weighting factors:
 * - Base: reliability score squared (favors reliable providers)
 * - Penalty for providers already used in race (spreads across providers)
 * - Heavy penalty for exact provider+serviceType duplicates (avoids same combo)
 * - Bonus for providers not yet used (encourages trying all providers)
 */
function pickWeightedWithDiversity<T extends { id: string; providerPubkey: string; reliabilityScore: number }>(
  providers: T[],
  providerUsageCount: Map<string, number>,
  providerServiceComboCount: Map<string, number>,
  serviceTypeId: string
): T {
  const weights = providers.map((provider) => {
    const pubkey = provider.providerPubkey;
    const comboKey = `${pubkey}:${serviceTypeId}`;

    // Base weight from reliability (squared for stronger preference)
    let weight = Math.pow(Math.max(provider.reliabilityScore, 0.01), 2);

    // How many horses already on this provider?
    const providerCount = providerUsageCount.get(pubkey) ?? 0;
    // How many with this exact provider+serviceType combo?
    const comboCount = providerServiceComboCount.get(comboKey) ?? 0;

    // Bonus for unused providers (encourage diversity)
    if (providerCount === 0) {
      weight *= 3.0; // 3x bonus for providers not yet used in race
    } else {
      // Penalty for each horse already on this provider (diminishing returns)
      weight *= Math.pow(0.5, providerCount); // 50% reduction per existing horse
    }

    // Heavy penalty for duplicate provider+serviceType combos
    if (comboCount > 0) {
      weight *= Math.pow(0.2, comboCount); // 80% reduction per duplicate combo
    }

    return Math.max(weight, 0.001); // Ensure non-zero weight
  });

  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) {
    return providers[Math.floor(Math.random() * providers.length)];
  }

  let roll = Math.random() * total;
  for (let i = 0; i < providers.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return providers[i];
  }
  return providers[providers.length - 1];
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

  // Track failed providers during this preflight session to avoid retrying them
  const failedProviders = new Set<string>(); // "serviceTypeId:providerPubkey"

  const raceHorses = await prisma.raceHorse.findMany({
    where: { raceId },
    include: { serviceType: true, horse: true, assignedProvider: true }
  });

  for (const entry of raceHorses) {
    if (entry.eliminatedAtTick !== null) continue;

    // Try to find a working provider, with fallback to alternatives
    const result = await probeWithFallback({
      raceId,
      entry,
      failedProviders
    });

    if (!result.success) {
      await disqualifyHorse(raceId, entry.id, result.errorType ?? "listener_down");
    }
  }
}

type ProbeWithFallbackResult = {
  success: boolean;
  errorType: string | null;
};

async function probeWithFallback(params: {
  raceId: string;
  entry: {
    id: string;
    horseId: string;
    serviceTypeId: string;
    assignedProviderId: string | null;
    eliminatedAtTick: number | null;
    horse: { displayName: string };
    assignedProvider: { id: string; providerPubkey: string } | null;
  };
  failedProviders: Set<string>;
  attemptNumber?: number;
}): Promise<ProbeWithFallbackResult> {
  const { raceId, entry, failedProviders, attemptNumber = 1 } = params;
  const maxProviderAttempts = 3; // Try up to 3 different providers

  const service = await getSubscriberService(entry.serviceTypeId);
  if (!service) {
    schedulerLogger.warn(
      { raceId, raceHorseId: entry.id, horseName: entry.horse.displayName },
      "Preflight: listener missing"
    );
    // Record a synthetic poll so the error appears in Provider Statistics
    try {
      await prisma.raceHorsePoll.create({
        data: {
          raceId,
          raceHorseId: entry.id,
          providerId: entry.assignedProviderId ?? null,
          tick: null,
          prepAttempt: 1,
          phase: "prep",
          ts: new Date(),
          mode: config.racingMode,
          latencyMs: 0,
          errorType: "listener_missing",
          errorMessage: `Service ${entry.serviceTypeId} not found in subscriber`,
          probeOk: false,
          probeRequestJson: {}
        }
      });
    } catch (error) {
      schedulerLogger.warn({ err: error }, "Failed to record listener_missing poll");
    }
    return { success: false, errorType: "listener_missing" };
  }

  const currentProvider = entry.assignedProvider;
  const providerKey = currentProvider
    ? `${entry.serviceTypeId}:${currentProvider.providerPubkey}`
    : null;

  // Skip if this provider already failed in this session
  if (providerKey && failedProviders.has(providerKey)) {
    // Try to find alternative immediately
    const alternative = await findAlternativeProvider(entry.serviceTypeId, failedProviders);
    if (alternative && attemptNumber < maxProviderAttempts) {
      await reassignProvider(entry.id, alternative.id);
      // Refetch entry with new provider
      const updatedEntry = await prisma.raceHorse.findUnique({
        where: { id: entry.id },
        include: { horse: true, assignedProvider: true }
      });
      if (updatedEntry && updatedEntry.assignedProvider) {
        return probeWithFallback({
          raceId,
          entry: {
            ...updatedEntry,
            horse: updatedEntry.horse,
            assignedProvider: updatedEntry.assignedProvider
          },
          failedProviders,
          attemptNumber: attemptNumber + 1
        });
      }
    }
    // Record a synthetic poll so the error appears in Provider Statistics
    try {
      await prisma.raceHorsePoll.create({
        data: {
          raceId,
          raceHorseId: entry.id,
          providerId: entry.assignedProviderId ?? null,
          tick: null,
          prepAttempt: attemptNumber,
          phase: "prep",
          ts: new Date(),
          mode: config.racingMode,
          latencyMs: 0,
          errorType: "all_providers_failed",
          errorMessage: `All providers for service ${entry.serviceTypeId} have failed`,
          probeOk: false,
          probeRequestJson: {}
        }
      });
    } catch (error) {
      schedulerLogger.warn({ err: error }, "Failed to record all_providers_failed poll");
    }
    return { success: false, errorType: "all_providers_failed" };
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
      ? await probeListener({
          listenerPort: service.listener_port,
          healthMethod,
          healthPayload,
          providerPubkey: currentProvider?.providerPubkey,
          timeoutMs
        })
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
    { raceHorseId: entry.id, horseName: entry.horse.displayName, latencies, okCount, provider: currentProvider?.providerPubkey?.slice(-8) },
    "Preflight: latency probes complete"
  );

  // Persist probes
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

  // If provider completely failed (0 successes), mark as failed and try alternative
  if (okCount === 0 && providerKey) {
    failedProviders.add(providerKey);
    schedulerLogger.info(
      { raceHorseId: entry.id, horseName: entry.horse.displayName, provider: currentProvider?.providerPubkey?.slice(-8), serviceType: entry.serviceTypeId, errorType },
      "Preflight: provider failed, looking for alternative"
    );

    // First try another provider for the same service type
    const alternative = await findAlternativeProvider(entry.serviceTypeId, failedProviders);
    if (alternative && attemptNumber < maxProviderAttempts) {
      await reassignProvider(entry.id, alternative.id);
      schedulerLogger.info(
        { raceHorseId: entry.id, horseName: entry.horse.displayName, newProvider: alternative.providerPubkey.slice(-8) },
        "Preflight: reassigned to alternative provider"
      );

      // Refetch entry with new provider and retry
      const updatedEntry = await prisma.raceHorse.findUnique({
        where: { id: entry.id },
        include: { horse: true, assignedProvider: true }
      });
      if (updatedEntry && updatedEntry.assignedProvider) {
        return probeWithFallback({
          raceId,
          entry: {
            ...updatedEntry,
            horse: updatedEntry.horse,
            assignedProvider: updatedEntry.assignedProvider
          },
          failedProviders,
          attemptNumber: attemptNumber + 1
        });
      }
    }

    // No more providers for this service type - try a completely different service type
    schedulerLogger.info(
      { raceHorseId: entry.id, horseName: entry.horse.displayName, failedServiceType: entry.serviceTypeId },
      "Preflight: all providers failed for service type, looking for different service type"
    );

    const alternativeService = await findAlternativeServiceType(entry.serviceTypeId, failedProviders);
    if (alternativeService) {
      await reassignServiceTypeAndProvider(entry.id, alternativeService.serviceTypeId, alternativeService.providerId);
      schedulerLogger.info(
        { raceHorseId: entry.id, horseName: entry.horse.displayName, newServiceType: alternativeService.serviceTypeId, newProvider: alternativeService.providerPubkey.slice(-8) },
        "Preflight: reassigned to different service type"
      );

      // Refetch entry with new service type and provider, reset attempt counter
      const updatedEntry = await prisma.raceHorse.findUnique({
        where: { id: entry.id },
        include: { horse: true, assignedProvider: true }
      });
      if (updatedEntry && updatedEntry.assignedProvider) {
        return probeWithFallback({
          raceId,
          entry: {
            ...updatedEntry,
            horse: updatedEntry.horse,
            assignedProvider: updatedEntry.assignedProvider
          },
          failedProviders,
          attemptNumber: 1 // Reset attempt counter for new service type
        });
      }
    }

    return { success: false, errorType: errorType ?? "all_providers_failed" };
  }

  // Need at least 2 successful probes
  if (okCount < 2) {
    return { success: false, errorType };
  }

  return { success: true, errorType: null };
}

async function findAlternativeProvider(
  serviceTypeId: string,
  failedProviders: Set<string>
): Promise<{ id: string; providerPubkey: string } | null> {
  const providers = await prisma.provider.findMany({
    where: { serviceTypeId },
    orderBy: { reliabilityScore: "desc" }
  });

  for (const provider of providers) {
    const key = `${serviceTypeId}:${provider.providerPubkey}`;
    if (!failedProviders.has(key)) {
      return { id: provider.id, providerPubkey: provider.providerPubkey };
    }
  }

  return null;
}

/**
 * Find a completely different service type that has at least one provider
 * not in the failed list. Used when all providers for a service type have failed.
 */
async function findAlternativeServiceType(
  excludeServiceTypeId: string,
  failedProviders: Set<string>
): Promise<{ serviceTypeId: string; providerId: string; providerPubkey: string } | null> {
  // Get all service types except the failed one
  const serviceTypes = await prisma.serviceType.findMany({
    where: { id: { not: excludeServiceTypeId } }
  });

  // For each service type, check if there's at least one provider not in failed list
  for (const serviceType of serviceTypes) {
    const providers = await prisma.provider.findMany({
      where: { serviceTypeId: serviceType.id },
      orderBy: { reliabilityScore: "desc" }
    });

    for (const provider of providers) {
      const key = `${serviceType.id}:${provider.providerPubkey}`;
      if (!failedProviders.has(key)) {
        return {
          serviceTypeId: serviceType.id,
          providerId: provider.id,
          providerPubkey: provider.providerPubkey
        };
      }
    }
  }

  return null;
}

async function reassignProvider(raceHorseId: string, providerId: string): Promise<void> {
  await prisma.raceHorse.update({
    where: { id: raceHorseId },
    data: { assignedProviderId: providerId }
  });
}

async function reassignServiceTypeAndProvider(
  raceHorseId: string,
  serviceTypeId: string,
  providerId: string
): Promise<void> {
  await prisma.raceHorse.update({
    where: { id: raceHorseId },
    data: {
      serviceTypeId,
      assignedProviderId: providerId
    }
  });
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

  // Track provider usage for diversity weighting
  // Key: providerPubkey, Value: count of horses assigned to this provider
  const providerUsageCount = new Map<string, number>();
  // Key: "providerPubkey:serviceTypeId", Value: count (to avoid exact duplicates)
  const providerServiceComboCount = new Map<string, number>();

  // Initialize counts from already-assigned horses
  for (const entry of raceHorses) {
    if (entry.assignedProvider) {
      const pubkey = entry.assignedProvider.providerPubkey;
      providerUsageCount.set(pubkey, (providerUsageCount.get(pubkey) ?? 0) + 1);
      const comboKey = `${pubkey}:${entry.serviceTypeId}`;
      providerServiceComboCount.set(comboKey, (providerServiceComboCount.get(comboKey) ?? 0) + 1);
    }
  }

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
        ? pickWeightedWithDiversity(list, providerUsageCount, providerServiceComboCount, entry.serviceTypeId)
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

      // Update usage counts for diversity tracking
      const pubkey = provider.providerPubkey;
      providerUsageCount.set(pubkey, (providerUsageCount.get(pubkey) ?? 0) + 1);
      const comboKey = `${pubkey}:${entry.serviceTypeId}`;
      providerServiceComboCount.set(comboKey, (providerServiceComboCount.get(comboKey) ?? 0) + 1);
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
        runPreflight: true,
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
    runPreflight: true,
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
