import { PrismaClient, HandicapTier, ProbeType, Prisma, TrackSurface } from "@prisma/client";

const prisma = new PrismaClient();

// Track names - hardcoded real locations
const trackNames = [
  "Airdrop Acres",
  "Ape Arena",
  "Arbitrage Acres",
  "Bag Holder Bend",
  "Bagholder Bay",
  "Bellcurve Park",
  "Belmont Block",
  "Blockchain Bay",
  "Bonding Curve Bend",
  "Byzantine Bend",
  "Capitulation Canyon",
  "Ceiling Price Park",
  "Charts Town",
  "Churchill Clowns",
  "Churchill Coins",
  "Cold Wallet Way",
  "Consensus Canyon",
  "Correction Creek",
  "Crypto Creek",
  "Dead Cat Downs",
  "Degen Downs",
  "Delta Hedge Downs",
  "Diamond Hand Downs",
  "Difficulty Downs",
  "Dump Downs",
  "Emission Estates",
  "Evangeline FUD",
  "Fair Launch Grounds",
  "Fat Finger Lakes",
  "Finality Fields",
  "Flamingo Staking",
  "Flash Loan Flats",
  "Floor Price Fields",
  "Fork Flats",
  "Frontrun Fields",
  "Funding Rate Farms",
  "Gas Fee Gardens",
  "Genesis Gardens",
  "Golden Ratio Fields",
  "Gulfstream Gwei",
  "Halving Hills",
  "Hashrate Heights",
  "Hawthorne Hype",
  "High Leverage Park",
  "Hodl Hollow",
  "Impermanent Downs",
  "Jailbreak Junction",
  "Keeneland Keynesian",
  "Kentucky Dumps",
  "Lambo Landing",
  "Ledger Lanes",
  "Leverage Lanes",
  "Limit Order Lodge",
  "Liquidation Lakes",
  "Liquidity Lakes",
  "Lone Stonk Park",
  "Long Meadows",
  "Longchamp Short",
  "Loss Alamitos",
  "Mainnet Manor",
  "Margin Downs",
  "Maxi Meadows",
  "Merkle Meadows",
  "Mint Meadows",
  "Minting Mills",
  "Mooning Valley",
  "Moonshot Meadows",
  "Nakamoto Knolls",
  "New Market Cycle",
  "Node Downs",
  "Nonce Downs",
  "Oracle Oaks",
  "Paper Hands Park",
  "Pimlico Ponzi",
  "Ponzi Pines",
  "Proof Of Pastures",
  "Protocol Plains",
  "Pump Park",
  "Pumplico",
  "Rally Ridge",
  "Random Walk Park",
  "Rekt Ranch",
  "Reorg Raceway",
  "Rug Run",
  "Rugpull Raceway",
  "Sandwich Speedway",
  "Santa Apeita",
  "Saratoga Satoshi",
  "Saratoga Stonks",
  "Shill Springs",
  "Short Squeeze Speedway",
  "Slashing Stables",
  "Slippage Slopes",
  "Soft Fork Fields",
  "Spread Speedway",
  "Stablecoin Stables",
  "Staking Stables",
  "Stop Loss Springs",
  "Testnet Turf",
  "The Memelands",
  "Token Track",
  "Turfwar Park",
  "Unhappy Valley",
  "Validator Valley",
  "Vaporware Valley",
  "Volume Valley",
  "Whale Watch Way",
  "Whitepaper Woods",
  "Yolo Downs",
  "York Fork",
  "Zero Sum Speedway"
];

// Generate deterministic track specs based on index
// Surfaces cycle: dirt, turf, synthetic
const surfaces = [TrackSurface.dirt, TrackSurface.turf, TrackSurface.synthetic];

