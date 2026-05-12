import { useCallback, useEffect, useRef } from "react";

import { customFetch, setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";

import { useAuth } from "./auth";

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

if (API_URL) {
  setBaseUrl(API_URL);
}

/**
 * Wires up the API client with our magic-link session token.
 * Mount this once near the root of the authed tree.
 */
export function useApiAuth(): void {
  const { getToken, isSignedIn } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        return await getTokenRef.current();
      } catch {
        return null;
      }
    });
    return () => {
      setAuthTokenGetter(null);
    };
  }, [isSignedIn]);
}

/**
 * Thin REST client hook — wraps customFetch with get/post/patch/del helpers.
 * Auth token is handled automatically via setAuthTokenGetter (wired in useApiAuth).
 */
export function useApiClient() {
  const get = useCallback(<T = unknown>(path: string): Promise<T> => {
    return customFetch<T>(`/api${path}`, { method: "GET", responseType: "json" });
  }, []);

  const post = useCallback(<T = unknown>(path: string, body?: unknown): Promise<T> => {
    return customFetch<T>(`/api${path}`, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: { "Content-Type": "application/json" },
      responseType: "json",
    });
  }, []);

  const patch = useCallback(<T = unknown>(path: string, body?: unknown): Promise<T> => {
    return customFetch<T>(`/api${path}`, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: { "Content-Type": "application/json" },
      responseType: "json",
    });
  }, []);

  const del = useCallback(<T = unknown>(path: string): Promise<T> => {
    return customFetch<T>(`/api${path}`, { method: "DELETE", responseType: "json" });
  }, []);

  return { get, post, patch, del };
}

export const PUBLIC_API_URL = API_URL;
