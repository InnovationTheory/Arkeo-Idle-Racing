import React from "react";
import HorseGlyph from "./HorseGlyph";
import { horseStyle } from "../utils/horseStyle";

type HorseIconProps = {
  seed: string;
  size?: number;
  x?: number;
  y?: number;
  className?: string;
};

export default function HorseIcon({ seed, size = 40, x, y, className }: HorseIconProps) {
  const visual = horseStyle(seed);
  const glyphSize = 54;
  const glyphOffset = (100 - glyphSize) / 2;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      x={x}
      y={y}
      className={className}
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="50" fill={visual.coatColor} />
      <HorseGlyph
        width={glyphSize}
        height={glyphSize}
        x={glyphOffset}
        y={glyphOffset}
        style={{ color: visual.glyphColor }}
      />
    </svg>
  );
}
