import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { MonoText } from "./MonoText";

interface Props {
  label: string;
  value: string | number;
  hint?: string;
  accent?: string;
}

export function StatTile({ label, value, hint, accent }: Props) {
  const colors = useColors();
  const accentColor = accent ?? colors.primary;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 14,
      }}
    >
      <View style={styles.dotRow}>
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: accentColor,
            shadowColor: accentColor,
            shadowOpacity: 0.7,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 0 },
          }}
        />
        <MonoText
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: "uppercase",
          }}
        >
          {label}
        </MonoText>
      </View>
      <Text
        style={{
          color: colors.foreground,
          fontSize: 28,
          fontFamily: "Inter_700Bold",
          letterSpacing: -1,
          marginTop: 6,
        }}
      >
        {value}
      </Text>
      {hint ? (
        <Text
          style={{
            color: colors.mutedForeground,
            fontSize: 12,
            marginTop: 2,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dotRow: { flexDirection: "row", alignItems: "center", gap: 6 },
});
