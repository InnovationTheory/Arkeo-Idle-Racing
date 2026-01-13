import fs from "fs";
import path from "path";

type WordLists = {
  tokens: Set<string>;
  phrases: string[];
};

let cached: WordLists | null = null;

function loadWordLists(): WordLists {
  if (cached) return cached;
  const filePath = path.join(__dirname, "words.txt");
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    cached = { tokens: new Set(), phrases: [] };
    return cached;
  }

  const tokens = new Set<string>();
  const phrases: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const normalized = normalizeEntry(trimmed);
    if (!normalized) continue;
    if (normalized.includes(" ")) {
      phrases.push(normalized);
    } else {
      tokens.add(normalized);
    }
  }

  cached = { tokens, phrases };
  return cached;
}

function normalizeBase(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
}

function normalizeEntry(input: string): string {
  return normalizeBase(input).replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeForScan(input: string, applyLeetMap: boolean): string {
  let text = normalizeBase(input);

  if (applyLeetMap) {
    const leetMap: Record<string, string> = {
      "0": "o",
      "1": "i",
      "2": "z",
      "3": "e",
      "4": "a",
      "5": "s",
      "6": "g",
      "7": "t",
      "8": "b",
      "9": "g"
    };
    text = text.replace(/[0-9]/g, (digit) => leetMap[digit] ?? digit);
  }

  return text.replace(/[^a-z0-9]+/g, " ").trim();
}

function containsMatch(normalized: string, lists: WordLists): boolean {
  if (!normalized) return false;
  const padded = ` ${normalized} `;
  for (const phrase of lists.phrases) {
    if (padded.includes(` ${phrase} `)) return true;
  }

  const tokens = normalized.split(/\s+/);
  for (const token of tokens) {
    if (lists.tokens.has(token)) return true;
  }

  return false;
}

export function containsProfanity(input: string): boolean {
  const lists = loadWordLists();
  const normalized = normalizeForScan(input, false);
  if (containsMatch(normalized, lists)) return true;

  const leetNormalized = normalizeForScan(input, true);
  if (leetNormalized !== normalized && containsMatch(leetNormalized, lists)) return true;

  return false;
}
