import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

interface Column {
  x: number;
  delay: number;
  duration: number;
  chars: string[];
  fontSize: number;
}

const GLYPHS =
  "01アイウエオカキクケコサシスセソタチツテトナニヌネノ{}<>/=+*-_";

function pickChar(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

interface Props {
  intensity?: number; // 0..1
  width: number;
  height: number;
}

export function MatrixRain({ intensity = 0.7, width, height }: Props) {
  const colors = useColors();
  const columns: Column[] = useMemo(() => {
    const colWidth = 18;
    const count = Math.max(8, Math.floor(width / colWidth));
    const rowsPerCol = Math.ceil(height / 16) + 4;
    const cols: Column[] = [];
    for (let i = 0; i < count; i++) {
      const chars: string[] = [];
      for (let j = 0; j < rowsPerCol; j++) chars.push(pickChar());
      cols.push({
        x: i * colWidth,
        delay: Math.random() * 4000,
        duration: 4000 + Math.random() * 4500,
        chars,
        fontSize: 13,
      });
    }
    return cols;
  }, [width, height]);

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { opacity: intensity, overflow: "hidden" },
      ]}
    >
      {columns.map((col, i) => (
        <RainColumn
          key={i}
          col={col}
          height={height}
          accent={colors.codeGreen}
          head={colors.codeCyan}
          tail={colors.mutedForeground}
        />
      ))}
    </View>
  );
}

function RainColumn({
  col,
  height,
  accent,
  head,
  tail,
}: {
  col: Column;
  height: number;
  accent: string;
  head: string;
  tail: string;
}) {
  const translate = useRef(new Animated.Value(-height)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(col.delay),
        Animated.timing(translate, {
          toValue: height,
          duration: col.duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [translate, height, col.delay, col.duration]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        left: col.x,
        top: 0,
        transform: [{ translateY: translate }],
      }}
    >
      {col.chars.map((c, idx) => {
        const isHead = idx === col.chars.length - 1;
        const isWarm = idx >= col.chars.length - 4;
        const opacity =
          0.05 + (idx / col.chars.length) * (isHead ? 1 : 0.55);
        return (
          <Text
            key={idx}
            style={{
              fontSize: col.fontSize,
              lineHeight: 16,
              color: isHead ? head : isWarm ? accent : tail,
              opacity,
              fontFamily: "ui-monospace",
              fontWeight: isHead ? "700" : "500",
              textShadowColor: isHead ? head : "transparent",
              textShadowRadius: isHead ? 8 : 0,
            }}
          >
            {c}
          </Text>
        );
      })}
    </Animated.View>
  );
}
