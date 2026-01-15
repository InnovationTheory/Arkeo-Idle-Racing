const iconMapping: Record<string, string> = {
  eth: "ethereum",
  ethereum: "ethereum",
  osmo: "osmosis",
  osmosis: "osmosis",
  arkeo: "arkeo",
  btc: "bitcoin",
  bitcoin: "bitcoin"
};

function resolveServiceFolder(value?: string): string {
  if (!value) return "";
  const key = value.toLowerCase();
  const mapped = iconMapping[key];
  if (mapped) return mapped;
  if (key.includes("ethereum") || key.includes("eth") || key.includes("base")) return "ethereum";
  if (key.includes("osmosis") || key.includes("osmo")) return "osmosis";
  if (key.includes("arkeo")) return "arkeo";
  if (key.includes("bitcoin") || key.includes("btc")) return "bitcoin";
  return "";
}

export function serviceIconPath(iconKey?: string, displayName?: string): string {
  const primary = resolveServiceFolder(iconKey);
  if (primary) return `/resources/${primary}/info/logo.png`;
  const secondary = resolveServiceFolder(displayName);
  return secondary ? `/resources/${secondary}/info/logo.png` : "";
}
