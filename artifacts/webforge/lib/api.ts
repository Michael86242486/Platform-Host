import { useAuth } from "@clerk/expo";
import { useEffect, useRef } from "react";

import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

if (API_URL) {
  setBaseUrl(API_URL);
}

/**
 * Wires up the API client with a Clerk token getter.
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

export const PUBLIC_API_URL = API_URL;
