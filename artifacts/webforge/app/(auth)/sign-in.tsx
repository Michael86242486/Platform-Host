import { useSignIn, useSSO } from "@clerk/expo";
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
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { Brand } from "@/components/Brand";
import { MatrixRain } from "@/components/MatrixRain";
import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { SocialButton } from "@/components/SocialButton";
import { useColors } from "@/hooks/useColors";

WebBrowser.maybeCompleteAuthSession();

const useWarmUp = () => {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
};

export default function SignInScreen() {
  useWarmUp();
  const colors = useColors();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const { width, height } = useWindowDimensions();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

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

  const onEmailSubmit = useCallback(async () => {
    if (!email || !password) return;
    const { error } = await signIn.password({
      emailAddress: email,
      password,
    });
    if (error) {
      console.error("sign-in error", error);
      return;
    }
    if (signIn.status === "complete") {
      await signIn.finalize({
        navigate: ({ session }) => {
          if (session?.currentTask) return;
          router.replace("/(home)");
        },
      });
    }
  }, [email, password, signIn, router]);

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
              Welcome back
            </Text>
            <MonoText
              style={{
                color: colors.mutedForeground,
                textAlign: "center",
                marginTop: 6,
                fontSize: 13,
              }}
            >
              {"// log in to forge sites"}
            </MonoText>
          </View>

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
            {errors.fields?.identifier ? (
              <ErrorText>{errors.fields.identifier.message}</ErrorText>
            ) : null}

            <FieldLabel>Password</FieldLabel>
            <FancyInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              autoComplete="current-password"
            />
            {errors.fields?.password ? (
              <ErrorText>{errors.fields.password.message}</ErrorText>
            ) : null}

            <NeonButton
              title="Continue →"
              onPress={onEmailSubmit}
              loading={fetchStatus === "fetching"}
              disabled={!email || !password}
              fullWidth
              style={{ marginTop: 8 }}
            />
          </View>

          <View
            style={{
              marginTop: 28,
              flexDirection: "row",
              justifyContent: "center",
              gap: 4,
            }}
          >
            <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
              No account?
            </Text>
            <Link href="/(auth)/sign-up" asChild>
              <Pressable>
                <Text
                  style={{
                    color: colors.primary,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 14,
                  }}
                >
                  Create one
                </Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Divider() {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      <MonoText
        style={{
          color: colors.mutedForeground,
          fontSize: 11,
          letterSpacing: 1.4,
        }}
      >
        OR
      </MonoText>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
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

export { FancyInput, FieldLabel, Divider, ErrorText };
