import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";
import RaceHeader from "../components/RaceHeader";
import RaceTicketCompact from "../components/RaceTicketCompact";
import { useWalletState } from "../hooks/useWalletState";
import { useRaceHeader } from "../hooks/useRaceHeader";
import { useRaceDayTicketHorses } from "../hooks/useRaceDayTicketHorses";
import HorseSilhouette from "../components/HorseSilhouette";
import JerseyIcon from "../components/JerseyIcon";
import { serviceIconPath } from "../utils/serviceIcons";
import { buildRaceJerseyColors } from "../utils/raceColors";
import { contrastColor, horseStyle } from "../utils/horseStyle";

type RaceHorseEntry = {
  raceHorseId: string;
  displayName: string;
  placement?: number | null;
  eliminatedAtTick?: number | null;
  serviceType?: { displayName?: string; iconKey?: string };
};

type RaceArchiveEntry = {
  raceId: string;
  status: string;
  track?: { name?: string };
  weather?: { name?: string };
  createdAt?: string;
  startAt?: string;
  endAt?: string;
  racedayLevel?: number | null;
  racedayHeatNumber?: number | null;
  racedayHeatCount?: number | null;
  racedayStatus?: string | null;
  horses: RaceHorseEntry[];
};

type RaceSummary = {
  raceId: string | null;
  status?: string;
  track?: { name?: string };
  weather?: { name?: string };
  pickCloseAt?: string;
  racedayLevel?: number | null;
  racedayHeatNumber?: number | null;
  racedayHeatCount?: number | null;
  racedayStatus?: string | null;
};

