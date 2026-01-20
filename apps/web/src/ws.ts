const WS_BASE = import.meta.env.VITE_WS_URL || "ws://localhost:8081/ws";

type MessageHandler = (message: any) => void;

type Connection = {
  close: () => void;
};

export function connectRaceWs(raceId: string, onMessage: MessageHandler): Connection {
  let socket: WebSocket | null = null;
  let stopped = false;
  let retries = 0;

  const connect = () => {
    const url = `${WS_BASE}?raceId=${encodeURIComponent(raceId)}`;
    socket = new WebSocket(url);

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch {
        // ignore malformed messages
      }
    };

    socket.onclose = () => {
      if (stopped) return;
      const delay = Math.min(5000, 500 + retries * 500);
      retries += 1;
      setTimeout(connect, delay);
    };
  };

  connect();

  return {
    close: () => {
      stopped = true;
      socket?.close();
    }
  };
}

export function connectRaceDayWs(raceDayId: string, onMessage: MessageHandler): Connection {
  let socket: WebSocket | null = null;
  let stopped = false;
  let retries = 0;

  const connect = () => {
    const url = `${WS_BASE}?racedayId=${encodeURIComponent(raceDayId)}`;
    socket = new WebSocket(url);

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch {
        // ignore malformed messages
      }
    };

    socket.onclose = () => {
      if (stopped) return;
      const delay = Math.min(5000, 500 + retries * 500);
      retries += 1;
      setTimeout(connect, delay);
    };
  };

  connect();

  return {
    close: () => {
      stopped = true;
      socket?.close();
    }
  };
}

type ChatConnection = {
  close: () => void;
  send: (text: string) => void;
};

export function connectChatWs(
  sessionToken: string | null,
  onMessage: MessageHandler,
  onConnected?: () => void,
  onDisconnected?: () => void
): ChatConnection {
  let socket: WebSocket | null = null;
  let stopped = false;
  let retries = 0;

  const connect = () => {
    const params = new URLSearchParams({ chat: "1" });
    if (sessionToken) {
      params.set("sessionToken", sessionToken);
    }
    const url = `${WS_BASE}?${params.toString()}`;
    socket = new WebSocket(url);

    socket.onopen = () => {
      retries = 0;
      onConnected?.();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch {
        // ignore malformed messages
      }
    };

    socket.onclose = () => {
      onDisconnected?.();
      if (stopped) return;
      const delay = Math.min(5000, 500 + retries * 500);
      retries += 1;
      setTimeout(connect, delay);
    };

    socket.onerror = () => {
      onDisconnected?.();
    };
  };

  connect();

  return {
    close: () => {
      stopped = true;
      socket?.close();
    },
    send: (text: string) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "chat_send", text }));
      }
    }
  };
}
