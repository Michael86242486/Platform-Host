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
  useRestoreCheckpoint,
  useRetrySite,
  useSendSiteMessage,
  useSetSiteDomain,
  useVerifySiteDomain,
  type Site,
  type SitePlanPage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import Svg, { Circle } from "react-native-svg";

import { useAuth } from "@/lib/auth";
import { MatrixRain } from "@/components/MatrixRain";
import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { Surface } from "@/components/Surface";
import { useColors } from "@/hooks/useColors";
import { useSiteStream } from "@/lib/useSiteStream";

type Tab = "overview" | "chat" | "preview" | "console" | "intel";

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
      enabled: activeTab === "chat" || activeTab === "console",
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
  const restoreCheckpoint = useRestoreCheckpoint();
  const del = useDeleteSite();
  const editSite = useEditSite();
  const sendMessage = useSendSiteMessage();
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

  const getShareUrl = useCallback(() => {
    const shareToken = (site as unknown as { shareToken?: string | null })?.shareToken;
    const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
    if (shareToken) return `${apiBase}/api/public/sites/${shareToken}/preview`;
    return site?.publicUrl ?? null;
  }, [site]);

  const onShare = async () => {
    const shareUrl = getShareUrl();
    if (!shareUrl || !site) return;
    await Share.share({ message: `Check out ${site.name}\n${shareUrl}`, url: shareUrl });
  };

  const onCopy = async () => {
    const shareUrl = getShareUrl();
    if (!shareUrl) return;
    await Clipboard.setStringAsync(shareUrl);
    void Haptics.selectionAsync();
    Alert.alert("Copied", "Share link copied to clipboard.");
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

  const onRetry = useCallback(async (model?: string) => {
    if (!site) return;
    try {
      if (model) {
        await fetch(`/api/sites/${site.id}/retry`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model }),
        });
      } else {
        await retry.mutateAsync({ id: site.id });
      }
      void siteQuery.refetch();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Retry failed", e instanceof Error ? e.message : "Unknown error");
    }
  }, [site, retry, siteQuery]);

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
      await sendMessage.mutateAsync({ id: site.id, data: { content: trimmed } });
      setChatDraft("");
      void Haptics.selectionAsync();
      void qc.invalidateQueries({ queryKey: getListSiteMessagesQueryKey(site.id) });
    } catch (e) {
      Alert.alert("Send failed", e instanceof Error ? e.message : "Unknown error");
    }
  }, [chatDraft, site, sendMessage, qc]);

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
        <TabBar activeTab={activeTab} onSelect={setActiveTab} accent={accent} colors={colors} isWorking={isWorking} />

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
            onRestoreCheckpoint={async (checkpointId) => {
              try {
                await restoreCheckpoint.mutateAsync({ id: site.id, checkpointId });
                await siteQuery.refetch();
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert("Restored", "Site files restored from checkpoint.");
              } catch (e) {
                Alert.alert("Restore failed", e instanceof Error ? e.message : "Unknown error");
              }
            }}
            restoreCheckpointPending={restoreCheckpoint.isPending}
          />
        )}

        {activeTab === "chat" && (
          <ChatTab
            site={site}
            messages={messages}
            chatDraft={chatDraft}
            setChatDraft={setChatDraft}
            onSend={onSendChatMessage}
            isSending={sendMessage.isPending}
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

        {activeTab === "console" && (
          <ConsoleTab
            site={site}
            messages={messages}
            accent={accent}
            colors={colors}
            isWorking={isWorking}
            currentFile={stream.currentFile}
          />
        )}

        {activeTab === "intel" && (
          <IntelTab
            site={site}
            accent={accent}
            colors={colors}
            onFixWithAI={(prompt) => {
              setChatDraft(prompt);
              setActiveTab("chat");
            }}
          />
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
  isWorking,
}: {
  activeTab: Tab;
  onSelect: (t: Tab) => void;
  accent: string;
  colors: ReturnType<typeof useColors>;
  isWorking: boolean;
}) {
  const tabs: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap; badge?: boolean }[] = [
    { key: "overview", label: "Overview", icon: "info" },
    { key: "chat", label: "Chat", icon: "message-circle" },
    { key: "preview", label: "Preview", icon: "monitor" },
    { key: "console", label: "Console", icon: "terminal", badge: isWorking },
    { key: "intel", label: "Intel", icon: "activity" },
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
              gap: 5,
              paddingVertical: 9,
              marginBottom: -1,
              borderBottomWidth: 2.5,
              borderBottomColor: active ? accent : "transparent",
              backgroundColor: active ? `${accent}12` : "transparent",
              borderRadius: active ? 8 : 0,
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ position: "relative" }}>
              <Feather
                name={t.icon}
                size={15}
                color={active ? accent : colors.mutedForeground}
              />
              {t.badge && (
                <View
                  style={{
                    position: "absolute",
                    top: -3,
                    right: -3,
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: accent,
                  }}
                />
              )}
            </View>
            <Text
              style={{
                color: active ? accent : colors.mutedForeground,
                fontSize: 12,
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
  onRestoreCheckpoint,
  restoreCheckpointPending,
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
  restoreCheckpointPending: boolean;
  onShare: () => void;
  onCopy: () => void;
  onRetry: (model?: string) => void;
  onRepublish: () => Promise<void>;
  onRegeneratePage: (page: SitePlanPage) => void;
  onSetDomain: (domain: string) => Promise<void>;
  onVerifyDomain: () => Promise<void>;
  onRemoveDomain: () => Promise<void>;
  onRestoreCheckpoint: (checkpointId: string) => Promise<void>;
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

      {/* ── Export ZIP ── */}
      {site.status === "ready" && site.files && site.files.length > 0 ? (
        <Pressable
          onPress={() => {
            const url = `/api/sites/${site.id}/export`;
            void WebBrowser.openBrowserAsync(url);
          }}
          style={({ pressed }) => ({
            marginTop: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 13,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: accent + "55",
            backgroundColor: accent + "12",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Feather name="download" size={15} color={accent} />
          <Text
            style={{
              color: accent,
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
            }}
          >
            Export as ZIP
          </Text>
          <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
            {site.files.length} file{site.files.length !== 1 ? "s" : ""}
          </MonoText>
        </Pressable>
      ) : null}

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
        <CheckpointsSection
          checkpoints={checkpoints}
          accent={accent}
          onRestore={onRestoreCheckpoint}
          restorePending={restoreCheckpointPending}
        />
      ) : null}

      {checkpoints.length > 0 ? (
        <IntelTimelineSection site={site} accent={accent} colors={colors} />
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
  onRestore,
  restorePending,
}: {
  checkpoints: SiteCheckpointDto[];
  accent: string;
  onRestore: (checkpointId: string) => Promise<void>;
  restorePending: boolean;
}) {
  const colors = useColors();
  const sorted = [...checkpoints].reverse();
  const [restoringId, setRestoringId] = React.useState<string | null>(null);

  const handleRestore = async (cpId: string) => {
    setRestoringId(cpId);
    try {
      await onRestore(cpId);
    } finally {
      setRestoringId(null);
    }
  };

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
            {cp.hasFiles ? (
              <Pressable
                onPress={() => {
                  Alert.alert(
                    "Restore checkpoint",
                    `Restore site files to "${cp.label}"? Current files will be replaced.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Restore",
                        style: "destructive",
                        onPress: () => void handleRestore(cp.id),
                      },
                    ]
                  );
                }}
                disabled={restorePending}
                style={({ pressed }) => ({
                  opacity: pressed || restorePending ? 0.5 : 1,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: restoringId === cp.id ? accent : colors.border,
                  backgroundColor: restoringId === cp.id ? `${accent}1A` : "transparent",
                })}
              >
                {restoringId === cp.id ? (
                  <ActivityIndicator size="small" color={accent} />
                ) : (
                  <Feather name="rotate-ccw" size={13} color={i === 0 ? accent : colors.mutedForeground} />
                )}
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Intel quality timeline section (shown in Overview tab)
// ---------------------------------------------------------------------------

type TimelineEntry =
  | { id: string; label: string; createdAt: string; progress: number; hasFiles: false }
  | { id: string; label: string; createdAt: string; progress: number; hasFiles: true; grade: string; overall: number; scores: { seo: number; a11y: number; perf: number; mobile: number; code: number } };

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const CAT_KEYS: (keyof NonNullable<Extract<TimelineEntry, { hasFiles: true }>["scores"]>)[] = [
  "seo", "a11y", "perf", "mobile", "code",
];

function TimelineCard({
  entry,
  prev,
  idx,
  accent,
  colors,
}: {
  entry: TimelineEntry;
  prev: TimelineEntry | null;
  idx: number;
  accent: string;
  colors: ReturnType<typeof useColors>;
}) {
  const [displayed, setDisplayed] = useState(0);
  const started = useRef(false);
  const score = entry.hasFiles ? entry.overall : 0;
  const grade = entry.hasFiles ? entry.grade : "—";

  useEffect(() => {
    if (started.current || !entry.hasFiles) return;
    started.current = true;
    const delay = setTimeout(() => {
      const total = 45;
      let f = 0;
      const tick = setInterval(() => {
        f++;
        setDisplayed(Math.round(score * (1 - Math.pow(1 - f / total, 3))));
        if (f >= total) { clearInterval(tick); setDisplayed(score); }
      }, 1000 / 60);
    }, idx * 80);
    return () => clearTimeout(delay);
  }, [score, idx, entry.hasFiles]);

  const gc = entry.hasFiles ? gradeColor(entry.grade) : colors.mutedForeground;
  const r = 26; const sw = 5; const size = (r + sw) * 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - displayed / 100);
  const cx = size / 2; const cy = size / 2;

  const prevOverall = prev && prev.hasFiles ? prev.overall : null;
  const trend = prevOverall !== null && entry.hasFiles
    ? entry.overall > prevOverall ? "up" : entry.overall < prevOverall ? "down" : "flat"
    : null;

  return (
    <View
      style={{
        width: 120,
        backgroundColor: colors.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: entry.hasFiles ? `${gc}40` : colors.border,
        padding: 12,
        alignItems: "center",
        gap: 6,
      }}
    >
      {/* checkpoint number badge */}
      <View style={{ position: "absolute", top: 8, left: 8 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 9, fontWeight: "700" }}>#{idx + 1}</Text>
      </View>

      {/* trend arrow */}
      {trend && (
        <View style={{ position: "absolute", top: 7, right: 8 }}>
          <Feather
            name={trend === "up" ? "trending-up" : trend === "down" ? "trending-down" : "minus"}
            size={10}
            color={trend === "up" ? "#00FFC2" : trend === "down" ? "#FF6B6B" : colors.mutedForeground}
          />
        </View>
      )}

      {/* Score ring */}
      <View style={{ alignItems: "center", justifyContent: "center", marginTop: 6 }}>
        <Svg width={size} height={size}>
          <Circle cx={cx} cy={cy} r={r} stroke="#ffffff0D" strokeWidth={sw} fill="none" />
          {entry.hasFiles && (
            <Circle
              cx={cx} cy={cy} r={r}
              stroke={gc}
              strokeWidth={sw}
              fill="none"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform={`rotate(-90, ${cx}, ${cy})`}
            />
          )}
        </Svg>
        <View style={{ position: "absolute", alignItems: "center" }}>
          <Text style={{ color: gc, fontSize: entry.hasFiles ? 20 : 16, fontWeight: "800" }}>{grade}</Text>
        </View>
      </View>

      {/* Overall score */}
      {entry.hasFiles ? (
        <Text style={{ color: colors.foreground, fontSize: 11, fontWeight: "700" }}>{entry.overall}/100</Text>
      ) : (
        <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>no scan</Text>
      )}

      {/* Label */}
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 10, fontWeight: "600", textAlign: "center", lineHeight: 14 }}>
        {entry.label}
      </Text>

      {/* Time */}
      <Text style={{ color: colors.mutedForeground, fontSize: 9 }}>{relTime(entry.createdAt)}</Text>

      {/* Category dots */}
      {entry.hasFiles ? (
        <View style={{ flexDirection: "row", gap: 4, marginTop: 2 }}>
          {CAT_KEYS.map((k) => (
            <View
              key={k}
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: scoreColor(entry.scores[k]),
                opacity: 0.85,
              }}
            />
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 4, marginTop: 2 }}>
          {CAT_KEYS.map((k) => (
            <View key={k} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border }} />
          ))}
        </View>
      )}
    </View>
  );
}

function IntelTimelineSection({
  site,
  accent,
  colors,
}: {
  site: Site;
  accent: string;
  colors: ReturnType<typeof useColors>;
}) {
  const { getToken } = useAuth();
  const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const res = await fetch(`${apiBase}/api/sites/${site.id}/checkpoints/timeline`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) { setError(`HTTP ${res.status}`); return; }
        const data = await res.json() as { timeline: TimelineEntry[] };
        setTimeline(data.timeline);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [site.id]);

  if (loading) {
    return (
      <Surface padded style={{ marginTop: 16, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Feather name="activity" size={14} color={colors.mutedForeground} />
          <MonoText style={{ color: colors.mutedForeground, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
            Quality Timeline
          </MonoText>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ width: 120, height: 180, backgroundColor: colors.cardElevated, borderRadius: 16, borderWidth: 1, borderColor: colors.border, opacity: 0.5 - i * 0.12 }} />
          ))}
        </ScrollView>
      </Surface>
    );
  }

  if (error || !timeline || timeline.length === 0) return null;

  const withScores = timeline.filter((t) => t.hasFiles);
  if (withScores.length === 0) return null;

  const firstScore = (withScores[0] as Extract<TimelineEntry, { hasFiles: true }>).overall;
  const lastScore = (withScores[withScores.length - 1] as Extract<TimelineEntry, { hasFiles: true }>).overall;
  const delta = lastScore - firstScore;

  return (
    <Surface padded style={{ marginTop: 16, gap: 12 }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Feather name="activity" size={14} color={accent} />
        <MonoText style={{ color: colors.mutedForeground, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", flex: 1 }}>
          Quality Timeline
        </MonoText>
        {withScores.length > 1 && (
          <View style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 999,
            backgroundColor: delta >= 0 ? "#00FFC218" : "#FF6B6B18",
          }}>
            <Feather
              name={delta > 0 ? "trending-up" : delta < 0 ? "trending-down" : "minus"}
              size={11}
              color={delta > 0 ? "#00FFC2" : delta < 0 ? "#FF6B6B" : colors.mutedForeground}
            />
            <Text style={{ color: delta > 0 ? "#00FFC2" : delta < 0 ? "#FF6B6B" : colors.mutedForeground, fontSize: 11, fontWeight: "700" }}>
              {delta > 0 ? "+" : ""}{delta} pts
            </Text>
          </View>
        )}
      </View>

      {/* Category legend */}
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        {[
          { key: "seo", label: "SEO" },
          { key: "a11y", label: "A11y" },
          { key: "perf", label: "Spd" },
          { key: "mobile", label: "Mob" },
          { key: "code", label: "Code" },
        ].map((c) => (
          <View key={c.key} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: accent + "80" }} />
            <Text style={{ color: colors.mutedForeground, fontSize: 9 }}>{c.label}</Text>
          </View>
        ))}
      </View>

      {/* Cards */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingHorizontal: 2 }}
      >
        {timeline.map((entry, idx) => (
          <TimelineCard
            key={entry.id}
            entry={entry}
            prev={idx > 0 ? timeline[idx - 1] : null}
            idx={idx}
            accent={accent}
            colors={colors}
          />
        ))}
      </ScrollView>

      {/* Bottom summary */}
      {withScores.length > 1 && (
        <Text style={{ color: colors.mutedForeground, fontSize: 11, textAlign: "center" }}>
          {withScores.length} builds scanned · scores from {firstScore} → {lastScore}
        </Text>
      )}
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
  setChatDraft: React.Dispatch<React.SetStateAction<string>>;
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

  const chatInputAvailable =
    site.status === "ready" ||
    site.status === "awaiting_confirmation" ||
    site.status === "failed";
  const canSend = chatDraft.trim().length >= 2 && !isSending && chatInputAvailable;

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
        {chatInputAvailable ? (
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
              placeholder={
                site.status === "awaiting_confirmation"
                  ? "Reply to the agent…"
                  : "Ask the agent to change something…"
              }
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
// Console tab — real-time build log
// ---------------------------------------------------------------------------

const PIPELINE_PHASES = [
  { n: 1, label: "Research & Inspiration" },
  { n: 2, label: "Parallel Page Build" },
  { n: 3, label: "SEO & Accessibility Audit" },
  { n: 4, label: "Self-Review" },
  { n: 5, label: "Auto-Fix" },
  { n: 6, label: "Hero Image" },
  { n: 7, label: "Publish to Puter" },
] as const;

type QualityReport = {
  score: number;
  passed: boolean;
  issues: { severity: string; file: string; detail: string }[];
  totalBytes: number;
  summary?: string;
};

type DiffFile = { path: string; bytes?: number; before?: number; after?: number };
type DiffResult = {
  from: SiteCheckpointDto;
  to: SiteCheckpointDto;
  summary: { added: number; removed: number; modified: number; unchanged: number };
  added: DiffFile[];
  removed: DiffFile[];
  modified: DiffFile[];
} | null;

type FileDiffLine = {
  type: "add" | "remove" | "context";
  text: string;
  lineA: number | null;
  lineB: number | null;
};
type FileDiffHunk = { startA: number; startB: number; lines: FileDiffLine[] };
type FileDiffResponse = {
  file: string;
  from: { id: string; label: string };
  to: { id: string; label: string };
  hunks: FileDiffHunk[];
  stats: { added: number; removed: number };
  truncated: boolean;
} | null;

function ConsoleTab({
  site,
  messages,
  accent,
  colors,
  isWorking,
  currentFile,
}: {
  site: Site;
  messages: AgentMessage[];
  accent: string;
  colors: ReturnType<typeof useColors>;
  isWorking: boolean;
  currentFile: string | null;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const checkpoints = ((site as unknown as { checkpoints?: SiteCheckpointDto[] }).checkpoints ?? [])
    .filter((c) => c.hasFiles)
    .slice()
    .reverse();
  const [diffFromId, setDiffFromId] = useState<string | null>(null);
  const [diffToId, setDiffToId] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<FileDiffResponse>(null);
  const [fileDiffLoading, setFileDiffLoading] = useState(false);
  const [fileDiffError, setFileDiffError] = useState<string | null>(null);

  const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

  const runFileDiff = useCallback(async (path: string) => {
    if (!diffFromId || !diffToId) return;
    setSelectedDiffFile(path);
    setFileDiff(null);
    setFileDiffLoading(true);
    setFileDiffError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/sites/${site.id}/checkpoints/file-diff?a=${encodeURIComponent(diffFromId)}&b=${encodeURIComponent(diffToId)}&file=${encodeURIComponent(path)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const j = await res.json() as { message?: string };
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      setFileDiff(await res.json() as FileDiffResponse);
    } catch (e) {
      setFileDiffError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setFileDiffLoading(false);
    }
  }, [apiBase, site.id, diffFromId, diffToId]);

  const runDiff = useCallback(async (fromId: string, toId: string) => {
    setDiffLoading(true);
    setDiffError(null);
    setDiffResult(null);
    try {
      const res = await fetch(
        `${apiBase}/api/sites/${site.id}/checkpoints/diff?a=${encodeURIComponent(fromId)}&b=${encodeURIComponent(toId)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const j = await res.json() as { message?: string };
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      setDiffResult(await res.json() as DiffResult);
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : "Diff failed");
    } finally {
      setDiffLoading(false);
    }
  }, [apiBase, site.id]);

  const handleDiffFrom = (id: string) => {
    setDiffFromId(id);
    setDiffResult(null);
    if (diffToId && id !== diffToId) void runDiff(id, diffToId);
  };
  const handleDiffTo = (id: string) => {
    setDiffToId(id);
    setDiffResult(null);
    if (diffFromId && diffFromId !== id) void runDiff(diffFromId, id);
  };

  const logMessages = useMemo(
    () =>
      messages.filter(
        (m) =>
          m.kind === "build_started" ||
          m.kind === "build_progress" ||
          m.kind === "build_done" ||
          m.kind === "build_failed",
      ),
    [messages],
  );

  const completedPhases = useMemo(() => {
    const done = new Set<number>();
    for (const m of logMessages) {
      const match = m.content.match(/✓ Step (\d+)\/7/);
      if (match) done.add(parseInt(match[1], 10));
    }
    return done;
  }, [logMessages]);

  const activePhase = useMemo(() => {
    const match = (site.message ?? "").match(/Step (\d+)\/7/);
    return match ? parseInt(match[1], 10) : null;
  }, [site.message]);

  const latestQualityReport = useMemo<QualityReport | null>(() => {
    for (let i = logMessages.length - 1; i >= 0; i--) {
      const qr = (logMessages[i].data as Record<string, unknown> | null)?.qualityReport;
      if (qr) return qr as QualityReport;
    }
    return null;
  }, [logMessages]);

  const builtFiles = useMemo(() => {
    const seen = new Set<string>();
    const result: { file: string; bytes?: number }[] = [];
    for (const m of logMessages) {
      const d = m.data as Record<string, unknown> | null;
      const file = d?.file as string | undefined;
      if (file && !seen.has(file)) {
        seen.add(file);
        result.push({ file });
      }
    }
    if (site.files) {
      for (const f of site.files) {
        if (!seen.has(f)) {
          seen.add(f);
          result.push({ file: f });
        }
      }
    }
    return result;
  }, [logMessages, site.files]);

  const totalKb = latestQualityReport
    ? (latestQualityReport.totalBytes / 1024).toFixed(1)
    : null;

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(t);
  }, [logMessages.length]);

  const isEmpty = logMessages.length === 0 && !isWorking;

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 32,
        gap: 14,
      }}
    >
      {isEmpty ? (
        <View style={{ alignItems: "center", paddingTop: 60, gap: 12 }}>
          <Feather name="terminal" size={36} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 14, textAlign: "center" }}>
            No build log yet.{"\n"}Start a build to see the agent work in real time.
          </Text>
        </View>
      ) : (
        <>
          {/* ── Pipeline steps ── */}
          <Surface padded style={{ gap: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Feather name="cpu" size={13} color={colors.mutedForeground} />
                <MonoText style={{ color: colors.mutedForeground, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
                  7-Phase Pipeline
                </MonoText>
              </View>
              {isWorking && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} />
                  <MonoText style={{ color: accent, fontSize: 10 }}>LIVE</MonoText>
                </View>
              )}
            </View>
            {PIPELINE_PHASES.map((phase) => {
              const done = completedPhases.has(phase.n);
              const active = !done && activePhase === phase.n;
              const pending = !done && !active;
              const phaseColor = done ? colors.success : active ? accent : colors.mutedForeground;
              return (
                <View
                  key={phase.n}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingVertical: 7,
                    borderTopWidth: phase.n > 1 ? 1 : 0,
                    borderTopColor: colors.border + "44",
                  }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      borderWidth: done ? 0 : 1.5,
                      borderColor: phaseColor,
                      backgroundColor: done ? phaseColor + "22" : active ? accent + "18" : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {done ? (
                      <Feather name="check" size={12} color={colors.success} />
                    ) : active ? (
                      <ActivityIndicator size="small" color={accent} style={{ transform: [{ scale: 0.6 }] }} />
                    ) : (
                      <MonoText style={{ color: colors.mutedForeground, fontSize: 9 }}>{phase.n}</MonoText>
                    )}
                  </View>
                  <Text
                    style={{
                      flex: 1,
                      color: pending ? colors.mutedForeground : colors.foreground,
                      fontSize: 13,
                      fontFamily: done ? "Inter_600SemiBold" : active ? "Inter_500Medium" : "Inter_400Regular",
                    }}
                  >
                    {phase.label}
                  </Text>
                  {done && (
                    <MonoText style={{ color: colors.success, fontSize: 10 }}>✓</MonoText>
                  )}
                  {active && (
                    <MonoText style={{ color: accent, fontSize: 10 }}>running</MonoText>
                  )}
                </View>
              );
            })}
          </Surface>

          {/* ── Quality gate card ── */}
          {latestQualityReport && (
            <Surface padded style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Feather
                    name={latestQualityReport.passed ? "shield" : "alert-triangle"}
                    size={13}
                    color={latestQualityReport.passed ? colors.success : "#FEBC2E"}
                  />
                  <MonoText style={{ color: colors.mutedForeground, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
                    Quality Gate
                  </MonoText>
                </View>
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 999,
                    backgroundColor: latestQualityReport.passed ? colors.success + "22" : "#FEBC2E22",
                    borderWidth: 1,
                    borderColor: latestQualityReport.passed ? colors.success + "55" : "#FEBC2E55",
                  }}
                >
                  <MonoText
                    style={{
                      color: latestQualityReport.passed ? colors.success : "#FEBC2E",
                      fontSize: 10,
                      fontWeight: "700",
                    }}
                  >
                    {latestQualityReport.passed ? "PASSED" : "RETRYING"}
                  </MonoText>
                </View>
              </View>

              {/* Score bar */}
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>Score</MonoText>
                  <MonoText
                    style={{
                      color: latestQualityReport.score >= 80
                        ? colors.success
                        : latestQualityReport.score >= 60
                          ? "#FEBC2E"
                          : colors.destructive,
                      fontSize: 13,
                      fontWeight: "700",
                    }}
                  >
                    {latestQualityReport.score}/100
                  </MonoText>
                </View>
                <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: "hidden" }}>
                  <View
                    style={{
                      width: `${latestQualityReport.score}%`,
                      height: "100%",
                      borderRadius: 3,
                      backgroundColor: latestQualityReport.score >= 80
                        ? colors.success
                        : latestQualityReport.score >= 60
                          ? "#FEBC2E"
                          : colors.destructive,
                    }}
                  />
                </View>
              </View>

              {totalKb && (
                <View style={{ flexDirection: "row", gap: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Feather name="hard-drive" size={11} color={colors.mutedForeground} />
                    <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
                      {totalKb} KB total
                    </MonoText>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Feather name="file" size={11} color={colors.mutedForeground} />
                    <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
                      {builtFiles.length} file{builtFiles.length !== 1 ? "s" : ""}
                    </MonoText>
                  </View>
                </View>
              )}

              {/* Issues */}
              {latestQualityReport.issues.length > 0 && (
                <View style={{ gap: 4 }}>
                  {latestQualityReport.issues.slice(0, 6).map((issue, i) => (
                    <View
                      key={i}
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 6,
                        paddingHorizontal: 8,
                        paddingVertical: 5,
                        borderRadius: 6,
                        backgroundColor:
                          issue.severity === "critical"
                            ? colors.destructive + "14"
                            : issue.severity === "high"
                              ? "#FEBC2E14"
                              : colors.cardElevated,
                        borderLeftWidth: 2,
                        borderLeftColor:
                          issue.severity === "critical"
                            ? colors.destructive
                            : issue.severity === "high"
                              ? "#FEBC2E"
                              : colors.border,
                      }}
                    >
                      <MonoText
                        style={{
                          color:
                            issue.severity === "critical"
                              ? colors.destructive
                              : issue.severity === "high"
                                ? "#FEBC2E"
                                : colors.mutedForeground,
                          fontSize: 9,
                          textTransform: "uppercase",
                          letterSpacing: 0.8,
                          marginTop: 1,
                          width: 36,
                        }}
                      >
                        {issue.severity.slice(0, 4)}
                      </MonoText>
                      <View style={{ flex: 1, gap: 1 }}>
                        <MonoText style={{ color: colors.foreground, fontSize: 11 }} numberOfLines={1}>
                          {issue.file}
                        </MonoText>
                        <Text style={{ color: colors.mutedForeground, fontSize: 11, lineHeight: 16 }} numberOfLines={2}>
                          {issue.detail}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Surface>
          )}

          {/* ── Built files ── */}
          {builtFiles.length > 0 && (
            <Surface padded style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Feather name="folder" size={13} color={colors.mutedForeground} />
                  <MonoText style={{ color: colors.mutedForeground, fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
                    Output Files
                  </MonoText>
                </View>
                <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
                  {builtFiles.length} files
                </MonoText>
              </View>
              <View style={{ gap: 3 }}>
                {builtFiles.map((f, i) => (
                  <View
                    key={f.file + i}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingVertical: 4,
                    }}
                  >
                    <Feather
                      name={
                        f.file.endsWith(".css")
                          ? "code"
                          : f.file.endsWith(".js")
                            ? "zap"
                            : f.file.endsWith(".html")
                              ? "globe"
                              : "file"
                      }
                      size={11}
                      color={accent + "99"}
                    />
                    <MonoText
                      numberOfLines={1}
                      style={{ color: colors.foreground, fontSize: 12, flex: 1 }}
                    >
                      {f.file}
                    </MonoText>
                  </View>
                ))}
              </View>
            </Surface>
          )}

          {/* ── Raw log stream ── */}
          <Surface
            style={{
              borderRadius: 12,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
                backgroundColor: colors.cardElevated,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <View style={{ flexDirection: "row", gap: 5 }}>
                {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                  <View key={c} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
                ))}
              </View>
              <MonoText style={{ color: colors.mutedForeground, fontSize: 10, flex: 1, letterSpacing: 0.5 }}>
                agent build log
              </MonoText>
              {isWorking && (
                <ThinkingDots accent={accent} />
              )}
            </View>
            <View style={{ padding: 12, gap: 4, backgroundColor: "#080C10" }}>
              {logMessages.map((m, i) => {
                const isDone = m.kind === "build_done";
                const isFailed = m.kind === "build_failed";
                const isStarted = m.kind === "build_started";
                const lineColor = isDone
                  ? colors.success
                  : isFailed
                    ? colors.destructive
                    : isStarted
                      ? accent
                      : m.content.startsWith("✓")
                        ? colors.success
                        : m.content.startsWith("⚠")
                          ? "#FEBC2E"
                          : colors.mutedForeground;
                return (
                  <View key={m.id + i} style={{ flexDirection: "row", gap: 6 }}>
                    <MonoText style={{ color: accent + "55", fontSize: 10, lineHeight: 17 }}>
                      {String(i + 1).padStart(2, "0")}
                    </MonoText>
                    <MonoText
                      style={{
                        color: lineColor,
                        fontSize: 11,
                        lineHeight: 17,
                        flex: 1,
                      }}
                    >
                      {m.content}
                    </MonoText>
                  </View>
                );
              })}
              {isWorking && currentFile && (
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <MonoText style={{ color: accent + "55", fontSize: 10, lineHeight: 17 }}>
                    {String(logMessages.length + 1).padStart(2, "0")}
                  </MonoText>
                  <MonoText style={{ color: accent, fontSize: 11, lineHeight: 17, flex: 1 }}>
                    {"›_ "}writing {currentFile}
                    <Text style={{ color: accent }}>▍</Text>
                  </MonoText>
                </View>
              )}
              {isWorking && !currentFile && (
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <MonoText style={{ color: accent + "55", fontSize: 10 }}>
                    {String(logMessages.length + 1).padStart(2, "0")}
                  </MonoText>
                  <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
                    {"›_ "}{site.message ?? "working…"}
                    <Text style={{ color: accent }}>▍</Text>
                  </MonoText>
                </View>
              )}
            </View>
          </Surface>

          {/* ── Checkpoint Diff ── */}
          {checkpoints.length >= 2 && (
            <Surface
              style={{
                borderRadius: 12,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              {/* header */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: colors.cardElevated,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Feather name="git-commit" size={12} color={colors.mutedForeground} />
                <MonoText style={{ color: colors.mutedForeground, fontSize: 10, flex: 1, letterSpacing: 0.5 }}>
                  checkpoint diff
                </MonoText>
              </View>

              <View style={{ padding: 12, gap: 10, backgroundColor: "#080C10" }}>
                {/* pickers row */}
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  {/* FROM */}
                  <View style={{ flex: 1 }}>
                    <MonoText style={{ color: accent + "88", fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>FROM</MonoText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                      {checkpoints.map((cp) => (
                        <Pressable
                          key={cp.id}
                          onPress={() => handleDiffFrom(cp.id)}
                          style={({ pressed }) => ({
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 6,
                            borderWidth: 1,
                            borderColor: diffFromId === cp.id ? accent : colors.border,
                            backgroundColor: diffFromId === cp.id ? `${accent}1A` : colors.cardElevated,
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          <MonoText style={{ color: diffFromId === cp.id ? accent : colors.mutedForeground, fontSize: 9 }} numberOfLines={1}>
                            {cp.label.slice(0, 22)}
                          </MonoText>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                  <Feather name="arrow-right" size={14} color={colors.mutedForeground} />
                  {/* TO */}
                  <View style={{ flex: 1 }}>
                    <MonoText style={{ color: accent + "88", fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>TO</MonoText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 5 }}>
                      {checkpoints.map((cp) => (
                        <Pressable
                          key={cp.id}
                          onPress={() => handleDiffTo(cp.id)}
                          style={({ pressed }) => ({
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 6,
                            borderWidth: 1,
                            borderColor: diffToId === cp.id ? accent : colors.border,
                            backgroundColor: diffToId === cp.id ? `${accent}1A` : colors.cardElevated,
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          <MonoText style={{ color: diffToId === cp.id ? accent : colors.mutedForeground, fontSize: 9 }} numberOfLines={1}>
                            {cp.label.slice(0, 22)}
                          </MonoText>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                </View>

                {/* diff result */}
                {diffLoading && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator size="small" color={accent} />
                    <MonoText style={{ color: colors.mutedForeground, fontSize: 10 }}>computing diff…</MonoText>
                  </View>
                )}
                {diffError && (
                  <MonoText style={{ color: colors.destructive, fontSize: 11 }}>✗ {diffError}</MonoText>
                )}
                {diffResult && !diffLoading && (
                  <View style={{ gap: 6 }}>
                    {/* summary badges */}
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      {diffResult.summary.added > 0 && (
                        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: `${colors.success}22`, borderWidth: 1, borderColor: `${colors.success}55` }}>
                          <MonoText style={{ color: colors.success, fontSize: 10 }}>+{diffResult.summary.added} added</MonoText>
                        </View>
                      )}
                      {diffResult.summary.removed > 0 && (
                        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: `${colors.destructive}22`, borderWidth: 1, borderColor: `${colors.destructive}55` }}>
                          <MonoText style={{ color: colors.destructive, fontSize: 10 }}>−{diffResult.summary.removed} removed</MonoText>
                        </View>
                      )}
                      {diffResult.summary.modified > 0 && (
                        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: "#FEBC2E22", borderWidth: 1, borderColor: "#FEBC2E55" }}>
                          <MonoText style={{ color: "#FEBC2E", fontSize: 10 }}>~{diffResult.summary.modified} changed</MonoText>
                        </View>
                      )}
                      {diffResult.summary.unchanged > 0 && (
                        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, backgroundColor: `${colors.mutedForeground}11`, borderWidth: 1, borderColor: `${colors.mutedForeground}33` }}>
                          <MonoText style={{ color: colors.mutedForeground, fontSize: 10 }}>{diffResult.summary.unchanged} same</MonoText>
                        </View>
                      )}
                    </View>
                    {/* per-file list */}
                    <View style={{ gap: 2 }}>
                      {diffResult.added.map((f) => (
                        <View key={f.path} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                          <MonoText style={{ color: colors.success, fontSize: 10, width: 10 }}>+</MonoText>
                          <MonoText style={{ color: colors.success, fontSize: 10, flex: 1 }} numberOfLines={1}>{f.path}</MonoText>
                          {f.bytes != null && <MonoText style={{ color: colors.success + "88", fontSize: 9 }}>{(f.bytes / 1024).toFixed(1)}k</MonoText>}
                        </View>
                      ))}
                      {diffResult.removed.map((f) => (
                        <View key={f.path} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                          <MonoText style={{ color: colors.destructive, fontSize: 10, width: 10 }}>−</MonoText>
                          <MonoText style={{ color: colors.destructive, fontSize: 10, flex: 1 }} numberOfLines={1}>{f.path}</MonoText>
                        </View>
                      ))}
                      {diffResult.modified.map((f) => (
                        <Pressable
                          key={f.path}
                          onPress={() => void runFileDiff(f.path)}
                          style={({ pressed }) => ({
                            flexDirection: "row", gap: 6, alignItems: "center",
                            paddingVertical: 2, paddingHorizontal: 4, borderRadius: 4,
                            backgroundColor: pressed ? "#FEBC2E0D" : "transparent",
                          })}
                        >
                          <MonoText style={{ color: "#FEBC2E", fontSize: 10, width: 10 }}>~</MonoText>
                          <MonoText style={{ color: "#FEBC2E", fontSize: 10, flex: 1 }} numberOfLines={1}>{f.path}</MonoText>
                          {f.before != null && f.after != null && (
                            <MonoText style={{ color: "#FEBC2E88", fontSize: 9 }}>
                              {(f.before / 1024).toFixed(1)}k→{(f.after / 1024).toFixed(1)}k
                            </MonoText>
                          )}
                          <Feather name="chevron-right" size={10} color="#FEBC2E88" />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}
                {!diffFromId && !diffToId && (
                  <MonoText style={{ color: colors.mutedForeground, fontSize: 10 }}>
                    select two checkpoints above to compare
                  </MonoText>
                )}
              </View>
            </Surface>
          )}

          {/* ── File-level line diff viewer ── */}
          {selectedDiffFile && (
            <Surface
              style={{
                borderRadius: 12,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: "#FEBC2E55",
              }}
            >
              {/* header */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: "#FEBC2E0A",
                  borderBottomWidth: 1,
                  borderBottomColor: "#FEBC2E33",
                }}
              >
                <Pressable
                  onPress={() => { setSelectedDiffFile(null); setFileDiff(null); setFileDiffError(null); }}
                  hitSlop={8}
                  style={{ marginRight: 2 }}
                >
                  <Feather name="arrow-left" size={13} color="#FEBC2E" />
                </Pressable>
                <Feather name="file-text" size={11} color="#FEBC2E88" />
                <MonoText style={{ color: "#FEBC2E", fontSize: 10, flex: 1, letterSpacing: 0.3 }} numberOfLines={1}>
                  {selectedDiffFile}
                </MonoText>
                {fileDiff && (
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {fileDiff.stats.added > 0 && (
                      <MonoText style={{ color: colors.success, fontSize: 9 }}>+{fileDiff.stats.added}</MonoText>
                    )}
                    {fileDiff.stats.removed > 0 && (
                      <MonoText style={{ color: colors.destructive, fontSize: 9 }}>−{fileDiff.stats.removed}</MonoText>
                    )}
                  </View>
                )}
              </View>

              <View style={{ backgroundColor: "#040709" }}>
                {fileDiffLoading && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12 }}>
                    <ActivityIndicator size="small" color="#FEBC2E" />
                    <MonoText style={{ color: colors.mutedForeground, fontSize: 10 }}>computing diff…</MonoText>
                  </View>
                )}
                {fileDiffError && (
                  <MonoText style={{ color: colors.destructive, fontSize: 11, padding: 12 }}>✗ {fileDiffError}</MonoText>
                )}
                {fileDiff && !fileDiffLoading && (
                  <>
                    {fileDiff.truncated && (
                      <View style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "#FEBC2E0A", borderBottomWidth: 1, borderBottomColor: "#FEBC2E22" }}>
                        <MonoText style={{ color: "#FEBC2E99", fontSize: 9 }}>
                          ⚠ file truncated to 400 lines for performance
                        </MonoText>
                      </View>
                    )}
                    {fileDiff.hunks.length === 0 && (
                      <MonoText style={{ color: colors.mutedForeground, fontSize: 10, padding: 12 }}>
                        No differences found (files are identical).
                      </MonoText>
                    )}
                    {fileDiff.hunks.map((hunk, hi) => (
                      <View key={hi}>
                        {/* hunk header */}
                        <View style={{ paddingHorizontal: 10, paddingVertical: 3, backgroundColor: "#58A6FF0A", borderTopWidth: hi > 0 ? 1 : 0, borderTopColor: "#58A6FF22" }}>
                          <MonoText style={{ color: "#58A6FF88", fontSize: 9 }}>
                            {`@@ -${hunk.startA} +${hunk.startB} @@`}
                          </MonoText>
                        </View>
                        {/* diff lines */}
                        {hunk.lines.map((line, li) => {
                          const isAdd = line.type === "add";
                          const isRem = line.type === "remove";
                          const lineColor = isAdd ? colors.success : isRem ? colors.destructive : colors.mutedForeground;
                          const lineBg = isAdd ? `${colors.success}0D` : isRem ? `${colors.destructive}0D` : "transparent";
                          const prefix = isAdd ? "+" : isRem ? "−" : " ";
                          const lineNo = isAdd ? (line.lineB ?? "") : (line.lineA ?? "");
                          return (
                            <View
                              key={li}
                              style={{
                                flexDirection: "row",
                                backgroundColor: lineBg,
                                borderLeftWidth: isAdd || isRem ? 2 : 0,
                                borderLeftColor: lineColor,
                              }}
                            >
                              {/* line number */}
                              <MonoText
                                style={{
                                  color: lineColor + "55",
                                  fontSize: 9,
                                  width: 32,
                                  textAlign: "right",
                                  paddingRight: 6,
                                  paddingVertical: 1,
                                  paddingLeft: 4,
                                  userSelect: "none",
                                }}
                              >
                                {String(lineNo)}
                              </MonoText>
                              {/* +/- prefix */}
                              <MonoText style={{ color: lineColor, fontSize: 9, width: 12, paddingVertical: 1 }}>
                                {prefix}
                              </MonoText>
                              {/* line content */}
                              <MonoText
                                style={{ color: isAdd || isRem ? lineColor : lineColor + "BB", fontSize: 9, flex: 1, paddingVertical: 1, paddingRight: 8 }}
                                numberOfLines={1}
                              >
                                {line.text}
                              </MonoText>
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </>
                )}
              </View>
            </Surface>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Intel tab — animated quality gauges + issue list
// ---------------------------------------------------------------------------

type SiteIntelReport = {
  scores: { seo: number; a11y: number; perf: number; mobile: number; code: number };
  overall: number;
  grade: "A" | "B" | "C" | "D" | "F";
  issues: { category: string; severity: "critical" | "warning" | "info"; message: string; fix: string }[];
  stats: { totalKB: string; fileCount: number; htmlCount: number; cssCount: number; jsCount: number; imgCount: number };
};

function gradeColor(g: string): string {
  if (g === "A") return "#00FFC2";
  if (g === "B") return "#4ADE80";
  if (g === "C") return "#FEBC2E";
  if (g === "D") return "#FB923C";
  return "#FF6B6B";
}
function scoreColor(s: number): string {
  if (s >= 85) return "#00FFC2";
  if (s >= 70) return "#FEBC2E";
  return "#FF6B6B";
}

function ScoreRing({
  score,
  size = 90,
  strokeWidth = 8,
  delay = 0,
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  delay?: number;
}) {
  const [displayed, setDisplayed] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const timeout = setTimeout(() => {
      const total = 55;
      let frame = 0;
      const tick = setInterval(() => {
        frame++;
        const t = frame / total;
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplayed(Math.round(score * eased));
        if (frame >= total) { clearInterval(tick); setDisplayed(score); }
      }, 1000 / 60);
    }, delay);
    return () => clearTimeout(timeout);
  }, [score, delay]);

  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - displayed / 100);
  const cx = size / 2;
  const cy = size / 2;
  const color = scoreColor(displayed > 0 ? score : 0);

  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={r} stroke="#ffffff0D" strokeWidth={strokeWidth} fill="none" />
      <Circle
        cx={cx} cy={cy} r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90, ${cx}, ${cy})`}
      />
    </Svg>
  );
}

const INTEL_CATS: {
  key: keyof SiteIntelReport["scores"];
  label: string;
  icon: keyof typeof Feather.glyphMap;
  delay: number;
}[] = [
  { key: "seo",    label: "SEO",    icon: "search",      delay: 0   },
  { key: "a11y",   label: "A11y",   icon: "eye",         delay: 120 },
  { key: "perf",   label: "Speed",  icon: "zap",         delay: 240 },
  { key: "mobile", label: "Mobile", icon: "smartphone",  delay: 360 },
  { key: "code",   label: "Code",   icon: "code",        delay: 480 },
];

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SEV_META = {
  critical: { label: "Critical", color: "#FF6B6B", icon: "alert-circle" as const },
  warning:  { label: "Warning",  color: "#FEBC2E", icon: "alert-triangle" as const },
  info:     { label: "Info",     color: "#58A6FF", icon: "info" as const },
};

function IntelTab({
  site,
  accent,
  colors,
  onFixWithAI,
}: {
  site: Site;
  accent: string;
  colors: ReturnType<typeof useColors>;
  onFixWithAI: (prompt: string) => void;
}) {
  const { getToken } = useAuth();
  const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  const [report, setReport] = useState<SiteIntelReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const overallAnim = useRef(new Animated.Value(0)).current;

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${apiBase}/api/sites/${site.id}/analyze`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as SiteIntelReport;
      setReport(data);
      Animated.timing(overallAnim, {
        toValue: data.overall,
        duration: 1400,
        delay: 80,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [site.id, getToken, apiBase, overallAnim]);

  useEffect(() => { void runAnalysis(); }, []);

  const buildFixPrompt = useCallback(() => {
    if (!report) return "";
    const actionable = report.issues.filter((i) => i.severity !== "info");
    const lines = [
      "Please fix the following quality issues in my site:",
      "",
      ...actionable.map((i) => `• [${i.category.toUpperCase()}] ${i.message} — ${i.fix}`),
    ];
    return lines.join("\n");
  }, [report]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={accent} />
        <Text style={{ color: colors.mutedForeground, fontFamily: "monospace", fontSize: 13 }}>
          Scanning site files…
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16, backgroundColor: colors.background }}>
        <Feather name="alert-circle" size={36} color={colors.destructive} />
        <Text style={{ color: colors.destructive, textAlign: "center", fontSize: 14 }}>{error}</Text>
        <Pressable
          onPress={() => void runAnalysis()}
          style={{ borderWidth: 1, borderColor: accent, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 }}
        >
          <Text style={{ color: accent, fontSize: 14 }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!report) return null;

  const critCount = report.issues.filter((i) => i.severity === "critical").length;
  const warnCount = report.issues.filter((i) => i.severity === "warning").length;
  const gc = gradeColor(report.grade);
  const overallCirc = 2 * Math.PI * 54;
  const overallOffset = overallAnim.interpolate({ inputRange: [0, 100], outputRange: [overallCirc, 0] });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 48 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Hero: overall score ── */}
      <LinearGradient
        colors={[`${gc}18`, `${gc}06`, "transparent"]}
        style={{ alignItems: "center", paddingTop: 28, paddingBottom: 24, gap: 4 }}
      >
        <View style={{ position: "relative", alignItems: "center", justifyContent: "center" }}>
          <Svg width={132} height={132}>
            <Circle cx={66} cy={66} r={54} stroke="#ffffff0D" strokeWidth={10} fill="none" />
            <AnimatedCircle
              cx={66} cy={66} r={54}
              stroke={gc}
              strokeWidth={10}
              fill="none"
              strokeDasharray={overallCirc}
              strokeDashoffset={overallOffset}
              strokeLinecap="round"
              transform="rotate(-90, 66, 66)"
            />
          </Svg>
          <View style={{ position: "absolute", alignItems: "center" }}>
            <Text style={{ color: gc, fontSize: 38, fontWeight: "800", letterSpacing: -1 }}>{report.grade}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{report.overall}/100</Text>
          </View>
        </View>
        <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700", marginTop: 4 }}>
          Site Intelligence
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
          {report.stats.fileCount} files · {report.stats.totalKB} KB total
        </Text>

        {/* Stat pills */}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            { label: `${report.stats.htmlCount} HTML`, color: "#58A6FF" },
            { label: `${report.stats.cssCount} CSS`,   color: "#B48EFF" },
            { label: `${report.stats.jsCount} JS`,     color: "#FEBC2E" },
            { label: `${report.stats.imgCount} img`,   color: "#4ADE80" },
          ].map((p) => (
            <View key={p.label} style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: `${p.color}18` }}>
              <Text style={{ color: p.color, fontSize: 11, fontWeight: "600" }}>{p.label}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      {/* ── Category score grid ── */}
      <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
          Categories
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {INTEL_CATS.map((cat) => {
            const s = report.scores[cat.key];
            const c = scoreColor(s);
            const isExpanded = expandedCat === cat.key;
            const catIssues = report.issues.filter((i) => i.category === cat.key);
            return (
              <Pressable
                key={cat.key}
                onPress={() => setExpandedCat(isExpanded ? null : cat.key)}
                style={({ pressed }) => ({
                  flex: 1,
                  minWidth: "44%",
                  backgroundColor: colors.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: isExpanded ? `${c}60` : colors.border,
                  padding: 14,
                  alignItems: "center",
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <ScoreRing score={s} size={72} strokeWidth={7} delay={cat.delay} />
                <View style={{ position: "absolute", top: 17, alignItems: "center" }}>
                  <Feather name={cat.icon} size={14} color={c} />
                </View>
                <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700", marginTop: 6 }}>{s}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 1 }}>{cat.label}</Text>
                {catIssues.length > 0 && (
                  <View style={{ marginTop: 6, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: `${c}18` }}>
                    <Text style={{ color: c, fontSize: 10, fontWeight: "600" }}>
                      {catIssues.length} issue{catIssues.length > 1 ? "s" : ""}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ── Expanded category issues ── */}
      {expandedCat && (() => {
        const catIssues = report.issues.filter((i) => i.category === expandedCat);
        const catMeta = INTEL_CATS.find((c) => c.key === expandedCat)!;
        return (
          <View style={{ marginHorizontal: 16, marginTop: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Feather name={catMeta.icon} size={14} color={accent} />
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700", flex: 1 }}>{catMeta.label} Issues</Text>
              <Pressable onPress={() => setExpandedCat(null)}>
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {catIssues.length === 0 ? (
              <View style={{ padding: 16, alignItems: "center", gap: 6 }}>
                <Feather name="check-circle" size={20} color="#00FFC2" />
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No issues found</Text>
              </View>
            ) : (
              catIssues.map((issue, idx) => {
                const sev = SEV_META[issue.severity];
                return (
                  <View key={idx} style={{ borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: colors.border, padding: 14 }}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                      <Feather name={sev.icon} size={13} color={sev.color} style={{ marginTop: 1 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{issue.message}</Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4, lineHeight: 17 }}>{issue.fix}</Text>
                      </View>
                      <View style={{ borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: `${sev.color}18` }}>
                        <Text style={{ color: sev.color, fontSize: 10, fontWeight: "600" }}>{sev.label}</Text>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        );
      })()}

      {/* ── Full issues list ── */}
      <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
          All Issues
          {critCount > 0 && <Text style={{ color: "#FF6B6B" }}> · {critCount} critical</Text>}
          {warnCount > 0 && <Text style={{ color: "#FEBC2E" }}> · {warnCount} warning</Text>}
        </Text>

        {report.issues.length === 0 ? (
          <View style={{ alignItems: "center", padding: 24, gap: 8, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
            <Feather name="check-circle" size={28} color="#00FFC2" />
            <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>Perfect score!</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No issues detected in your site.</Text>
          </View>
        ) : (
          <Surface style={{ borderRadius: 14, overflow: "hidden" }}>
            {report.issues.map((issue, idx) => {
              const sev = SEV_META[issue.severity];
              const catMeta = INTEL_CATS.find((c) => c.key === issue.category);
              return (
                <View
                  key={idx}
                  style={{
                    borderTopWidth: idx === 0 ? 0 : 1,
                    borderTopColor: colors.border,
                    padding: 14,
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 10,
                  }}
                >
                  <View style={{ width: 28, height: 28, borderRadius: 999, backgroundColor: `${sev.color}18`, alignItems: "center", justifyContent: "center" }}>
                    <Feather name={sev.icon} size={13} color={sev.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      {catMeta && (
                        <View style={{ borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: `${scoreColor(report.scores[catMeta.key])}18` }}>
                          <Text style={{ color: scoreColor(report.scores[catMeta.key]), fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>
                            {catMeta.label}
                          </Text>
                        </View>
                      )}
                      <View style={{ borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: `${sev.color}14` }}>
                        <Text style={{ color: sev.color, fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>{sev.label}</Text>
                      </View>
                    </View>
                    <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{issue.message}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 3, lineHeight: 17 }}>{issue.fix}</Text>
                  </View>
                </View>
              );
            })}
          </Surface>
        )}
      </View>

      {/* ── Fix with AI ── */}
      {report.issues.filter((i) => i.severity !== "info").length > 0 && (
        <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
          <NeonButton
            title={`Fix ${report.issues.filter((i) => i.severity !== "info").length} Issues with AI`}
            icon={<Feather name="zap" size={16} color="#0A0E14" />}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onFixWithAI(buildFixPrompt());
            }}
            fullWidth
          />
          <Text style={{ color: colors.mutedForeground, fontSize: 11, textAlign: "center", marginTop: 8 }}>
            Switches to Chat and prefills a targeted fix prompt
          </Text>
        </View>
      )}

      {/* Re-scan */}
      <Pressable
        onPress={() => { overallAnim.setValue(0); void runAnalysis(); }}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          marginTop: 20,
          padding: 12,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="refresh-cw" size={13} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Re-scan site</Text>
      </Pressable>
    </ScrollView>
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
  onRetry: (model?: string) => void;
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

const RETRY_MODELS = [
  { value: "openai/gpt-5.3-codex",      label: "Codex 5.3",    hint: "Most capable · free" },
  { value: "openai/gpt-5.1-codex",      label: "Codex 5.1",    hint: "Balanced · free" },
  { value: "openai/gpt-5.1-codex-mini", label: "Codex Mini",   hint: "Fastest · free" },
  { value: "openai/gpt-4o-mini",        label: "GPT-4o Mini",  hint: "Fallback" },
  { value: "openai/gpt-4o",             label: "GPT-4o",       hint: "High quality" },
] as const;

function BlurOverlay({
  site,
  accent,
  onRetry,
}: {
  site: Site;
  accent: string;
  onRetry: (model?: string) => void;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const pulse = useRef(new Animated.Value(0)).current;

  const siteModel = (site as unknown as { model?: string | null }).model ?? "openai/gpt-5.3-codex";
  const isQuota   = site.error === "quota_exhausted";
  const isOffline = site.error === "agent_offline";

  const [pickedModel, setPickedModel] = useState<string>(() => {
    if (isQuota) {
      const idx = RETRY_MODELS.findIndex((m) => m.value === siteModel);
      return RETRY_MODELS[(idx + 1) % RETRY_MODELS.length].value;
    }
    return siteModel;
  });
  const [showPicker, setShowPicker] = useState(isQuota);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const pickedLabel = RETRY_MODELS.find((m) => m.value === pickedModel)?.label ?? pickedModel;

  const modelPicker = (
    <View style={{ width: "100%", maxWidth: 280, gap: 5 }}>
      {RETRY_MODELS.map((m) => {
        const active = pickedModel === m.value;
        return (
          <Pressable
            key={m.value}
            onPress={() => setPickedModel(m.value)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: active ? accent : "rgba(255,255,255,0.12)",
              backgroundColor: active ? `${accent}20` : "rgba(255,255,255,0.04)",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: active ? accent : colors.foreground, fontSize: 13, fontWeight: "600" }}>
                {m.label}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{m.hint}</Text>
            </View>
            {active && <Feather name="check" size={14} color={accent} />}
          </Pressable>
        );
      })}
      <NeonButton
        title={`Retry with ${pickedLabel}`}
        onPress={() => onRetry(pickedModel)}
        icon={<Feather name="cpu" size={16} color={colors.primaryForeground} />}
      />
    </View>
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "#0007" }]}>
      <View style={StyleSheet.absoluteFill}>
        <MatrixRain width={width - 40} height={300} intensity={0.4} />
      </View>
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "#000A", alignItems: "center", justifyContent: "center", padding: 20, gap: 12 },
        ]}
      >
        {site.status === "failed" ? (
          isQuota ? (
            <>
              <View style={{ alignItems: "center", gap: 4 }}>
                <Text style={{ fontSize: 34 }}>⚡</Text>
                <MonoText style={{ color: "#FEBC2E", fontSize: 10, letterSpacing: 2, fontWeight: "700" }}>
                  QUOTA EXHAUSTED
                </MonoText>
              </View>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20, textAlign: "center", letterSpacing: -0.4 }}>
                Model Ran Out of Credits
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "center", lineHeight: 20, maxWidth: 260 }}>
                This model has no usage left. Pick a different one below to continue.
              </Text>
              {modelPicker}
            </>
          ) : (
            <>
              {isOffline ? (
                <View style={{ alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 36 }}>🤖</Text>
                  <MonoText style={{ color: "#00FFC2", fontSize: 10, letterSpacing: 2, fontWeight: "700" }}>
                    STATUS: OFFLINE
                  </MonoText>
                </View>
              ) : (
                <Feather name="alert-triangle" size={32} color={colors.destructive} />
              )}
              <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: isOffline ? 20 : 18, textAlign: "center", letterSpacing: -0.4 }}>
                {isOffline ? "Agent Temporarily Offline" : "Build Failed"}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "center", lineHeight: 20, maxWidth: 260 }}>
                {isOffline
                  ? "The AI model is currently unreachable. Your project is saved and will auto-retry within 3 minutes."
                  : (site.error ?? "An unknown error occurred.")}
              </Text>
              {isOffline && (
                <View style={{ borderWidth: 1, borderColor: "rgba(0,255,194,0.2)", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "rgba(0,255,194,0.05)", maxWidth: 280, width: "100%" }}>
                  <MonoText style={{ color: colors.mutedForeground, fontSize: 11, textAlign: "center", lineHeight: 17 }}>
                    {"// auto-retry queued · no action needed"}
                  </MonoText>
                </View>
              )}
              <NeonButton
                title={isOffline ? "Retry now" : "Retry build"}
                onPress={() => onRetry()}
                icon={<Feather name="refresh-cw" size={16} color={colors.primaryForeground} />}
              />
              <Pressable
                onPress={() => setShowPicker((v) => !v)}
                style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 2 }}
              >
                <Feather name="cpu" size={13} color={accent} />
                <Text style={{ color: accent, fontSize: 12, fontWeight: "600" }}>
                  {showPicker ? "Hide model picker" : "Try a different model"}
                </Text>
                <Feather name={showPicker ? "chevron-up" : "chevron-down"} size={12} color={accent} />
              </Pressable>
              {showPicker && modelPicker}
            </>
          )
        ) : (
          <>
            <Animated.View style={{ opacity }}>
              <MonoText style={{ color: accent, fontSize: 11, letterSpacing: 1.6, fontWeight: "700" }}>
                ● GENERATING
              </MonoText>
            </Animated.View>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: -0.5, textAlign: "center" }}>
              Forging your site
            </Text>
            <View style={{ width: "80%", height: 4, backgroundColor: "#fff1", borderRadius: 2, overflow: "hidden" }}>
              <View style={{ width: `${Math.max(3, site.progress)}%`, backgroundColor: accent, height: "100%" }} />
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
