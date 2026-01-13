import React from "react";
import type { RaceEvent } from "../hooks";

type RaceEventBannerProps = {
  event: RaceEvent | null;
};

function getEventDisplay(event: RaceEvent): { icon: string; message: string; color: string } {
  switch (event.eventType) {
    case "race_started":
      return {
        icon: "🏁",
        message: "And they're off!",
        color: "from-emerald-500/90 to-green-600/90"
      };
    case "lead_change":
      return {
        icon: "🔄",
        message: `${event.horseName} takes the lead!`,
        color: "from-blue-500/90 to-blue-600/90"
      };
    case "entering_stretch":
      return {
        icon: "🔥",
        message: "Entering the final stretch!",
        color: "from-orange-500/90 to-red-500/90"
      };
    case "final_stretch":
      return {
        icon: "⏱️",
        message: "Down to the wire!",
        color: "from-red-500/90 to-red-600/90"
      };
    case "photo_finish":
      return {
        icon: "📸",
        message: event.horsesInContention === 3
          ? "Three-way photo finish!"
          : "Neck and neck!",
        color: "from-purple-500/90 to-pink-500/90"
      };
    case "desperation_surge":
      return {
        icon: "💥",
        message: `${event.horseName} surges forward!`,
        color: "from-yellow-500/90 to-orange-500/90"
      };
    case "weather_spike":
      return {
        icon: "⚡",
        message: "Network turbulence detected!",
        color: "from-cyan-500/90 to-blue-500/90"
      };
    case "horses_leaving":
      return {
        icon: "🐎",
        message: "Horses leaving the track...",
        color: "from-zinc-600 to-zinc-700"
      };
    case "horses_entering":
      return {
        icon: "🚪",
        message: "Horses entering the gates...",
        color: "from-zinc-600 to-zinc-700"
      };
    default:
      return {
        icon: "📢",
        message: event.eventType,
        color: "from-zinc-500 to-zinc-600"
      };
  }
}

export default function RaceEventBanner({ event }: RaceEventBannerProps) {
  if (!event) return null;

  const { icon, message, color } = getEventDisplay(event);

  return (
    <div
      className={`
        w-full rounded-xl px-4 py-3
        bg-gradient-to-r ${color}
        text-white font-semibold text-center
        animate-pulse shadow-lg
        flex items-center justify-center gap-2
      `}
      key={event.timestamp}
    >
      <span className="text-xl">{icon}</span>
      <span className="text-lg">{message}</span>
    </div>
  );
}
