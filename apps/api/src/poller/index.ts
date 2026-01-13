import { HandicapTier } from "@prisma/client";
import { config } from "../config";
import { simulateMetrics, WeatherModifiers } from "../race/sim";
import { getSubscriberService } from "../subscriber/discovery";
import { JsonValue, probeListener, probeSubscriberApi } from "../subscriber/probe";

export type PollResult = {
  latencyMs: number;
  p95Ms: number;
  errorRate: number;
  speedFactor: number;
  headHeightDelta: number;
  errorType?: string | null;
  errorMessage?: string | null;
  request?: {
    url: string;
    method: string;
    payload?: JsonValue;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function pollHorse(params: {
  serviceTypeId: string;
  handicapTier: HandicapTier;
  weather: WeatherModifiers;
  loadFactor: number;
  timeoutMs?: number;
}): Promise<PollResult> {
  if (config.racingMode === "sim") {
    return simulateMetrics({
      serviceTypeId: params.serviceTypeId,
      handicapTier: params.handicapTier,
      weather: params.weather,
      loadFactor: params.loadFactor
    });
  }

  const service = await getSubscriberService(params.serviceTypeId);
  const healthMethod = service?.health_method ?? "POST";
  const healthPayload = service?.health_payload ?? '{"jsonrpc":"2.0","id":1,"method":"status","params":[]}';

  const probe = service?.listener_port
    ? await probeListener({
        listenerPort: service.listener_port,
        healthMethod,
        healthPayload,
        timeoutMs: params.timeoutMs
      })
    : await probeSubscriberApi({
        serviceId: params.serviceTypeId,
        healthMethod,
        healthPayload,
        timeoutMs: params.timeoutMs
      });

  const latencyMs = clamp(probe.latencyMs, 80, 3000);
  const p95Ms = clamp(latencyMs * 1.35, latencyMs, 4000);
  const errorRate = probe.ok ? 0.02 : 0.6;
  const speedFactor = clamp(0.012 * (1 / (latencyMs / 200)) * (1 - errorRate), 0.002, 0.03);

  return {
    latencyMs,
    p95Ms,
    errorRate,
    speedFactor,
    headHeightDelta: probe.headHeightDelta,
    errorType: probe.errorType,
    errorMessage: probe.errorMessage,
    request: probe.request
  };
}
