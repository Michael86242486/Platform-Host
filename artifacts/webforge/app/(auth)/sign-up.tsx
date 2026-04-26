import { useSignUp, useSSO } from "@clerk/expo";
import * as AuthSession from "expo-auth-session";
import { Link, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { Brand } from "@/components/Brand";
import { MatrixRain } from "@/components/MatrixRain";
import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { SocialButton } from "@/components/SocialButton";
import { useColors } from "@/hooks/useColors";

import {
  Divider,
  ErrorText,
  FancyInput,
  FieldLabel,
} from "./sign-in";

WebBrowser.maybeCompleteAuthSession();

export default function SignUpScreen() {
  const colors = useColors();
  const router = useRouter();
  const { signUp, errors, fetchStatus } = useSignUp();
  const { startSSOFlow } = useSSO();
  const { width, height } = useWindowDimensions();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const onSocial = useCallback(
    async (strategy: "oauth_google" | "oauth_facebook" | "oauth_apple") => {
      setOauthLoading(strategy);
      try {
        const { createdSessionId, setActive } = await startSSOFlow({
          strategy,
          redirectUrl: AuthSession.makeRedirectUri(),
        });
        if (createdSessionId && setActive) {
          await setActive({ session: createdSessionId });
          router.replace("/(home)");
        }
      } catch (e) {
        console.error("SSO error", e);
      } finally {
        setOauthLoading(null);
      }
    },
    [startSSOFlow, router],
  );

  const onSubmit = useCallback(async () => {
    const { error } = await signUp.password({ emailAddress: email, password });
    if (error) return;
    await signUp.verifications.sendEmailCode();
  }, [email, password, signUp]);

  const onVerify = useCallback(async () => {
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === "complete") {
      await signUp.finalize({
        navigate: ({ session }) => {
          if (session?.currentTask) return;
          router.replace("/(home)");
        },
      });
    }
  }, [code, signUp, router]);

  const needsVerify =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields?.includes("email_address");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={StyleSheet.absoluteFill}>
        <MatrixRain width={width} height={height} intensity={0.5} />
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
              {needsVerify ? "Verify email" : "Create account"}
            </Text>
            <MonoText
              style={{
                color: colors.mutedForeground,
                textAlign: "center",
                marginTop: 6,
                fontSize: 13,
              }}
            >
              {needsVerify
                ? `// code sent to ${email || "your inbox"}`
                : "// claim your handle"}
            </MonoText>
          </View>

          {needsVerify ? (
            <View style={{ gap: 12 }}>
              <FieldLabel>Verification code</FieldLabel>
              <FancyInput
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                keyboardType="number-pad"
                autoComplete="one-time-code"
              />
              {errors.fields?.code ? (
                <ErrorText>{errors.fields.code.message}</ErrorText>
              ) : null}
              <NeonButton
                title="Verify →"
                onPress={onVerify}
                loading={fetchStatus === "fetching"}
                disabled={code.length < 4}
                fullWidth
                style={{ marginTop: 8 }}
              />
              <Pressable
                onPress={() => signUp.verifications.sendEmailCode()}
                style={{ alignSelf: "center", marginTop: 8 }}
              >
                <Text
                  style={{
                    color: colors.accent,
                    fontFamily: "Inter_500Medium",
                    fontSize: 14,
                  }}
                >
                  Send a new code
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={{ gap: 10, marginBottom: 22 }}>
                <SocialButton
                  provider="google"
                  onPress={() => onSocial("oauth_google")}
                  loading={oauthLoading === "oauth_google"}
                  disabled={!!oauthLoading}
                />
                <SocialButton
                  provider="facebook"
                  onPress={() => onSocial("oauth_facebook")}
                  loading={oauthLoading === "oauth_facebook"}
                  disabled={!!oauthLoading}
                />
                {Platform.OS === "ios" ? (
                  <SocialButton
                    provider="apple"
                    onPress={() => onSocial("oauth_apple")}
                    loading={oauthLoading === "oauth_apple"}
                    disabled={!!oauthLoading}
                  />
                ) : null}
              </View>

              <Divider />

              <View style={{ gap: 12, marginTop: 22 }}>
                <FieldLabel>Email</FieldLabel>
                <FancyInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@dev.io"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
                {errors.fields?.emailAddress ? (
                  <ErrorText>{errors.fields.emailAddress.message}</ErrorText>
                ) : null}

                <FieldLabel>Password</FieldLabel>
                <FancyInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  secureTextEntry
                  autoComplete="new-password"
                />
                {errors.fields?.password ? (
                  <ErrorText>{errors.fields.password.message}</ErrorText>
                ) : null}

                <NeonButton
                  title="Sign up →"
                  onPress={onSubmit}
                  loading={fetchStatus === "fetching"}
                  disabled={!email || !password}
                  fullWidth
                  style={{ marginTop: 8 }}
                />
              </View>
            </>
          )}

          <View
            style={{
              marginTop: 28,
              flexDirection: "row",
              justifyContent: "center",
              gap: 4,
            }}
          >
            <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
              Have an account?
            </Text>
            <Link href="/(auth)/sign-in" asChild>
              <Pressable>
                <Text
                  style={{
                    color: colors.primary,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 14,
                  }}
                >
                  Sign in
                </Text>
              </Pressable>
            </Link>
          </View>

          <View
            nativeID="clerk-captcha"
            style={{ alignSelf: "center", marginTop: 12 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
