import React from "react";
import HorseSilhouette from "./HorseSilhouette";
import JerseyIcon from "./JerseyIcon";
import { serviceIconPath } from "../utils/serviceIcons";
import { contrastColor, horseStyle } from "../utils/horseStyle";
import { archetypeLabels, archetypeTooltips, temperamentLabels, surfaceAffinityLabels, surfaceAffinityTooltips } from "../utils/archetypes";

function formatOdds(odds: number | null | undefined): string {
  if (odds == null) return "";
  if (odds === 1) return "EVEN";
  if (odds === 1.5) return "3-2";
  return `${odds}-1`;
}

type HorseRecord = {
  wins: number;
  places: number;
  shows: number;
  advances: number;
  races: number;
  dnfs: number;
};

type HorseCardProps = {
  horse: {
    raceHorseId: string;
    horseId?: string;
    displayName: string;
    handicapTier?: string;
    formScore?: number;
    difficultyMultiplier?: number;
    archetype?: keyof typeof archetypeLabels;
    temperament?: keyof typeof temperamentLabels;
    surfaceAffinity?: keyof typeof surfaceAffinityLabels;
    odds?: number | null;
    record?: HorseRecord;
    serviceType: {
      displayName: string;
      iconKey: string;
      colorHex: string;
    };
    assignedProvider?: { providerPubkey: string; moniker?: string | null } | null;
  };
  prepProbes?: Array<{
    latencyMs: number;
    probeOk?: boolean | null;
    errorType?: string | null;
  }>;
  raceStatus?: string;
  slotNumber?: number;
  slotLabel?: string;
  selected?: boolean;
  locked?: boolean;
  jerseyColor?: string;
  interactive?: boolean;
  background?: string;
  selectedBy?: string[];
  backerCount?: number;
  onToggle?: (raceHorseId: string) => void;
  onConfirmSelection?: (raceHorseId: string) => void;
};

