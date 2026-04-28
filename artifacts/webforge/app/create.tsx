import { Feather } from "@expo/vector-icons";

import { useAuth } from "@/lib/auth";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import {
  getGetSiteQueryKey,
  useCreateSite,
  useGetSite,
  type Site,
} from "@workspace/api-client-react";

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
  const params = useLocalSearchParams<{ prompt?: string; siteId?: string }>();
  const { getToken } = useAuth();
  const [prompt, setPrompt] = useState(
    typeof params.prompt === "string" ? params.prompt : "",
  );
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [activeSiteId, setActiveSiteId] = useState<string | null>(
    typeof params.siteId === "string" ? params.siteId : null,
  );
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
        data: { prompt: trimmed, name: null, autoBuild: true },
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setActiveSiteId(site.id);
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

  const transcribe = useCallback(
    async (blob: Blob) => {
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
    },
    [getToken],
  );

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
  }, [transcribe]);

  const onMicPress = () => {
    if (transcribing) return;
    if (recording) void stopRecording();
    else void startRecording();
  };

  const onCancelBuild = () => {
    setActiveSiteId(null);
    setPrompt("");
  };

  if (activeSiteId) {
    return (
      <BuildView
        siteId={activeSiteId}
        onBack={onCancelBuild}
        onOpenLibrary={() => router.replace(`/site/${activeSiteId}`)}
      />
    );
  }

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
                editable={!transcribing && !create.isPending}
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
                  <Animated.View style={{ transform: [{ scale: pulse }] }}>
                    <Pressable
                      onPress={onMicPress}
                      disabled={transcribing}
                      style={({ pressed }) => ({
                        width: 38,
                        height: 38,
                        borderRadius: 19,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: recording ? "#ef4444" : colors.card,
                        borderWidth: 1,
                        borderColor: recording ? "#ef4444" : colors.border,
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
            disabled={
              prompt.trim().length < 4 || transcribing || create.isPending
            }
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

// ---------------------------------------------------------------------------
// Live build view — Bolt.new-style streaming preview
// ---------------------------------------------------------------------------

function BuildView({
  siteId,
  onBack,
  onOpenLibrary,
}: {
  siteId: string;
  onBack: () => void;
  onOpenLibrary: () => void;
}) {
  const colors = useColors();
  const siteQuery = useGetSite(siteId, {
    query: {
      queryKey: getGetSiteQueryKey(siteId),
      refetchInterval: (q) => {
        const s = q.state.data as Site | undefined;
        if (!s) return 1200;
        return s.status === "ready" || s.status === "failed" ? false : 900;
      },
    },
  });
  const site = siteQuery.data as Site | undefined;

  // Track build-log lines for the streaming console.
  const [logLines, setLogLines] = useState<string[]>([]);
  const lastMsgRef = useRef<string | null>(null);
  useEffect(() => {
    const m = site?.message;
    if (m && m !== lastMsgRef.current) {
      lastMsgRef.current = m;
      setLogLines((prev) => [...prev.slice(-20), m]);
    }
  }, [site?.message]);

  // Iframe refresh key — bumps every ~1.4s while a page file is present and
  // the site is still being built, so users see new sections appearing.
  const [refreshKey, setRefreshKey] = useState(0);
  const hasIndex = useMemo(
    () => (site?.files ?? []).includes("index.html"),
    [site?.files],
  );
  useEffect(() => {
    if (!site) return;
    if (site.status === "ready" || site.status === "failed") return;
    if (!hasIndex) return;
    const t = setInterval(() => setRefreshKey((k) => k + 1), 1400);
    return () => clearInterval(t);
  }, [site, hasIndex]);

  const accent = site?.coverColor || colors.primary;
  const status = site?.status ?? "queued";
  const progress = site?.progress ?? 0;
  const isReady = status === "ready";
  const isFailed = status === "failed";
  const previewUrl = site?.previewUrl ?? null;
  const iframeSrc =
    previewUrl && hasIndex ? `${previewUrl}?_=${refreshKey}` : null;

  const onOpenInBrowser = async () => {
    if (!previewUrl) return;
    void Haptics.selectionAsync();
    await Linking.openURL(previewUrl);
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
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 8,
        }}
      >
        <Pressable
          onPress={onBack}
          style={({ pressed }) => ({
            padding: 8,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather
            name="chevron-left"
            size={24}
            color={colors.mutedForeground}
          />
        </Pressable>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: isReady
                ? colors.success
                : isFailed
                  ? colors.destructive
                  : accent,
              shadowColor: accent,
              shadowOpacity: 0.8,
              shadowRadius: 6,
            }}
          />
          <MonoText
            style={{
              color: isReady
                ? colors.success
                : isFailed
                  ? colors.destructive
                  : accent,
              fontSize: 11,
              letterSpacing: 1.4,
              fontWeight: "700",
            }}
          >
            {status.toUpperCase()}
          </MonoText>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}
      >
        <View>
          <Text
            style={{
              color: colors.foreground,
              fontSize: 24,
              fontFamily: "Inter_700Bold",
              letterSpacing: -0.6,
            }}
            numberOfLines={2}
          >
            {site?.name ?? "Forging your site"}
          </Text>
          {site?.prompt ? (
            <Text
              numberOfLines={2}
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
                marginTop: 4,
              }}
            >
              {site.prompt}
            </Text>
          ) : null}
        </View>

        <LivePreviewPane
          iframeSrc={iframeSrc}
          accent={accent}
          isReady={isReady}
          isFailed={isFailed}
          status={status}
          progress={progress}
          message={site?.message ?? "warming up…"}
          previewUrl={previewUrl}
          onOpenInBrowser={onOpenInBrowser}
        />

        <View
          style={{
            backgroundColor: colors.cardElevated,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 14,
            gap: 8,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: "uppercase",
              }}
            >
              Build log
            </MonoText>
            <MonoText
              style={{
                color: accent,
                fontSize: 12,
              }}
            >
              {progress}%
            </MonoText>
          </View>
          <View
            style={{
              height: 4,
              backgroundColor: colors.border,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${Math.max(2, progress)}%`,
                backgroundColor: accent,
                height: "100%",
              }}
            />
          </View>
          <View style={{ marginTop: 4, gap: 2 }}>
            {logLines.length === 0 ? (
              <MonoText
                style={{ color: colors.mutedForeground, fontSize: 12 }}
              >
                {">_ "} starting agent…
              </MonoText>
            ) : (
              logLines.map((line, idx) => (
                <MonoText
                  key={`${idx}-${line}`}
                  style={{
                    color:
                      idx === logLines.length - 1
                        ? colors.foreground
                        : colors.mutedForeground,
                    fontSize: 12,
                  }}
                  numberOfLines={1}
                >
                  {">_ "} {line}
                </MonoText>
              ))
            )}
          </View>
        </View>

        {(site?.files ?? []).length > 0 ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 14,
              gap: 6,
            }}
          >
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: "uppercase",
              }}
            >
              Files materialized ({(site?.files ?? []).length})
            </MonoText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {(site?.files ?? []).map((f) => (
                <View
                  key={f}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 6,
                    backgroundColor: colors.cardElevated,
                    borderWidth: 1,
                    borderColor: `${accent}55`,
                  }}
                >
                  <MonoText
                    style={{
                      color: colors.foreground,
                      fontSize: 11,
                    }}
                  >
                    {f}
                  </MonoText>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {isReady ? (
          <View style={{ gap: 10 }}>
            <NeonButton
              title="Open in library"
              onPress={onOpenLibrary}
              fullWidth
            />
            <Pressable
              onPress={onBack}
              style={({ pressed }) => ({
                padding: 14,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                alignItems: "center",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                }}
              >
                Forge another
              </Text>
            </Pressable>
          </View>
        ) : null}

        {isFailed ? (
          <View
            style={{
              padding: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.destructive,
              gap: 8,
              backgroundColor: `${colors.destructive}11`,
            }}
          >
            <Text
              style={{
                color: colors.destructive,
                fontFamily: "Inter_700Bold",
              }}
            >
              Build failed
            </Text>
            <MonoText
              style={{ color: colors.mutedForeground, fontSize: 12 }}
            >
              {site?.error ?? "Unknown error"}
            </MonoText>
            <NeonButton title="Try again" onPress={onBack} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function LivePreviewPane({
  iframeSrc,
  accent,
  isReady,
  isFailed,
  status,
  progress,
  message,
  previewUrl,
  onOpenInBrowser,
}: {
  iframeSrc: string | null;
  accent: string;
  isReady: boolean;
  isFailed: boolean;
  status: string;
  progress: number;
  message: string;
  previewUrl: string | null;
  onOpenInBrowser: () => void;
}) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isReady) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isReady, pulse]);

  const overlayOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.4],
  });

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
        backgroundColor: "#000",
        minHeight: 360,
      }}
    >
      {/* Fake browser chrome */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 8,
          backgroundColor: colors.cardElevated,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <View
            key={c}
            style={{
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: c,
            }}
          />
        ))}
        <Pressable
          onPress={onOpenInBrowser}
          disabled={!previewUrl}
          style={{
            flex: 1,
            backgroundColor: colors.card,
            marginLeft: 6,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Feather name="lock" size={9} color={colors.mutedForeground} />
          <MonoText
            numberOfLines={1}
            style={{ color: colors.mutedForeground, fontSize: 10, flex: 1 }}
          >
            {previewUrl ?? "preview is loading…"}
          </MonoText>
          {previewUrl ? (
            <Feather
              name="external-link"
              size={11}
              color={colors.mutedForeground}
            />
          ) : null}
        </Pressable>
      </View>

      {/* Iframe area */}
      <View style={{ minHeight: 320, backgroundColor: "#0a0a0a" }}>
        {Platform.OS === "web" && iframeSrc ? (
          React.createElement("iframe", {
            src: iframeSrc,
            title: "Live site preview",
            style: {
              width: "100%",
              height: "100%",
              minHeight: 320,
              border: "0",
              background: "#0a0a0a",
              display: "block",
            },
            sandbox: "allow-scripts allow-same-origin",
          })
        ) : (
          <View
            style={{
              minHeight: 320,
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              gap: 10,
            }}
          >
            <ActivityIndicator color={accent} />
            <MonoText
              style={{
                color: accent,
                fontSize: 11,
                letterSpacing: 1.4,
                fontWeight: "700",
              }}
            >
              {isFailed
                ? "● BUILD FAILED"
                : isReady
                  ? "● READY"
                  : "● GENERATING"}
            </MonoText>
            <Text
              style={{
                color: "#fff",
                fontFamily: "Inter_600SemiBold",
                fontSize: 14,
                textAlign: "center",
              }}
            >
              {message}
            </Text>
            {previewUrl ? (
              <Pressable onPress={onOpenInBrowser}>
                <MonoText style={{ color: colors.primary, fontSize: 11 }}>
                  Open preview in browser ↗
                </MonoText>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      {/* Generating overlay shimmer (only while building) */}
      {!isReady && Platform.OS === "web" && iframeSrc ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 32,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: accent,
            opacity: overlayOpacity,
          }}
        />
      ) : null}

      {/* Status pill in the corner */}
      <View
        style={{
          position: "absolute",
          top: 44,
          right: 10,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 999,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          backgroundColor: "#000A",
          borderWidth: 1,
          borderColor: `${accent}77`,
        }}
      >
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: isReady
              ? colors.success
              : isFailed
                ? colors.destructive
                : accent,
          }}
        />
        <MonoText
          style={{
            color: isReady
              ? colors.success
              : isFailed
                ? colors.destructive
                : accent,
            fontSize: 10,
            letterSpacing: 1.2,
            fontWeight: "700",
          }}
        >
          {isReady
            ? "LIVE"
            : isFailed
              ? "FAILED"
              : `${status.toUpperCase()} ${progress}%`}
        </MonoText>
      </View>
    </View>
  );
}
