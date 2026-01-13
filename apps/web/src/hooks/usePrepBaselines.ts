import { useEffect, useState } from "react";
import { apiGet } from "../api";

export type PrepProbe = {
  latencyMs: number;
  probeOk?: boolean | null;
  errorType?: string | null;
};

export function usePrepBaselines(raceId: string | null | undefined) {
  const [baselineByHorseId, setBaselineByHorseId] = useState<Map<string, number>>(new Map());
  const [probesByHorse, setProbesByHorse] = useState<Record<string, PrepProbe[]>>({});

  useEffect(() => {
    if (!raceId) {
      setBaselineByHorseId(new Map());
      setProbesByHorse({});
      return;
    }

    let mounted = true;

    const fetchPrepBaselines = async () => {
      try {
        const data = await apiGet<{ polls: Record<string, PrepProbe[]> }>(
          `/api/races/${raceId}/polls?phase=prep`
        );
        if (!mounted) return;

        const next = new Map<string, number>();
        const pollsByHorse = data?.polls ?? {};

        Object.entries(pollsByHorse).forEach(([raceHorseId, polls]) => {
          const latencies = polls
            .map((probe) => probe.latencyMs)
            .filter((value) => Number.isFinite(value));
          if (latencies.length >= 3) {
            const avg = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
            next.set(raceHorseId, avg);
          }
        });

        setProbesByHorse(pollsByHorse);
        setBaselineByHorseId(next);
      } catch {
        if (!mounted) return;
        setProbesByHorse({});
        setBaselineByHorseId(new Map());
      }
    };

    void fetchPrepBaselines();

    return () => {
      mounted = false;
    };
  }, [raceId]);

  return { baselineByHorseId, probesByHorse };
}
