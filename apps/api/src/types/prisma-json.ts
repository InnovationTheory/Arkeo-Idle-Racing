// Track configuration - stored in Track.thresholdsJson
export type Thresholds = {
  p95Ms: number;
  errorRate: number;
  maxStaleTicks: number;
  latencyConsecutiveTicks: number;
  errorConsecutiveTicks: number;
};

// Track configuration - stored in Track.rampConfigJson
export type RampConfig = {
  type: "linear" | "pulse";
  start: number;
  end: number;
  paceMult?: number;
};

// Weather modifiers - stored in Weather.modifiersJson
export type WeatherModifiers = {
  latencyMult: number;
  errorMult: number;
  jitterMult: number;
  spikes?: number[];
};

// Horse history entry - stored in Horse.historyJson
export type HorseHistoryEntry = {
  raceId: string;
  placement: number | null;
  eliminatedAtTick: number | null;
  totalTicks: number;
  avgLatencyMs: number;
  avgP95Ms: number;
  avgErrorRate: number;
  ts: string;
};

// Horse history container
export type HorseHistory = {
  races?: HorseHistoryEntry[];
};

// RaceDay configuration - stored in RaceDay.heatsConfigJson
export type HeatsConfig = {
  maxParallelHeats: number;
};

// Heat result entry - stored in RaceDayHeat.resultsJson
export type HeatResult = {
  raceDayHorseId: string;
  placement: number;
};

// Heat metadata - stored in RaceDayHeat.metadataJson
export type HeatMetadata = {
  trackId?: string;
  trackName?: string;
  weatherId?: string;
  weatherName?: string;
  attempt?: number;
  providerStrategy?: unknown;
  lastVoidAt?: string;
  preflightCompleteAt?: string;
};

// Payout breakdown - stored in Payout.breakdownJson
export type PayoutBreakdown = Array<{
  position: number;
  percentage: number;
  credits: number;
}>;
