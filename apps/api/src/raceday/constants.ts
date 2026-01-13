// Tournament structure
export const ROUND_HEATS = [8, 4, 2, 1];
export const HEAT_SIZE = 10;
export const ADVANCE_COUNT = 5;
export const HEAT_TIMEOUT_BUFFER_SECS = 120;

// Horse requirements
export const MIN_HORSES_FOR_RACEDAY = 80;
export const RACEDAY_HORSE_COUNT = 80;

// Timing
export const PICK_CLOSE_DELAY_MS = 5000;
export const HEAT_POLL_INTERVAL_MS = 2000;

// Placement scoring
export const UNKNOWN_PLACEMENT = 999;
export const PODIUM_COUNT = 3;

// Provider strategy round thresholds
// Set to 0 to disable single-provider strategies (all rounds use random/diverse assignment)
export const RANDOM_PROVIDER_ROUND = 0;
export const FIXED_PROVIDER_ROUND = 0;
