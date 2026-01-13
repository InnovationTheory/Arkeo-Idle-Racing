import React from "react";
import WeatherBadge from "./WeatherBadge";
import { formatDuration } from "./Countdown";

type HeaderRace = {
  raceId: string | null;
  status?: string;
  track?: { name?: string; surface?: string };
  weather?: { name?: string };
  pickCloseAt?: string;
  startAt?: string;
  racedayLevel?: number | null;
  racedayHeatNumber?: number | null;
  racedayHeatCount?: number | null;
  racedayStatus?: string | null;
};

const surfaceLabels: Record<string, string> = {
  dirt: "Dirt",
  turf: "Turf",
  synthetic: "Synthetic"
};

type RaceHeaderProps = {
  race: HeaderRace | null;
  remainingMs: number;
  poolSize?: number;
  racedayStatus?: string | null;
};

export default function RaceHeader({ race, remainingMs, racedayStatus, poolSize = 0 }: RaceHeaderProps) {
  const raceReady = Boolean(race?.raceId);
  const selectionLocked = !raceReady
    ? true
    : race?.status
      ? ["running", "finished", "voided"].includes(race.status)
      : false;
  const isPicking = race?.status === "picking";
  const isClosingSoon = raceReady && isPicking && remainingMs <= 10_000 && remainingMs > 0;
  const countdownValue = race?.pickCloseAt ? formatDuration(Math.max(remainingMs, 0)) : "--:--";

  // Calculate countdown to startAt for "preparing next heat"
  const startAtMs = race?.startAt ? new Date(race.startAt).getTime() - Date.now() : 0;
  const startCountdownValue = startAtMs > 0 ? formatDuration(startAtMs) : "--:--";
  const racedayLevel = typeof race?.racedayLevel === "number" ? race.racedayLevel : null;
  const racedayHeatNumber = typeof race?.racedayHeatNumber === "number"
    ? race.racedayHeatNumber
    : null;
  const racedayHeatCount = typeof race?.racedayHeatCount === "number"
    ? race.racedayHeatCount
    : null;
  const fallbackHeatCount = racedayLevel === null
    ? null
    : {
        1: 8,
        2: 4,
        3: 2,
        4: 1
      }[racedayLevel] ?? null;
  const totalHeats = racedayHeatCount ?? fallbackHeatCount;
  const status = race?.status;
  const isRaceDay = racedayLevel !== null;
  const resolvedRaceDayStatus = racedayStatus ?? race?.racedayStatus ?? null;
  const isPolling = isRaceDay && resolvedRaceDayStatus === "polling";
  const isRaceDayPicking = isRaceDay && resolvedRaceDayStatus === "picking";
  const isScheduled = status === "scheduled";
  const isRunning = status === "running";
  const isFinished = status === "finished";
  const isPreparingNextHeat =
    isRaceDay && isScheduled && resolvedRaceDayStatus === "running";
  const isAwaitingRaceDay = !raceReady;
  const isRaceDayComplete = resolvedRaceDayStatus === "complete";

  // Between rounds: preparing next heat but no start time yet (round transition)
  const isBetweenRounds = isPreparingNextHeat && (!race?.startAt || startAtMs <= 0);

  // Show track info only during running/buffer phases, not during polling or picking
  // Weather only shown when race is created (not during picking)
  const showRaceInfo = isRunning || isPreparingNextHeat || isFinished;
  const showWeather = showRaceInfo;

  // During raceDay running, don't flash "Race Finished" for individual heats
  const isHeatFinishedDuringRaceDay = isFinished && isRaceDay && resolvedRaceDayStatus === "running";

  // Status label for badges (used in non-raceDay mode)
  const statusLabel = !raceReady
    ? "Awaiting RaceDay Event"
    : isRunning
      ? "Live"
      : isHeatFinishedDuringRaceDay
        ? "Heat Complete"
        : isFinished
          ? "Race Finished"
          : status === "voided"
            ? "Race Voided"
            : isPolling
              ? "Preparing Races"
              : isRaceDayPicking
                ? `Picks close in ${countdownValue}`
              : isPreparingNextHeat
                ? startAtMs > 0
                  ? `Next heat in ${startCountdownValue}`
                  : "Starting..."
                : isClosingSoon
                  ? "Closing Soon"
                  : "Betting Open";

  // Status value for the main status display
  const statusValue = !raceReady
    ? "Awaiting RaceDay Event"
    : isRunning
      ? "Live"
      : isHeatFinishedDuringRaceDay
        ? startAtMs > 0
          ? `Next heat in ${startCountdownValue}`
          : "Starting..."
        : isFinished
          ? isRaceDayComplete
            ? "Tournament Complete"
            : "Race Finished"
          : status === "voided"
            ? "Race Voided"
            : isPolling
              ? "Preparing Races"
              : isRaceDayPicking
                ? `Picks close in ${countdownValue}`
              : isBetweenRounds
                ? "Preparing Next Round"
              : isPreparingNextHeat
                ? startAtMs > 0
                  ? `Next heat in ${startCountdownValue}`
                  : "Starting..."
                : isPicking
                  ? `Picks close in ${countdownValue}`
                  : "Betting Open";

  return (
    <section className="surface animate-fade-up relative overflow-hidden rounded-3xl p-6">
      <div className="relative z-10 flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            {showRaceInfo && isRaceDay && racedayLevel !== null && racedayHeatNumber !== null ? (
              <>
                <p className="text-xs uppercase tracking-[0.3em] text-slate">
                  {isPreparingNextHeat ? "Up Next" : `Round ${racedayLevel}`}
                </p>
                <h2 className="font-display text-5xl uppercase tracking-[0.12em] text-midnight">
                  {isPreparingNextHeat ? (
                    // Show "Round X, Heat Y" when preparing, gives full context
                    <>Round {racedayLevel}, Heat {racedayHeatNumber}</>
                  ) : (
                    <>
                      Heat {racedayHeatNumber}
                      {totalHeats ? ` of ${totalHeats}` : ""}
                    </>
                  )}
                </h2>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-[0.3em] text-slate">
                  {isPolling ? "Tournament" : isRaceDayPicking ? "Choose your racehorses" : "Next heat"}
                </p>
                <h2 className="font-display text-5xl uppercase tracking-[0.12em] text-midnight">
                  {isPolling ? "Preparing Races" : "RaceDay Event"}
                </h2>
              </>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {/* LIVE indicator when race is running */}
              {isRunning && (
                <span className="flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-white">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                  </span>
                  Live
                </span>
              )}
              {showRaceInfo && isRaceDay ? (
                <>
                  {race?.track?.name && (
                    <span className="rounded-full bg-midnight/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-midnight">
                      {race.track.name}
                    </span>
                  )}
                  {race?.track?.surface && (
                    <span className="rounded-full bg-amber-600/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
                      {surfaceLabels[race.track.surface] ?? race.track.surface}
                    </span>
                  )}
                  {showWeather && <WeatherBadge weatherName={race?.weather?.name} />}
                </>
              ) : !isRaceDay ? (
                <>
                  <WeatherBadge weatherName={race?.weather?.name} />
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
                      isAwaitingRaceDay
                        ? "bg-ink/10 text-ink"
                        : selectionLocked || isClosingSoon
                            ? "bg-warning/10 text-warning"
                            : "bg-accent2/10 text-accent2"
                    }`}
                  >
                    {statusLabel}
                  </span>
                </>
              ) : null}
            </div>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-[0.3em] text-slate">Race Rewards</p>
            <p className="font-display text-3xl uppercase tracking-[0.1em] text-accent2">
              {poolSize.toFixed(2)} ARKEO
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.3em] text-slate">Race Status</p>
            <p className={`font-display text-3xl uppercase tracking-[0.1em] whitespace-nowrap ${isRunning ? "text-red-600" : "text-ink"}`}>
              {statusValue}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
