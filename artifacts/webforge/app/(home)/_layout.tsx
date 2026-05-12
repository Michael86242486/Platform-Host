import { Feather } from "@expo/vector-icons";

import { useAuth } from "@/lib/auth";
import { Redirect, Tabs } from "expo-router";
import React from "react";
import { Platform, Text, View } from "react-native";

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
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === "ios" ? 88 : 68,
          paddingTop: 6,
          paddingBottom: Platform.OS === "ios" ? 28 : 10,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 10,
          letterSpacing: 0.3,
          marginTop: 2,
        },
        tabBarIcon: ({ color, focused }) => {
          const config = (() => {
            switch (route.name) {
              case "index":    return { icon: "zap", label: "Forge" };
              case "sites":    return { icon: "globe", label: "Sites" };
              case "bots":     return { icon: "layers", label: "Projects" };
              case "codex":    return { icon: "cpu", label: "Agent" };
              case "profile":  return { icon: "user", label: "Me" };
              default:         return { icon: "circle", label: "" };
            }
          })();
          return (
            <View
              style={{
                width: 40,
                height: 28,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {focused ? (
                <View
                  style={{
                    backgroundColor: `${colors.primary}18`,
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather
                    name={config.icon as keyof typeof Feather.glyphMap}
                    size={18}
                    color={color}
                  />
                </View>
              ) : (
                <Feather
                  name={config.icon as keyof typeof Feather.glyphMap}
                  size={20}
                  color={color}
                />
              )}
            </View>
          );
        },
      })}
    >
      <Tabs.Screen name="index"   options={{ title: "Forge" }} />
      <Tabs.Screen name="sites"   options={{ title: "Sites" }} />
      <Tabs.Screen name="bots"    options={{ title: "Projects" }} />
      <Tabs.Screen name="codex"   options={{ title: "Agent" }} />
      <Tabs.Screen name="profile" options={{ title: "Me" }} />
    </Tabs>
  );
}

import { StyleSheet } from "react-native";
