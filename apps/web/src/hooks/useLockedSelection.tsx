import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

type SelectedHorse = {
  raceHorseId: string;
  horseId: string;
  displayName: string;
  serviceType: {
    displayName: string;
    iconKey: string;
  };
  jerseyColor?: string;
  providerMoniker?: string | null;
  slotNumber?: number;
  slotLabel?: string;
};

type LockedSelectionContextType = {
  lockedHorse: SelectedHorse | null;
  raceId: string | null;
  lockSelection: (horse: SelectedHorse, raceId: string) => void;
  clearSelection: () => void;
};

const LockedSelectionContext = createContext<LockedSelectionContextType | null>(null);

export function LockedSelectionProvider({ children }: { children: React.ReactNode }) {
  const [lockedHorse, setLockedHorse] = useState<SelectedHorse | null>(null);
  const [raceId, setRaceId] = useState<string | null>(null);

  const lockSelection = useCallback((horse: SelectedHorse, newRaceId: string) => {
    setLockedHorse(horse);
    setRaceId(newRaceId);
  }, []);

  const clearSelection = useCallback(() => {
    setLockedHorse(null);
    setRaceId(null);
  }, []);

  // Clear selection if the race changes
  useEffect(() => {
    // This will be handled by the Lobby when it detects race change
  }, []);

  return (
    <LockedSelectionContext.Provider value={{ lockedHorse, raceId, lockSelection, clearSelection }}>
      {children}
    </LockedSelectionContext.Provider>
  );
}

export function useLockedSelection() {
  const context = useContext(LockedSelectionContext);
  if (!context) {
    throw new Error("useLockedSelection must be used within LockedSelectionProvider");
  }
  return context;
}
