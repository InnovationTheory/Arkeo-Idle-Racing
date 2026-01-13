// Default simulation baselines
export const DEFAULT_BASE_LATENCY = 220;
export const DEFAULT_BASE_ERROR_RATE = 0.02;
export const DEFAULT_BASE_SPEED = 0.012;

// Service type baselines: { latency, errorRate, speed }
export const SERVICE_BASELINES: Record<string, { latency: number; errorRate: number; speed: number }> = {
  "ethereum-mainnet-jsonrpc": { latency: 260, errorRate: 0.025, speed: 0.011 },
  "osmosis-mainnet-rpc": { latency: 190, errorRate: 0.02, speed: 0.013 },
  "arkeo-mainnet-rpc": { latency: 170, errorRate: 0.018, speed: 0.014 },
  "bitcoin-mainnet-jsonrpc": { latency: 300, errorRate: 0.03, speed: 0.01 }
};

// Latency simulation
export const LATENCY_JITTER_RANGE = 25;
export const SIM_MIN_LATENCY = 80;
export const SIM_MAX_LATENCY = 2000;

// P95 simulation
export const P95_BASE_MULTIPLIER = 1.2;
export const P95_RANDOM_RANGE = 0.4;
export const P95_MAX_CLAMP = 2500;

// Error rate simulation
export const LOAD_ERROR_MULTIPLIER = 0.6;
export const RANDOM_ERROR_VARIATION = 0.03;

// Speed factor simulation
export const SPEED_REFERENCE_LATENCY = 200;

// Head height delta simulation
export const HEAD_HEIGHT_BASE_PROBABILITY = 0.08;
export const HEAD_HEIGHT_ERROR_MULTIPLIER = 0.2;
