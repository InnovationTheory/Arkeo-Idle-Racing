import fs from "fs/promises";
import path from "path";
import { config } from "../config";

export type NormalizedService = {
  service_id: string;
  name: string;
  service_type: string;
  listener_port: number;
  is_active: boolean;
  health_method: string;
  health_payload: string;
  metadata: Record<string, unknown>;
};

type CacheEntry = {
  expiresAt: number;
  services: NormalizedService[];
};

let cache: CacheEntry | null = null;

const fallbackServices: NormalizedService[] = [
  {
    service_id: "ethereum-mainnet",
    name: "Ethereum Mainnet",
    service_type: "ethereum_jsonrpc",
    listener_port: 0,
    is_active: true,
    health_method: "POST",
    health_payload: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}',
    metadata: { iconKey: "eth", colorHex: "#627EEA", protocol: "jsonrpc" }
  },
  {
    service_id: "osmosis-1",
    name: "Osmosis",
    service_type: "cosmos_rpc",
    listener_port: 0,
    is_active: true,
    health_method: "POST",
    health_payload: '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}',
    metadata: { iconKey: "osmo", colorHex: "#4E7FFF", protocol: "rpc" }
  },
  {
    service_id: "arkeo-mainnet",
    name: "Arkeo",
    service_type: "cosmos_rpc",
    listener_port: 0,
    is_active: true,
    health_method: "POST",
    health_payload: '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}',
    metadata: { iconKey: "arkeo", colorHex: "#F97316", protocol: "rpc" }
  }
];

type ListenerSnapshot = {
  listeners?: Array<Record<string, unknown>>;
};

function normalizeListener(listener: Record<string, unknown>): NormalizedService {
  const rawServiceId =
    (listener.service_id as string) ||
    (listener.serviceId as string) ||
    (listener.service_name as string) ||
    "unknown";

  const name =
    (listener.service_name as string) ||
    (listener.serviceName as string) ||
    (listener.service_description as string) ||
    String(rawServiceId);

  const description =
    (listener.service_description as string) ||
    (listener.serviceDescription as string) ||
    "";

  const serviceId = String(rawServiceId || name);
  const listenerPort = Number(listener.port ?? listener.listener_port ?? 0);
  const status = String(listener.status ?? "").toLowerCase();
  const isActive = status ? status === "active" : true;
  const serviceType = deriveProbeType({ name, description });

  const healthMethod = String(listener.health_method ?? "POST");
  const healthPayload = String(listener.health_payload ?? "");

  const metadata = {
    service_name: name,
    description,
    provider_pubkey: listener.provider_pubkey ?? listener.providerPubkey,
    provider_moniker: listener.provider_moniker ?? listener.providerMoniker,
    status
  } as Record<string, unknown>;

  return {
    service_id: serviceId,
    name,
    service_type: serviceType,
    listener_port: listenerPort,
    is_active: isActive,
    health_method: healthMethod,
    health_payload: healthPayload,
    metadata
  };
}

async function readListenersSnapshot(): Promise<NormalizedService[] | null> {
  const snapshotPath = path.resolve(process.cwd(), config.subscriberSnapshotDir, "listeners.json");
  try {
    const raw = await fs.readFile(snapshotPath, "utf8");
    const payload = JSON.parse(raw) as ListenerSnapshot;
    const listeners = Array.isArray(payload.listeners) ? payload.listeners : [];
    if (listeners.length === 0) return null;
    return listeners.map((listener) => normalizeListener(listener));
  } catch {
    return null;
  }
}

const EVM_KEYWORDS = ["eth", "ethereum", "sepolia", "holesky", "base", "op", "optimism", "arbitrum", "arb"];
const REST_KEYWORDS = ["rest", "lcd"];

function deriveProbeType(params: { protocol?: string; name?: string; description?: string }): string {
  const protocol = (params.protocol ?? "").toLowerCase();
  if (protocol === "jsonrpc") return "ethereum_jsonrpc";
  if (protocol === "rest") return "cosmos_rest";
  if (protocol === "rpc") return "cosmos_rpc";

  const name = `${params.name ?? ""} ${params.description ?? ""}`.toLowerCase();
  if (REST_KEYWORDS.some((keyword) => name.includes(keyword))) return "cosmos_rest";
  if (EVM_KEYWORDS.some((keyword) => name.includes(keyword))) return "ethereum_jsonrpc";
  return "cosmos_rpc";
}

