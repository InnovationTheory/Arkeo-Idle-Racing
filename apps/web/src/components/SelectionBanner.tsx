import React from "react";
import HorseSilhouette from "./HorseSilhouette";
import JerseyIcon from "./JerseyIcon";
import { serviceIconPath } from "../utils/serviceIcons";
import { contrastColor, horseStyle } from "../utils/horseStyle";

type SelectedHorse = {
  raceHorseId: string;
  horseId?: string;
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

type SelectionBannerProps = {
  horse: SelectedHorse | null;
  jerseyColor?: string;
  raceId: string | null;
  onClear?: () => void;
};

export default function SelectionBanner({
  horse,
  jerseyColor,
  raceId,
  onClear
}: SelectionBannerProps) {
  if (!horse || !raceId) return null;

  const visualSeed = horse.horseId ?? horse.raceHorseId;
  const visual = horseStyle(visualSeed);
  const coinIconPath = serviceIconPath(horse.serviceType.iconKey, horse.serviceType.displayName);
  const horseSize = 40;
  const coinSize = 16;
  const effectiveJerseyColor = jerseyColor ?? horse.jerseyColor;
  const providerLabel = horse.providerMoniker?.trim() ?? null;
  const slotText = horse.slotLabel ?? (typeof horse.slotNumber === "number" ? String(horse.slotNumber) : null);
  const slotLines = slotText ? slotText.split("\n") : [];

  const tabColor = effectiveJerseyColor ?? visual.coatColor;

  return (
    <div className="surface relative flex items-center justify-between gap-4 rounded-2xl border-[3px] border-accent2 py-3 pl-10 pr-4">
      <div
        className="absolute inset-y-0 left-0 flex w-7 items-center justify-center"
        style={{ backgroundColor: tabColor, borderTopLeftRadius: 13, borderBottomLeftRadius: 13 }}
      >
        {slotLines.length > 0 && (
          <span
            className={`font-semibold ${slotLines.length > 1 ? "text-[8px] leading-[1.1]" : "text-xs"}`}
            style={{ color: contrastColor(tabColor) }}
          >
            {slotLines.length > 1
              ? slotLines.map((line, index) => (
                  <span key={`${horse.raceHorseId}-slot-${index}`} className="block">
                    {line}
                  </span>
                ))
              : slotLines[0]}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <div className="relative flex shrink-0 items-center justify-center" style={{ width: horseSize, height: horseSize }}>
          <HorseSilhouette
            width={horseSize}
            height={horseSize}
            className="drop-shadow-sm"
            style={{ color: visual.coatColor }}
          />
          <div
            className="absolute z-20 flex items-center justify-center overflow-hidden rounded-full border border-midnight/10 bg-panel shadow-sm"
            style={{
              width: coinSize,
              height: coinSize,
              top: -4,
              left: "50%",
              transform: "translateX(-50%) translateX(-2px)"
            }}
          >
            {coinIconPath ? (
              <img src={coinIconPath} alt="" className="h-full w-full rounded-full object-cover" />
            ) : (
              <span className="text-[6px] font-semibold text-ink/70">
                {horse.serviceType.displayName.slice(0, 3).toUpperCase()}
              </span>
            )}
          </div>
          <div
            className="absolute left-1/2 top-1/2 z-10"
            style={{ transform: "translate(-50%, -50%) translateX(-2px)" }}
          >
            <JerseyIcon
              seed={visualSeed}
              width={10}
              height={18}
              shape="square"
              baseColor={effectiveJerseyColor}
              className="rounded-sm shadow-sm"
            />
          </div>
        </div>
        <div>
          <p className="font-semibold text-ink">{horse.displayName}</p>
          <p className="text-xs text-slate">{horse.serviceType.displayName}</p>
          {providerLabel && (
            <span
              className="mt-1 inline-flex rounded-full bg-accent2/15 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent2"
            >
              {providerLabel}
            </span>
          )}
        </div>
      </div>
      <p className="text-[10px] uppercase tracking-[0.3em] text-accent2">
        Your Selection
      </p>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-full bg-accent px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-white transition hover:-translate-y-0.5"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