// Track configurations by tier (short/medium/long)
const trackConfigs = {
  short: {
    durationRange: [60, 90],
    tickRange: [600, 800],
    rampTypes: [
      { type: "linear", start: 0.5, end: 1.0, paceMult: 1.15 },
      { type: "linear", start: 0.6, end: 1.0, paceMult: 1.12 },
      { type: "pulse", start: 0.4, end: 1.2, paceMult: 1.20 }
    ],
    thresholds: [
      { p95Ms: 650, errorRate: 0.15, maxStaleTicks: 3, latencyConsecutiveTicks: 2, errorConsecutiveTicks: 2 },
      { p95Ms: 700, errorRate: 0.18, maxStaleTicks: 3, latencyConsecutiveTicks: 2, errorConsecutiveTicks: 2 },
      { p95Ms: 750, errorRate: 0.20, maxStaleTicks: 4, latencyConsecutiveTicks: 2, errorConsecutiveTicks: 2 }
    ]
  },
  medium: {
    durationRange: [90, 130],
    tickRange: [750, 1000],
    rampTypes: [
      { type: "linear", start: 0.4, end: 0.95, paceMult: 1.18 },
      { type: "linear", start: 0.35, end: 1.0, paceMult: 1.15 },
      { type: "pulse", start: 0.3, end: 1.1, paceMult: 1.22 }
    ],
    thresholds: [
      { p95Ms: 800, errorRate: 0.18, maxStaleTicks: 5, latencyConsecutiveTicks: 3, errorConsecutiveTicks: 3 },
      { p95Ms: 900, errorRate: 0.20, maxStaleTicks: 5, latencyConsecutiveTicks: 3, errorConsecutiveTicks: 3 },
      { p95Ms: 1000, errorRate: 0.22, maxStaleTicks: 6, latencyConsecutiveTicks: 4, errorConsecutiveTicks: 3 }
    ]
  },
  long: {
    durationRange: [130, 180],
    tickRange: [1000, 1200],
    rampTypes: [
      { type: "linear", start: 0.2, end: 0.9, paceMult: 1.20 },
      { type: "linear", start: 0.15, end: 0.85, paceMult: 1.18 },
      { type: "pulse", start: 0.25, end: 1.0, paceMult: 1.25 }
    ],
    thresholds: [
      { p95Ms: 1100, errorRate: 0.20, maxStaleTicks: 7, latencyConsecutiveTicks: 4, errorConsecutiveTicks: 4 },
      { p95Ms: 1200, errorRate: 0.22, maxStaleTicks: 8, latencyConsecutiveTicks: 5, errorConsecutiveTicks: 5 },
      { p95Ms: 1300, errorRate: 0.25, maxStaleTicks: 8, latencyConsecutiveTicks: 5, errorConsecutiveTicks: 5 }
    ]
  }
};

// Simple hash function for deterministic randomness based on string
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Generate track specs deterministically
const tracks = trackNames.map((name, index) => {
  const hash = simpleHash(name);

  // Determine tier based on index distribution (roughly even split)
  const tierIndex = index % 3;
  const tier = tierIndex === 0 ? "short" : tierIndex === 1 ? "medium" : "long";
  const config = trackConfigs[tier];

  // Surface cycles through the three types
  const surface = surfaces[index % 3];

  // Duration varies within tier range based on hash
  const durationRange = config.durationRange[1] - config.durationRange[0];
  const durationSecs = config.durationRange[0] + (hash % durationRange);

  // Tick varies within tier range
  const tickRange = config.tickRange[1] - config.tickRange[0];
  const tickMs = config.tickRange[0] + ((hash >> 4) % tickRange);

  // Ramp config based on hash
  const rampConfigJson = config.rampTypes[hash % config.rampTypes.length];

  // Thresholds based on hash
  const thresholdsJson = config.thresholds[(hash >> 8) % config.thresholds.length];

  // Generate URL-friendly ID from name
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");

  return {
    id,
    name,
    surface,
    durationSecs,
    tickMs,
    rampConfigJson,
    thresholdsJson
  };
});

const weathers = [
  {
    id: "clear",
    name: "Clear Skies",
    modifiersJson: {
      latencyMult: 1.0,
      errorMult: 1.0,
      jitterMult: 0.8,
      spikes: []
    }
  },
  {
    id: "breeze",
    name: "Light Breeze",
    modifiersJson: {
      latencyMult: 1.02,
      errorMult: 1.0,
      jitterMult: 1.05,
      spikes: []
    }
  },
  {
    id: "haze",
    name: "Network Haze",
    modifiersJson: {
      latencyMult: 1.05,
      errorMult: 1.05,
      jitterMult: 1.1,
      spikes: [30]
    }
  },
  {
    id: "gusts",
    name: "Gusty Winds",
    modifiersJson: {
      latencyMult: 1.1,
      errorMult: 1.05,
      jitterMult: 1.25,
      spikes: [20, 40]
    }
  },
  {
    id: "rain",
    name: "Packet Drizzle",
    modifiersJson: {
      latencyMult: 1.12,
      errorMult: 1.1,
      jitterMult: 1.15,
      spikes: [25, 50]
    }
  },
  {
    id: "squall",
    name: "Signal Squall",
    modifiersJson: {
      latencyMult: 1.15,
      errorMult: 1.15,
      jitterMult: 1.35,
      spikes: [15, 30, 45]
    }
  },
  {
    id: "storm",
    name: "Error Storm",
    modifiersJson: {
      latencyMult: 1.2,
      errorMult: 1.3,
      jitterMult: 1.1,
      spikes: [20, 40, 60]
    }
  },
  {
    id: "thunderstorm",
    name: "Latency Thunderstorm",
    modifiersJson: {
      latencyMult: 1.3,
      errorMult: 1.25,
      jitterMult: 1.4,
      spikes: [10, 25, 50, 75]
    }
  },
  {
    id: "fog",
    name: "Blackout Fog",
    modifiersJson: {
      latencyMult: 1.35,
      errorMult: 1.4,
      jitterMult: 1.2,
      spikes: [35, 70]
    }
  },
  {
    id: "catastrophic",
    name: "Perfect Storm",
    modifiersJson: {
      latencyMult: 1.5,
      errorMult: 1.6,
      jitterMult: 1.5,
      spikes: [10, 20, 30, 45, 60]
    }
  }
];

