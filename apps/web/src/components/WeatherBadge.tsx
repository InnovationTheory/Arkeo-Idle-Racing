import React from "react";

export default function WeatherBadge({ weatherName }: { weatherName?: string }) {
  if (!weatherName) return null;
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-midnight/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-midnight">
      {weatherName}
    </span>
  );
}
