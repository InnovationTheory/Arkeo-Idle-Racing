import React, { useMemo, useRef, useState } from "react";
import HorseSilhouette from "./HorseSilhouette";
import JerseyIcon from "./JerseyIcon";
import HorseCard from "./HorseCard";
import RaceEventBanner from "./RaceEventBanner";
import { serviceIconPath } from "../utils/serviceIcons";
import { contrastColor, horseStyle } from "../utils/horseStyle";
import type { RaceEvent } from "../hooks";

function formatOdds(odds: number | null | undefined): string {
  if (odds == null) return "";
  if (odds === 1) return "EVEN";
  if (odds === 1.5) return "3-2";
  return `${odds}-1`;
}

type TrackHorse = {
  raceHorseId: string;
  horseId?: string;
  displayName: string;
  position: number;
  rank?: number;
  finishRank?: number;
  serviceIconKey?: string;
  serviceName?: string;
  jerseyColor?: string;
  latencyDeltaMs?: number | null;
  liveLatencyMs?: number | null;
  errorType?: string | null;
  selectionCount?: number;
  card?: {
    horse: {
      raceHorseId: string;
      horseId?: string;
      displayName: string;
      handicapTier: string;
      formScore: number;
      difficultyMultiplier: number;
      archetype?: "front_runner" | "stalker" | "stretch_runner" | "grinder" | "burst" | "erratic";
      temperament?: "calm" | "normal" | "volatile";
      surfaceAffinity?: "dirt_specialist" | "turf_specialist" | "mud_lover" | "all_surface";
      odds?: number | null;
      record?: { wins: number; places: number; shows: number; advances: number; races: number; dnfs: number };
      serviceType: { displayName: string; iconKey: string; colorHex: string };
      assignedProvider?: { providerPubkey: string; moniker?: string | null } | null;
    };
    prepProbes?: Array<{
      latencyMs: number;
      probeOk?: boolean | null;
      errorType?: string | null;
    }>;
    slotNumber?: number;
    slotLabel?: string;
    jerseyColor?: string;
    selectedBy?: string[];
  };
};

type TrackViewProps = {
  horses: TrackHorse[];
  raceStatus?: string;
  racedayLevel?: number | null;
  event?: RaceEvent | null;
};

const TRACK_WIDTH = 900;
const LANE_HEIGHT = 84;
const TRACK_TOP = 60;
const TRACK_BOTTOM = 50;
const START_X = 146;
const HORSE_START_X = START_X - 52;
const HORSE_SIZE = 60;
const COIN_SIZE = 20;
const TILE_SIZE = 26;
const TILE_WIDTH = Math.round(TILE_SIZE * 0.58);
const TILE_HEIGHT = Math.round(TILE_SIZE * 1.05);
const NUMBER_SIZE = 20;
const FINISH_X = TRACK_WIDTH - 24;
const FINISH_LINE_MARGIN = 84;
const GRASS_SIZE = 18;
const ACCENT_GREEN = "#51980c";
const GRASS_COLOR = ACCENT_GREEN;

const formatOrdinal = (value: number) => {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
};

