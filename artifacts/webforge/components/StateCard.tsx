import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type IconName = React.ComponentProps<typeof Feather>["name"];

interface BaseProps {
  icon: IconName;
  title: string;
  message: string;
  tone?: "neutral" | "danger";
  action?: { label: string; onPress: () => void };
}

/**
 * Shared empty / error state card used across screens. One pattern, one set
 * of accessibility labels, easy to keep visually consistent on top of the
 * matrix-rain background.
 */
export function StateCard({
  icon,
  title,
  message,
  tone = "neutral",
  action,
}: BaseProps): React.ReactElement {
  const colors = useColors();
  const accent = tone === "danger" ? colors.destructive : colors.primary;
  const [focused, setFocused] = useState(false);
  return (
    <View
      accessibilityRole={tone === "danger" ? "alert" : undefined}
      style={{
        borderColor: tone === "danger" ? colors.destructive : colors.border,
        borderWidth: 1,
        borderRadius: 16,
        borderStyle: tone === "danger" ? "solid" : "dashed",
        padding: 24,
        alignItems: "center",
        gap: 10,
        backgroundColor: colors.card,
      }}
    >
      <Feather name={icon} size={26} color={accent} />
      <Text
        style={{
          color: colors.foreground,
          fontFamily: "Inter_700Bold",
          fontSize: 16,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          textAlign: "center",
          fontSize: 13,
          lineHeight: 19,
          maxWidth: 320,
        }}
      >
        {message}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={({ pressed }) => ({
            marginTop: 6,
            paddingVertical: 10,
            paddingHorizontal: 18,
            borderRadius: 10,
            backgroundColor:
              tone === "danger" ? colors.destructive : colors.primary,
            opacity: pressed ? 0.85 : 1,
            borderWidth: 2,
            borderColor: focused ? colors.accent : "transparent",
          })}
        >
          <Text
            style={{
              color:
                tone === "danger"
                  ? colors.destructiveForeground
                  : colors.primaryForeground,
              fontFamily: "Inter_700Bold",
              fontSize: 13,
              letterSpacing: 0.4,
            }}
          >
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
