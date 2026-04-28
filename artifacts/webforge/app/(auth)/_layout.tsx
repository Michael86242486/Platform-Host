import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/lib/auth";

export default function AuthLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  if (isLoaded && isSignedIn) return <Redirect href="/(home)" />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#0A0E14" },
        animation: "fade",
      }}
    />
  );
}
