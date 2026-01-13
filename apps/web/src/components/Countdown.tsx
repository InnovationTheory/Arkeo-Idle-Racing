import { useEffect, useState } from "react";

export function formatDuration(ms: number) {
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function Countdown({
  target,
  onChange,
  className
}: {
  target?: string;
  onChange?: (remainingMs: number) => void;
  className?: string;
}) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!target) return;
    const targetTime = new Date(target).getTime();

    const tick = () => {
      const next = Math.max(0, targetTime - Date.now());
      setRemaining(next);
      onChange?.(next);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [target, onChange]);

  return (
    <span className={className ?? "font-mono text-sm text-slate"}>
      {formatDuration(remaining)}
    </span>
  );
}
