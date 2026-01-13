import fs from "fs/promises";
import path from "path";
import { config } from "../config";
import { subscriberLogger } from "../logger";
import { FETCH_RETRY_COUNT, FETCH_TIMEOUT_MS } from "./constants";

const snapshotTargets = [
  {
    path: config.subscriberActiveServiceTypesPath,
    filename: "active_service_types.json"
  },
  {
    path: config.subscriberActiveServicesPath,
    filename: "active_services.json"
  },
  {
    path: config.subscriberActiveProvidersPath,
    filename: "active_providers.json"
  },
  {
    path: config.subscriberListenersPath,
    filename: "listeners.json"
  }
];

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchJsonWithRetry(url: string, retries = FETCH_RETRY_COUNT): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!response.ok) {
        throw new Error(`subscriber status ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("subscriber_fetch_failed");
}

async function writeSnapshot(filename: string, payload: unknown): Promise<void> {
  const outputDir = path.resolve(process.cwd(), config.subscriberSnapshotDir);
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, filename);
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
}

export async function refreshActiveSubscriberSnapshots(): Promise<void> {
  for (const target of snapshotTargets) {
    const url = new URL(target.path, config.subscriberBaseUrl);
    try {
      const payload = await fetchJsonWithRetry(url.toString());
      await writeSnapshot(target.filename, payload);
    } catch (error) {
      subscriberLogger.warn({ err: error, url: url.toString() }, "Subscriber snapshot failed");
    }
  }
}
