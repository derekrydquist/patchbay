import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { queryClient } from "@/lib/queryClient";

interface AuthUser {
  id: string;
  username: string;
  bandName?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// The session cookie is shared by every tab in a browser profile, so logging in or
// out in one tab silently changes who every other tab is on the server. Tabs
// announce their own login/logout here; every tab also re-checks on focus /
// visibility as the fallback (BroadcastChannel unsupported, or a change made
// outside this app's login/logout).
const AUTH_CHANNEL = "patchbay-auth";

function openAuthChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(AUTH_CHANNEL);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Mirrors `user` for the event listeners below, which are registered once.
  const userRef = useRef<AuthUser | null>(null);
  // Bumped by every local login/logout. A re-check whose request started before the
  // bump is discarded, so a slow /me response can't undo a login that just happened.
  const authEpochRef = useRef(0);
  const recheckInFlightRef = useRef(false);
  // Set when a re-check is requested while one is in flight — that in-flight request
  // may predate the change being reported, so one more check runs after it.
  const recheckQueuedRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const applyUser = useCallback((next: AuthUser | null) => {
    userRef.current = next;
    setUser(next);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => applyUser(data))
      .catch(() => applyUser(null))
      .finally(() => setIsLoading(false));
  }, [applyUser]);

  // Ask the server who this tab is now. Only a different user id (or a 401) changes
  // anything; an unchanged id is a no-op, so no needless cache clears. Network
  // errors and non-401 failures are ignored — a blip must not log the tab out.
  const recheckSession = useCallback(async (): Promise<void> => {
    if (recheckInFlightRef.current) {
      recheckQueuedRef.current = true;
      return;
    }
    recheckInFlightRef.current = true;
    const epoch = authEpochRef.current;
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (epoch !== authEpochRef.current) return;
      let next: AuthUser | null;
      if (res.status === 401) next = null;
      else if (res.ok) next = (await res.json()) as AuthUser;
      else return;
      if (epoch !== authEpochRef.current) return;
      if ((next?.id ?? null) === (userRef.current?.id ?? null)) return;
      // Different user (or logged out): drop everything fetched as the previous one.
      queryClient.clear();
      applyUser(next); // null → RequireAuth redirects this tab to /login
    } catch {
      // Network error — keep the current state.
    } finally {
      recheckInFlightRef.current = false;
      if (recheckQueuedRef.current) {
        recheckQueuedRef.current = false;
        void recheckSession();
      }
    }
  }, [applyUser]);

  useEffect(() => {
    const onFocus = () => { void recheckSession(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void recheckSession();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    const channel = openAuthChannel();
    channelRef.current = channel;
    // Another tab logged in or out — the shared cookie already changed, so re-check
    // now rather than waiting for this tab to be focused.
    if (channel) channel.onmessage = () => { void recheckSession(); };

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      channel?.close();
      channelRef.current = null;
    };
  }, [recheckSession]);

  const login = async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { message?: string }).message ?? "Login failed.");
    }
    const data: AuthUser = await res.json();
    authEpochRef.current++;
    queryClient.clear();
    applyUser(data);
    channelRef.current?.postMessage({ type: "login" });
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    authEpochRef.current++;
    queryClient.clear();
    applyUser(null);
    channelRef.current?.postMessage({ type: "logout" });
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
