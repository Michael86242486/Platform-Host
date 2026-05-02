import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
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
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  getGetSiteQueryKey,
  getListSiteMessagesQueryKey,
  useDeleteSite,
  useEditSite,
  useGetSite,
  useListSiteMessages,
  useRegenerateSitePage,
  useRemoveSiteDomain,
  useRepublishSite,
  useRetrySite,
  useSetSiteDomain,
  useVerifySiteDomain,
  type Site,
  type SitePlanPage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { MatrixRain } from "@/components/MatrixRain";
import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { Surface } from "@/components/Surface";
import { useColors } from "@/hooks/useColors";
import { useSiteStream } from "@/lib/useSiteStream";

type Tab = "overview" | "chat" | "preview";

type AgentMessage = {
  id: string;
  role: "user" | "agent" | "system";
  kind: string;
  content: string;
  data?: Record<string, unknown> | null;
  createdAt: string;
};

type SiteCheckpointDto = {
  id: string;
  label: string;
  createdAt: string;
  progress: number;
  hasFiles: boolean;
};

export default function SiteDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [chatDraft, setChatDraft] = useState("");

  const siteQuery = useGetSite(String(id), {
    query: {
      queryKey: getGetSiteQueryKey(String(id)),
      refetchInterval: (q) => {
        const s = q.state.data as Site | undefined;
        if (!s) return 1500;
        return s.status === "ready" || s.status === "failed" ? false : 1200;
      },
    },
  });

  const messagesQuery = useListSiteMessages(String(id), {
    query: {
      enabled: activeTab === "chat",
      queryKey: getListSiteMessagesQueryKey(String(id)),
      refetchInterval: (q) => {
        const s = siteQuery.data as Site | undefined;
        if (!s) return 1500;
        if (s.status === "ready" || s.status === "failed") return 8000;
        return 1500;
      },
    },
  });

  const stream = useSiteStream(String(id));

  const retry = useRetrySite();
  const republish = useRepublishSite();
  const del = useDeleteSite();
  const editSite = useEditSite();
  const setDomain = useSetSiteDomain();
  const removeDomain = useRemoveSiteDomain();
  const verifyDomain = useVerifySiteDomain();
  const regeneratePage = useRegenerateSitePage();
  const [regeneratingPath, setRegeneratingPath] = useState<string | null>(null);

  const site = siteQuery.data as Site | undefined;
  const messages = (messagesQuery.data ?? []) as AgentMessage[];

  useEffect(() => {
    if (stream.connected && activeTab === "chat") {
      void qc.invalidateQueries({ queryKey: getListSiteMessagesQueryKey(String(id)) });
    }
  }, [stream.connected, activeTab, id, qc]);

  const onShare = async () => {
    if (!site?.publicUrl) return;
    await Share.share({ message: `${site.name}\n${site.publicUrl}`, url: site.publicUrl });
  };

  const onCopy = async () => {
    if (!site?.publicUrl) return;
    await Clipboard.setStringAsync(site.publicUrl);
    void Haptics.selectionAsync();
    Alert.alert("Copied", "Link copied to clipboard.");
  };

  const onDelete = () => {
    if (!site) return;
    Alert.alert("Delete site?", `Delete "${site.name}"? This is permanent.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await del.mutateAsync({ id: site.id });
          router.back();
        },
      },
    ]);
  };

  const onRetry = async () => {
    if (!site) return;
    await retry.mutateAsync({ id: site.id });
    siteQuery.refetch();
  };

  const onRepublish = async () => {
    if (!site) return;
    void Haptics.selectionAsync();
    try {
      await republish.mutateAsync({ id: site.id });
      await siteQuery.refetch();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Republished",
        "Your site is live on Puter again. New URLs can take up to a minute to propagate.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't republish";
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Republish failed", msg);
    }
  };

  const onRegeneratePage = async (page: SitePlanPage) => {
    if (!site || regeneratingPath) return;
    setRegeneratingPath(page.path);
    void Haptics.selectionAsync();
    try {
      await regeneratePage.mutateAsync({ id: site.id, data: { path: page.path } });
      await siteQuery.refetch();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Regenerate failed", e instanceof Error ? e.message : "Couldn't regenerate page");
    } finally {
      setRegeneratingPath(null);
    }
  };

  const confirmRegenerate = (page: SitePlanPage) => {
    Alert.alert(
      "Regenerate this page?",
      `Re-render "${page.title}" (/${page.path}) from the deterministic template.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Regenerate", style: "default", onPress: () => void onRegeneratePage(page) },
      ],
    );
  };

  const onSendChatMessage = useCallback(async () => {
    const trimmed = chatDraft.trim();
    if (trimmed.length < 2 || !site) return;
    try {
      await editSite.mutateAsync({ id: site.id, data: { prompt: trimmed } });
      setChatDraft("");
      void Haptics.selectionAsync();
      await siteQuery.refetch();
      void qc.invalidateQueries({ queryKey: getListSiteMessagesQueryKey(site.id) });
    } catch (e) {
      Alert.alert("Edit failed", e instanceof Error ? e.message : "Unknown error");
    }
  }, [chatDraft, site, editSite, siteQuery, qc]);

  if (!site) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}
      >
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const isWorking =
    site.status === "queued" ||
    site.status === "analyzing" ||
    site.status === "building" ||
    site.status === "awaiting_confirmation";
  const accent = site.coverColor || colors.primary;
  const checkpoints = ((site as unknown as { checkpoints?: SiteCheckpointDto[] }).checkpoints ?? []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {/* ── Header ── */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 12,
            paddingVertical: 8,
            justifyContent: "space-between",
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({ padding: 10, opacity: pressed ? 0.6 : 1 })}
          >
            <Feather name="chevron-left" size={26} color={colors.foreground} />
          </Pressable>

          <View style={{ flex: 1, paddingHorizontal: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 3.5,
                  backgroundColor:
                    site.status === "ready"
                      ? colors.success
                      : site.status === "failed"
                        ? colors.destructive
                        : accent,
                }}
              />
              <Text
                numberOfLines={1}
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_700Bold",
                  fontSize: 16,
                  letterSpacing: -0.3,
                  flex: 1,
                }}
              >
                {site.name}
              </Text>
            </View>
            <MonoText numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10 }}>
              /{site.slug}
            </MonoText>
          </View>

          <Pressable
            onPress={onDelete}
            style={({ pressed }) => ({ padding: 10, opacity: pressed ? 0.6 : 1 })}
          >
            <Feather name="trash-2" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* ── Tab bar ── */}
        <TabBar activeTab={activeTab} onSelect={setActiveTab} accent={accent} colors={colors} />

        {/* ── Tab content ── */}
        {activeTab === "overview" && (
          <OverviewTab
            site={site}
            width={width}
            accent={accent}
            isWorking={isWorking}
            checkpoints={checkpoints}
            regeneratingPath={regeneratingPath}
            republishPending={republish.isPending}
            setDomainPending={setDomain.isPending}
            removeDomainPending={removeDomain.isPending}
            verifyDomainPending={verifyDomain.isPending}
            onShare={onShare}
            onCopy={onCopy}
            onRetry={onRetry}
            onRepublish={onRepublish}
            onRegeneratePage={confirmRegenerate}
            onSetDomain={async (domain) => {
              await setDomain.mutateAsync({ id: site.id, data: { domain } });
              await siteQuery.refetch();
            }}
            onVerifyDomain={async () => {
              await verifyDomain.mutateAsync({ id: site.id });
              await siteQuery.refetch();
            }}
            onRemoveDomain={async () => {
              await removeDomain.mutateAsync({ id: site.id });
              await siteQuery.refetch();
            }}
          />
        )}

        {activeTab === "chat" && (
          <ChatTab
            site={site}
            messages={messages}
            chatDraft={chatDraft}
            setChatDraft={setChatDraft}
            onSend={onSendChatMessage}
            isSending={editSite.isPending}
            isWorking={isWorking}
            narrations={stream.narrations}
            currentFile={stream.currentFile}
            colors={colors}
            accent={accent}
          />
        )}

        {activeTab === "preview" && (
          <PreviewTab site={site} accent={accent} colors={colors} />
        )}
      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

