export type HorseRarity = "common" | "rare" | "epic" | "legendary";
export type HorsePattern =
  | "solid"
  | "vertical_stripe"
  | "horizontal_band"
  | "diagonal_sash"
  | "quartered"
  | "diamond";

export type HorseVisual = {
  coatColor: string;
  glyphColor: string;
  patternBaseColor: string;
  patternColor: string;
  pattern: HorsePattern;
  rarity: HorseRarity;
};

export type PatternStyle = {
  backgroundImage: string;
  backgroundRepeat: string;
  backgroundSize: string;
  backgroundPosition: string;
};

export const jerseyPalette = [
  "#3BE0FF",
  "#7B5CFF",
  "#E84C4C",
  "#7DDA58",
  "#E6B85C",
  "#3B4B9A",
  "#61ac59",
  "#E04EB8",
  "#1E1E1E",
  "#E1E1E1",
  "#F26A3D",
  "#2F80ED",
  "#B93A3A",
  "#2E7D32",
  "#7EC8E3",
  "#E5F04C",
  "#7A7A7A",
  "#4A2F7C",
  "#4ED6C1",
  "#F07AA6"
];

const horseCoatPalette = [
  "#8B4A2F",
  "#6B3E26",
  "#4A2C1A",
  "#1E1E1E",
  "#B3B3B3",
  "#9E9E9E",
  "#E6C27A",
  "#C2A060",
  "#8F7F75",
  "#C8C8C8"
];

const patternByRarity: Record<HorseRarity, HorsePattern[]> = {
  common: ["solid", "vertical_stripe"],
  rare: ["horizontal_band", "diagonal_sash"],
  epic: ["quartered"],
  legendary: ["diamond"]
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((c) => c + c).join("")
    : normalized;
  const int = parseInt(value, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
}

function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastColor(baseColor: string) {
  return luminance(baseColor) > 0.55 ? "#1E1E1E" : "#FFFFFF";
}

function rarityFromHash(hash: number): HorseRarity {
  const roll = hash % 100;
  if (roll < 55) return "common";
  if (roll < 80) return "rare";
  if (roll < 95) return "epic";
  return "legendary";
}

export function horseStyle(seed: string): HorseVisual {
  const hash = hashString(seed);
  const coatColor = horseCoatPalette[hash % horseCoatPalette.length];
  const patternBaseColor = jerseyPalette[(hash >> 4) % jerseyPalette.length];
  const rarity = rarityFromHash(hash >> 8);
  const patterns = patternByRarity[rarity];
  const pattern = patterns[(hash >> 10) % patterns.length];
  const patternColor = contrastColor(patternBaseColor);
  const glyphColor = contrastColor(coatColor);

  return { coatColor, glyphColor, patternBaseColor, patternColor, pattern, rarity };
}

export function horseCardPattern(visual: HorseVisual): PatternStyle {
  const width = 240;
  const height = 140;
  const baseFill = visual.patternBaseColor;
  const accentFill = visual.patternColor;

  let shape = `<rect width="${width}" height="${height}" fill="${baseFill}" />`;
  switch (visual.pattern) {
    case "solid":
      shape = `<rect width="${width}" height="${height}" fill="${baseFill}" />`;
      break;
    case "vertical_stripe":
      shape += `<rect x="${width * 0.35}" width="${width * 0.3}" height="${height}" fill="${accentFill}" />`;
      break;
    case "horizontal_band":
      shape += `<rect y="${height * 0.35}" width="${width}" height="${height * 0.3}" fill="${accentFill}" />`;
      break;
    case "diagonal_sash":
      shape += `<rect x="-20" y="${height * 0.4}" width="${width + 40}" height="${height * 0.22}" fill="${accentFill}" transform="rotate(-20 ${width / 2} ${height / 2})" />`;
      break;
    case "quartered":
      shape += `<rect width="${width / 2}" height="${height / 2}" fill="${accentFill}" /><rect x="${width / 2}" y="${height / 2}" width="${width / 2}" height="${height / 2}" fill="${accentFill}" />`;
      break;
    case "diamond":
      shape += `<polygon points="${width / 2},${height * 0.08} ${width * 0.92},${height / 2} ${width / 2},${height * 0.92} ${width * 0.08},${height / 2}" fill="${accentFill}" />`;
      break;
    default:
      break;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${shape}</svg>`;
  const encoded = encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22");

  return {
    backgroundImage: `url("data:image/svg+xml,${encoded}")`,
    backgroundRepeat: "no-repeat",
    backgroundSize: "100% 100%",
    backgroundPosition: "center"
  };
}
