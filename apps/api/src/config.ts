export type RacingMode = "sim" | "live";

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bigintFromEnv(value: string | undefined, fallback: bigint): bigint {
  if (!value) return fallback;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const hotWalletMnemonic = process.env.ARKEOD_MNEMONIC ?? "";
const entryFeeUarkeo = bigintFromEnv(process.env.ENTRY_FEE_UARKEO, 100n);
const pick3FeeUarkeo = bigintFromEnv(
  process.env.PICK3_FEE_UARKEO,
  entryFeeUarkeo * 3n
);
const arkeoGasPrice =
  process.env.ARKEO_GAS_PRICE ?? process.env.VITE_ARKEO_GAS_PRICE ?? "0.025uarkeo";
const arkeoGasAdjustment = numberFromEnv(process.env.ARKEO_GAS_ADJUSTMENT, 1.2);

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  logLevel: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  adminApiKey: process.env.ADMIN_API_KEY ?? null,
  httpPort: numberFromEnv(process.env.HTTP_PORT, 8081),
  wsPath: process.env.WS_PATH ?? "/ws",
  racingMode: (process.env.RACING_MODE ?? "live") as RacingMode,
  payoutCapRatio: numberFromEnv(process.env.PAYOUT_CAP_RATIO, 0.9),
  entryFee: numberFromEnv(process.env.ENTRY_FEE, 100),
  raceIntervalSecs: numberFromEnv(process.env.RACE_INTERVAL_SECS, 30),
  pickWindowSecs: numberFromEnv(process.env.PICK_WINDOW_SECS, 5 * 60),
  autoRaceEnabled: process.env.AUTO_RACE_ENABLED === "1",
  resetRaceOnBoot: process.env.RESET_RACE_ON_BOOT === "1",
  horsesPerRace: numberFromEnv(process.env.HORSES_PER_RACE, 10),
  voidFirstTicks: numberFromEnv(process.env.VOID_FIRST_TICKS, 10),
  voidStartGraceSecs: numberFromEnv(process.env.VOID_START_GRACE_SECS, 60),
  maxConcurrencyPerHorse: numberFromEnv(process.env.MAX_CONCURRENCY_PER_HORSE, 20),
  maxConcurrencyGlobal: numberFromEnv(process.env.MAX_CONCURRENCY_GLOBAL, 100),
  pollTimeoutMs: numberFromEnv(process.env.POLL_TIMEOUT_MS, 3000),
  firstPollTimeoutMs: numberFromEnv(process.env.FIRST_POLL_TIMEOUT_MS, 15000),
  subscriberBaseUrl: process.env.SUBSCRIBER_BASE_URL ?? "http://subscriber-core:9998",
  subscriberServicesPath: process.env.SUBSCRIBER_SERVICES_PATH ?? "/api/services",
  subscriberProbePath: process.env.SUBSCRIBER_PROBE_PATH ?? "/api/probe",
  subscriberActiveServiceTypesPath: process.env.SUBSCRIBER_ACTIVE_SERVICE_TYPES_PATH ?? "/api/active-service-types",
  subscriberActiveServicesPath: process.env.SUBSCRIBER_ACTIVE_SERVICES_PATH ?? "/api/active-services",
  subscriberActiveProvidersPath: process.env.SUBSCRIBER_ACTIVE_PROVIDERS_PATH ?? "/api/active-providers",
  subscriberListenersPath: process.env.SUBSCRIBER_LISTENERS_PATH ?? "/api/listeners",
  subscriberSnapshotDir: process.env.SUBSCRIBER_SNAPSHOT_DIR ?? "data/subscriber",
  subscriberDiscoveryTtlSecs: numberFromEnv(
    process.env.SUBSCRIBER_DISCOVERY_TTL_SECS,
    60
  ),
  posthogEnabled: process.env.POSTHOG_ENABLED === "1",
  posthogHost: process.env.POSTHOG_HOST ?? "",
  posthogApiKey: process.env.POSTHOG_API_KEY ?? "",
  initialCredits: numberFromEnv(process.env.INITIAL_CREDITS, 10000),
  raceDayTickMs: numberFromEnv(process.env.RACEDAY_TICK_MS, 1000),
  raceDayDurationSecs: numberFromEnv(process.env.RACEDAY_DURATION_SECS, 12 * 60),
  raceDayPickWindowSecs: numberFromEnv(process.env.RACEDAY_PICK_WINDOW_SECS, 15 * 60),
  raceDayBufferSecs: numberFromEnv(process.env.RACEDAY_BUFFER_SECS, 30),
  raceDayMaxParallelHeats: numberFromEnv(process.env.RACEDAY_MAX_PARALLEL_HEATS, 1),
  arkeoChainId: process.env.ARKEO_CHAIN_ID ?? "arkeo-main-v1",
  arkeoChainName: process.env.ARKEO_CHAIN_NAME ?? "Arkeo",
  arkeoRpcUrl: process.env.ARKEO_RPC_URL ?? "https://rpc-seed.arkeo.network",
  arkeoRestUrl: process.env.ARKEO_LCD_URL ?? "https://rest-seed.arkeo.network",
  arkeoDenom: process.env.ARKEO_DENOM ?? "uarkeo",
  arkeoDecimals: numberFromEnv(process.env.ARKEO_DECIMALS, 8),
  arkeoTicker: process.env.ARKEO_TICKER ?? "ARKEO",
  arkeoBech32Prefix: process.env.ARKEO_BECH32_PREFIX ?? "arkeo",
  hotWalletMnemonic,
  hotWalletEnabled: hotWalletMnemonic.length > 0,
  arkeoGasPrice,
  entryFeeUarkeo,
  pick3FeeUarkeo
};