const serviceTypes = [
  {
    id: "ethereum-mainnet",
    displayName: "Ethereum Mainnet",
    iconKey: "eth",
    colorHex: "#627EEA",
    probeType: ProbeType.ethereum_jsonrpc
  },
  {
    id: "osmosis-1",
    displayName: "Osmosis",
    iconKey: "osmo",
    colorHex: "#4E7FFF",
    probeType: ProbeType.cosmos_rpc
  },
  {
    id: "arkeo-mainnet",
    displayName: "Arkeo",
    iconKey: "arkeo",
    colorHex: "#F97316",
    probeType: ProbeType.cosmos_rpc
  }
];

const horseNames = [
  "Absolute Unit",
  "Alpha Signal",
  "APY Stallion",
  "Atomic Pony",
  "Market Maker",
  "Block Confirmed",
  "Blockfather",
  "Blocksmith",
  "Built Different",
  "Bull Run Royal",
  "Chain Reaction",
  "Chain Wrangler",
  "Chainbreaker",
  "By The Blocks",
  "Cold Wallet",
  "Colt Lightning",
  "Confirmed Winner",
  "Consensus Cowboy",
  "Consensus Incarnate",
  "Consensus King",
  "Cryptic Crown",
  "Cryptographic Colt",
  "Dead Cat Bounce",
  "Decentraland Dash",
  "Decentralized Crown",
  "DeFi Dynamo",
  "Diamond Hooves",
  "Digital Gold Rush",
  "Entropy Engine",
  "Exit Velocity",
  "Fast Finality",
  "Block Fetch",
  "Final Consensus",
  "Finality Run",
  "Flash Crash",
  "Fork Around",
  "Fork Forged",
  "Forked Lightning",
  "Full Send",
  "Gallop.exe",
  "Galloping Blocks",
  "Gas Fee Flyer",
  "Gas Whisperer",
  "Gasless Wonder",
  "Genesis Block",
  "Genesis Dash",
  "Green Candle",
  "Hash Function",
  "Hashrate Heat",
  "Horsepower Protocol",
  "Immutable Law",
  "Immutable One",
  "Immutable Stride",
  "Just Jailed",
  "Keeper of Fees",
  "King of Blocks",
  "Latency Slayer",
  "Layer Zero",
  "Ledger Legend",
  "Li'l Nonce",
  "Limitless Leverage",
  "Liquidated Late",
  "Liquidity Lancer",
  "Lord Balancer",
  "Lord of Ledgers",
  "Lost My Keys",
  "Margin Call",
  "Market Maker",
  "Meme Token",
  "Merkle Miracle",
  "Midnight Oracle",
  "Mint Condition",
  "Minted Majesty",
  "Moon or Glue",
  "Moonshot Majesty",
  "Much Speed Wow",
  "Nakamoto Nitro",
  "Noble Node",
  "Node Eternal",
  "Node Runner",
  "Number Go Up",
  "On-Chain Only",
  "On-Chain Thunder",
  "Oracle's Oath",
  "Panic Sell",
  "Paper Hands",
  "Parabolic Pony",
  "Peak Euphoria",
  "Peer-to-Peer Pony",
  "Prime Number",
  "Private Key",
  "Probably Nothing",
  "Proof of Hooves",
  "Proof of Speed",
  "Proof of Zoom",
  "Quantum Comet",
  "Race Condition",
  "Random Oracle",
  "Read the Whitepaper",
  "Regal Hash",
  "Rocket Fuel",
  "Royal Validator",
  "Rugproof",
  "Satoshi's Spur",
  "Signed Rocket",
  "Sir Dumps-A-Lot",
  "Slashing Survivor",
  "Slippage King",
  "Slippage Slipstream",
  "Smart Gallop",
  "Solidity Sprint",
  "Sovereign Chain",
  "Sovereign Speed",
  "Stablecoin",
  "Stop Loss King",
  "Immutable One",
  "Last Block",
  "This Is Fine",
  "To The Moon",
  "Tokenized Thunder",
  "Trust Me Bro",
  "Unstoppable Run",
  "UTXO Express",
  "Validator's Vow",
  "Very Fast Such Horse",
  "Victory Lap",
  "Wen Lambo",
  "Wen Moon",
  "Yield Farmer",
  "Zero Knowledge Proof",
  "Buy The Dip",
  "Sold Too Early",
  "Liquidation Event",
  "Last One Out",
  "Got Dumped",
  "Exit Pumped",
  "Overleveraged",
  "Works In Prod",
  "Pushed To Main",
  "Broke The Build",
  "Merge Conflict",
  "Hotfix Harry",
  "Rolled Back",
  "Dependency Hell",
  "Spaghetti Code",
  "Rage Quit",
  "Famous Last Words",
  "In Theory",
  "It's A Feature",
  "Not A Bug",
  "By Design",
  "Brace For Impact",
  "Any Day Now",
  "So Close",
  "Task Failed Successfully",
  "Unexpected Behavior",
  "Forgot To Save",
  "Speed Run",
  "Glitched Out",
  "Garbage In",
  "Garbage Out",
  "Fork In The Road",
  "Block Party",
  "Token Gesture",
  "Read The Fine Print",
  "Audit Pending",
  "Battle Tested",
  "Stress Tested",
  "Ship It",
  "Looks Good To Me",
  "No Notes",
  "Due Diligence",
  "Per My Last Email",
  "Circle Back",
  "Burn Rate",
  "Bootstrapped",
  "Golden Parachute",
  "Taking It Public",
  "Cold Feet",
  "Handshake Deal",
  "Gentleman's Agreement",
  "Non Binding",
  "Subject To Change",
  "Not Financial Advice",
  "Do Your Own Research",
  "No Guarantees",
  "Void Where Prohibited",
  "See Fine Print",
  "Miss Configured",
  "Crypto Queen",
  "Miss Demeanor",
  "Penny Stock",
  "Smart Cookie",
  "Fortune Favors Her",
  "Mother Of All Trades",
  "HODLR",
  "Honey Pot",
  "Hard To Get",
  "Champagne Problems",
  "First Class",
  "Brand New Block",
  "Sir This Is A Wendys",
  "Diamond Hooves",
  "Paper Hooves",
  "Smooth Brain",
  "Full Degen",
  "Hodl Your Horses",
  "Stonky Tonk",
  "Ape Jockey",
  "Full Ape",
  "Captain Fomo",
  "Absolutely Rekt",
  "Chad Thunderhooves",
  "Rare Pepe",
  "To The Mooooon",
  "Rugged And Loving It",
  "We Are So Back",
  "It's So Over",
  "No Cap",
  "Straight Bussin",
  "Go Touch Grass",
];

async function main() {
  for (const track of tracks) {
    await prisma.track.upsert({
      where: { id: track.id },
      update: track,
      create: track
    });
  }

  for (const weather of weathers) {
    await prisma.weather.upsert({
      where: { id: weather.id },
      update: weather,
      create: weather
    });
  }

  for (const serviceType of serviceTypes) {
    await prisma.serviceType.upsert({
      where: { id: serviceType.id },
      update: serviceType,
      create: serviceType
    });
  }

  const existingNames = new Set(
    (await prisma.horse.findMany({ select: { displayName: true } })).map(
      (horse) => horse.displayName
    )
  );

  const horsesToCreate: Prisma.HorseCreateManyInput[] = [];

  // Dedupe the horseNames array to avoid unique constraint violations
  const uniqueHorseNames = [...new Set(horseNames)];

  for (const displayName of uniqueHorseNames) {
    if (existingNames.has(displayName)) {
      continue;
    }
    horsesToCreate.push({
      displayName,
      handicapTier: HandicapTier.Light,
      formScore: 0,
      historyJson: { races: [] } as Prisma.InputJsonValue
    });
  }

  if (horsesToCreate.length > 0) {
    await prisma.horse.createMany({ data: horsesToCreate });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
