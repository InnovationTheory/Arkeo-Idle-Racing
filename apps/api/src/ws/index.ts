import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "../config";
import { prisma } from "../db";
import { containsProfanity } from "../profanity";
import { getRaceWithRelations } from "../race/queries";
import { serializeRace } from "../race/serialize";
import { getRaceDayState } from "../raceday";

const socketsByRace = new Map<string, Set<WebSocket>>();
const socketsByRaceDay = new Map<string, Set<WebSocket>>();
const chatSockets = new Set<WebSocket>();
const chatUserIds = new Map<WebSocket, string>();

function addSocket(raceId: string, socket: WebSocket) {
  const set = socketsByRace.get(raceId) ?? new Set<WebSocket>();
  set.add(socket);
  socketsByRace.set(raceId, set);
  console.log(`[WS] Added socket for race ${raceId.slice(-6)}, total sockets: ${set.size}`);
}

function addRaceDaySocket(raceDayId: string, socket: WebSocket) {
  const set = socketsByRaceDay.get(raceDayId) ?? new Set<WebSocket>();
  set.add(socket);
  socketsByRaceDay.set(raceDayId, set);
}

function removeSocket(raceId: string, socket: WebSocket) {
  const set = socketsByRace.get(raceId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) socketsByRace.delete(raceId);
}

function removeRaceDaySocket(raceDayId: string, socket: WebSocket) {
  const set = socketsByRaceDay.get(raceDayId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) socketsByRaceDay.delete(raceDayId);
}

export function broadcastToRace(raceId: string, message: Record<string, unknown>) {
  const set = socketsByRace.get(raceId);
  if (!set) {
    // Only log for tick_update since those are frequent and important
    if (message.type === "tick_update") {
      console.log(`[WS] No sockets for race ${raceId.slice(-6)}, skipping broadcast`);
    }
    return;
  }
  const payload = JSON.stringify(message);
  let sentCount = 0;
  for (const socket of set) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
      sentCount++;
    }
  }
  if (message.type === "tick_update") {
    const tickData = message.data as { tick: number };
    console.log(`[WS] Broadcast tick ${tickData.tick} to ${sentCount}/${set.size} sockets for race ${raceId.slice(-6)}`);
  }
}

export function broadcastToRaceDay(raceDayId: string, message: Record<string, unknown>) {
  const set = socketsByRaceDay.get(raceDayId);
  if (!set) return;
  const payload = JSON.stringify(message);
  for (const socket of set) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}

export function broadcastToChat(message: Record<string, unknown>) {
  const payload = JSON.stringify(message);
  for (const socket of chatSockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  }
}

export function getChatOnlineCounts(): { players: number; viewers: number } {
  // Players: unique wallet-connected users
  const uniquePlayers = new Set(chatUserIds.values());
  const playerSocketCount = chatUserIds.size;
  // Viewers: total sockets minus player sockets
  const viewerCount = chatSockets.size - playerSocketCount;
  return { players: uniquePlayers.size, viewers: Math.max(0, viewerCount) };
}

function broadcastOnlineCount() {
  const counts = getChatOnlineCounts();
  broadcastToChat({ type: "chat_online", data: counts });
}

async function handleChatMessage(socket: WebSocket, userId: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 280) return;
  if (containsProfanity(trimmed)) {
    socket.send(JSON.stringify({ type: "chat_error", data: { error: "profanity_detected" } }));
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, nickname: true, handle: true, walletAddress: true }
  });

  if (!user || !user.walletAddress || !user.nickname) {
    socket.send(JSON.stringify({ type: "chat_error", data: { error: "not_authorized" } }));
    return;
  }

  const message = await prisma.chatMessage.create({
    data: { userId, text: trimmed }
  });

  broadcastToChat({
    type: "chat_message",
    data: {
      id: message.id,
      text: message.text,
      createdAt: message.createdAt.toISOString(),
      user: {
        id: user.id,
        displayName: user.nickname || user.handle
      }
    }
  });
}

export function initWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ server, path: config.wsPath });

  wss.on("connection", async (socket, request) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    const raceId = url.searchParams.get("raceId");
    const raceDayId = url.searchParams.get("racedayId");
    const chatMode = url.searchParams.get("chat");
    const sessionToken = url.searchParams.get("sessionToken");

    // Chat connection
    if (chatMode === "1") {
      let userId: string | null = null;
      let hasWallet = false;

      // Authenticate user if session token provided
      if (sessionToken) {
        const user = await prisma.user.findUnique({
          where: { sessionToken },
          select: { id: true, walletAddress: true }
        });
        if (user) {
          userId = user.id;
          hasWallet = Boolean(user.walletAddress);
          // Only track users with connected wallets for online count
          if (hasWallet) {
            chatUserIds.set(socket, userId);
          }
        }
      }

      chatSockets.add(socket);
      broadcastOnlineCount();

      // Send recent messages
      const recentMessages = await prisma.chatMessage.findMany({
        take: 50,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, nickname: true, handle: true } }
        }
      });

      const counts = getChatOnlineCounts();
      socket.send(JSON.stringify({
        type: "chat_history",
        data: {
          messages: recentMessages.reverse().map((m) => ({
            id: m.id,
            text: m.text,
            createdAt: m.createdAt.toISOString(),
            user: {
              id: m.user.id,
              displayName: m.user.nickname || m.user.handle
            }
          })),
          ...counts
        }
      }));

      // Handle incoming messages
      socket.on("message", async (data) => {
        if (!userId) return;
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "chat_send" && typeof parsed.text === "string") {
            await handleChatMessage(socket, userId, parsed.text);
          }
        } catch {
          // Ignore malformed messages
        }
      });

      const cleanupSocket = () => {
        chatSockets.delete(socket);
        chatUserIds.delete(socket);
        broadcastOnlineCount();
      };

      socket.on("close", cleanupSocket);
      socket.on("error", (err) => {
        console.log("[WS Chat] Socket error:", err);
        cleanupSocket();
        socket.terminate();
      });

      return;
    }

    if (!raceId && !raceDayId) {
      socket.send(
        JSON.stringify({ type: "error", data: { message: "raceId, racedayId, or chat=1 required" } })
      );
      socket.close();
      return;
    }

    if (raceId) {
      addSocket(raceId, socket);
      const race = await getRaceWithRelations(raceId);
      if (race) {
        socket.send(JSON.stringify({ type: "race_state", data: serializeRace(race) }));
      }
      socket.on("close", () => removeSocket(raceId, socket));
      socket.on("error", () => removeSocket(raceId, socket));
      return;
    }

    if (raceDayId) {
      addRaceDaySocket(raceDayId, socket);
      const state = await getRaceDayState(raceDayId);
      if (state) {
        socket.send(JSON.stringify({ type: "raceday_state", data: state }));
      }
      socket.on("close", () => removeRaceDaySocket(raceDayId, socket));
      socket.on("error", () => removeRaceDaySocket(raceDayId, socket));
    }
  });

  return wss;
}
