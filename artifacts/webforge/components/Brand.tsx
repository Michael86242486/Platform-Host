import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path, Circle, G } from "react-native-svg";

import { useColors } from "@/hooks/useColors";

interface Props {
  size?: number;
  showWordmark?: boolean;
}

export function BrandLogo({ size = 36 }: { size?: number }) {
  const s = size;
  return (
    <View style={{ width: s, height: s }}>
      <LinearGradient
        colors={["#00FFC2", "#0AAFFF"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: s * 0.26,
            shadowColor: "#00FFC2",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.7,
            shadowRadius: s * 0.4,
            elevation: 8,
          },
        ]}
      />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Svg
          width={s * 0.64}
          height={s * 0.64}
          viewBox="0 0 32 32"
          fill="none"
        >
          <G>
            {/* Bold W letterform */}
            <Path
              d="M3 7L8.5 24L13 15L16 21L18.5 15L24 24L29 7"
              stroke="rgba(0,20,14,0.92)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Forge sparks — 3 lines rising from the center peak */}
            <Path
              d="M16 12L16 7"
              stroke="rgba(0,20,14,0.7)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <Path
              d="M13.5 13L11 9"
              stroke="rgba(0,20,14,0.5)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <Path
              d="M18.5 13L21 9"
              stroke="rgba(0,20,14,0.5)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            {/* Ember dot at top of center spark */}
            <Circle cx="16" cy="6" r="1.5" fill="rgba(0,20,14,0.6)" />
          </G>
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
          Web
          <Text style={{ color: colors.primary }}>Forge</Text>
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
