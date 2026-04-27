import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCreateSite } from "@workspace/api-client-react";

import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { useColors } from "@/hooks/useColors";

const SUGGESTIONS = [
  {
    icon: "coffee" as const,
    label: "Coffee shop landing page",
    prompt:
      "A coffee shop landing page with a warm sunset palette, a hero, our menu, our story, and a contact form.",
  },
  {
    icon: "code" as const,
    label: "Indie game dev portfolio",
    prompt:
      "A neon, dark-mode portfolio for an indie game developer with project showcase, devlog blog, and contact.",
  },
  {
    icon: "scissors" as const,
    label: "Barbershop with booking",
    prompt:
      "A modern barbershop site with services, prices, gallery, and an online booking section.",
  },
  {
    icon: "send" as const,
    label: "Newsletter signup",
    prompt:
      "A clean editorial newsletter landing page with a manifesto, recent issues, and an email signup CTA.",
  },
  {
    icon: "camera" as const,
    label: "Photographer portfolio",
    prompt:
      "A minimal dark-mode photographer portfolio with a hero gallery, about page, and inquiry form.",
  },
];

const apiBase =
  (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "") || "";

export default function CreateScreen() {
  const colors = useColors();
  const router = useRouter();
  const { getToken } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const create = useCreateSite();

  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!recording) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.18,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  const onSubmit = async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 4) return;
    try {
      const site = await create.mutateAsync({
        data: { prompt: trimmed, name: null },
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/site/${site.id}`);
    } catch (e) {
      Alert.alert(
        "Could not start build",
        e instanceof Error ? e.message : "Unknown error",
      );
    }
  };

  // Web-only voice recording using MediaRecorder + upload to /api/voice/transcribe.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stopRecording = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (mr.state === "inactive") return;
    mr.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (Platform.OS !== "web") {
      Alert.alert(
        "Voice input on web",
        "Voice capture works in the web preview. On a real device, use the microphone in your keyboard.",
      );
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      Alert.alert("Not supported", "Microphone access is not available.");
      return;
    }
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        setRecording(false);
        for (const t of stream.getTracks()) t.stop();
        const blob = new Blob(chunksRef.current, {
          type: mime || "audio/webm",
        });
        if (blob.size < 1024) {
          Alert.alert("Too short", "Hold the mic and speak for a moment.");
          return;
        }
        await transcribe(blob);
      };
      mr.start();
      setRecording(true);
    } catch (err) {
      Alert.alert(
        "Microphone error",
        err instanceof Error ? err.message : "Could not access mic",
      );
    }
  }, []);

  const transcribe = async (blob: Blob) => {
    setTranscribing(true);
    try {
      const token = await getToken();
      const res = await fetch(`${apiBase}/api/voice/transcribe`, {
        method: "POST",
        headers: {
          "Content-Type": blob.type || "audio/webm",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: blob,
      });
      if (!res.ok) throw new Error(`Transcribe failed: ${res.status}`);
      const data = (await res.json()) as { text?: string };
      const t = (data.text ?? "").trim();
      if (!t) {
        Alert.alert("Hmm", "I didn't catch any words. Try again.");
        return;
      }
      setPrompt((prev) => (prev ? `${prev.trim()} ${t}` : t));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert(
        "Transcription failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setTranscribing(false);
    }
  };

  const onMicPress = () => {
    if (transcribing) return;
    if (recording) void stopRecording();
    else void startRecording();
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 8,
          justifyContent: "space-between",
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            padding: 8,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="x" size={24} color={colors.mutedForeground} />
        </Pressable>
        <MonoText
          style={{
            color: colors.primary,
            fontSize: 11,
            letterSpacing: 1.4,
          }}
        >
          {">_ new site"}
        </MonoText>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            padding: 20,
            paddingBottom: 40,
            gap: 16,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 8 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colors.primary,
                  shadowColor: colors.primary,
                  shadowOpacity: 0.8,
                  shadowRadius: 8,
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
                AI co-builder online
              </MonoText>
            </View>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 32,
                fontFamily: "Inter_700Bold",
                letterSpacing: -0.8,
                lineHeight: 38,
              }}
            >
              What should we forge?
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 14,
                lineHeight: 20,
              }}
            >
              Type or speak it. The agent picks the layout, palette, copy, and
              ships every page for you.
            </Text>
          </View>

          <LinearGradient
            colors={[`${colors.primary}22`, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: 18,
              padding: 1,
            }}
          >
            <View
              style={{
                backgroundColor: colors.cardElevated,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 17,
                padding: 14,
              }}
            >
              <TextInput
                value={prompt}
                onChangeText={setPrompt}
                placeholder="e.g. A minimal photographer portfolio with a dark hero…"
                placeholderTextColor={colors.mutedForeground}
                multiline
                autoFocus
                editable={!transcribing}
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_500Medium",
                  fontSize: 16,
                  minHeight: 130,
                  textAlignVertical: "top",
                }}
              />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Animated.View
                    style={{ transform: [{ scale: pulse }] }}
                  >
                    <Pressable
                      onPress={onMicPress}
                      disabled={transcribing}
                      style={({ pressed }) => ({
                        width: 38,
                        height: 38,
                        borderRadius: 19,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: recording
                          ? "#ef4444"
                          : colors.card,
                        borderWidth: 1,
                        borderColor: recording
                          ? "#ef4444"
                          : colors.border,
                        opacity: pressed ? 0.7 : 1,
                        shadowColor: recording ? "#ef4444" : colors.primary,
                        shadowOpacity: recording ? 0.6 : 0,
                        shadowRadius: 12,
                      })}
                    >
                      {transcribing ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.primary}
                        />
                      ) : (
                        <Feather
                          name={recording ? "square" : "mic"}
                          size={16}
                          color={recording ? "#fff" : colors.foreground}
                        />
                      )}
                    </Pressable>
                  </Animated.View>
                  <MonoText
                    style={{
                      color: recording
                        ? "#ef4444"
                        : transcribing
                          ? colors.primary
                          : colors.mutedForeground,
                      fontSize: 11,
                      letterSpacing: 1.2,
                    }}
                  >
                    {recording
                      ? "● REC — tap to stop"
                      : transcribing
                        ? "transcribing…"
                        : "tap to speak"}
                  </MonoText>
                </View>
                <MonoText
                  style={{
                    color:
                      prompt.length > 800
                        ? colors.warning
                        : colors.mutedForeground,
                    fontSize: 11,
                  }}
                >
                  {prompt.length}/1000
                </MonoText>
              </View>
            </View>
          </LinearGradient>

          <NeonButton
            title="✨ Forge it"
            onPress={onSubmit}
            loading={create.isPending}
            disabled={prompt.trim().length < 4 || transcribing}
            fullWidth
          />

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
              opacity: 0.6,
            }}
          >
            <Feather name="zap" size={12} color={colors.primary} />
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 11,
                letterSpacing: 1.2,
              }}
            >
              powered by GPT — multi-page output
            </MonoText>
          </View>

          <View style={{ marginTop: 20, gap: 10 }}>
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: "uppercase",
              }}
            >
              Try one of these
            </MonoText>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s.label}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setPrompt(s.prompt);
                }}
                style={({ pressed }) => ({
                  padding: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  opacity: pressed ? 0.85 : 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                })}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: `${colors.primary}22`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather name={s.icon} size={14} color={colors.primary} />
                </View>
                <Text
                  style={{
                    color: colors.foreground,
                    fontSize: 14,
                    flex: 1,
                  }}
                >
                  {s.label}
                </Text>
                <Feather
                  name="arrow-up-right"
                  size={16}
                  color={colors.mutedForeground}
                />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