function TabBar({
  activeTab,
  onSelect,
  accent,
  colors,
}: {
  activeTab: Tab;
  onSelect: (t: Tab) => void;
  accent: string;
  colors: ReturnType<typeof useColors>;
}) {
  const tabs: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
    { key: "overview", label: "Overview", icon: "info" },
    { key: "chat", label: "Chat", icon: "message-circle" },
    { key: "preview", label: "Preview", icon: "monitor" },
  ];
  return (
    <View
      style={{
        flexDirection: "row",
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.surface,
        paddingHorizontal: 8,
        paddingTop: 6,
      }}
    >
      {tabs.map((t) => {
        const active = t.key === activeTab;
        return (
          <Pressable
            key={t.key}
            onPress={() => onSelect(t.key)}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 9,
              marginBottom: -1,
              borderBottomWidth: 2.5,
              borderBottomColor: active ? accent : "transparent",
              backgroundColor: active ? `${accent}12` : "transparent",
              borderRadius: active ? 8 : 0,
              borderBottomLeftRadius: active ? 0 : 0,
              borderBottomRightRadius: active ? 0 : 0,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Feather
              name={t.icon}
              size={15}
              color={active ? accent : colors.mutedForeground}
            />
            <Text
              style={{
                color: active ? accent : colors.mutedForeground,
                fontSize: 13,
                fontFamily: active ? "Inter_700Bold" : "Inter_400Regular",
                letterSpacing: 0.1,
              }}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({
  site,
  width,
  accent,
  isWorking,
  checkpoints,
  regeneratingPath,
  republishPending,
  setDomainPending,
  removeDomainPending,
  verifyDomainPending,
  onShare,
  onCopy,
  onRetry,
  onRepublish,
  onRegeneratePage,
  onSetDomain,
  onVerifyDomain,
  onRemoveDomain,
}: {
  site: Site;
  width: number;
  accent: string;
  isWorking: boolean;
  checkpoints: SiteCheckpointDto[];
  regeneratingPath: string | null;
  republishPending: boolean;
  setDomainPending: boolean;
  removeDomainPending: boolean;
  verifyDomainPending: boolean;
  onShare: () => void;
  onCopy: () => void;
  onRetry: () => void;
  onRepublish: () => Promise<void>;
  onRegeneratePage: (page: SitePlanPage) => void;
  onSetDomain: (domain: string) => Promise<void>;
  onVerifyDomain: () => Promise<void>;
  onRemoveDomain: () => Promise<void>;
}) {
  const colors = useColors();
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
      <PreviewCard
        site={site}
        width={width - 40}
        onShare={onShare}
        onCopy={onCopy}
        onRetry={onRetry}
      />

      <Surface padded style={{ marginTop: 16, gap: 8 }}>
        <MonoText
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: "uppercase",
          }}
        >
          Prompt
        </MonoText>
        <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 21 }}>
          {site.prompt}
        </Text>
        {(site as unknown as { model?: string }).model ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
            <Feather name="cpu" size={11} color={colors.mutedForeground} />
            <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
              {(site as unknown as { model?: string }).model}
            </MonoText>
          </View>
        ) : null}
      </Surface>

      <PuterHostingSection
        site={site}
        isBusy={republishPending}
        onRepublish={onRepublish}
      />

      <DomainSection
        site={site}
        onSet={onSetDomain}
        onVerify={onVerifyDomain}
        onRemove={onRemoveDomain}
        isBusy={setDomainPending || removeDomainPending || verifyDomainPending}
      />

      {isWorking ? (
        <Surface padded style={{ marginTop: 16, gap: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
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
            <MonoText style={{ color: accent, fontSize: 12 }}>{site.progress}%</MonoText>
          </View>
          <View
            style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" }}
          >
            <View
              style={{ width: `${Math.max(2, site.progress)}%`, backgroundColor: accent, height: "100%" }}
            />
          </View>
          <MonoText style={{ color: colors.foreground, fontSize: 13 }}>
            {">_ "} {site.message ?? "starting…"}
          </MonoText>
        </Surface>
      ) : null}

      {site.plan && site.plan.pages.length > 0 ? (
        <PagesSection
          pages={site.plan.pages}
          accent={accent}
          regeneratingPath={regeneratingPath}
          onRegenerate={onRegeneratePage}
          disabled={isWorking}
        />
      ) : null}

      {checkpoints.length > 0 ? (
        <CheckpointsSection checkpoints={checkpoints} accent={accent} />
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Checkpoints section
// ---------------------------------------------------------------------------

function CheckpointsSection({
  checkpoints,
  accent,
}: {
  checkpoints: SiteCheckpointDto[];
  accent: string;
}) {
  const colors = useColors();
  const sorted = [...checkpoints].reverse();
  return (
    <Surface padded style={{ marginTop: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Feather name="clock" size={14} color={colors.mutedForeground} />
        <MonoText
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: "uppercase",
          }}
        >
          Checkpoints
        </MonoText>
      </View>
      <View style={{ gap: 8 }}>
        {sorted.map((cp, i) => (
          <View
            key={cp.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: i === 0 ? `${accent}55` : colors.border,
              backgroundColor: i === 0 ? `${accent}0A` : colors.cardElevated,
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === 0 ? accent : colors.mutedForeground,
              }}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: i === 0 ? accent : colors.foreground,
                  fontSize: 13,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                {cp.label}
              </Text>
              <MonoText style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 1 }}>
                {new Date(cp.createdAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {cp.hasFiles ? " · snapshot saved" : ""}
              </MonoText>
            </View>
            <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
              {cp.progress}%
            </MonoText>
          </View>
        ))}
      </View>
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Chat tab
// ---------------------------------------------------------------------------

function ChatTab({
  site,
  messages,
  chatDraft,
  setChatDraft,
  onSend,
  isSending,
  isWorking,
  narrations,
  currentFile,
  colors,
  accent,
}: {
  site: Site;
  messages: AgentMessage[];
  chatDraft: string;
  setChatDraft: (s: string) => void;
  onSend: () => void;
  isSending: boolean;
  isWorking: boolean;
  narrations: { id: string; text: string; done: boolean }[];
  currentFile: string | null;
  colors: ReturnType<typeof useColors>;
  accent: string;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const lastCount = useRef(0);

  useEffect(() => {
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      return () => clearTimeout(t);
    }
  }, [messages.length]);

  const canSend = chatDraft.trim().length >= 2 && !isSending && !isWorking;

  const [isUploading, setIsUploading] = useState(false);

  const pickAndUploadImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo library access to upload images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.75,
      base64: true,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) return;
    setIsUploading(true);
    try {
      const resp = await fetch(`/api/sites/${site.id}/upload-asset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          base64: asset.base64,
          mimeType: asset.mimeType ?? "image/jpeg",
          filename: asset.fileName ?? `upload-${Date.now()}.jpg`,
        }),
      });
      if (!resp.ok) throw new Error("Upload failed");
      const { path } = await resp.json() as { path: string };
      setChatDraft((prev) => (prev ? `${prev} [use uploaded image: ${path}]` : `Use my uploaded image: ${path}`));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Could not upload image");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8, gap: 10 }}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && isWorking ? (
          <AgentChatBubble colors={colors}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              Building your site…
            </Text>
          </AgentChatBubble>
        ) : null}

        {messages.length === 0 && !isWorking ? (
          <View style={{ alignItems: "center", paddingTop: 40, gap: 8 }}>
            <Feather name="message-circle" size={32} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontSize: 14, textAlign: "center" }}>
              No messages yet.{"\n"}Type below to edit or refine your site.
            </Text>
          </View>
        ) : null}

        {messages.map((m) => (
          <ChatMessageBubble key={m.id} message={m} colors={colors} accent={accent} />
        ))}

        {narrations.map((n) => (
          <AgentChatBubble key={n.id} colors={colors}>
            <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>
              {n.text}
              {!n.done ? (
                <Text style={{ color: accent, fontWeight: "700" }}>▍</Text>
              ) : null}
            </Text>
          </AgentChatBubble>
        ))}

        {isWorking && narrations.length === 0 ? (
          <AgentChatBubble colors={colors}>
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ThinkingDots accent={accent} />
                <MonoText style={{ color: colors.mutedForeground, fontSize: 11, flex: 1 }}>
                  {currentFile ? `writing ${currentFile}` : (site.message ?? "thinking…")}
                </MonoText>
              </View>
              <ThinkingBar accent={accent} />
            </View>
          </AgentChatBubble>
        ) : null}
      </ScrollView>

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
        {site.status === "ready" ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 8,
              backgroundColor: colors.cardElevated,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 14,
              paddingVertical: 6,
            }}
          >
            <TextInput
              value={chatDraft}
              onChangeText={setChatDraft}
              placeholder="Ask the agent to change something…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={{
                flex: 1,
                color: colors.foreground,
                fontFamily: "Inter_500Medium",
                fontSize: 15,
                maxHeight: 120,
                paddingTop: 9,
                paddingBottom: 9,
                ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null),
              }}
            />
            <Pressable
              onPress={pickAndUploadImage}
              disabled={isUploading}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed || isUploading ? 0.5 : 0.75,
                marginBottom: 4,
              })}
            >
              {isUploading ? (
                <ActivityIndicator size="small" color={accent} />
              ) : (
                <Feather name="image" size={17} color={colors.mutedForeground} />
              )}
            </Pressable>
            <Pressable
              onPress={onSend}
              disabled={!canSend}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: canSend ? accent : colors.muted,
                opacity: pressed ? 0.8 : 1,
                marginBottom: 4,
              })}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather
                  name="arrow-up"
                  size={16}
                  color={canSend ? "#000" : colors.mutedForeground}
                />
              )}
            </Pressable>
          </View>
        ) : (
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <MonoText style={{ color: colors.mutedForeground, fontSize: 11, textAlign: "center" }}>
              {isWorking
                ? `${site.status} · ${site.progress}% — chat available after build`
                : "Build failed — retry to enable chat"}
            </MonoText>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function AgentChatBubble({
  children,
  colors,
}: {
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end", maxWidth: "92%" }}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: `${colors.primary}1A`,
          borderWidth: 1,
          borderColor: `${colors.primary}55`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name="zap" size={11} color={colors.primary} />
      </View>
      <View
        style={{
          flex: 1,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderRadius: 16,
          borderBottomLeftRadius: 4,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function ChatMessageBubble({
  message,
  colors,
  accent,
}: {
  message: AgentMessage;
  colors: ReturnType<typeof useColors>;
  accent: string;
}) {
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

  if (message.role === "system") {
    return (
      <MonoText style={{ color: colors.mutedForeground, fontSize: 10, textAlign: "center", paddingVertical: 4 }}>
        {message.content}
      </MonoText>
    );
  }

  const isLog = message.kind === "log" || message.kind === "build_progress";
  const isDone = message.kind === "build_done";
  const isFailed = message.kind === "build_failed";
  const isStarted = message.kind === "build_started";

  if (isLog) {
    return (
      <View style={{ paddingLeft: 6 }}>
        <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
          <Text style={{ color: colors.primary }}>›_ </Text>
          {message.content}
        </MonoText>
      </View>
    );
  }

  if (isDone || isFailed || isStarted) {
    const iconColor = isDone ? colors.success : isFailed ? colors.destructive : accent;
    const iconName = isDone ? "check-circle" : isFailed ? "alert-circle" : "play-circle";
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, paddingHorizontal: 6 }}>
        <Feather name={iconName} size={14} color={iconColor} />
        <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 }}>
          {message.content}
        </Text>
      </View>
    );
  }

  return (
    <AgentChatBubble colors={colors}>
      <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 20 }}>
        {message.content}
      </Text>
    </AgentChatBubble>
  );
}

// ---------------------------------------------------------------------------
// Thinking animation components
// ---------------------------------------------------------------------------

function ThinkingDots({ accent }: { accent: string }) {
  const d0 = useRef(new Animated.Value(0.3)).current;
  const d1 = useRef(new Animated.Value(0.3)).current;
  const d2 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 280, useNativeDriver: false }),
          Animated.timing(dot, { toValue: 0.3, duration: 280, useNativeDriver: false }),
          Animated.delay(Math.max(0, 560 - delay)),
        ]),
      );
    const a0 = pulse(d0, 0);
    const a1 = pulse(d1, 180);
    const a2 = pulse(d2, 360);
    a0.start(); a1.start(); a2.start();
    return () => { a0.stop(); a1.stop(); a2.stop(); };
  }, [d0, d1, d2]);

  return (
    <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
      {([d0, d1, d2] as Animated.Value[]).map((dot, i) => (
        <Animated.View
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: accent,
            opacity: dot,
          }}
        />
      ))}
    </View>
  );
}

function ThinkingBar({ accent }: { accent: string }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1600,
        useNativeDriver: false,
        easing: Easing.inOut(Easing.quad),
      }),
    ).start();
    return () => shimmer.stopAnimation();
  }, [shimmer]);

  return (
    <View
      style={{
        height: 2,
        borderRadius: 1,
        backgroundColor: `${accent}22`,
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: "45%",
          borderRadius: 1,
          backgroundColor: accent,
          opacity: 0.85,
          transform: [
            {
              translateX: shimmer.interpolate({
                inputRange: [0, 1],
                outputRange: [-80, 220],
              }),
            },
          ],
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Preview tab
// ---------------------------------------------------------------------------

function PreviewTab({
  site,
  accent,
  colors,
}: {
  site: Site;
  accent: string;
  colors: ReturnType<typeof useColors>;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const previewUrl = site.previewUrl ?? null;
  const hasIndex = useMemo(
    () => (site.files ?? []).includes("index.html"),
    [site.files],
  );
  const iframeSrc = previewUrl && hasIndex ? `${previewUrl}?_=${refreshKey}` : null;

  const onOpenBrowser = async () => {
    const url = site.publicUrl ?? site.previewUrl;
    if (!url) return;
    if (Platform.OS === "web") {
      await Linking.openURL(url);
    } else {
      await WebBrowser.openBrowserAsync(url);
    }
  };

  if (!previewUrl && site.status !== "ready") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 }}>
        <Feather name="monitor" size={36} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 14, textAlign: "center" }}>
          Preview will appear once your site finishes building.
        </Text>
        <MonoText style={{ color: accent, fontSize: 11, letterSpacing: 1.2 }}>
          {site.status.toUpperCase()} · {site.progress}%
        </MonoText>
      </View>
    );
  }

  if (Platform.OS === "web" && iframeSrc) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            backgroundColor: colors.surface,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View style={{ flexDirection: "row", gap: 5 }}>
            {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
              <View key={c} style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: c }} />
            ))}
          </View>
          <View
            style={{
              flex: 1,
              backgroundColor: colors.cardElevated,
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 3,
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Feather name="lock" size={9} color={colors.mutedForeground} />
            <MonoText numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10, flex: 1 }}>
              {site.publicUrl ?? iframeSrc}
            </MonoText>
          </View>
          <Pressable
            onPress={() => setRefreshKey((k) => k + 1)}
            hitSlop={8}
            style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
          >
            <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={onOpenBrowser}
            hitSlop={8}
            style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
          >
            <Feather name="external-link" size={14} color={colors.mutedForeground} />
          </Pressable>
        </View>
        {React.createElement("iframe", {
          key: refreshKey,
          src: iframeSrc,
          title: "Site preview",
          style: {
            flex: 1,
            width: "100%",
            height: "100%",
            border: "0",
            background: "#0a0a0a",
            display: "block",
          },
          sandbox: "allow-scripts allow-same-origin allow-forms",
        })}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <View
        style={{
          borderRadius: 16,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <LinearGradient
          colors={[`${accent}33`, "#000"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ padding: 24, gap: 12, alignItems: "center" }}
        >
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: `${accent}77`,
              backgroundColor: `${accent}11`,
            }}
          >
            <MonoText style={{ color: accent, fontSize: 10, letterSpacing: 1.4 }}>
              ● {site.status === "ready" ? "LIVE" : site.status.toUpperCase()}
            </MonoText>
          </View>
          <Text
            style={{
              color: "#fff",
              fontFamily: "Inter_700Bold",
              fontSize: 24,
              letterSpacing: -0.5,
              textAlign: "center",
            }}
          >
            {site.name}
          </Text>
          {site.publicUrl ? (
            <MonoText
              numberOfLines={1}
              style={{ color: "#ffffff99", fontSize: 12, textAlign: "center" }}
            >
              {site.publicUrl}
            </MonoText>
          ) : null}
        </LinearGradient>
      </View>

      <NeonButton
        title="Open in Browser"
        onPress={onOpenBrowser}
        icon={<Feather name="external-link" size={16} color="#000" />}
      />

      {site.previewUrl ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", lineHeight: 18 }}>
          Tap to open your live site in the browser.{"\n"}Full in-app preview is available on web.
        </Text>
      ) : (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}>
          Your site will be available here once the build completes.
        </Text>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Preview card (overview tab)
// ---------------------------------------------------------------------------

function PreviewCard({
  site,
  width,
  onShare,
  onCopy,
  onRetry,
}: {
  site: Site;
  width: number;
  onShare: () => void;
  onCopy: () => void;
  onRetry: () => void;
}) {
  const colors = useColors();
  const accent = site.coverColor || colors.primary;
  const aspect = 0.62;
  const height = width * aspect;

  return (
    <View
      style={{
        width,
        height,
        borderRadius: 20,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        marginTop: 16,
      }}
    >
      <View style={StyleSheet.absoluteFill}>
        <FakeBrowser site={site} accent={accent} />
      </View>

      {site.status !== "ready" ? (
        <BlurOverlay site={site} accent={accent} onRetry={onRetry} />
      ) : (
        <View
          style={{
            position: "absolute",
            bottom: 12,
            right: 12,
            flexDirection: "row",
            gap: 8,
          }}
        >
          <SmallActionButton icon="copy" onPress={onCopy} />
          <SmallActionButton icon="share-2" onPress={onShare} />
        </View>
      )}
    </View>
  );
}

function SmallActionButton({
  icon,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.cardElevated,
        borderColor: colors.border,
        borderWidth: 1,
        padding: 10,
        borderRadius: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Feather name={icon} size={16} color={colors.foreground} />
    </Pressable>
  );
}

function FakeBrowser({ site, accent }: { site: Site; accent: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={[`${accent}33`, "#000"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: "#0008",
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
        }}
      >
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <View key={c} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c }} />
        ))}
        <View
          style={{
            flex: 1,
            backgroundColor: "#0006",
            marginLeft: 10,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
          }}
        >
          <MonoText numberOfLines={1} style={{ color: "#fff8", fontSize: 10 }}>
            {site.publicUrl ?? `webforge.app/${site.slug}`}
          </MonoText>
        </View>
      </View>
      <View
        style={{
          flex: 1,
          padding: 14,
          justifyContent: "center",
          alignItems: "center",
          gap: 10,
        }}
      >
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: `${accent}77`,
          }}
        >
          <MonoText style={{ color: accent, fontSize: 9, letterSpacing: 1.4 }}>● LIVE</MonoText>
        </View>
        <Text
          numberOfLines={2}
          style={{
            color: "#fff",
            fontFamily: "Inter_700Bold",
            fontSize: 22,
            letterSpacing: -0.5,
            textAlign: "center",
          }}
        >
          {site.name}
        </Text>
        <View
          style={{
            backgroundColor: accent,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: "#000", fontFamily: "Inter_700Bold", fontSize: 12 }}>
            Get started →
          </Text>
        </View>
      </View>
    </View>
  );
}

function BlurOverlay({
  site,
  accent,
  onRetry,
}: {
  site: Site;
  accent: string;
  onRetry: () => void;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "#0007" }]}>
      <View style={StyleSheet.absoluteFill}>
        <MatrixRain width={width - 40} height={300} intensity={0.4} />
      </View>
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "#000A", alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
        ]}
      >
        {site.status === "failed" ? (
          <>
            <Feather name="alert-triangle" size={32} color={colors.destructive} />
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 18,
                textAlign: "center",
              }}
            >
              Build failed
            </Text>
            {site.error ? (
              <MonoText style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}>
                {site.error}
              </MonoText>
            ) : null}
            <NeonButton
              title="Retry build"
              onPress={onRetry}
              icon={<Feather name="refresh-cw" size={16} color={colors.primaryForeground} />}
            />
          </>
        ) : (
          <>
            <Animated.View style={{ opacity }}>
              <MonoText style={{ color: accent, fontSize: 11, letterSpacing: 1.6, fontWeight: "700" }}>
                ● GENERATING
              </MonoText>
            </Animated.View>
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 22,
                letterSpacing: -0.5,
                textAlign: "center",
              }}
            >
              Forging your site
            </Text>
            <View
              style={{ width: "80%", height: 4, backgroundColor: "#fff1", borderRadius: 2, overflow: "hidden" }}
            >
              <View
                style={{ width: `${Math.max(3, site.progress)}%`, backgroundColor: accent, height: "100%" }}
              />
            </View>
            <MonoText style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {site.message ?? "warming up…"}
            </MonoText>
          </>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hosting + domain sections (unchanged from original)
// ---------------------------------------------------------------------------

function PuterHostingSection({
  site,
  onRepublish,
  isBusy,
}: {
  site: Site;
  onRepublish: () => Promise<void>;
  isBusy: boolean;
}) {
  const colors = useColors();
  const status = (site.puterStatus ?? null) as "hosted" | "uploading" | "failed" | null;
  const isHosted = status === "hosted" && Boolean(site.puterPublicUrl);
  const isUploading = status === "uploading" || isBusy;
  const isFailed = status === "failed";
  const isPending = !status && site.status === "ready";

  const stateAccent = isHosted
    ? colors.primary
    : isFailed
      ? "#FF6B6B"
      : isUploading
        ? "#FEBC2E"
        : colors.mutedForeground;
  const stateLabel = isHosted
    ? "LIVE ON PUTER"
    : isFailed
      ? "PUTER UPLOAD FAILED"
      : isUploading
        ? "REPUBLISHING…"
        : isPending
          ? "NOT YET ON PUTER"
          : "BUILDING…";

  if (site.status !== "ready" && !isFailed && !isHosted) return null;

  const canRepublish =
    !isUploading &&
    site.status === "ready" &&
    Boolean(site.files && Object.keys(site.files).length > 0);

  const onCopyUrl = async () => {
    if (!site.puterPublicUrl) return;
    await Clipboard.setStringAsync(site.puterPublicUrl);
    void Haptics.selectionAsync();
    Alert.alert("Copied", "Puter URL copied to clipboard.");
  };

  return (
    <Surface padded style={{ marginTop: 16, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <MonoText style={{ color: stateAccent, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
          {stateLabel}
        </MonoText>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stateAccent }} />
          <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>puter.site</MonoText>
        </View>
      </View>

      {isHosted && site.puterPublicUrl ? (
        <Pressable onPress={onCopyUrl}>
          <MonoText numberOfLines={1} style={{ color: colors.foreground, fontSize: 13 }}>
            {site.puterPublicUrl}
          </MonoText>
        </Pressable>
      ) : null}

      {isFailed && site.puterError ? (
        <Text style={{ color: "#FF9C9C", fontSize: 12, lineHeight: 18 }} numberOfLines={3}>
          {site.puterError}
        </Text>
      ) : null}

      {isPending ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 18 }}>
          This site has not been pushed to Puter yet. Tap Republish to put it live on a public URL.
        </Text>
      ) : null}

      {(isFailed || isPending || isHosted) ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <Pressable
            onPress={onRepublish}
            disabled={!canRepublish}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingVertical: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: isFailed ? "#FF6B6B66" : colors.border,
              backgroundColor: isFailed ? "#FF6B6B14" : colors.cardElevated,
              opacity: !canRepublish ? 0.55 : pressed ? 0.7 : 1,
            })}
          >
            {isUploading ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <Feather
                name={isFailed ? "rotate-ccw" : "upload-cloud"}
                size={15}
                color={isFailed ? "#FF9C9C" : colors.foreground}
              />
            )}
            <Text
              style={{
                color: isFailed ? "#FF9C9C" : colors.foreground,
                fontSize: 14,
                fontFamily: "Inter_600SemiBold",
              }}
            >
              {isUploading
                ? "Republishing…"
                : isFailed
                  ? "Retry Puter upload"
                  : isHosted
                    ? "Republish to Puter"
                    : "Publish to Puter"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Surface>
  );
}

function DomainSection({
  site,
  onSet,
  onVerify,
  onRemove,
  isBusy,
}: {
  site: Site;
  onSet: (domain: string) => Promise<void>;
  onVerify: () => Promise<void>;
  onRemove: () => Promise<void>;
  isBusy: boolean;
}) {
  const colors = useColors();
  const [input, setInput] = React.useState("");
  const status = site.customDomainStatus;

  const onAttach = async () => {
    const cleaned = input.trim().toLowerCase().replace(/^https?:\/\//, "");
    if (cleaned.length < 3) {
      Alert.alert("Invalid domain", "Enter something like mysite.com");
      return;
    }
    try {
      await onSet(cleaned);
      setInput("");
    } catch (e) {
      Alert.alert("Couldn't attach", e instanceof Error ? e.message : "Failed to attach domain");
    }
  };

  const onVerifyPress = async () => {
    try {
      await onVerify();
    } catch (e) {
      Alert.alert("Verification failed", e instanceof Error ? e.message : "Verification failed");
    }
  };

  const onCopyValue = async (value: string) => {
    await Clipboard.setStringAsync(value);
    void Haptics.selectionAsync();
  };

  const statusColor =
    status === "verified"
      ? colors.success
      : status === "failed"
        ? colors.destructive
        : colors.primary;

  return (
    <Surface padded style={{ marginTop: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Feather name="globe" size={14} color={colors.mutedForeground} />
        <MonoText style={{ color: colors.mutedForeground, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
          Custom domain
        </MonoText>
      </View>

      {site.customDomain ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 18,
                letterSpacing: -0.4,
              }}
            >
              {site.customDomain}
            </Text>
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: `${statusColor}77`,
              }}
            >
              <MonoText
                style={{ color: statusColor, fontSize: 10, letterSpacing: 1.4, fontWeight: "700" }}
              >
                ● {(status ?? "pending").toUpperCase()}
              </MonoText>
            </View>
          </View>

          {status !== "verified" ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>
                Add these DNS records at your registrar, then tap{" "}
                <Text style={{ color: colors.foreground, fontWeight: "700" }}>Verify</Text>.
              </Text>
              <DnsRow
                label="CNAME"
                name={site.customDomain}
                value={site.customDomainTarget ?? ""}
                onCopy={() => onCopyValue(site.customDomainTarget ?? "")}
              />
              <DnsRow
                label="TXT"
                name={site.customDomainTxtName ?? ""}
                value={site.customDomainTxtValue ?? ""}
                onCopy={() => onCopyValue(site.customDomainTxtValue ?? "")}
              />
              {site.customDomainError ? (
                <MonoText style={{ color: colors.destructive, fontSize: 12 }}>
                  {site.customDomainError}
                </MonoText>
              ) : null}
            </View>
          ) : (
            <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>
              Live at{" "}
              <Text style={{ color: colors.primary, fontWeight: "700" }}>
                https://{site.customDomain}
              </Text>
            </Text>
          )}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            {status !== "verified" ? (
              <NeonButton
                title={isBusy ? "Verifying…" : "Verify domain"}
                onPress={onVerifyPress}
                icon={<Feather name="check" size={16} color={colors.primaryForeground} />}
              />
            ) : null}
            <Pressable
              onPress={() => {
                Alert.alert("Remove domain?", `Detach ${site.customDomain}?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => { void onRemove(); } },
                ]);
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.cardElevated,
                opacity: pressed ? 0.7 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              })}
            >
              <Feather name="x" size={14} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 13, fontWeight: "600" }}>
                Remove
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19 }}>
            Host this site on your own domain. Point a CNAME at our edge and add a TXT record to
            prove ownership.
          </Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <View
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: colors.cardElevated,
              }}
            >
              <MonoTextInput value={input} onChangeText={setInput} placeholder="mysite.com" />
            </View>
            <NeonButton
              title={isBusy ? "Adding…" : "Attach"}
              onPress={onAttach}
              icon={<Feather name="link" size={16} color={colors.primaryForeground} />}
            />
          </View>
        </>
      )}
    </Surface>
  );
}

