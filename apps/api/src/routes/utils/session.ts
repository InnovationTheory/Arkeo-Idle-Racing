import { Request, Response } from "express";
import { prisma } from "../../db";
import { config } from "../../config";
import { ConflictError } from "../../errors";

// Get session token from cookie OR header (fallback for Safari)
export function getSessionToken(req: Request): string | undefined {
  return (
    (req.cookies?.racing_session as string | undefined) ||
    (req.headers["x-session-token"] as string | undefined)
  );
}

export async function getOrCreateUser(params: { sessionToken?: string; handle?: string }) {
  if (params.sessionToken) {
    const existing = await prisma.user.findUnique({ where: { sessionToken: params.sessionToken } });
    if (existing) {
      return existing;
    }
  }

  if (params.handle) {
    const existing = await prisma.user.findUnique({ where: { handle: params.handle } });
    if (existing) {
      throw new ConflictError("handle_taken");
    }
  }

  const handle = params.handle ?? `guest-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({
    data: {
      handle,
      balance: { create: { credits: config.initialCredits } }
    }
  });
}

export async function ensureBalance(userId: string) {
  const balance = await prisma.balance.findUnique({ where: { userId } });
  if (balance) return balance;
  return prisma.balance.create({ data: { userId, credits: config.initialCredits } });
}

export async function requireSessionUser(req: Request, res: Response) {
  const sessionToken = getSessionToken(req);
  if (!sessionToken) {
    res.status(401).json({ error: "session_required" });
    return null;
  }
  const user = await prisma.user.findUnique({ where: { sessionToken } });
  if (!user) {
    res.status(401).json({ error: "session_invalid" });
    return null;
  }
  return user;
}
