import type { RaceRuntime, WeatherState } from "./types";
import { spikeMultipliers } from "./constants";

export function weatherForTick(runtime: RaceRuntime): WeatherState {
  if (runtime.spikeSeconds.size === 0) {
    return { ...runtime.weatherBase, isSpiking: false };
  }

  const elapsedSeconds = Math.floor((runtime.currentTick * runtime.tickMs) / 1000);
  if (!runtime.spikeSeconds.has(elapsedSeconds)) {
    return { ...runtime.weatherBase, isSpiking: false };
  }

  return {
    latencyMult: runtime.weatherBase.latencyMult * spikeMultipliers.latency,
    errorMult: runtime.weatherBase.errorMult * spikeMultipliers.error,
    jitterMult: runtime.weatherBase.jitterMult * spikeMultipliers.jitter,
    isSpiking: true
  };
}

// Generate randomized spike seconds from spike windows
// Each window is [minSecond, maxSecond], we pick a random second within each
export type SpikeWindow = [number, number];

export function generateRandomizedSpikes(
  windows: SpikeWindow[],
  raceDurationSecs: number
): number[] {
  const spikes: number[] = [];

  for (const [minSec, maxSec] of windows) {
    // Ensure we don't exceed race duration
    const effectiveMax = Math.min(maxSec, raceDurationSecs - 5);
    const effectiveMin = Math.min(minSec, effectiveMax);

    if (effectiveMin < effectiveMax) {
      const spike = effectiveMin + Math.floor(Math.random() * (effectiveMax - effectiveMin + 1));
      spikes.push(spike);
    }
  }

  return spikes.sort((a, b) => a - b);
}

// Convert fixed spikes to randomized windows (±5 seconds around each spike)
export function spikesToWindows(fixedSpikes: number[]): SpikeWindow[] {
  return fixedSpikes.map(spike => [
    Math.max(5, spike - 5),
    spike + 5
  ] as SpikeWindow);
}
