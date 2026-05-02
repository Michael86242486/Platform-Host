import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

WebBrowser.maybeCompleteAuthSession();

const AUTH_TOKEN_KEY = "auth_session_token";
const USER_KEY = "webforge.session.user";
const ISSUER_URL = "https://replit.com/oidc";

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface AuthContextValue {
  isLoaded: boolean;
  isSignedIn: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  token: string | null;
  loginError: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (fields: { firstName?: string; lastName?: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>({
  isLoaded: false,
  isSignedIn: false,
  isAuthenticated: false,
  user: null,
  token: null,
  loginError: null,
  login: async () => {},
  logout: async () => {},
  signOut: async () => {},
  updateUser: async () => ({ ok: false, error: "not initialized" }),
  getToken: async () => null,
});

async function storeGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}

async function storeSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* noop */ }
    return;
  }
  try { await SecureStore.setItemAsync(key, value); } catch { /* noop */ }
}

async function storeDel(key: string): Promise<void> {
  if (Platform.OS === "web") {
    try { globalThis.localStorage?.removeItem(key); } catch { /* noop */ }
    return;
  }
  try { await SecureStore.deleteItemAsync(key); } catch { /* noop */ }
}

function getApiBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  }
  return process.env.EXPO_PUBLIC_API_URL ?? "";
}

function getClientId(): string {
  return process.env.EXPO_PUBLIC_REPL_ID ?? "";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  const discovery = AuthSession.useAutoDiscovery(ISSUER_URL);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: "webforge" });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: getClientId(),
      scopes: ["openid", "email", "profile", "offline_access"],
      redirectUri,
      prompt: AuthSession.Prompt.Login,
    },
    discovery,
  );

  const fetchUser = useCallback(async (sessionToken: string) => {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/api/auth/user`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { user: AuthUser | null };
    if (!data.user) throw new Error("no_user");
    return data.user;
  }, []);

  useEffect(() => {
    void (async () => {
      const stored = await storeGet(AUTH_TOKEN_KEY);
      if (!stored) { setIsLoading(false); return; }
      try {
        const u = await fetchUser(stored);
        setToken(stored);
        setUser(u);
        await storeSet(USER_KEY, JSON.stringify(u));
      } catch {
        await storeDel(AUTH_TOKEN_KEY);
        await storeDel(USER_KEY);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [fetchUser]);

  useEffect(() => {
    if (response?.type === "error") {
      setLoginError("Login was cancelled or failed. Please try again.");
      return;
    }
    if (response?.type !== "success" || !request?.codeVerifier) return;
    const { code, state } = response.params;
    void (async () => {
      setLoginError(null);
      try {
        const apiBase = getApiBaseUrl();
        const exchangeRes = await fetch(`${apiBase}/api/mobile-auth/token-exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            code_verifier: request.codeVerifier,
            redirect_uri: redirectUri,
            state,
            nonce: request.nonce,
          }),
        });
        if (!exchangeRes.ok) {
          const body = await exchangeRes.json().catch(() => ({})) as { error?: string };
          setLoginError(body.error ?? `Server error (${exchangeRes.status}). Please try again.`);
          setIsLoading(false);
          return;
        }
        const data = (await exchangeRes.json()) as { token: string };
        if (data.token) {
          await storeSet(AUTH_TOKEN_KEY, data.token);
          setToken(data.token);
          setIsLoading(true);
          const u = await fetchUser(data.token);
          setUser(u);
          await storeSet(USER_KEY, JSON.stringify(u));
          setIsLoading(false);
        } else {
          setLoginError("Login failed — no session returned. Please try again.");
          setIsLoading(false);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setLoginError(`Could not reach the server. Check your connection and try again. (${msg})`);
        setIsLoading(false);
      }
    })();
  }, [response, request, redirectUri, fetchUser]);

  const login = useCallback(async () => {
    try { await promptAsync(); } catch { /* noop */ }
  }, [promptAsync]);

  const logout = useCallback(async () => {
    try {
      const storedToken = await storeGet(AUTH_TOKEN_KEY);
      if (storedToken) {
        const apiBase = getApiBaseUrl();
        await fetch(`${apiBase}/api/mobile-auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${storedToken}` },
        });
      }
    } catch { /* noop */ } finally {
      await storeDel(AUTH_TOKEN_KEY);
      await storeDel(USER_KEY);
      setToken(null);
      setUser(null);
    }
  }, []);

  const updateUser = useCallback(
    async (fields: { firstName?: string; lastName?: string }): Promise<{ ok: true } | { ok: false; error: string }> => {
      const currentToken = token ?? await storeGet(AUTH_TOKEN_KEY);
      if (!currentToken) return { ok: false, error: "not signed in" };
      try {
        const apiBase = getApiBaseUrl();
        const res = await fetch(`${apiBase}/api/auth/me`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentToken}`,
          },
          body: JSON.stringify(fields),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: body.error ?? `request failed (${res.status})` };
        }
        const data = (await res.json()) as { user: AuthUser };
        setUser(data.user);
        await storeSet(USER_KEY, JSON.stringify(data.user));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "network error" };
      }
    },
    [token],
  );

  const getToken = useCallback(async () => token ?? storeGet(AUTH_TOKEN_KEY), [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoaded: !isLoading,
      isSignedIn: !!user,
      isAuthenticated: !!user,
      user,
      token,
      loginError,
      login,
      logout,
      signOut: logout,
      updateUser,
      getToken,
    }),
    [isLoading, user, token, loginError, login, logout, updateUser, getToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function useUser(): { user: AuthUser | null } {
  const { user } = useAuth();
  return { user };
}