export default function TrackView({
  horses,
  raceStatus,
  racedayLevel,
  event
}: TrackViewProps) {
  const height =
    TRACK_TOP +
    Math.max(1, horses.length) * LANE_HEIGHT +
    TRACK_BOTTOM -
    LANE_HEIGHT;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredHorseId, setHoveredHorseId] = useState<string | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const hoveredHorse = useMemo(
    () => horses.find((horse) => horse.raceHorseId === hoveredHorseId),
    [horses, hoveredHorseId]
  );
  const hoverCard = hoveredHorse?.card ?? null;
  const tooltipOffset = 16;
  const tooltipWidth = 520;
  const tooltipHeight = 280;
  const tooltipPosition = useMemo(() => {
    if (!hoverPoint || !containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const maxX = Math.max(0, rect.width - tooltipWidth - tooltipOffset);
    const maxY = Math.max(0, rect.height - tooltipHeight - tooltipOffset);
    return {
      x: Math.min(hoverPoint.x + tooltipOffset, maxX),
      y: Math.min(hoverPoint.y + tooltipOffset, maxY)
    };
  }, [hoverPoint]);

  return (
    <div ref={containerRef} className="surface relative rounded-3xl p-5 select-none">
      <div className="h-14 mb-2 flex items-center justify-center">
        {event ? <RaceEventBanner event={event} /> : <div className="h-full" />}
      </div>
      <svg viewBox={`0 0 ${TRACK_WIDTH} ${height}`} className="w-full select-none" role="img">
        <rect
          x={0}
          y={0}
          width={TRACK_WIDTH}
          height={height}
          rx={24}
          fill="transparent"
        />
        <g className="track-grid">
          {horses.map((horse, index) => {
            const y = TRACK_TOP + index * LANE_HEIGHT;
            const lineStartX = START_X - 58;
            const lineEndX = TRACK_WIDTH - FINISH_LINE_MARGIN;
            const grassY = y - GRASS_SIZE / 2 - 6;
            return (
              <g key={horse.raceHorseId}>
                <line
                  x1={lineStartX}
                  y1={y}
                  x2={lineEndX}
                  y2={y}
                  strokeWidth={2}
                />
                <g transform={`translate(${lineStartX - GRASS_SIZE / 2}, ${grassY}) scale(${GRASS_SIZE / 24})`}>
                  <path
                    fill={GRASS_COLOR}
                    d="M5,2c.82.82,5.61,2.88,6,18,0,.65,0,1.31,0,2h3C14,2.12,7,2,5,2ZM19,5a7,7,0,0,0-5.56,3,16.3,16.3,0,0,1,1.12,4C15.74,6.79,18.39,5.61,19,5ZM2,9c.77.77,4.72,3.09,5,12,0,.32,0,.66,0,1h3C10,13.52,7.5,9.22,2,9ZM22,9c-2,0-7,2.25-7,13h3C18,13,21.12,9.88,22,9Z"
                  />
                </g>
                <g transform={`translate(${lineEndX - GRASS_SIZE / 2}, ${grassY - 1}) scale(${GRASS_SIZE / 24})`}>
                  <path
                    fill={GRASS_COLOR}
                    d="M5,2c.82.82,5.61,2.88,6,18,0,.65,0,1.31,0,2h3C14,2.12,7,2,5,2ZM19,5a7,7,0,0,0-5.56,3,16.3,16.3,0,0,1,1.12,4C15.74,6.79,18.39,5.61,19,5ZM2,9c.77.77,4.72,3.09,5,12,0,.32,0,.66,0,1h3C10,13.52,7.5,9.22,2,9ZM22,9c-2,0-7,2.25-7,13h3C18,13,21.12,9.88,22,9Z"
                  />
                </g>
              </g>
            );
          })}
        </g>

        {horses.map((horse, index) => {
          const y = TRACK_TOP + index * LANE_HEIGHT;
          const runWidth = TRACK_WIDTH - FINISH_LINE_MARGIN - HORSE_START_X;
          const clampedPosition = Math.max(0, Math.min(100, horse.position));
          const progress = clampedPosition / 100;
          const x = HORSE_START_X + runWidth * progress;
          const horseX = x - HORSE_SIZE / 2;
          const horseY = y - HORSE_SIZE / 2;
          const numberCenterX = NUMBER_SIZE / 2 + 20;
          const numberCenterY = y - 6;
          const coinCenterX = x - 3;
          const coinCenterY = horseY + 4;
          const coinInnerSize = COIN_SIZE * 0.92;
          const jerseyX = x - 3 - TILE_WIDTH / 2;
          const jerseyY = horseY + HORSE_SIZE / 2 - TILE_HEIGHT / 2;
          const tokenIconPath = serviceIconPath(horse.serviceIconKey, horse.serviceName);
          const tokenLabel = horse.serviceName?.slice(0, 3).toUpperCase() ?? "";
          const percentLabel = `${clampedPosition.toFixed(1)}%`;
          const rankValue =
            typeof horse.finishRank === "number" ? horse.finishRank : horse.rank ?? null;
          const showRank = clampedPosition >= 100 && typeof rankValue === "number";
          const endLabel = showRank ? formatOrdinal(rankValue ?? 0) : percentLabel;
          const serviceLabel = horse.serviceName?.toUpperCase() ?? "";
          const visualSeed = horse.horseId ?? horse.raceHorseId;
          const visual = horseStyle(visualSeed);
          const numberFill = horse.jerseyColor ?? "#FAF6F1";
          const numberText = horse.jerseyColor ? contrastColor(horse.jerseyColor) : "#1E1E1E";
          const slotLabel = horse.card?.slotLabel;
          const isRaceDay = typeof racedayLevel === "number";
          const flipLabels = clampedPosition >= 50;
          const labelX = flipLabels ? x - HORSE_SIZE / 2 - 10 : x + HORSE_SIZE / 2 + 10;
          const labelAnchor = flipLabels ? "end" : "start";
          const delta = typeof horse.latencyDeltaMs === "number" ? horse.latencyDeltaMs : null;
          const hasError = !!horse.errorType;

          // Calculate triangle count based on delta magnitude (1-3 triangles)
          const getTriangleCount = (deltaMs: number): number => {
            const absDelta = Math.abs(deltaMs);
            if (absDelta >= 100) return 3;
            if (absDelta >= 50) return 2;
            return 1;
          };

          // Build status indicator: error = red X, positive delta = green up triangles, negative = red down
          let statusLabel: string | null = null;
          let statusColor = ACCENT_GREEN;

          if (hasError) {
            statusLabel = "✕";
            statusColor = "#E45858";
          } else if (delta !== null && !Number.isNaN(delta) && delta !== 0) {
            const count = getTriangleCount(delta);
            if (delta > 0) {
              // Faster than baseline = green up triangles
              statusLabel = "▲".repeat(count);
              statusColor = ACCENT_GREEN;
            } else {
              // Slower than baseline = red down triangles
              statusLabel = "▼".repeat(count);
              statusColor = "#E45858";
            }
          }
          return (
            <g
              key={horse.raceHorseId}
              className="cursor-pointer"
              onMouseEnter={(event) => {
                setHoveredHorseId(horse.raceHorseId);
                const rect = containerRef.current?.getBoundingClientRect();
                if (!rect) return;
                setHoverPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
              }}
              onMouseMove={(event) => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (!rect) return;
                setHoverPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
              }}
              onMouseLeave={() => {
                setHoveredHorseId(null);
                setHoverPoint(null);
              }}
            >
              <g>
                {isRaceDay && slotLabel ? (
                  <>
                    <circle
                      cx={numberCenterX + 8}
                      cy={numberCenterY}
                      r={16}
                      fill={numberFill}
                      stroke="#243447"
                      strokeOpacity={0.2}
                    />
                    <text
                      x={numberCenterX + 8}
                      y={numberCenterY - 8}
                      fontSize={7}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={numberText}
                      fontFamily="Space Grotesk, system-ui"
                      fontWeight={600}
                    >
                      {slotLabel.split("\n")[0] || ""}
                    </text>
                    <text
                      x={numberCenterX + 8}
                      y={numberCenterY}
                      fontSize={7}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={numberText}
                      fontFamily="Space Grotesk, system-ui"
                      fontWeight={600}
                    >
                      {slotLabel.split("\n")[1] || ""}
                    </text>
                    <text
                      x={numberCenterX + 8}
                      y={numberCenterY + 8}
                      fontSize={7}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={numberText}
                      fontFamily="Space Grotesk, system-ui"
                      fontWeight={700}
                    >
                      {slotLabel.split("\n")[2] || ""}
                    </text>
                  </>
                ) : (
                  <>
                    <circle
                      cx={numberCenterX}
                      cy={numberCenterY}
                      r={NUMBER_SIZE / 2}
                      fill={numberFill}
                      stroke="#243447"
                      strokeOpacity={0.2}
                    />
                    <text
                      x={numberCenterX}
                      y={numberCenterY + 0.5}
                      fontSize={9}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={numberText}
                      fontFamily="Space Grotesk, system-ui"
                    >
                      {index + 1}
                    </text>
                  </>
                )}
              </g>
              <g>
                <HorseSilhouette
                  width={HORSE_SIZE}
                  height={HORSE_SIZE}
                  x={horseX}
                  y={horseY}
                  style={{ color: visual.coatColor }}
                />
                <circle
                  cx={coinCenterX}
                  cy={coinCenterY}
                  r={COIN_SIZE / 2}
                  fill="#FAF6F1"
                  stroke="#243447"
                  strokeOpacity={0.2}
                />
                {tokenIconPath ? (
                  <image
                    href={tokenIconPath}
                    x={coinCenterX - coinInnerSize / 2}
                    y={coinCenterY - coinInnerSize / 2}
                    width={coinInnerSize}
                    height={coinInnerSize}
                  />
                ) : (
                  <text
                    x={coinCenterX}
                    y={coinCenterY + 3}
                    fontSize={6}
                    textAnchor="middle"
                    fill="#1E1E1E"
                    fontFamily="Space Grotesk, system-ui"
                  >
                    {tokenLabel}
                  </text>
                )}
              </g>
            <JerseyIcon
              seed={visualSeed}
                width={TILE_WIDTH}
                height={TILE_HEIGHT}
                shape="square"
                x={jerseyX}
                y={jerseyY}
                baseColor={horse.jerseyColor}
              />
              <text
                x={labelX}
                y={y - 9}
                fontSize={16}
                fontWeight={600}
                textAnchor={labelAnchor}
                fill="#1E1E1E"
                fontFamily="Space Grotesk, system-ui"
              >
                {horse.displayName}
                {horse.card?.horse?.odds != null && (
                  <tspan fill="#16a34a" dx="8" fontSize="12">{formatOdds(horse.card.horse.odds)}</tspan>
                )}
              </text>
              {statusLabel && (
                <text
                  x={labelX}
                  y={y - 28}
                  fontSize={10}
                  fontWeight={600}
                  textAnchor={labelAnchor}
                  fill={statusColor}
                  fontFamily="Space Grotesk, system-ui"
                >
                  {statusLabel}
                </text>
              )}
              {serviceLabel && (
                <text
                  x={labelX}
                  y={y + 17}
                  fontSize={10}
                  fontWeight={600}
                  letterSpacing={3}
                  textAnchor={labelAnchor}
                  fill="#6B6B6B"
                  fontFamily="Space Grotesk, system-ui"
                >
                  {serviceLabel}
                </text>
              )}
              {typeof horse.selectionCount === "number" && horse.selectionCount > 0 && (
                <text
                  x={labelX}
                  y={y + 32}
                  fontSize={9}
                  fontWeight={600}
                  textAnchor={labelAnchor}
                  fill="#F26A3D"
                  fontFamily="Space Grotesk, system-ui"
                >
                  {horse.selectionCount} {horse.selectionCount === 1 ? "player" : "players"}
                </text>
              )}
              {showRank && typeof rankValue === "number" && (racedayLevel === 4 ? rankValue <= 3 : rankValue <= 5) ? (
                <g>
                  <circle
                    cx={FINISH_X - 16}
                    cy={y - 4}
                    r={14}
                    fill={
                      racedayLevel === 4
                        ? rankValue === 1
                          ? "#FFD700" // Gold
                          : rankValue === 2
                            ? "#C0C0C0" // Silver
                            : "#CD7F32" // Bronze
                        : ACCENT_GREEN
                    }
                  />
                  <text
                    x={FINISH_X - 16}
                    y={y - 3}
                    fontSize={10}
                    fontWeight={600}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={racedayLevel === 4 && rankValue <= 2 ? "#1E1E1E" : "#FFFFFF"}
                    fontFamily="Space Grotesk, system-ui"
                  >
                    {endLabel}
                  </text>
                </g>
              ) : (
                <text
                  x={FINISH_X}
                  y={y}
                  fontSize={11}
                  textAnchor="end"
                  fill="#6B6B6B"
                  fontFamily="Space Grotesk, system-ui"
                >
                  {endLabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hoverCard && tooltipPosition && (
        <div
          className="pointer-events-none absolute z-20"
          style={{ left: tooltipPosition.x, top: tooltipPosition.y, width: tooltipWidth }}
        >
          <HorseCard
            horse={hoverCard.horse}
            prepProbes={hoverCard.prepProbes}
            slotNumber={hoverCard.slotNumber}
            slotLabel={hoverCard.slotLabel}
            jerseyColor={hoverCard.jerseyColor}
            background="#FAF6F1"
            selectedBy={hoverCard.selectedBy}
            raceStatus={raceStatus}
            racedayLevel={racedayLevel}
            interactive={false}
          />
        </div>
      )}
    </div>
  );
}
