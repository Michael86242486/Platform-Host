import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useColors } from "@/hooks/useColors";

interface Props {
  size?: number;
  showWordmark?: boolean;
}

export function BrandLogo({ size = 36 }: { size?: number }) {
  const colors = useColors();
  const inner = size * 0.55;
  return (
    <View style={{ width: size, height: size }}>
      <LinearGradient
        colors={[colors.primary, colors.accent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: size * 0.28,
            shadowColor: colors.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.55,
            shadowRadius: 14,
          },
        ]}
      />
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Svg width={inner} height={inner} viewBox="0 0 24 24" fill="none">
          <Path
            d="M9 7l-5 5 5 5"
            stroke={colors.background}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M15 7l5 5-5 5"
            stroke={colors.background}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    </View>
  );
}

export function Brand({ size = 32, showWordmark = true }: Props) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <BrandLogo size={size} />
      {showWordmark ? (
        <Text
          style={{
            fontSize: size * 0.62,
            fontFamily: "Inter_700Bold",
            letterSpacing: -0.5,
            color: colors.foreground,
          }}
        >
          WebForge
          <Text style={{ color: colors.primary }}>.</Text>
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
