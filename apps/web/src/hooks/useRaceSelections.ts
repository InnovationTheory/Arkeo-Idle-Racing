import { useEffect, useState } from "react";
import { apiGet } from "../api";

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

export function useRaceSelections(raceId: string | null | undefined) {
  const [selections, setSelections] = useState<RaceSelection[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!raceId) {
      setSelections([]);
      setIsLoaded(false);
      return;
    }

    let mounted = true;
    let interval: number | null = null;

    const fetchSelections = async () => {
      try {
        const data = await apiGet<{ selections: RaceSelection[] }>(
          `/api/races/${raceId}/selections`
        );
        if (!mounted) return;
        setSelections(Array.isArray(data?.selections) ? data.selections : []);
        setIsLoaded(true);
      } catch {
        if (!mounted) return;
        setSelections([]);
        setIsLoaded(true);
      }
    };

    void fetchSelections();
    interval = window.setInterval(fetchSelections, 3000);

    return () => {
      mounted = false;
      if (interval) window.clearInterval(interval);
    };
  }, [raceId]);

  return { selections, isLoaded };
}
