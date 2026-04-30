import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";

/**
 * Shimmering placeholder used while the sites list is loading. Matches the
 * footprint of `SiteCard` so the layout doesn't jump when data arrives.
 */
export function SiteCardSkeleton(): React.ReactElement {
  const colors = useColors();
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: Platform.OS !== "web",
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.35, 0.7, 0.35],
  });

  const Bar = ({
    width,
    height = 12,
    style,
  }: {
    width: number | string;
    height?: number;
    style?: object;
  }) => (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: 6,
          backgroundColor: colors.border,
          opacity,
        },
        style,
      ]}
    />
  );

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading site"
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.row}>
        <Animated.View
          style={[
            styles.cover,
            { backgroundColor: colors.border, opacity },
          ]}
        />
        <View style={{ flex: 1, gap: 8 }}>
          <Bar width="60%" height={14} />
          <Bar width="40%" height={10} />
          <Bar width="80%" height={8} style={{ marginTop: 4 }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  cover: { width: 56, height: 56, borderRadius: 12 },
});