export default function HorseCard({
  horse,
  slotNumber,
  selected,
  locked,
  jerseyColor,
  interactive = true,
  background,
  selectedBy,
  backerCount,
  onToggle,
  onConfirmSelection,
  prepProbes,
  raceStatus,
  slotLabel
}: HorseCardProps) {
  const coinIconPath = serviceIconPath(horse.serviceType.iconKey, horse.serviceType.displayName);
  const visualSeed = horse.horseId ?? horse.raceHorseId;
  const visual = horseStyle(visualSeed);
  const horseSize = 78;
  const coinSize = 26;
  const tileSize = 30;
  const tileWidth = Math.round(tileSize * 0.58);
  const tileHeight = Math.round(tileSize * 1.05);
  const hoverClasses =
    !interactive || locked ? "" : "hover:-translate-y-1 hover:-rotate-[0.5deg] hover:shadow-xl";
  const borderClasses = "border-ink/10";
  const lockedClasses = locked
    ? selected
      ? "cursor-not-allowed"
      : "cursor-not-allowed"
    : "";
  const lockedStyle = locked && !selected ? { filter: "grayscale(40%) brightness(95%)" } : undefined;
  const mergedStyle = background ? { ...lockedStyle, background } : lockedStyle;
  const providerLabel = horse.assignedProvider?.moniker?.trim() ?? null;
  const probeValues = prepProbes ? prepProbes.slice(0, 3) : [];
  const displayProbes = Array.from({ length: 3 }, (_, index) => probeValues[index] ?? null);
  const archetypeKey = horse.archetype ?? null;
  const temperamentKey = horse.temperament ?? null;
  const surfaceAffinityKey = horse.surfaceAffinity ?? null;
  const archetypeLabel = archetypeKey ? archetypeLabels[archetypeKey] : null;
  const temperamentLabel = temperamentKey ? temperamentLabels[temperamentKey] : null;
  const surfaceAffinityLabel = surfaceAffinityKey ? surfaceAffinityLabels[surfaceAffinityKey] : null;
  const archetypeTooltip = archetypeKey
    ? `${archetypeLabels[archetypeKey]} — ${archetypeTooltips[archetypeKey]}`
    : "";
  const surfaceAffinityTooltip = surfaceAffinityKey
    ? `${surfaceAffinityLabels[surfaceAffinityKey]} — ${surfaceAffinityTooltips[surfaceAffinityKey]}`
    : "";
  const archetypePill = archetypeLabel ?? "Stalker";
  const temperamentPill = temperamentLabel ?? "Normal";
  const surfaceAffinityPill = surfaceAffinityLabel ?? "All-Surface";
  const raceStarted = raceStatus ? ["running", "finished", "voided"].includes(raceStatus) : false;
  const showWarmup = !raceStarted && displayProbes.some(Boolean);
  const oddsDisplay = formatOdds(horse.odds);
  const showOdds = oddsDisplay && !raceStarted;
  const slotText = slotLabel ?? (typeof slotNumber === "number" ? String(slotNumber) : null);
  const slotLines = slotText ? slotText.split("\n") : [];
  const actionLabel = selected ? "Remove" : "Select";

  const selectionList = selectedBy?.filter(Boolean) ?? [];

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-disabled={locked || undefined}
      onClick={() => {
        if (!interactive) return;
        onToggle?.(horse.raceHorseId);
      }}
      onKeyDown={(event) => {
        if (!interactive || locked) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle?.(horse.raceHorseId);
        }
      }}
      className={`surface group relative flex w-full flex-col gap-3 rounded-2xl border-2 py-4 pl-12 pr-4 text-left transition-all duration-200 ${hoverClasses} ${borderClasses} ${lockedClasses}`}
      style={mergedStyle}
    >
      <div
        className="absolute inset-y-0 left-0 w-9 rounded-l-2xl"
        style={{ backgroundColor: jerseyColor ?? visual.coatColor }}
      />
      {slotLines.length > 0 && (
        <div
          className={`absolute left-0 top-1/2 flex w-9 -translate-y-1/2 items-center justify-center font-semibold ${
            slotLines.length > 1 ? "flex-col text-[10px] leading-[1.1]" : "text-[10px]"
          }`}
          style={{
            color: jerseyColor ? contrastColor(jerseyColor) : visual.glyphColor
          }}
        >
          {slotLines.length > 1
            ? slotLines.map((line, index) => (
                <span key={`${horse.raceHorseId}-slot-${index}`}>{line}</span>
              ))
            : slotLines[0]}
        </div>
      )}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div className="flex items-start gap-5">
          <div className="relative flex w-20 shrink-0 items-center justify-center">
            <div className="pointer-events-none absolute bottom-[-4px] left-1/2 h-3 w-14 -translate-x-1/2 rounded-full bg-ink/5 blur-[2px] scale-x-125" />
            <HorseSilhouette
              width={horseSize}
              height={horseSize}
              className="drop-shadow-sm"
              style={{ color: visual.coatColor }}
            />
            <div
              className="absolute left-1/2 z-20 flex items-center justify-center overflow-hidden rounded-full border border-midnight/10 bg-panel shadow-sm"
              style={{
                width: coinSize,
                height: coinSize,
                top: "-0.8125rem",
                transform: "translate(-50%, 0) translate(-4px, 6px)"
              }}
            >
              {coinIconPath ? (
                <img
                  src={coinIconPath}
                  alt=""
                  className="h-full w-full scale-105 rounded-full object-cover"
                />
              ) : (
                <span className="text-[10px] font-semibold text-ink/70">
                  {horse.serviceType.displayName.slice(0, 3).toUpperCase()}
                </span>
              )}
            </div>
            <div
              className="absolute left-1/2 top-1/2 z-10 flex items-center justify-center"
              style={{ transform: "translate(-50%, -50%) translateX(-3px)" }}
            >
              <JerseyIcon
                seed={visualSeed}
                width={tileWidth}
                height={tileHeight}
                shape="square"
                baseColor={jerseyColor}
                className="rounded-sm shadow-sm"
              />
            </div>
          </div>
          <div>
            <p className="text-xl font-semibold leading-tight text-ink">
              {horse.displayName}
              {oddsDisplay && (
                <span className="ml-2 text-base font-bold text-green-600">{oddsDisplay}</span>
              )}
            </p>
            <p className="text-xs uppercase tracking-[0.2em] text-slate">
              {horse.serviceType.displayName}
            </p>
            {providerLabel && (
              <span className="inline-flex rounded-full bg-green-600/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-green-600">
                {providerLabel}
              </span>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex rounded-full bg-ink/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/70"
                title={archetypeTooltip}
              >
                {archetypePill}
              </span>
              <span className="inline-flex rounded-full bg-ink/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/70">
                {temperamentPill}
              </span>
              <span
                className="inline-flex rounded-full bg-ink/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/70"
                title={surfaceAffinityTooltip}
              >
                {surfaceAffinityPill}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center self-center">
          {showOdds && (
            <div
              className={`flex flex-col items-center gap-1 transition ${
                !locked && onConfirmSelection ? "group-hover:hidden" : ""
              }`}
            >
              <span className="text-[10px] uppercase tracking-[0.2em] text-ink/50">Odds</span>
              <span className="text-2xl font-bold text-green-600">{oddsDisplay}</span>
              {horse.record && (
                <span className="text-[10px] uppercase tracking-[0.2em] text-ink/50">
                  {horse.record.wins}-{horse.record.places}-{horse.record.shows}-{horse.record.advances}
                </span>
              )}
              {showWarmup && (
                <div className="flex items-center gap-1 mt-1">
                  {displayProbes.map((probe, index) => (
                    <span
                      key={`${horse.raceHorseId}-probe-${index}`}
                      className="text-sm"
                    >
                      {probe === null ? (
                        <span className="text-ink/30">○</span>
                      ) : probe.probeOk ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-red-500">✗</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {typeof backerCount === "number" && backerCount > 0 && (
                <span className="mt-1 whitespace-nowrap text-[10px] uppercase tracking-[0.2em] text-ink/50">
                  {backerCount} {backerCount === 1 ? "backer" : "backers"}
                </span>
              )}
            </div>
          )}
          {!locked && onConfirmSelection && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onConfirmSelection(horse.raceHorseId);
              }}
              className="hidden rounded-full bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-white transition group-hover:block hover:-translate-y-0.5 hover:shadow-md"
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>

      {selectionList.length > 0 && (
        <div className="relative z-10 border-t border-dashed border-midnight/20 pt-3">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate">Selected by</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {selectionList.slice(0, 6).map((name) => (
              <span
                key={`${horse.raceHorseId}-${name}`}
                className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold text-ink/70"
              >
                {name}
              </span>
            ))}
            {selectionList.length > 6 && (
              <span className="text-[10px] font-semibold text-slate">
                +{selectionList.length - 6} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
