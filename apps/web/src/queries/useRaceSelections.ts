import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api";
import { queryKeys, pollingIntervals } from "../queryClient";

export type RaceSelection = {
  selectionId: string;
  createdAt: string;
  type: "single";
  raceHorseId?: string;
  bettor: {
    nickname?: string | null;
    walletAddress?: string | null;
  };
  picks: Array<{ horseName: string; serviceType?: string }>;
};

async function fetchSelections(raceId: string): Promise<RaceSelection[]> {
  const data = await apiGet<{ selections: RaceSelection[] }>(
    `/api/races/${raceId}/selections`
  );
  return Array.isArray(data?.selections) ? data.selections : [];
}

export function useRaceSelections(raceId: string | null | undefined) {
  const query = useQuery({
    queryKey: queryKeys.raceSelections(raceId),
    queryFn: () => fetchSelections(raceId!),
    enabled: !!raceId,
    refetchInterval: pollingIntervals.selections,
    placeholderData: []
  });

  return {
    selections: query.data ?? [],
    isLoaded: !query.isLoading && query.isFetched,
    isLoading: query.isLoading,
    error: query.error
  };
}
