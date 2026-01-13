import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/createTestApp";
import { prisma } from "../../db";

const mockPrisma = vi.mocked(prisma);

describe("User Routes", () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/me", () => {
    it("creates new user when no session exists", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: "user-1",
        sessionToken: "new-session-token",
        handle: "user123",
        nickname: null,
        walletAddress: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.balance.findUnique.mockResolvedValue(null);

      const res = await request(app).get("/api/me");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("userId", "user-1");
      expect(res.body).toHaveProperty("handle", "user123");
      expect(res.body).toHaveProperty("balance", 0);
      expect(res.headers["set-cookie"]).toBeDefined();
    });

    it("returns existing user with session cookie", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-2",
        sessionToken: "existing-session",
        handle: "existinguser",
        nickname: "TestUser",
        walletAddress: "arkeo1test",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.balance.findUnique.mockResolvedValue({
        userId: "user-2",
        credits: 500,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .get("/api/me")
        .set("Cookie", "racing_session=existing-session");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: "user-2",
        handle: "existinguser",
        nickname: "TestUser",
        walletAddress: "arkeo1test",
        balance: 500,
        sessionToken: "existing-session",
      });
    });
  });

  describe("GET /api/me/wallet", () => {
    it("returns 401 when no session", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await request(app).get("/api/me/wallet");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "session_required" });
    });

    it("returns wallet info for authenticated user", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-3",
        sessionToken: "valid-session",
        handle: "testhandle",
        nickname: "Tester",
        walletAddress: "arkeo1wallet",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .get("/api/me/wallet")
        .set("Cookie", "racing_session=valid-session");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("walletAddress", "arkeo1wallet");
      expect(res.body).toHaveProperty("nickname", "Tester");
      expect(res.body).toHaveProperty("chain");
      expect(res.body.chain).toHaveProperty("chainId");
    });
  });

  describe("POST /api/me/wallet", () => {
    it("returns 400 for invalid wallet address", async () => {
      const res = await request(app)
        .post("/api/me/wallet")
        .send({ walletAddress: "invalid" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "invalid_wallet_address" });
    });

    it("returns 400 for invalid nickname", async () => {
      const res = await request(app)
        .post("/api/me/wallet")
        .send({ walletAddress: "arkeo1validaddress123456789012345678901", nickname: "x" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "invalid_nickname" });
    });

    it("connects wallet for authenticated user", async () => {
      const existingUser = {
        id: "user-4",
        sessionToken: "session-4",
        handle: "user4",
        nickname: null,
        walletAddress: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.user.findUnique.mockResolvedValue(existingUser);
      mockPrisma.user.findFirst.mockResolvedValue(null); // No existing user with this wallet
      mockPrisma.user.update.mockResolvedValue({
        ...existingUser,
        walletAddress: "arkeo1validaddress123456789012345678901",
        nickname: "TestNick",
      });

      const res = await request(app)
        .post("/api/me/wallet")
        .set("Cookie", "racing_session=session-4")
        .send({
          walletAddress: "arkeo1validaddress123456789012345678901",
          nickname: "TestNick",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("walletAddress", "arkeo1validaddress123456789012345678901");
      expect(res.body).toHaveProperty("nickname", "TestNick");
    });
  });

  describe("POST /api/me/wallet/disconnect", () => {
    it("clears session cookie and returns ok", async () => {
      const res = await request(app).post("/api/me/wallet/disconnect");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      // Cookie should be cleared (set to empty or expired)
      expect(res.headers["set-cookie"]).toBeDefined();
    });
  });
});