function DnsRow({
  label,
  name,
  value,
  onCopy,
}: {
  label: string;
  name: string;
  value: string;
  onCopy: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        padding: 10,
        backgroundColor: colors.cardElevated,
        gap: 4,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <MonoText style={{ color: colors.primary, fontSize: 10, letterSpacing: 1.6, fontWeight: "700" }}>
          {label}
        </MonoText>
        <Pressable onPress={onCopy} hitSlop={8}>
          <Feather name="copy" size={12} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <MonoText numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11 }}>
        Name: <Text style={{ color: colors.foreground }}>{name}</Text>
      </MonoText>
      <MonoText numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11 }}>
        Value: <Text style={{ color: colors.foreground }}>{value}</Text>
      </MonoText>
    </View>
  );
}

function MonoTextInput(props: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder?: string;
}) {
  const colors = useColors();
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={colors.mutedForeground}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      style={{
        color: colors.foreground,
        fontFamily: "JetBrainsMono_400Regular",
        fontSize: 14,
        padding: 0,
      }}
    />
  );
}

function PagesSection({
  pages,
  accent,
  regeneratingPath,
  onRegenerate,
  disabled,
}: {
  pages: SitePlanPage[];
  accent: string;
  regeneratingPath: string | null;
  onRegenerate: (page: SitePlanPage) => void;
  disabled: boolean;
}) {
  const colors = useColors();
  return (
    <Surface padded style={{ marginTop: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Feather name="file-text" size={14} color={colors.mutedForeground} />
        <MonoText style={{ color: colors.mutedForeground, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
          Pages
        </MonoText>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 18 }}>
        Tap a page to re-render it from the deterministic template. Useful when a single page came
        out broken — leaves the rest of the site untouched.
      </Text>
      <View style={{ gap: 8 }}>
        {pages.map((page) => {
          const busy = regeneratingPath === page.path;
          const isDisabled = disabled || (regeneratingPath !== null && !busy);
          return (
            <Pressable
              key={page.path}
              onPress={() => onRegenerate(page)}
              disabled={isDisabled}
              accessibilityRole="button"
              style={({ pressed, focused }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: focused ? accent : colors.border,
                backgroundColor: colors.cardElevated,
                opacity: pressed ? 0.7 : isDisabled && !busy ? 0.4 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.foreground,
                    fontSize: 14,
                    fontFamily: "Inter_700Bold",
                    letterSpacing: -0.2,
                  }}
                >
                  {page.title}
                </Text>
                <MonoText numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11 }}>
                  /{page.path}
                </MonoText>
              </View>
              {busy ? (
                <ActivityIndicator size="small" color={accent} />
              ) : (
                <Feather name="refresh-cw" size={16} color={accent} />
              )}
            </Pressable>
          );
        })}
      </View>
    </Surface>
  );
}
