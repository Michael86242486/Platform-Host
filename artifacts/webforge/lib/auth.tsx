import * as SecureStore from "expo-secure-store";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";

const TOKEN_KEY = "webforge.session.token";
const USER_KEY = "webforge.session.user";

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

interface AuthContextValue {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: AuthUser | null;
  token: string | null;
  signInWithEmail: (email: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// SecureStore doesn't exist on web — fall back to localStorage there.
async function storeGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function storeSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* noop */
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* noop */
  }
}

async function storeDel(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* noop */
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* noop */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Boot: read token from secure storage, validate against /auth/me.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await storeGet(TOKEN_KEY);
      if (!stored) {
        if (!cancelled) setIsLoaded(true);
        return;
      }
      try {
        const res = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${stored}` },
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { user: AuthUser };
        if (cancelled) return;
        setToken(stored);
        setUser(data.user);
      } catch {
        // Token expired or backend unreachable — drop it.
        await storeDel(TOKEN_KEY);
        await storeDel(USER_KEY);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signInWithEmail = useCallback(
    async (
      email: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const res = await fetch(`${API_URL}/api/auth/email-link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          return {
            ok: false,
            error: body.error ?? `request failed (${res.status})`,
          };
        }
        const data = (await res.json()) as { token: string; user: AuthUser };
        await storeSet(TOKEN_KEY, data.token);
        await storeSet(USER_KEY, JSON.stringify(data.user));
        setToken(data.token);
        setUser(data.user);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : "network error — is the API server running?",
        };
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    if (token) {
      try {
        await fetch(`${API_URL}/api/auth/sign-out`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        /* noop */
      }
    }
    await storeDel(TOKEN_KEY);
    await storeDel(USER_KEY);
    setToken(null);
    setUser(null);
  }, [token]);

  const getToken = useCallback(async () => token, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoaded,
      isSignedIn: !!user && !!token,
      user,
      token,
      signInWithEmail,
      signOut,
      getToken,
    }),
    [isLoaded, user, token, signInWithEmail, signOut, getToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}

export function useUser(): { user: AuthUser | null } {
  const { user } = useAuth();
  return { user };
}
