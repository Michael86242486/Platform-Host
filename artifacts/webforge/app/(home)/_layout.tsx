import { Feather } from "@expo/vector-icons";

import { useAuth } from "@/lib/auth";
import { Redirect, Tabs } from "expo-router";
import React from "react";
import { Platform, View } from "react-native";

import { useApiAuth } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

export default function HomeLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  useApiAuth();
  const colors = useColors();

  if (isLoaded && !isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === "ios" ? 84 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === "ios" ? 28 : 10,
        },
        tabBarLabelStyle: {
          fontFamily: "Inter_600SemiBold",
          fontSize: 11,
          letterSpacing: 0.4,
        },
        tabBarIcon: ({ color, focused }) => {
          const iconName = (() => {
            switch (route.name) {
              case "index":
                return "grid";
              case "sites":
                return "globe";
              case "bots":
                return "send";
              case "codex":
                return "cpu";
              case "profile":
                return "user";
              default:
                return "circle";
            }
          })() as keyof typeof Feather.glyphMap;
          return (
            <View
              style={{
                width: 36,
                height: 28,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name={iconName} size={focused ? 22 : 20} color={color} />
            </View>
          );
        },
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Forge" }} />
      <Tabs.Screen name="sites" options={{ title: "Sites" }} />
      <Tabs.Screen name="bots" options={{ title: "Bots" }} />
      <Tabs.Screen name="codex" options={{ title: "Codex" }} />
      <Tabs.Screen name="profile" options={{ title: "Me" }} />
    </Tabs>
  );
}
