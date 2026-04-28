import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
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
import { NeonButton } from "@/components/NeonButton";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";

export default function SignInScreen() {
  const colors = useColors();
  const router = useRouter();
  const { signInWithEmail } = useAuth();
  const { width, height } = useWindowDimensions();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    const result = await signInWithEmail(trimmed);
    setLoading(false);
    if (result.ok) {
      router.replace("/(home)");
    } else {
      setError(result.error);
    }
  }, [email, signInWithEmail, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={StyleSheet.absoluteFill}>
        <MatrixRain width={width} height={height} intensity={0.55} />
      </View>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "rgba(10,14,20,0.65)" },
        ]}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
            paddingVertical: 40,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <Brand size={44} />
          </View>

          <View style={{ marginBottom: 28 }}>
            <Text
              style={{
                fontSize: 32,
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                letterSpacing: -1,
                textAlign: "center",
              }}
            >
              Sign in to WebForge
            </Text>
            <MonoText
              style={{
                color: colors.mutedForeground,
                textAlign: "center",
                marginTop: 6,
                fontSize: 13,
              }}
            >
              {"// magic link · no password · no setup"}
            </MonoText>
          </View>

          <View style={{ gap: 12, marginTop: 8 }}>
            <FieldLabel>Email</FieldLabel>
            <FancyInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@dev.io"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
            {error ? <ErrorText>{error}</ErrorText> : null}

            <NeonButton
              title="Continue →"
              onPress={onSubmit}
              loading={loading}
              disabled={!email}
              fullWidth
              style={{ marginTop: 8 }}
            />

            <MonoText
              style={{
                color: colors.mutedForeground,
                textAlign: "center",
                marginTop: 12,
                fontSize: 11,
                lineHeight: 16,
              }}
            >
              {"// we'll create your account on first sign-in.\n// no email is sent — your token lives on this device."}
            </MonoText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <MonoText
      style={{
        color: colors.mutedForeground,
        fontSize: 11,
        letterSpacing: 1.4,
        textTransform: "uppercase",
      }}
    >
      {children}
    </MonoText>
  );
}

function FancyInput(props: React.ComponentProps<typeof TextInput>) {
  const colors = useColors();
  return (
    <TextInput
      placeholderTextColor={colors.mutedForeground}
      {...props}
      style={[
        {
          backgroundColor: colors.cardElevated,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 14,
          color: colors.foreground,
          fontFamily: "Inter_500Medium",
          fontSize: 15,
        },
        props.style as object,
      ]}
    />
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <Text style={{ color: colors.destructive, fontSize: 12 }}>{children}</Text>
  );
}