function defaultHealthPayload(serviceType: string): { method: string; payload: string } {
  switch (serviceType) {
    case "ethereum_jsonrpc":
      return { method: "POST", payload: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' };
    case "cosmos_rest":
      return { method: "GET", payload: "/cosmos/base/tendermint/v1beta1/node_info" };
    case "cosmos_rpc":
    default:
      return { method: "POST", payload: '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}' };
  }
}

function normalizeService(service: Record<string, unknown>): NormalizedService {
  const rawServiceId =
    (service.service_id as string) ||
    (service.id as string) ||
    (service.serviceId as string) ||
    "unknown";

  const name =
    (service.name as string) ||
    (service.display_name as string) ||
    (service.displayName as string) ||
    String(rawServiceId);

  const serviceId = String(rawServiceId || name);

  const rawServiceType =
    (service.service_type as string) ||
    (service.serviceType as string) ||
    "";

  const protocol =
    (service.protocol as string) ||
    (service.metadata as Record<string, unknown>)?.protocol as string ||
    "";

  const description =
    (service.description as string) ||
    (service.service_description as string) ||
    (service.display_description as string) ||
    "";

  const serviceType = deriveProbeType({ protocol, name, description });

  const listenerPort =
    Number(service.listener_port ?? service.listenerPort ?? 0);

  const isActive =
    Boolean(service.is_active ?? service.isActive ?? true);

  const healthDefaults = defaultHealthPayload(serviceType);
  const healthMethod = String(service.health_method ?? healthDefaults.method);
  const healthPayload = String(service.health_payload ?? healthDefaults.payload);

  const metadata = { ...((service.metadata as Record<string, unknown>) || {}) };
  if (rawServiceType) metadata.rawServiceType = rawServiceType;
  if (description) metadata.description = description;
  if (protocol) metadata.protocol = protocol;

  return {
    service_id: serviceId,
    name,
    service_type: serviceType,
    listener_port: listenerPort,
    is_active: isActive,
    health_method: healthMethod,
    health_payload: healthPayload,
    metadata
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function fetchSubscriberServices(): Promise<NormalizedService[]> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.services;
  }

  const snapshotServices = await readListenersSnapshot();
  if (snapshotServices && snapshotServices.length > 0) {
    cache = {
      expiresAt: Date.now() + config.subscriberDiscoveryTtlSecs * 1000,
      services: snapshotServices
    };
    return snapshotServices;
  }

  const url = new URL(config.subscriberServicesPath, config.subscriberBaseUrl);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url.toString(), 5000);
      if (!response.ok) {
        throw new Error(`subscriber status ${response.status}`);
      }
      const body = await response.json();
      const rawList = Array.isArray(body) ? body : (body.services as unknown[] | undefined) ?? [];
      const normalized = rawList
        .map((service) => normalizeService(service as Record<string, unknown>))
        .filter((service) => {
          const rawType = String(service.metadata.rawServiceType ?? "").toLowerCase();
          return service.is_active && (rawType ? rawType === "blockchain" : true);
        })
        .filter((service) =>
          ["ethereum_jsonrpc", "cosmos_rpc", "cosmos_rest"].includes(service.service_type)
        );

      cache = {
        expiresAt: Date.now() + config.subscriberDiscoveryTtlSecs * 1000,
        services: normalized
      };
      return normalized;
    } catch (error) {
      lastError = error;
    }
  }

  cache = {
    expiresAt: Date.now() + config.subscriberDiscoveryTtlSecs * 1000,
    services: fallbackServices
  };

  if (lastError) {
    return fallbackServices;
  }

  return fallbackServices;
}

export async function getSubscriberService(
  serviceId: string
): Promise<NormalizedService | undefined> {
  const services = await fetchSubscriberServices();
  return services.find((service) => service.service_id === serviceId);
}
