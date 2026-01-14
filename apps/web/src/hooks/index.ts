export { useRaceCountdown } from "./useRaceCountdown";
export { useWalletState } from "./useWalletState";
export { useRaceWebSocket, type RaceEvent } from "./useRaceWebSocket";
export { useRaceHeader, type CurrentHeatInfo, type HeaderRace } from "./useRaceHeader";
export { useSound, SoundProvider } from "./useSound";

// Legacy exports - prefer using queries/ versions
export { useRacePolling, type Race, type RaceHorse } from "./useRacePolling";
