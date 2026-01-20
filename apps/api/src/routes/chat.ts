import { Router } from "express";
import { prisma } from "../db";
import { containsProfanity } from "../profanity";
import { asyncHandler } from "./utils/asyncHandler";
import { requireSessionUser } from "./utils/session";

const router = Router();

const MAX_MESSAGE_LENGTH = 280;
const MESSAGES_LIMIT = 50;

// Get recent chat messages
router.get(
  "/messages",
  asyncHandler(async (_req, res) => {
    const messages = await prisma.chatMessage.findMany({
      take: MESSAGES_LIMIT,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            handle: true
          }
        }
      }
    });

    // Return in chronological order (oldest first)
    const reversed = messages.reverse();

    res.json({
      messages: reversed.map((m) => ({
        id: m.id,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
        user: {
          id: m.user.id,
          displayName: m.user.nickname || m.user.handle
        }
      }))
    });
  })
);

// Get online count (based on recent chat activity)
router.get(
  "/online",
  asyncHandler(async (_req, res) => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentUsers = await prisma.chatMessage.findMany({
      where: { createdAt: { gte: fiveMinutesAgo } },
      select: { userId: true },
      distinct: ["userId"]
    });
    res.json({ online: recentUsers.length });
  })
);

// Post a new chat message
router.post(
  "/messages",
  asyncHandler(async (req, res) => {
    const user = await requireSessionUser(req, res);
    if (!user) return;

    if (!user.walletAddress) {
      res.status(403).json({ error: "wallet_required" });
      return;
    }

    if (!user.nickname) {
      res.status(403).json({ error: "nickname_required" });
      return;
    }

    const text = (req.body?.text as string || "").trim();

    if (!text) {
      res.status(400).json({ error: "empty_message" });
      return;
    }

    if (text.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: "message_too_long" });
      return;
    }

    if (containsProfanity(text)) {
      res.status(400).json({ error: "profanity_detected" });
      return;
    }

    const message = await prisma.chatMessage.create({
      data: {
        userId: user.id,
        text
      },
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            handle: true
          }
        }
      }
    });

    res.json({
      id: message.id,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
      user: {
        id: message.user.id,
        displayName: message.user.nickname || message.user.handle
      }
    });
  })
);

export default router;
