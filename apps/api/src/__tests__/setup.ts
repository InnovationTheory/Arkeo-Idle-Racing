import { vi, beforeEach } from "vitest";

// Mock prisma client
vi.mock("../db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    balance: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    race: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    raceHorse: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    ticket: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    pick: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    raceSelection: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    raceHorsePoll: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    payout: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    ticketIdempotency: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback({
      user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      balance: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      race: { findUnique: vi.fn(), update: vi.fn() },
      ticket: { create: vi.fn() },
      ticketIdempotency: { findUnique: vi.fn(), create: vi.fn() },
      $executeRaw: vi.fn(),
    })),
  },
}));

// Mock external services
vi.mock("../routes/utils/arkeo", () => ({
  fetchArkeoBalance: vi.fn().mockResolvedValue("1000000uarkeo"),
  fetchArkeoTx: vi.fn().mockResolvedValue({ tx_response: { code: 0 } }),
  findBankPaymentMessage: vi.fn().mockReturnValue({ amount: 100n }),
}));

// Mock hot wallet
vi.mock("../arkeo/send", () => ({
  getHotWalletAddress: vi.fn().mockResolvedValue("arkeo1hotwallet"),
  sendArkeoReward: vi.fn().mockResolvedValue({ ok: true, txHash: "mock_tx_hash" }),
}));

// Mock profanity filter
vi.mock("../profanity", () => ({
  containsProfanity: vi.fn().mockReturnValue(false),
}));

// Mock logger to silence output during tests
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  httpLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  schedulerLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  raceLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  raceDayLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  subscriberLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
