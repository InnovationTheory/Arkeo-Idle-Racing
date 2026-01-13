import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: 1,
      retryDelay: 1000
    }
  }
});

// Query keys for consistent cache management
export const queryKeys = {
  currentRace: ["race", "current"] as const,
  raceSelections: (raceId: string | null | undefined) =>
    ["race", raceId, "selections"] as const,
  prepProbes: (raceId: string | null | undefined) =>
    ["race", raceId, "prep-probes"] as const,
  raceArchive: (page: number, limit: number) =>
    ["races", "archive", { page, limit }] as const,
  wallet: ["wallet"] as const,
  user: ["user", "me"] as const
};

// Polling intervals (in milliseconds)
export const pollingIntervals = {
  currentRace: 2000,
  selections: 3000,
  prepProbes: 5000,
  archive: 10000
};
