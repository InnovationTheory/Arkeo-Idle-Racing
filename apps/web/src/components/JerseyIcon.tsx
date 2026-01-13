import React, { useId } from "react";
import { contrastColor, horseStyle } from "../utils/horseStyle";

type JerseyIconProps = {
  seed: string;
  size?: number;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  className?: string;
  shape?: "circle" | "square";
  baseColor?: string;
  patternColor?: string;
};

export default function JerseyIcon({
  seed,
  size = 40,
  width,
  height,
  x,
  y,
  className,
  shape = "circle",
  baseColor,
  patternColor
}: JerseyIconProps) {
  const visual = horseStyle(seed);
  const clipId = useId().replace(/:/g, "");
  const isSquare = shape === "square";
  const resolvedWidth = width ?? size;
  const resolvedHeight = height ?? size;
  const resolvedBaseColor = baseColor ?? visual.patternBaseColor;
  const resolvedPatternColor = patternColor ?? contrastColor(resolvedBaseColor);

  return (
    <svg
      viewBox="0 0 100 100"
      width={resolvedWidth}
      height={resolvedHeight}
      preserveAspectRatio={resolvedWidth === resolvedHeight ? "xMidYMid meet" : "none"}
      x={x}
      y={y}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={`jersey-clip-${clipId}`}>
          {isSquare ? (
            <rect x="0" y="0" width="100" height="100" rx="6" ry="6" />
          ) : (
            <circle cx="50" cy="50" r="50" />
          )}
        </clipPath>
      </defs>
      {isSquare ? (
        <rect x="0" y="0" width="100" height="100" rx="6" ry="6" fill={resolvedBaseColor} />
      ) : (
        <circle cx="50" cy="50" r="50" fill={resolvedBaseColor} />
      )}
      <g clipPath={`url(#jersey-clip-${clipId})`}>
        {visual.pattern === "vertical_stripe" && (
          <rect x="36" y="0" width="28" height="100" fill={resolvedPatternColor} />
        )}
        {visual.pattern === "horizontal_band" && (
          <rect x="0" y="35" width="100" height="30" fill={resolvedPatternColor} />
        )}
        {visual.pattern === "diagonal_sash" && (
          <rect
            x="-20"
            y="40"
            width="140"
            height="20"
            fill={resolvedPatternColor}
            transform="rotate(-35 50 50)"
          />
        )}
        {visual.pattern === "quartered" && (
          <>
            <rect x="0" y="0" width="50" height="50" fill={resolvedPatternColor} />
            <rect x="50" y="50" width="50" height="50" fill={resolvedPatternColor} />
          </>
        )}
        {visual.pattern === "diamond" && (
          <polygon
            points="50,8 92,50 50,92 8,50"
            fill={resolvedPatternColor}
          />
        )}
      </g>
    </svg>
  );
}
