import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiGet } from "../api";
import { queryKeys, pollingIntervals } from "../queryClient";

export type PrepProbe = {
  latencyMs: number;
  probeOk: boolean | null;
  errorType: string | null;
  ts: string;
};

type PollsResponse = {
  polls: Record<string, PrepProbe[]>;
};

async function fetchPrepProbes(raceId: string): Promise<Record<string, PrepProbe[]>> {
  const data = await apiGet<PollsResponse>(`/api/races/${raceId}/polls?phase=prep`);
  return data?.polls && typeof data.polls === "object" ? data.polls : {};
}

export function usePrepBaselines(raceId: string | null | undefined) {
  const query = useQuery({
    queryKey: queryKeys.prepProbes(raceId),
    queryFn: () => fetchPrepProbes(raceId!),
    enabled: !!raceId,
    staleTime: 60_000,
    refetchInterval: pollingIntervals.prepProbes,
    placeholderData: {}
  });

  const { baselineByHorseId, probesByHorse } = useMemo(() => {
    const byHorse = query.data ?? {};
    const baseline = new Map<string, number>();

    for (const [horseId, probes] of Object.entries(byHorse)) {
      const latencies = probes
        .filter((p) => p.probeOk && typeof p.latencyMs === "number")
        .map((p) => p.latencyMs);
      if (latencies.length >= 3) {
        // Use P75 (75th percentile) as baseline so that "green up" means
        // performing better than typical, not better than average
        const sorted = [...latencies].sort((a, b) => a - b);
        const p75Index = Math.floor(sorted.length * 0.75);
        const p75 = sorted[p75Index];
        baseline.set(horseId, p75);
      }
    }

    return { baselineByHorseId: baseline, probesByHorse: byHorse };
  }, [query.data]);

  return {
    baselineByHorseId,
    probesByHorse,
    isLoading: query.isLoading,
    error: query.error
  };
}
