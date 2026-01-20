import React from "react";
import { connectChatWs } from "../ws";
import { useWalletState } from "../hooks/useWalletState";

interface ChatUser {
  id: string;
  displayName: string;
}

interface ChatMessage {
  id: string;
  text: string;
  createdAt: string;
  user: ChatUser;
}

const STORAGE_KEY = "arkeo.chat.expanded";
const SESSION_STORAGE_KEY = "arkeo_session_token";

function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export default function PersistentChat() {
  const { walletAddress, nickname } = useWalletState();
  const [isExpanded, setIsExpanded] = React.useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "true";
  });
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = React.useState("");
  const [players, setPlayers] = React.useState(0);
  const [viewers, setViewers] = React.useState(0);
  const [isConnected, setIsConnected] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const lastMessageIdRef = React.useRef<string | null>(null);
  const connectionRef = React.useRef<ReturnType<typeof connectChatWs> | null>(null);

  const canSendMessages = Boolean(walletAddress && nickname);

  // Persist expanded preference
  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isExpanded));
  }, [isExpanded]);

  // Auto-scroll to bottom when chat opens
  React.useEffect(() => {
    if (isExpanded && messages.length > 0) {
      // Small delay to ensure DOM is rendered
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      }, 50);
    }
  }, [isExpanded]);

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    if (isExpanded && messages.length > 0) {
      const latestId = messages[messages.length - 1]?.id;
      if (latestId !== lastMessageIdRef.current) {
        lastMessageIdRef.current = latestId;
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 50);
      }
    }
  }, [messages]);

  // WebSocket connection
  React.useEffect(() => {
    const sessionToken = getSessionToken();

    const handleMessage = (data: any) => {
      if (data.type === "chat_history") {
        setMessages(data.data.messages);
        setPlayers(data.data.players);
        setViewers(data.data.viewers);
      } else if (data.type === "chat_message") {
        setMessages((prev) => [...prev, data.data].slice(-200));
      } else if (data.type === "chat_online") {
        setPlayers(data.data.players);
        setViewers(data.data.viewers);
      } else if (data.type === "chat_error") {
        if (data.data.error === "profanity_detected") {
          setSendError("Message contains blocked words");
        } else if (data.data.error === "not_authorized") {
          setSendError("Connect wallet and set nickname to chat");
        }
        setIsSending(false);
      }
    };

    connectionRef.current = connectChatWs(
      sessionToken,
      handleMessage,
      () => setIsConnected(true),
      () => setIsConnected(false)
    );

    return () => {
      connectionRef.current?.close();
    };
  }, []);

  // Reconnect with new session when wallet connects
  React.useEffect(() => {
    if (walletAddress && connectionRef.current) {
      // Close old connection and reconnect with session
      connectionRef.current.close();
      const sessionToken = getSessionToken();

      const handleMessage = (data: any) => {
        if (data.type === "chat_history") {
          setMessages(data.data.messages);
          setPlayers(data.data.players);
          setViewers(data.data.viewers);
        } else if (data.type === "chat_message") {
          setMessages((prev) => [...prev, data.data].slice(-200));
        } else if (data.type === "chat_online") {
          setPlayers(data.data.players);
          setViewers(data.data.viewers);
        } else if (data.type === "chat_error") {
          if (data.data.error === "profanity_detected") {
            setSendError("Message contains blocked words");
          } else if (data.data.error === "not_authorized") {
            setSendError("Connect wallet and set nickname to chat");
          }
          setIsSending(false);
        }
      };

      connectionRef.current = connectChatWs(
        sessionToken,
        handleMessage,
        () => setIsConnected(true),
        () => setIsConnected(false)
      );
    }
  }, [walletAddress]);

  const toggleExpanded = () => {
    setIsExpanded((prev) => !prev);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isSending || !canSendMessages) return;

    const text = inputValue.trim();
    setInputValue("");
    setSendError(null);
    setIsSending(true);

    connectionRef.current?.send(text);

    // Reset sending state after a short delay (message will arrive via WS)
    setTimeout(() => setIsSending(false), 500);
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 mt-4 transition-all duration-300 ease-out ${
        isExpanded ? "h-[456px]" : "h-[44px]"
      }`}
    >
      <div className="mx-auto h-full max-w-6xl px-6 md:px-12">
        <div
          className="flex h-full flex-col overflow-hidden rounded-t-xl"
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.98)",
            boxShadow: "0 -8px 30px rgba(0, 0, 0, 0.25)"
          }}
        >
          {/* Header bar - always visible */}
          <button
            type="button"
            onClick={toggleExpanded}
            className="flex h-[44px] w-full shrink-0 cursor-pointer items-center justify-between bg-stone-800 px-4 transition-colors hover:bg-stone-700"
          >
            <div className="flex items-center gap-3">
              <span className="text-base">💬</span>
              <span className="font-display text-sm uppercase tracking-[0.15em] text-white">
                Race Chat
              </span>
              <span className="flex items-center gap-1.5 text-xs text-stone-300">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    isConnected ? "bg-green-400" : "bg-red-500"
                  }`}
                />
                {players} player{players !== 1 ? "s" : ""}{viewers > 0 ? ` • ${viewers} viewer${viewers !== 1 ? "s" : ""}` : ""}
              </span>
            </div>
            <svg
              className={`h-4 w-4 text-stone-300 transition-transform duration-200 ${
                isExpanded ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 15l7-7 7 7"
              />
            </svg>
          </button>

          {/* Expanded content */}
          {isExpanded && (
            <>
              {/* Message list */}
              <div className="mx-3 mt-3 flex-1 overflow-y-auto rounded-lg bg-stone-100 px-4 py-3">
                {messages.length === 0 ? (
                  <p className="py-4 text-center text-sm text-stone-500">
                    No messages yet. Be the first to say something!
                  </p>
                ) : (
                  messages.map((msg) => {
                    const isSystem = msg.user.displayName === "Race Announcer";
                    if (isSystem) {
                      const isRaceEvent = msg.text.startsWith("🏇") || msg.text.startsWith("🏆") || msg.text.startsWith("🎉");
                      return (
                        <p key={msg.id} className={`mb-2 text-sm last:mb-0 ${isRaceEvent ? "text-accent2" : "text-accent"}`}>
                          {msg.text}
                        </p>
                      );
                    }
                    return (
                      <div key={msg.id} className="mb-2 last:mb-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-semibold text-accent2">
                            {msg.user.displayName}
                          </span>
                          <span className="text-[10px] text-stone-400">
                            {formatTime(msg.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm text-stone-700">{msg.text}</p>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input form */}
              <div className="shrink-0 px-4 py-3">
                {sendError && (
                  <p className="mb-1 text-xs text-red-500">{sendError}</p>
                )}
                {canSendMessages ? (
                  <form onSubmit={handleSubmit} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => {
                        setInputValue(e.target.value);
                        setSendError(null);
                      }}
                      placeholder="Type a message..."
                      maxLength={280}
                      disabled={isSending}
                      className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500 disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={!inputValue.trim() || isSending}
                      className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-stone-700 disabled:opacity-50"
                    >
                      {isSending ? "..." : "Send"}
                    </button>
                  </form>
                ) : (
                  <p className="py-1 text-center text-xs text-stone-500">
                    {!walletAddress
                      ? "Connect your wallet to chat"
                      : "Set a nickname to chat"}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
