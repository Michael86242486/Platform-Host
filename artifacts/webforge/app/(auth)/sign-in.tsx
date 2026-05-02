import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { Brand } from "@/components/Brand";
import { MatrixRain } from "@/components/MatrixRain";
import { MonoText } from "@/components/MonoText";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";

export default function SignInScreen() {
  const colors = useColors();
  const { login, isLoaded } = useAuth();
  const { width, height } = useWindowDimensions();
  const [loading, setLoading] = useState(false);
  const accent = "#00FFC2";

  const onLogin = useCallback(async () => {
    setLoading(true);
    try {
      await login();
    } finally {
      setLoading(false);
    }
  }, [login]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={StyleSheet.absoluteFill}>
        <MatrixRain width={width} height={height} intensity={0.55} />
      </View>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "rgba(10,14,20,0.72)" },
        ]}
      />

      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: 28,
          paddingVertical: 48,
        }}
      >
        {/* Logo + name */}
        <Brand size={56} />
        <Text
          style={{
            fontSize: 36,
            color: colors.foreground,
            fontFamily: "Inter_700Bold",
            marginTop: 20,
            letterSpacing: -1,
          }}
        >
          WebForge
        </Text>
        <MonoText
          style={{
            color: colors.mutedForeground,
            fontSize: 13,
            marginTop: 8,
            textAlign: "center",
            lineHeight: 20,
          }}
        >
          {"// AI website builder · publish anywhere"}
        </MonoText>

        {/* Feature pills */}
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "center",
            marginTop: 32,
            marginBottom: 40,
          }}
        >
          {["Multi-page sites", "Live preview", "Checkpoint history", "AI chat edits"].map(
            (f) => (
              <View
                key={f}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: `${accent}44`,
                  backgroundColor: `${accent}0A`,
                }}
              >
                <MonoText style={{ color: accent, fontSize: 11 }}>{f}</MonoText>
              </View>
            ),
          )}
        </View>

        {/* Login button */}
        <Pressable
          onPress={onLogin}
          disabled={loading || !isLoaded}
          style={({ pressed }) => ({
            width: "100%",
            maxWidth: 320,
            height: 54,
            borderRadius: 14,
            backgroundColor: loading ? `${accent}22` : accent,
            borderWidth: loading ? 1 : 0,
            borderColor: accent,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 10,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {loading ? (
            <ActivityIndicator color={accent} size="small" />
          ) : (
            <>
              <Feather name="log-in" size={18} color="#0A0E14" />
              <Text
                style={{
                  color: "#0A0E14",
                  fontSize: 16,
                  fontFamily: "Inter_700Bold",
                  letterSpacing: -0.3,
                }}
              >
                Log in
              </Text>
            </>
          )}
        </Pressable>

        <MonoText
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            textAlign: "center",
            marginTop: 16,
            lineHeight: 18,
          }}
        >
          {"// secure login · no password needed"}
        </MonoText>
      </View>
    </View>
  );
}
