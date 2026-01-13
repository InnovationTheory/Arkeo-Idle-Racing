import fs from "fs/promises";
import path from "path";
import { config } from "../config";

type ActiveServiceSnapshot = {
  active_services?: Array<ActiveServiceEntry>;
};

type ActiveServiceEntry = {
  metadata?: {
    config?: Record<string, unknown>;
  };
  provider_pubkey?: string;
};

type ActiveProvidersSnapshot = {
  providers?: Array<ActiveProviderEntry>;
};

type ActiveProviderEntry = {
  metadata?: {
    config?: Record<string, unknown>;
  };
  provider_pubkey?: string;
};

type ActiveServiceConfig = {
  provider_pubkey?: string;
  moniker?: string;
  location?: string;
  hub_provider_uri?: string;
  event_stream_host?: string;
  port?: string | number;
  services?: Array<{ id?: string | number; name?: string; type?: string; service_id?: string | number }>;
};

export type ProviderCandidate = {
  serviceTypeId: string;
  providerPubkey: string;
  moniker?: string;
  endpoint: string;
  region?: string;
  reliabilityScore: number;
};

async function readActiveServicesSnapshot(): Promise<ActiveServiceSnapshot | null> {
  const snapshotPath = path.resolve(process.cwd(), config.subscriberSnapshotDir, "active_services.json");
  try {
    const raw = await fs.readFile(snapshotPath, "utf8");
    return JSON.parse(raw) as ActiveServiceSnapshot;
  } catch {
    return null;
  }
}

async function readActiveProvidersSnapshot(): Promise<ActiveProvidersSnapshot | null> {
  const snapshotPath = path.resolve(process.cwd(), config.subscriberSnapshotDir, "active_providers.json");
  try {
    const raw = await fs.readFile(snapshotPath, "utf8");
    return JSON.parse(raw) as ActiveProvidersSnapshot;
  } catch {
    return null;
  }
}

function buildMonikerMap(snapshot: ActiveProvidersSnapshot | null): Map<string, string> {
  const map = new Map<string, string>();
  const providers = snapshot?.providers ?? [];
  for (const entry of providers) {
    const configBlock = (entry.metadata?.config ?? {}) as ActiveServiceConfig;
    const pubkey = configBlock.provider_pubkey ?? entry.provider_pubkey ?? "";
    const moniker = configBlock.moniker ?? "";
    if (!pubkey || !moniker) continue;
    map.set(pubkey, moniker);
  }
  return map;
}

function normalizeProviderCandidates(
  entry: ActiveServiceEntry,
  monikerMap: Map<string, string>
): ProviderCandidate[] {
  const configBlock = (entry.metadata?.config ?? {}) as ActiveServiceConfig;
  const providerPubkey =
    configBlock.provider_pubkey ?? entry.provider_pubkey ?? "";
  if (!providerPubkey) return [];

  const endpoint =
    configBlock.hub_provider_uri ??
    configBlock.event_stream_host ??
    (configBlock.port ? String(configBlock.port) : "") ??
    "";

  const region = configBlock.location ?? undefined;
  const moniker = configBlock.moniker ?? monikerMap.get(providerPubkey) ?? undefined;
  const services = Array.isArray(configBlock.services) ? configBlock.services : [];
  const results: ProviderCandidate[] = [];

  for (const service of services) {
    const serviceTypeId = String(
      service.id ?? service.service_id ?? service.name ?? service.type ?? ""
    );
    if (!serviceTypeId) continue;
    results.push({
      serviceTypeId,
      providerPubkey,
      moniker,
      endpoint,
      region,
      reliabilityScore: 0.9
    });
  }

  return results;
}

export async function loadProvidersFromActiveServices(): Promise<ProviderCandidate[]> {
  const snapshot = await readActiveServicesSnapshot();
  if (!snapshot?.active_services || !Array.isArray(snapshot.active_services)) {
    return [];
  }

  const monikerMap = buildMonikerMap(await readActiveProvidersSnapshot());
  const unique = new Map<string, ProviderCandidate>();
  for (const entry of snapshot.active_services) {
    for (const candidate of normalizeProviderCandidates(entry, monikerMap)) {
      const key = `${candidate.serviceTypeId}:${candidate.providerPubkey}`;
      if (!unique.has(key)) {
        unique.set(key, candidate);
      }
    }
  }

  return Array.from(unique.values());
}
