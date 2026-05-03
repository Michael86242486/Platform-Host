import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { Brand } from "@/components/Brand";
import { MatrixRain } from "@/components/MatrixRain";
import { MonoText } from "@/components/MonoText";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { Feather } from "@expo/vector-icons";

type AuthMode = "choose" | "email-login" | "email-register";

export default function SignInScreen() {
  const colors = useColors();
  const { login, emailLogin, emailRegister, isLoaded } = useAuth();
  const { width, height } = useWindowDimensions();
  const accent = "#00FFC2";

  const [mode, setMode] = useState<AuthMode>("choose");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const onReplitLogin = useCallback(async () => {
    setLoading(true);
    try { await login(); } finally { setLoading(false); }
  }, [login]);

  const onEmailSubmit = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (mode === "email-login") {
        await emailLogin(email.trim(), password);
      } else {
        await emailRegister(email.trim(), password, firstName.trim() || undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [mode, email, password, firstName, emailLogin, emailRegister]);

  const inputStyle = {
    width: "100%" as const,
    maxWidth: 320,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${accent}44`,
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 16,
    color: colors.foreground,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={StyleSheet.absoluteFill}>
        <MatrixRain width={width} height={height} intensity={0.55} />
      </View>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,14,20,0.72)" }]}
      />

      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: 28,
          paddingVertical: 48,
        }}
        keyboardShouldPersistTaps="handled"
      >
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

        {mode === "choose" && (
          <>
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
              {["Multi-page sites", "Live preview", "Checkpoint history", "AI chat edits"].map((f) => (
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
              ))}
            </View>

            <Pressable
              onPress={() => setMode("email-login")}
              style={({ pressed }) => ({
                width: "100%",
                maxWidth: 320,
                height: 54,
                borderRadius: 14,
                backgroundColor: accent,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 10,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Feather name="mail" size={18} color="#0A0E14" />
              <Text style={{ color: "#0A0E14", fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.3 }}>
                Log in with Email
              </Text>
            </Pressable>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 20, maxWidth: 320, width: "100%" }}>
              <View style={{ flex: 1, height: 1, backgroundColor: `${accent}22` }} />
              <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>or</MonoText>
              <View style={{ flex: 1, height: 1, backgroundColor: `${accent}22` }} />
            </View>

            <Pressable
              onPress={onReplitLogin}
              disabled={loading || !isLoaded}
              style={({ pressed }) => ({
                width: "100%",
                maxWidth: 320,
                height: 54,
                borderRadius: 14,
                backgroundColor: "transparent",
                borderWidth: 1,
                borderColor: `${accent}55`,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 10,
                opacity: pressed ? 0.75 : 1,
                marginTop: 20,
              })}
            >
              {loading ? (
                <ActivityIndicator color={accent} size="small" />
              ) : (
                <>
                  <Feather name="log-in" size={18} color={accent} />
                  <Text style={{ color: accent, fontSize: 15, fontFamily: "Inter_600SemiBold", letterSpacing: -0.3 }}>
                    Log in with Replit
                  </Text>
                </>
              )}
            </Pressable>

            <Pressable onPress={() => setMode("email-register")} style={{ marginTop: 20 }}>
              <MonoText style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}>
                {"// no account? "}
                <MonoText style={{ color: accent }}>create one →</MonoText>
              </MonoText>
            </Pressable>
          </>
        )}

        {(mode === "email-login" || mode === "email-register") && (
          <View style={{ width: "100%", alignItems: "center", marginTop: 36, gap: 12 }}>
            <MonoText style={{ color: accent, fontSize: 13, alignSelf: "flex-start", maxWidth: 320, marginBottom: 4 }}>
              {mode === "email-login" ? "// sign in" : "// create account"}
            </MonoText>

            {mode === "email-register" && (
              <TextInput
                style={inputStyle}
                placeholder="First name (optional)"
                placeholderTextColor={colors.mutedForeground}
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
              />
            )}

            <TextInput
              style={inputStyle}
              placeholder="Email address"
              placeholderTextColor={colors.mutedForeground}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              returnKeyType="next"
            />

            <View style={{ width: "100%", maxWidth: 320, position: "relative" }}>
              <TextInput
                style={inputStyle}
                placeholder="Password"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={onEmailSubmit}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                style={{ position: "absolute", right: 14, top: 0, bottom: 0, justifyContent: "center" }}
              >
                <Feather name={showPassword ? "eye-off" : "eye"} size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {error ? (
              <View
                style={{
                  width: "100%",
                  maxWidth: 320,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: "rgba(255,80,80,0.10)",
                  borderWidth: 1,
                  borderColor: "rgba(255,80,80,0.35)",
                }}
              >
                <Text style={{ color: "#FF6B6B", fontSize: 12, textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 18 }}>
                  {error}
                </Text>
              </View>
            ) : null}

            <Pressable
              onPress={onEmailSubmit}
              disabled={loading}
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
                marginTop: 4,
              })}
            >
              {loading ? (
                <ActivityIndicator color={accent} size="small" />
              ) : (
                <>
                  <Feather name={mode === "email-login" ? "log-in" : "user-plus"} size={18} color="#0A0E14" />
                  <Text style={{ color: "#0A0E14", fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.3 }}>
                    {mode === "email-login" ? "Log in" : "Create Account"}
                  </Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={() => { setMode(mode === "email-login" ? "email-register" : "email-login"); setError(null); }}
              style={{ marginTop: 4 }}
            >
              <MonoText style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}>
                {mode === "email-login"
                  ? "// no account? "
                  : "// already have one? "}
                <MonoText style={{ color: accent }}>
                  {mode === "email-login" ? "create one →" : "sign in →"}
                </MonoText>
              </MonoText>
            </Pressable>

            <Pressable onPress={() => { setMode("choose"); setError(null); }} style={{ marginTop: 4 }}>
              <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>← back</MonoText>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
