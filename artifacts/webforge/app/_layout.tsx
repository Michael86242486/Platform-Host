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
import React, { useEffect, useState } from "react";
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

function OnboardingGate() {
  const { isSignedIn, isLoaded } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void getOnboardingDone().then((done) => {
      if (!done) setShowOnboarding(true);
    });
  }, [isLoaded, isSignedIn]);

  const handleDone = async () => {
    setShowOnboarding(false);
    await setOnboardingDone();
  };

  return (
    <OnboardingModal visible={showOnboarding} onDone={() => void handleDone()} />
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
