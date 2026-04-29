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
  getListSiteMessagesQueryKey,
  useCreateSite,
  useGetSite,
  useListSiteMessages,
  useSendSiteMessage,
  type Site,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { MonoText } from "@/components/MonoText";
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

type AgentMessage = {
  id: string;
  role: "user" | "agent" | "system";
  kind: string;
  content: string;
  data?: Record<string, unknown> | null;
  createdAt: string;
};

const apiBase =
  (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "") || "";

export default function CreateScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ prompt?: string; siteId?: string }>();
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const [draft, setDraft] = useState(
    typeof params.prompt === "string" ? params.prompt : "",
  );
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [activeSiteId, setActiveSiteId] = useState<string | null>(
    typeof params.siteId === "string" ? params.siteId : null,
  );
  const [showPreview, setShowPreview] = useState(true);

  const create = useCreateSite();
  const send = useSendSiteMessage();

  const siteQuery = useGetSite(activeSiteId ?? "", {
    query: {
      enabled: !!activeSiteId,
      queryKey: getGetSiteQueryKey(activeSiteId ?? ""),
      refetchInterval: (q) => {
        const s = q.state.data as Site | undefined;
        if (!s) return 1500;
        return s.status === "ready" || s.status === "failed" ? false : 1100;
      },
    },
  });
  const messagesQuery = useListSiteMessages(activeSiteId ?? "", {
    query: {
      enabled: !!activeSiteId,
      queryKey: getListSiteMessagesQueryKey(activeSiteId ?? ""),
      refetchInterval: (q) => {
        const s = siteQuery.data as Site | undefined;
        if (!s) return 1500;
        return s.status === "ready" || s.status === "failed" ? 4000 : 1100;
      },
    },
  });

  const site = siteQuery.data as Site | undefined;
  const messages = (messagesQuery.data ?? []) as AgentMessage[];

  // Submit: either start a new site, or send a follow-up message.
  const onSubmit = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed.length < 2) return;
    if (!activeSiteId) {
      try {
        const created = await create.mutateAsync({
          data: { prompt: trimmed, name: null, autoBuild: true },
        });
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        setActiveSiteId(created.id);
        setDraft("");
      } catch (e) {
        Alert.alert(
          "Could not start build",
          e instanceof Error ? e.message : "Unknown error",
        );
      }
    } else {
      try {
        await send.mutateAsync({
          id: activeSiteId,
          data: { content: trimmed },
        });
        setDraft("");
        void Haptics.selectionAsync();
        // Refresh messages immediately
        await qc.invalidateQueries({
          queryKey: getListSiteMessagesQueryKey(activeSiteId),
        });
      } catch (e) {
        Alert.alert(
          "Could not send",
          e instanceof Error ? e.message : "Unknown error",
        );
      }
    }
  }, [draft, activeSiteId, create, send, qc]);

  // Voice input (web only — uses MediaRecorder + /api/voice/transcribe).
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stopRecording = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") return;
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
        setDraft((prev) => (prev ? `${prev.trim()} ${t}` : t));
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
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

  const sending = create.isPending || send.isPending;
  const inputDisabled = transcribing || sending;
  const isWorking =
    !!site && site.status !== "ready" && site.status !== "failed";

  const onClose = () => router.back();
  const onNewChat = () => {
    setActiveSiteId(null);
    setDraft("");
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <ChatHeader
        site={site}
        onClose={onClose}
        onNewChat={onNewChat}
        hasSite={!!activeSiteId}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {!activeSiteId ? (
          <EmptyChat
            colors={colors}
            onPick={(p) => {
              void Haptics.selectionAsync();
              setDraft(p);
            }}
          />
        ) : (
          <ConversationView
            messages={messages}
            site={site}
            isWorking={isWorking}
            showPreview={showPreview}
            onTogglePreview={() => setShowPreview((s) => !s)}
            onOpenSite={() => router.push(`/site/${activeSiteId}`)}
            onOpenInBrowser={async () => {
              if (!site?.previewUrl) return;
              await Linking.openURL(site.previewUrl);
            }}
          />
        )}

        <Composer
          colors={colors}
          value={draft}
          onChange={setDraft}
          onSubmit={onSubmit}
          onMicPress={onMicPress}
          recording={recording}
          transcribing={transcribing}
          disabled={inputDisabled}
          sending={sending}
          placeholder={
            activeSiteId
              ? "Ask the agent to change something…"
              : "Describe the site you want…"
          }
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function ChatHeader({
  site,
  onClose,
  onNewChat,
  hasSite,
}: {
  site: Site | undefined;
  onClose: () => void;
  onNewChat: () => void;
  hasSite: boolean;
}) {
  const colors = useColors();
  const status = site?.status ?? "queued";
  const isReady = status === "ready";
  const isFailed = status === "failed";
  const accent = isReady
    ? colors.success
    : isFailed
      ? colors.destructive
      : (site?.coverColor || colors.primary);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Pressable
        onPress={onClose}
        hitSlop={10}
        style={({ pressed }) => ({
          padding: 6,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="chevron-left" size={22} color={colors.foreground} />
      </Pressable>

      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: `${accent}22`,
            borderWidth: 1,
            borderColor: `${accent}55`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="zap" size={13} color={accent} />
        </View>
        <View style={{ alignItems: "flex-start" }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
              lineHeight: 16,
            }}
            numberOfLines={1}
          >
            {site?.name ?? "WebForge Agent"}
          </Text>
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: accent,
                shadowColor: accent,
                shadowOpacity: 0.8,
                shadowRadius: 4,
              }}
            />
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 10,
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              {hasSite
                ? isReady
                  ? "live"
                  : isFailed
                    ? "build failed"
                    : `${status} · ${site?.progress ?? 0}%`
                : "ready when you are"}
            </MonoText>
          </View>
        </View>
      </View>

      <Pressable
        onPress={onNewChat}
        hitSlop={10}
        style={({ pressed }) => ({
          padding: 6,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather
          name={hasSite ? "edit" : "x"}
          size={20}
          color={colors.mutedForeground}
        />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyChat({
  colors,
  onPick,
}: {
  colors: ReturnType<typeof useColors>;
  onPick: (p: string) => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: 18,
        paddingTop: 26,
        paddingBottom: 16,
        gap: 22,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ alignItems: "center", gap: 14 }}>
        <LinearGradient
          colors={[`${colors.primary}33`, `${colors.accent}11`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: `${colors.primary}55`,
          }}
        >
          <Feather name="zap" size={28} color={colors.primary} />
        </LinearGradient>
        <Text
          style={{
            color: colors.foreground,
            fontSize: 24,
            fontFamily: "Inter_700Bold",
            letterSpacing: -0.4,
            textAlign: "center",
          }}
        >
          What should we build today?
        </Text>
        <Text
          style={{
            color: colors.mutedForeground,
            fontSize: 13,
            lineHeight: 19,
            textAlign: "center",
            maxWidth: 320,
          }}
        >
          Describe a site in plain English. The agent will plan it, design it,
          and ship it — page by page. You can keep chatting to refine.
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        <MonoText
          style={{
            color: colors.mutedForeground,
            fontSize: 10,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            paddingHorizontal: 4,
          }}
        >
          Try one of these
        </MonoText>
        {SUGGESTIONS.map((s) => (
          <Pressable
            key={s.label}
            onPress={() => onPick(s.prompt)}
            style={({ pressed }) => ({
              padding: 12,
              borderRadius: 14,
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
                borderRadius: 10,
                backgroundColor: `${colors.primary}1A`,
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
                fontFamily: "Inter_500Medium",
              }}
              numberOfLines={2}
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
  );
}

// ---------------------------------------------------------------------------
// Conversation view (messages + inline preview)
// ---------------------------------------------------------------------------

function ConversationView({
  messages,
  site,
  isWorking,
  showPreview,
  onTogglePreview,
  onOpenSite,
  onOpenInBrowser,
}: {
  messages: AgentMessage[];
  site: Site | undefined;
  isWorking: boolean;
  showPreview: boolean;
  onTogglePreview: () => void;
  onOpenSite: () => void;
  onOpenInBrowser: () => void;
}) {
  const colors = useColors();
  const scrollRef = useRef<ScrollView>(null);
  const lastCount = useRef(0);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      const t = setTimeout(
        () => scrollRef.current?.scrollToEnd({ animated: true }),
        80,
      );
      return () => clearTimeout(t);
    }
  }, [messages.length]);

  // Iframe refresh during build (web-only inline preview).
  const [refreshKey, setRefreshKey] = useState(0);
  const hasIndex = useMemo(
    () => (site?.files ?? []).includes("index.html"),
    [site?.files],
  );
  useEffect(() => {
    if (!site || !isWorking || !hasIndex) return;
    const t = setInterval(() => setRefreshKey((k) => k + 1), 1500);
    return () => clearInterval(t);
  }, [site, isWorking, hasIndex]);

  const previewUrl = site?.previewUrl ?? null;
  const iframeSrc =
    previewUrl && hasIndex ? `${previewUrl}?_=${refreshKey}` : null;

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 14,
        gap: 10,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {messages.length === 0 && isWorking ? (
        <AgentBubble>
          <TypingDots />
          <MonoText
            style={{
              color: colors.mutedForeground,
              fontSize: 11,
              marginTop: 6,
            }}
          >
            warming up the agent…
          </MonoText>
        </AgentBubble>
      ) : null}

      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}

      {/* Inline preview card — appears once we have any HTML to show. */}
      {site && (hasIndex || isWorking) ? (
        <PreviewCard
          site={site}
          iframeSrc={iframeSrc}
          showPreview={showPreview}
          onToggle={onTogglePreview}
          onOpenSite={onOpenSite}
          onOpenInBrowser={onOpenInBrowser}
        />
      ) : null}

      {/* Live "thinking" bubble while a job is running and the last message
          isn't already an in-flight progress update. */}
      {isWorking && messages.length > 0 ? (
        <AgentBubble>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TypingDots />
            <MonoText
              style={{ color: colors.mutedForeground, fontSize: 11 }}
            >
              {(site?.message ?? "working").toLowerCase()}
            </MonoText>
          </View>
        </AgentBubble>
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Message bubble — renders user, agent, and rich agent message kinds.
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: AgentMessage }) {
  const colors = useColors();
  if (message.role === "user") {
    return (
      <View
        style={{
          alignSelf: "flex-end",
          maxWidth: "85%",
          backgroundColor: colors.primary,
          paddingHorizontal: 13,
          paddingVertical: 10,
          borderRadius: 16,
          borderBottomRightRadius: 4,
        }}
      >
        <Text
          style={{
            color: colors.primaryForeground,
            fontFamily: "Inter_500Medium",
            fontSize: 14,
            lineHeight: 20,
          }}
        >
          {message.content}
        </Text>
      </View>
    );
  }

  // System: subtle centered note.
  if (message.role === "system") {
    return (
      <MonoText
        style={{
          color: colors.mutedForeground,
          fontSize: 10,
          textAlign: "center",
          paddingVertical: 4,
        }}
      >
        {message.content}
      </MonoText>
    );
  }

  // Agent — render based on kind.
  switch (message.kind) {
    case "analysis":
      return <AnalysisCard message={message} />;
    case "plan":
      return <PlanCard message={message} />;
    case "awaiting_confirmation":
      return (
        <AgentBubble>
          <Text
            style={{
              color: colors.foreground,
              fontSize: 14,
              lineHeight: 20,
            }}
          >
            {message.content}
          </Text>
          <MonoText
            style={{
              color: colors.primary,
              fontSize: 10,
              letterSpacing: 1.2,
              marginTop: 6,
              textTransform: "uppercase",
            }}
          >
            reply &quot;build it&quot; to confirm
          </MonoText>
        </AgentBubble>
      );
    case "build_started":
      return (
        <StatusLine
          icon="play-circle"
          label="Build started"
          color={colors.accent}
        />
      );
    case "build_done":
      return (
        <StatusLine
          icon="check-circle"
          label={message.content || "Build complete"}
          color={colors.success}
        />
      );
    case "build_failed":
      return (
        <StatusLine
          icon="alert-circle"
          label={message.content || "Build failed"}
          color={colors.destructive}
        />
      );
    case "log":
    case "build_progress":
      return (
        <View style={{ paddingLeft: 6 }}>
          <MonoText
            style={{
              color: colors.mutedForeground,
              fontSize: 11,
              letterSpacing: 0.5,
            }}
          >
            <Text style={{ color: colors.primary }}>›_ </Text>
            {message.content}
          </MonoText>
        </View>
      );
    default:
      return (
        <AgentBubble>
          <Text
            style={{
              color: colors.foreground,
              fontSize: 14,
              lineHeight: 20,
            }}
          >
            {message.content}
          </Text>
        </AgentBubble>
      );
  }
}

function AgentBubble({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        alignItems: "flex-end",
        maxWidth: "92%",
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: `${colors.primary}1A`,
          borderWidth: 1,
          borderColor: `${colors.primary}55`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name="zap" size={12} color={colors.primary} />
      </View>
      <View
        style={{
          flex: 1,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 13,
          paddingVertical: 10,
          borderRadius: 16,
          borderBottomLeftRadius: 4,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function AnalysisCard({ message }: { message: AgentMessage }) {
  const colors = useColors();
  const a = (message.data ?? {}) as {
    intent?: string;
    audience?: string | null;
    features?: string[];
    pages?: string[];
    styleHints?: string[];
  };
  return (
    <AgentBubble>
      <Text
        style={{
          color: colors.foreground,
          fontSize: 14,
          lineHeight: 20,
          marginBottom: 6,
        }}
      >
        {message.content}
      </Text>
      {a.audience ? (
        <MonoText
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            marginBottom: 6,
          }}
        >
          audience › {a.audience}
        </MonoText>
      ) : null}
      {a.features?.length ? (
        <View style={{ marginTop: 6, gap: 4 }}>
          {a.features.map((f) => (
            <View
              key={f}
              style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}
            >
              <MonoText
                style={{ color: colors.primary, fontSize: 11, lineHeight: 18 }}
              >
                ✓
              </MonoText>
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 13,
                  lineHeight: 18,
                  flex: 1,
                }}
              >
                {f}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </AgentBubble>
  );
}

function PlanCard({ message }: { message: AgentMessage }) {
  const colors = useColors();
  const p = (message.data ?? {}) as {
    pages?: { name?: string; route?: string; sections?: string[] }[];
    palette?: string[];
  };
  return (
    <AgentBubble>
      <Text
        style={{
          color: colors.foreground,
          fontSize: 14,
          lineHeight: 20,
          marginBottom: 8,
        }}
      >
        {message.content}
      </Text>

      {p.palette?.length ? (
        <View
          style={{
            flexDirection: "row",
            gap: 6,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          {p.palette.slice(0, 6).map((c, i) => (
            <View
              key={`${c}-${i}`}
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                backgroundColor: c,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            />
          ))}
        </View>
      ) : null}

      {p.pages?.length ? (
        <View style={{ gap: 6 }}>
          {p.pages.slice(0, 6).map((pg, i) => (
            <View
              key={`${pg.name ?? "page"}-${i}`}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 8,
                backgroundColor: colors.cardElevated,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 13,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                {pg.name ?? pg.route ?? `Page ${i + 1}`}
              </Text>
              {pg.sections?.length ? (
                <MonoText
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 10,
                    marginTop: 2,
                  }}
                >
                  {pg.sections.join(" · ")}
                </MonoText>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </AgentBubble>
  );
}

function StatusLine({
  icon,
  label,
  color,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 4,
        paddingHorizontal: 6,
      }}
    >
      <Feather name={icon} size={14} color={color} />
      <Text
        style={{
          color: colors.foreground,
          fontSize: 13,
          fontFamily: "Inter_500Medium",
          flex: 1,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function TypingDots() {
  const colors = useColors();
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0,
            duration: 400,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
    const loops = [make(a, 0), make(b, 150), make(c, 300)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [a, b, c]);

  const dot = (v: Animated.Value) => (
    <Animated.View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.primary,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
        transform: [
          {
            translateY: v.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -3],
            }),
          },
        ],
      }}
    />
  );

  return (
    <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
      {dot(a)}
      {dot(b)}
      {dot(c)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Inline preview card
// ---------------------------------------------------------------------------

function PreviewCard({
  site,
  iframeSrc,
  showPreview,
  onToggle,
  onOpenSite,
  onOpenInBrowser,
}: {
  site: Site;
  iframeSrc: string | null;
  showPreview: boolean;
  onToggle: () => void;
  onOpenSite: () => void;
  onOpenInBrowser: () => void;
}) {
  const colors = useColors();
  const isReady = site.status === "ready";
  const isFailed = site.status === "failed";
  const accent = isReady
    ? colors.success
    : isFailed
      ? colors.destructive
      : (site.coverColor || colors.primary);

  return (
    <View
      style={{
        marginTop: 4,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        overflow: "hidden",
      }}
    >
      {/* Browser-chrome header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <View style={{ flexDirection: "row", gap: 5 }}>
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 4.5,
              backgroundColor: "#FF5F57",
            }}
          />
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 4.5,
              backgroundColor: "#FEBC2E",
            }}
          />
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 4.5,
              backgroundColor: "#28C840",
            }}
          />
        </View>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 8,
            paddingVertical: 3,
            backgroundColor: colors.cardElevated,
            borderRadius: 6,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Feather name="lock" size={9} color={colors.mutedForeground} />
          <MonoText
            numberOfLines={1}
            style={{
              color: colors.mutedForeground,
              fontSize: 10,
              flex: 1,
            }}
          >
            {site.publicUrl ?? site.previewUrl ?? "preview pending…"}
          </MonoText>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor: `${accent}22`,
            }}
          >
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 2.5,
                backgroundColor: accent,
              }}
            />
            <MonoText
              style={{
                color: accent,
                fontSize: 9,
                letterSpacing: 1,
                fontWeight: "700",
              }}
            >
              {isReady
                ? "LIVE"
                : isFailed
                  ? "FAILED"
                  : `${site.progress ?? 0}%`}
            </MonoText>
          </View>
        </View>
        <Pressable
          onPress={onToggle}
          hitSlop={8}
          style={({ pressed }) => ({
            padding: 4,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather
            name={showPreview ? "chevron-up" : "chevron-down"}
            size={14}
            color={colors.mutedForeground}
          />
        </Pressable>
      </View>

      {showPreview ? (
        <View style={{ minHeight: 240, backgroundColor: "#0a0a0a" }}>
          {Platform.OS === "web" && iframeSrc ? (
            React.createElement("iframe", {
              src: iframeSrc,
              title: "Live preview",
              style: {
                width: "100%",
                height: "100%",
                minHeight: 240,
                border: "0",
                background: "#0a0a0a",
                display: "block",
              },
              sandbox: "allow-scripts allow-same-origin",
            })
          ) : (
            <View
              style={{
                minHeight: 240,
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: 20,
              }}
            >
              {isFailed ? null : <ActivityIndicator color={accent} />}
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_500Medium",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                {site.message ?? "warming up…"}
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {/* Footer actions */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          padding: 10,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Pressable
          onPress={onOpenInBrowser}
          disabled={!site.previewUrl}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: 999,
            backgroundColor: colors.cardElevated,
            opacity: !site.previewUrl ? 0.5 : pressed ? 0.7 : 1,
          })}
        >
          <Feather name="external-link" size={11} color={colors.foreground} />
          <MonoText style={{ color: colors.foreground, fontSize: 10 }}>
            open
          </MonoText>
        </Pressable>
        <Pressable
          onPress={onOpenSite}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: 999,
            backgroundColor: colors.cardElevated,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Feather name="settings" size={11} color={colors.foreground} />
          <MonoText style={{ color: colors.foreground, fontSize: 10 }}>
            site settings
          </MonoText>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function Composer({
  colors,
  value,
  onChange,
  onSubmit,
  onMicPress,
  recording,
  transcribing,
  disabled,
  sending,
  placeholder,
}: {
  colors: ReturnType<typeof useColors>;
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  onMicPress: () => void;
  recording: boolean;
  transcribing: boolean;
  disabled: boolean;
  sending: boolean;
  placeholder: string;
}) {
  const canSend = value.trim().length >= 2 && !disabled;
  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: Platform.OS === "ios" ? 12 : 14,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          backgroundColor: colors.cardElevated,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 12,
          paddingVertical: 6,
        }}
      >
        <Pressable
          onPress={onMicPress}
          disabled={transcribing}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: recording ? "#ef4444" : "transparent",
            opacity: pressed ? 0.7 : 1,
            marginBottom: 5,
          })}
        >
          {transcribing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather
              name={recording ? "square" : "mic"}
              size={16}
              color={recording ? "#fff" : colors.mutedForeground}
            />
          )}
        </Pressable>

        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          multiline
          editable={!disabled}
          style={{
            flex: 1,
            color: colors.foreground,
            fontFamily: "Inter_500Medium",
            fontSize: 15,
            maxHeight: 140,
            paddingTop: 9,
            paddingBottom: 9,
            ...(Platform.OS === "web"
              ? ({ outlineStyle: "none" } as object)
              : null),
          }}
        />

        <Pressable
          onPress={onSubmit}
          disabled={!canSend}
          hitSlop={6}
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canSend ? colors.primary : colors.muted,
            opacity: pressed ? 0.8 : 1,
            marginBottom: 4,
          })}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Feather
              name="arrow-up"
              size={16}
              color={
                canSend ? colors.primaryForeground : colors.mutedForeground
              }
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}
