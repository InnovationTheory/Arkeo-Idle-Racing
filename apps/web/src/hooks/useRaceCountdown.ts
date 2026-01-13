import { useEffect, useState } from "react";

export function useRaceCountdown(target?: string) {
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (!target) {
      setRemainingMs(0);
      return;
    }
    const targetTime = new Date(target).getTime();

    const tick = () => {
      setRemainingMs(Math.max(0, targetTime - Date.now()));
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [target]);

  return remainingMs;
}
