import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OnboardingModal } from "@/components/OnboardingModal";
import { WebBadgeRemover } from "@/components/WebBadgeRemover";
import { AuthProvider, useAuth } from "@/lib/auth";

SplashScreen.preventAutoHideAsync();

const ONBOARDING_KEY = "webforge.onboarding.done";

async function getOnboardingDone(): Promise<boolean> {
  if (Platform.OS === "web") {
    return !!globalThis.localStorage?.getItem(ONBOARDING_KEY);
  }
  const { getItemAsync } = await import("expo-secure-store");
  return !!(await getItemAsync(ONBOARDING_KEY).catch(() => null));
}

async function setOnboardingDone(): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(ONBOARDING_KEY, "1");
    return;
  }
  const { setItemAsync } = await import("expo-secure-store");
  await setItemAsync(ONBOARDING_KEY, "1").catch(() => {});
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// ---------------------------------------------------------------------------
// Push notification registration — runs once after sign-in on native
// ---------------------------------------------------------------------------

function PushNotificationRegistrar() {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const registered = useRef(false);
  const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

  useEffect(() => {
    if (!isLoaded || !isSignedIn || registered.current || Platform.OS === "web") return;
    registered.current = true;

    void (async () => {
      try {
        const Notifications = await import("expo-notifications");

        // Configure notification appearance on native
        await Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== "granted") return;

        const projectId = process.env.EXPO_PUBLIC_REPL_ID ?? undefined;
        const tokenData = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        const token = tokenData.data;

        const authToken = await getToken();
        await fetch(`${apiBase}/api/me/push-token`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });
      } catch {
      }
    })();
  }, [isLoaded, isSignedIn, getToken, apiBase]);

  return null;
}

function OnboardingGate() {
  const { isSignedIn, isLoaded, updateUser } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void getOnboardingDone().then((done) => {
      if (!done) setShowOnboarding(true);
    });
  }, [isLoaded, isSignedIn]);

  const handleDone = async (name: string, _choice: string) => {
    setShowOnboarding(false);
    await setOnboardingDone();
    if (name) {
      const parts = name.trim().split(/\s+/);
      await updateUser({
        firstName: parts[0],
        lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
      });
    }
  };

  return (
    <OnboardingModal visible={showOnboarding} onDone={(name, choice) => void handleDone(name, choice)} />
  );
}

function RootLayoutNav() {
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#0A0E14" },
          animation: "fade",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(home)" />
        <Stack.Screen
          name="create"
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
        <Stack.Screen
          name="site/[id]"
          options={{ presentation: "card", animation: "slide_from_right" }}
        />
      </Stack>
      <OnboardingGate />
      <PushNotificationRegistrar />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            <AuthProvider>
              <QueryClientProvider client={queryClient}>
                <StatusBar style="light" />
                <WebBadgeRemover />
                <RootLayoutNav />
              </QueryClientProvider>
            </AuthProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
