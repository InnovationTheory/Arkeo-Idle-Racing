const iconMapping: Record<string, string> = {
  eth: "ethereum",
  ethereum: "ethereum",
  osmo: "osmosis",
  osmosis: "osmosis",
  arkeo: "arkeo",
  btc: "bitcoin",
  bitcoin: "bitcoin"
};

export function serviceIconPath(iconKey?: string): string {
  if (!iconKey) return "";
  const key = iconKey.toLowerCase();
  const folder = iconMapping[key];
  return folder ? `/resources/${folder}/info/logo.png` : "";
}
