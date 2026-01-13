import { config } from "../config";
import { raceLogger } from "../logger";

export type ProbeResult = {
  ok: boolean;
  latencyMs: number;
  errorType: string | null;
  errorMessage: string | null;
  headHeightDelta: number;
  request: {
    url: string;
    method: string;
    payload?: JsonValue;
  };
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function buildListenerRequest(params: {
  listenerPort: number;
  healthMethod: string;
  healthPayload: string;
}) {
  const base = new URL(config.subscriberBaseUrl);
  base.port = String(params.listenerPort);

  const isGet = params.healthMethod.toUpperCase() === "GET";

  if (isGet) {
    // For GET requests, health_payload is the path
    base.pathname = params.healthPayload || "/";
    return { url: base.toString(), method: "GET", payload: undefined };
  }

  // For POST requests, health_payload is JSON body
  base.pathname = "/";
  let payload: JsonValue = {};
  try {
    payload = JSON.parse(params.healthPayload) as JsonValue;
  } catch {
    // If not valid JSON, use as-is
    payload = params.healthPayload as JsonValue;
  }

  return { url: base.toString(), method: "POST", payload };
}

function buildSubscriberRequest(params: {
  serviceId: string;
  healthMethod: string;
  healthPayload: string;
}) {
  const url = new URL(config.subscriberProbePath, config.subscriberBaseUrl);

  const isGet = params.healthMethod.toUpperCase() === "GET";

  let innerPayload: JsonValue = null;
  if (!isGet && params.healthPayload) {
    try {
      innerPayload = JSON.parse(params.healthPayload) as JsonValue;
    } catch {
      innerPayload = params.healthPayload as JsonValue;
    }
  }

  return {
    url: url.toString(),
    method: "POST",
    payload: {
      serviceId: params.serviceId,
      httpMethod: isGet ? "GET" : "POST",
      path: isGet ? params.healthPayload : "/",
      payload: innerPayload
    }
  };
}

export async function probeListener(params: {
  listenerPort: number;
  healthMethod: string;
  healthPayload: string;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const request = buildListenerRequest(params);
  const timeout = params.timeoutMs ?? config.pollTimeoutMs;

  const start = Date.now();
  try {
    const response = await fetchWithTimeout(
      request.url,
      request.method === "POST"
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request.payload ?? {})
          }
        : { method: "GET" },
      timeout
    );

    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const errorType = `listener_${response.status}`;
      const errorMessage = `HTTP ${response.status} ${response.statusText}`;
      raceLogger.warn({ url: request.url, status: response.status, latencyMs }, `Probe failed: ${errorType}`);
      return {
        ok: false,
        latencyMs,
        errorType,
        errorMessage,
        headHeightDelta: 0,
        request
      };
    }

    return { ok: true, latencyMs, errorType: null, errorMessage: null, headHeightDelta: 1, request };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = errorMessage.includes("aborted") ? "timeout" : "connection_error";
    raceLogger.warn({ url: request.url, error: errorMessage, latencyMs }, `Probe failed: ${errorType}`);
    return {
      ok: false,
      latencyMs,
      errorType,
      errorMessage,
      headHeightDelta: 0,
      request
    };
  }
}

export async function probeSubscriberApi(params: {
  serviceId: string;
  healthMethod: string;
  healthPayload: string;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const request = buildSubscriberRequest(params);
  const timeout = params.timeoutMs ?? config.pollTimeoutMs;

  const start = Date.now();
  try {
    const response = await fetchWithTimeout(
      request.url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.payload ?? {})
      },
      timeout
    );

    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const errorType = `subscriber_${response.status}`;
      const errorMessage = `HTTP ${response.status} ${response.statusText}`;
      raceLogger.warn({ url: request.url, serviceId: params.serviceId, status: response.status, latencyMs }, `Probe failed: ${errorType}`);
      return {
        ok: false,
        latencyMs,
        errorType,
        errorMessage,
        headHeightDelta: 0,
        request
      };
    }

    const body = (await response.json()) as Record<string, unknown>;
    const headHeightDelta =
      typeof body.headHeightDelta === "number" ? body.headHeightDelta : 1;

    return { ok: true, latencyMs, errorType: null, errorMessage: null, headHeightDelta, request };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = errorMessage.includes("aborted") ? "timeout" : "connection_error";
    raceLogger.warn({ url: request.url, serviceId: params.serviceId, error: errorMessage, latencyMs }, `Probe failed: ${errorType}`);
    return {
      ok: false,
      latencyMs,
      errorType,
      errorMessage,
      headHeightDelta: 0,
      request
    };
  }
}
