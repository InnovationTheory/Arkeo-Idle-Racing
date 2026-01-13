import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "../config";
import { getRaceWithRelations } from "../race/queries";
import { serializeRace } from "../race/serialize";
import { getRaceDayState } from "../raceday";

const socketsByRace = new Map<string, Set<WebSocket>>();
const socketsByRaceDay = new Map<string, Set<WebSocket>>();

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

export function initWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ server, path: config.wsPath });

  wss.on("connection", async (socket, request) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    const raceId = url.searchParams.get("raceId");
    const raceDayId = url.searchParams.get("racedayId");
    if (!raceId && !raceDayId) {
      socket.send(
        JSON.stringify({ type: "error", data: { message: "raceId or racedayId required" } })
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
