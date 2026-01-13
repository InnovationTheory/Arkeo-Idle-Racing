const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const SESSION_STORAGE_KEY = "arkeo_session_token";

// Get stored session token (fallback for Safari cookie issues)
function getStoredSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

// Store session token from response
function storeSessionToken(token: string | null | undefined): void {
  try {
    if (token) {
      localStorage.setItem(SESSION_STORAGE_KEY, token);
    }
  } catch {
    // localStorage not available
  }
}

// Clear stored session token
export function clearStoredSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // localStorage not available
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const sessionToken = getStoredSessionToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(sessionToken ? { "x-session-token": sessionToken } : {})
  };

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    credentials: "include",
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "request_failed");
  }

  const data = await response.json();

  // Store session token from response if present
  if (data && typeof data === "object" && "sessionToken" in data) {
    storeSessionToken(data.sessionToken as string);
  }

  return data;
}

export function apiGet<T>(path: string) {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: Record<string, unknown>) {
  return request<T>(path, {
    method: "POST",
    body: JSON.stringify(body ?? {})
  });
}

export function apiDelete<T>(path: string) {
  return request<T>(path, {
    method: "DELETE"
  });
}