export default function Results() {
  const walletState = useWalletState();
  const { ticketHorses } = useRaceDayTicketHorses(walletState.walletAddress);

  // Shared RaceHeader data (consistent across all tabs)
  const {
    headerRace,
    remainingMs,
    poolSize,
    racedayStatus
  } = useRaceHeader();

  const [races, setRaces] = useState<RaceArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const pageSize = 10;
  const totalPages = totalCount !== null
    ? Math.max(1, Math.ceil(totalCount / pageSize))
    : null;
  const horseSize = 60;
  const stackSize = 64;
  const coinSize = 20;
  const tileWidth = 15;
  const tileHeight = 27;
  const horseTop = (stackSize - horseSize) / 2;
  const coinTop = horseTop + 4 - coinSize / 2;

  useEffect(() => {
    let mounted = true;
    let interval: number | null = null;

    const fetchRaces = async () => {
      try {
        const offset = page * pageSize;
        const payload = await apiGet<{ races: RaceArchiveEntry[]; totalCount?: number }>(
          `/api/races?limit=${pageSize}&offset=${offset}`
        );
        if (!mounted) return;
        const all = Array.isArray(payload?.races) ? payload.races : [];
        const next = all.filter((race) => ["finished", "voided"].includes(race.status));
        setRaces(next);
        const total = typeof payload?.totalCount === "number" ? payload.totalCount : null;
        setTotalCount(total);
        setHasNext(total !== null ? page + 1 < Math.max(1, Math.ceil(total / pageSize)) : next.length === pageSize);
        setLoading(false);
      } catch {
        if (!mounted) return;
        setRaces([]);
        setHasNext(false);
        setTotalCount(null);
        setLoading(false);
      }
    };

    setLoading(true);
    void fetchRaces();
    interval = window.setInterval(fetchRaces, 10000);

    return () => {
      mounted = false;
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [page, pageSize]);


  const formatTime = useMemo(
    () => (value?: string | null) => {
      if (!value) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date.toLocaleString("en-US", {
        timeZone: "America/Denver",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    },
    []
  );

  const formatPlacement = (placement?: number | null) => {
    if (!placement || placement <= 0) return null;
    const mod100 = placement % 100;
    const suffix =
      mod100 >= 11 && mod100 <= 13
        ? "th"
        : placement % 10 === 1
          ? "st"
          : placement % 10 === 2
            ? "nd"
            : placement % 10 === 3
              ? "rd"
              : "th";
    return `${placement}${suffix}`;
  };

  const statusClass = (status: string) => {
    const normalized = status.toLowerCase();
    switch (normalized) {
      case "finished":
        return "bg-green-600/15 text-green-600";
      case "voided":
        return "bg-warning/15 text-warning";
      case "running":
        return "bg-accent/15 text-accent";
      case "picking":
        return "bg-midnight/10 text-midnight";
      default:
        return "bg-slate/10 text-slate";
    }
  };

  const pager = (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <button
        type="button"
        className="rounded-full border border-midnight/10 bg-panel/80 px-4 py-2 text-xs uppercase tracking-[0.2em] text-midnight transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setPage((prev) => Math.max(prev - 1, 0))}
        disabled={page === 0}
      >
        Prev
      </button>
      <span className="text-xs uppercase tracking-[0.3em] text-white/80">
        {totalPages ? `Page ${page + 1} of ${totalPages}` : `Page ${page + 1}`}
      </span>
      <button
        type="button"
        className="rounded-full border border-midnight/10 bg-panel/80 px-4 py-2 text-xs uppercase tracking-[0.2em] text-midnight transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setPage((prev) => prev + 1)}
        disabled={!hasNext || (totalPages !== null && page + 1 >= totalPages)}
      >
        Next
      </button>
    </div>
  );

  let body: React.ReactNode = null;
  if (loading) {
    body = (
      <div className="surface rounded-3xl p-6 text-center text-slate">
        Fetching race archive...
      </div>
    );
  } else if (races.length === 0) {
    body = (
      <div className="surface rounded-3xl p-6 text-center text-slate">
        No races yet. The archive will populate after the first finish.
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-6">
        {races.map((race) => {
          const labelTime = formatTime(race.endAt || race.startAt || race.createdAt);
          const raceHorses = Array.isArray(race.horses) ? race.horses : [];
          const jerseyColors = buildRaceJerseyColors(
            race.raceId,
            raceHorses.map((horse) => horse.raceHorseId)
          );
          const raceStatus = race.status ?? "unknown";
          const isRaceDay = typeof race.racedayLevel === "number";
          const racedayLevel = race.racedayLevel;
          const racedayHeatNumber = race.racedayHeatNumber;
          const fallbackHeatCount = racedayLevel === null || racedayLevel === undefined
            ? null
            : { 1: 8, 2: 4, 3: 2, 4: 1 }[racedayLevel] ?? null;
          const totalHeats = race.racedayHeatCount ?? fallbackHeatCount;
          const raceTitle = isRaceDay && typeof racedayHeatNumber === "number"
            ? `Round ${racedayLevel} Heat ${racedayHeatNumber}${totalHeats ? ` of ${totalHeats}` : ""}`
            : race.track?.name ?? "Race";
          return (
            <section key={race.raceId} className="surface rounded-3xl p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate">
                    {labelTime ?? "Race"}
                  </p>
                  <h3 className="font-display text-3xl uppercase tracking-[0.1em] text-midnight">
                    {raceTitle}
                  </h3>
                  {isRaceDay && race.track?.name && (
                    <span className="mt-2 inline-block rounded-full bg-midnight/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-midnight">
                      {race.track.name}
                    </span>
                  )}
                  {!isRaceDay && race.weather?.name && (
                    <p className="text-sm uppercase tracking-[0.2em] text-slate">
                      {race.weather.name}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusClass(
                      raceStatus
                    )}`}
                  >
                    {raceStatus}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {raceHorses.length === 0 ? (
                  <div className="rounded-2xl bg-panel/90 px-4 py-2 text-sm text-slate">
                    No horses recorded.
                  </div>
                ) : (
                  raceHorses.map((entry, index) => {
                    const finishedLabel =
                      raceStatus === "finished"
                        ? entry.eliminatedAtTick !== null && entry.eliminatedAtTick !== undefined
                          ? "Eliminated"
                          : "Finished"
                        : raceStatus === "voided"
                          ? "Voided"
                          : raceStatus === "picking"
                            ? "Picking"
                            : raceStatus === "scheduled"
                              ? "Scheduled"
                              : "In progress";
                    const visual = horseStyle(entry.raceHorseId);
                    const jerseyColor = jerseyColors.get(entry.raceHorseId);
                    const numberColor = jerseyColor ? contrastColor(jerseyColor) : "#1E1E1E";
                    const numberValue = index + 1;
                    const placementLabel = formatPlacement(entry.placement);
                    const coinPath = serviceIconPath(entry.serviceType?.iconKey);
                    const isTopFive =
                      raceStatus === "finished" &&
                      typeof entry.placement === "number" &&
                      entry.placement > 0 &&
                      entry.placement <= 5;
                    return (
                      <div
                        key={entry.raceHorseId}
                        className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-panel/90 px-4 py-2 border ${
                          isTopFive ? "border-2 border-accent2" : "border-midnight/10"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="flex h-5 w-5 items-center justify-center rounded-full border border-midnight/10 text-[10px] font-semibold"
                            style={{ backgroundColor: jerseyColor ?? "#FAF6F1", color: numberColor }}
                          >
                            {numberValue}
                          </span>
                          <div
                            className="relative shrink-0"
                            style={{ width: stackSize, height: stackSize }}
                          >
                            <HorseSilhouette
                              width={horseSize}
                              height={horseSize}
                              className="absolute drop-shadow-sm"
                              style={{
                                color: visual.coatColor,
                                left: "50%",
                                top: "50%",
                                transform: "translate(-50%, -50%)"
                              }}
                            />
                            <div
                              className="absolute left-1/2 flex items-center justify-center overflow-hidden rounded-full border border-midnight/10 bg-panel shadow-sm"
                              style={{
                                width: coinSize,
                                height: coinSize,
                                top: coinTop,
                                transform: "translateX(-50%) translateX(-3px)"
                              }}
                            >
                              {coinPath ? (
                                <img
                                  src={coinPath}
                                  alt=""
                                  className="h-full w-full scale-110 rounded-full object-cover"
                                />
                              ) : (
                                <span className="text-[8px] font-semibold text-ink/70">
                                  {entry.serviceType?.displayName?.slice(0, 3)?.toUpperCase() ?? ""}
                                </span>
                              )}
                            </div>
                            <div
                              className="absolute left-1/2 top-1/2 flex items-center justify-center"
                              style={{ transform: "translate(-50%, -50%) translateX(-3px)" }}
                            >
                              <JerseyIcon
                                seed={entry.raceHorseId}
                                width={tileWidth}
                                height={tileHeight}
                                shape="square"
                                baseColor={jerseyColor}
                                className="rounded-sm shadow-sm"
                              />
                            </div>
                          </div>
                          <span className="font-semibold leading-tight text-ink">
                            {entry.displayName}
                          </span>
                          {entry.serviceType?.displayName && (
                            <span className="text-[10px] uppercase tracking-[0.3em] text-slate">
                              {entry.serviceType.displayName}
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-xs ${
                            finishedLabel === "Eliminated"
                              ? "text-warning"
                              : finishedLabel === "Finished"
                                ? "text-accent2"
                                : "text-slate"
                          }`}
                        >
                          {placementLabel ?? finishedLabel}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

            </section>
          );
        })}

        {pager}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <RaceHeader race={headerRace} remainingMs={remainingMs} poolSize={poolSize} racedayStatus={racedayStatus} />
      <RaceTicketCompact
        raceId={null}
        ticketHorses={ticketHorses}
        walletState={walletState}
      />
      {body}
    </div>
  );
}
