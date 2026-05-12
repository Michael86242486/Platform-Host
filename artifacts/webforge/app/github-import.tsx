import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { Surface } from "@/components/Surface";
import { useColors } from "@/hooks/useColors";
import { useApiClient } from "@/lib/api";

interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  defaultBranch: string;
  language: string | null;
  updatedAt: string;
  stars: number;
  private: boolean;
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178C6",
  JavaScript: "#F7DF1E",
  Python: "#3776AB",
  Go: "#00ADD8",
  Rust: "#CE422B",
  Swift: "#FA7343",
  Kotlin: "#7F52FF",
  Java: "#ED8B00",
  "C++": "#F34B7D",
  "C#": "#239120",
  PHP: "#777BB4",
  Ruby: "#CC342D",
  Dart: "#00B4AB",
  Vue: "#4FC08D",
  HTML: "#E34F26",
  CSS: "#563D7C",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function GitHubImportScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApiClient();

  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const [building, setBuildingId] = useState<number | null>(null);
  const [githubUser, setGithubUser] = useState<string | null>(null);

  const fetchRepos = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      // Check GitHub connection status first
      const statusRes = await api.get<{ connected: boolean; username: string | null }>("/github/status");
      if (!statusRes.connected) {
        setNotConnected(true);
        return;
      }
      setGithubUser(statusRes.username);
      setNotConnected(false);

      const data = await api.get<GithubRepo[]>("/github/repos");
      setRepos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load repositories");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void fetchRepos();
  }, [fetchRepos]);

  const filteredRepos = repos.filter((r) => {
    const matchesSearch =
      !search.trim() ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.description ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesLang = !selectedLang || r.language === selectedLang;
    return matchesSearch && matchesLang;
  });

  const allLanguages = Array.from(
    new Set(repos.map((r) => r.language).filter(Boolean) as string[])
  ).slice(0, 8);

  const onBuildRepo = async (repo: GithubRepo) => {
    if (Platform.OS !== "web") {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setBuildingId(repo.id);

    try {
      const res = await api.post<{ suggestedPrompt: string }>("/github/import", {
        repoUrl: repo.url,
        branch: repo.defaultBranch,
      });

      const prompt = res.suggestedPrompt;
      router.push(`/create?prompt=${encodeURIComponent(prompt)}` as never);
    } catch {
      Alert.alert("Import failed", "Could not generate a build prompt for this repo.");
    } finally {
      setBuildingId(null);
    }
  };

  const onConnectGitHub = () => {
    router.push("/(home)/profile");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      {/* ─── Header ─── */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
          hitSlop={12}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <MonoText style={[styles.headerLabel, { color: colors.primary }]}>
            {">_ github import"}
          </MonoText>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Import Repository
          </Text>
        </View>
        {githubUser ? (
          <View style={[styles.userBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="github" size={13} color={colors.foreground} />
            <Text style={[styles.userBadgeText, { color: colors.foreground }]} numberOfLines={1}>
              {githubUser}
            </Text>
          </View>
        ) : null}
      </View>

      {/* ─── Not Connected ─── */}
      {notConnected && (
        <View style={styles.center}>
          <View style={[styles.notConnectedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <LinearGradient
              colors={[`${colors.primary}12`, "transparent"]}
              style={StyleSheet.absoluteFill}
            />
            <View style={[styles.githubIconWrap, { backgroundColor: `${colors.primary}15` }]}>
              <Feather name="github" size={36} color={colors.primary} />
            </View>
            <Text style={[styles.notConnectedTitle, { color: colors.foreground }]}>
              Connect GitHub
            </Text>
            <Text style={[styles.notConnectedText, { color: colors.mutedForeground }]}>
              Link your GitHub account to browse your repositories and let the AI build directly from your code.
            </Text>
            <NeonButton
              title="Connect GitHub Account"
              onPress={onConnectGitHub}
              style={{ marginTop: 8 }}
            />
          </View>
        </View>
      )}

      {/* ─── Loading ─── */}
      {loading && !notConnected && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <MonoText style={[styles.loadingText, { color: colors.mutedForeground }]}>
            fetching repos…
          </MonoText>
        </View>
      )}

      {/* ─── Error ─── */}
      {error && !loading && (
        <View style={styles.center}>
          <Feather name="alert-triangle" size={32} color={colors.danger} />
          <Text style={[styles.errorText, { color: colors.foreground }]}>
            {error}
          </Text>
          <NeonButton title="Retry" onPress={() => fetchRepos()} style={{ marginTop: 12 }} />
        </View>
      )}

      {/* ─── Repos List ─── */}
      {!loading && !notConnected && !error && (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchRepos(true)}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* Search bar */}
          <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={15} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={`Search ${repos.length} repositories…`}
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground }]}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch("")} hitSlop={8}>
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>

          {/* Language filters */}
          {allLanguages.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.langScroll}
            >
              <Pressable
                onPress={() => setSelectedLang(null)}
                style={[
                  styles.langPill,
                  {
                    backgroundColor: !selectedLang ? `${colors.primary}20` : colors.card,
                    borderColor: !selectedLang ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={[styles.langText, { color: !selectedLang ? colors.primary : colors.mutedForeground }]}>
                  All
                </Text>
              </Pressable>
              {allLanguages.map((lang) => {
                const active = selectedLang === lang;
                const langColor = LANG_COLORS[lang] ?? colors.accent;
                return (
                  <Pressable
                    key={lang}
                    onPress={() => setSelectedLang(active ? null : lang)}
                    style={[
                      styles.langPill,
                      {
                        backgroundColor: active ? `${langColor}20` : colors.card,
                        borderColor: active ? langColor : colors.border,
                      },
                    ]}
                  >
                    <View style={[styles.langDot, { backgroundColor: langColor }]} />
                    <Text style={[styles.langText, { color: active ? langColor : colors.mutedForeground }]}>
                      {lang}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* Repo count */}
          <View style={styles.countRow}>
            <MonoText style={[styles.countText, { color: colors.mutedForeground }]}>
              {filteredRepos.length} REPO{filteredRepos.length !== 1 ? "S" : ""}
            </MonoText>
          </View>

          {/* Repo cards */}
          <View style={styles.repoList}>
            {filteredRepos.map((repo) => (
              <RepoCard
                key={repo.id}
                repo={repo}
                colors={colors}
                isBuilding={building === repo.id}
                onBuild={() => onBuildRepo(repo)}
              />
            ))}

            {filteredRepos.length === 0 && (
              <View style={styles.empty}>
                <Feather name="inbox" size={28} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  No repositories match your search
                </Text>
              </View>
            )}
          </View>

          {/* Manual URL import */}
          <Surface padded style={[styles.manualSection, { marginHorizontal: 20, marginTop: 8 }]}>
            <MonoText style={[styles.manualLabel, { color: colors.mutedForeground }]}>
              OR IMPORT BY URL
            </MonoText>
            <ManualImport colors={colors} router={router} api={api} />
          </Surface>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function RepoCard({
  repo,
  colors,
  isBuilding,
  onBuild,
}: {
  repo: GithubRepo;
  colors: ReturnType<typeof useColors>;
  isBuilding: boolean;
  onBuild: () => void;
}) {
  const langColor = repo.language ? (LANG_COLORS[repo.language] ?? colors.accent) : colors.mutedForeground;

  return (
    <View style={[styles.repoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Top row */}
      <View style={styles.repoTop}>
        <View style={{ flex: 1 }}>
          <View style={styles.repoNameRow}>
            <Feather
              name={repo.private ? "lock" : "book"}
              size={13}
              color={colors.mutedForeground}
            />
            <Text style={[styles.repoName, { color: colors.foreground }]} numberOfLines={1}>
              {repo.name}
            </Text>
            {repo.private && (
              <View style={[styles.privateBadge, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                <Text style={[styles.privateBadgeText, { color: colors.mutedForeground }]}>
                  private
                </Text>
              </View>
            )}
          </View>
          {repo.description ? (
            <Text style={[styles.repoDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
              {repo.description}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Meta row */}
      <View style={styles.repoMeta}>
        {repo.language ? (
          <View style={styles.metaItem}>
            <View style={[styles.langDotSm, { backgroundColor: langColor }]} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{repo.language}</Text>
          </View>
        ) : null}
        {repo.stars > 0 ? (
          <View style={styles.metaItem}>
            <Feather name="star" size={11} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{repo.stars}</Text>
          </View>
        ) : null}
        <View style={styles.metaItem}>
          <Feather name="git-branch" size={11} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{repo.defaultBranch}</Text>
        </View>
        <View style={styles.metaItem}>
          <Feather name="clock" size={11} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{timeAgo(repo.updatedAt)}</Text>
        </View>
      </View>

      {/* Build button */}
      <Pressable
        onPress={onBuild}
        disabled={isBuilding}
        style={({ pressed }) => [
          styles.buildRepoBtn,
          {
            backgroundColor: isBuilding ? colors.cardElevated : colors.primary,
            opacity: pressed ? 0.85 : isBuilding ? 0.6 : 1,
          },
        ]}
      >
        {isBuilding ? (
          <>
            <ActivityIndicator size="small" color={colors.foreground} />
            <Text style={[styles.buildRepoBtnText, { color: colors.mutedForeground }]}>
              Preparing build…
            </Text>
          </>
        ) : (
          <>
            <Feather name="zap" size={14} color="#000" />
            <Text style={styles.buildRepoBtnText}>
              Build with AI
            </Text>
            <Feather name="arrow-right" size={13} color="#000" />
          </>
        )}
      </Pressable>
    </View>
  );
}

function ManualImport({
  colors,
  router,
  api,
}: {
  colors: ReturnType<typeof useColors>;
  router: ReturnType<typeof useRouter>;
  api: ReturnType<typeof useApiClient>;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const onImport = async () => {
    const trimmed = url.trim();
    if (!trimmed || !trimmed.includes("github.com")) {
      Alert.alert("Invalid URL", "Please enter a valid GitHub repository URL.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ suggestedPrompt: string }>("/github/import", {
        repoUrl: trimmed,
        branch: "main",
      });
      router.push(`/create?prompt=${encodeURIComponent(res.suggestedPrompt)}` as never);
    } catch {
      Alert.alert("Import failed", "Could not import that repository URL.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={[styles.urlInput, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
        <Feather name="github" size={14} color={colors.mutedForeground} />
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://github.com/owner/repo"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.urlInputText, { color: colors.foreground }]}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {url.length > 0 && (
          <Pressable onPress={() => setUrl("")} hitSlop={8}>
            <Feather name="x" size={13} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>
      <Pressable
        onPress={onImport}
        disabled={loading || !url.trim()}
        style={({ pressed }) => [
          styles.importUrlBtn,
          {
            backgroundColor: url.trim() ? colors.primary : colors.cardElevated,
            opacity: pressed ? 0.85 : loading || !url.trim() ? 0.5 : 1,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#000" />
        ) : (
          <Feather name="download" size={15} color={url.trim() ? "#000" : colors.mutedForeground} />
        )}
        <Text
          style={[
            styles.importUrlBtnText,
            { color: url.trim() ? "#000" : colors.mutedForeground },
          ]}
        >
          {loading ? "Importing…" : "Import & Build"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
  },
  backBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerLabel: { fontSize: 11, letterSpacing: 1.4, marginBottom: 2 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.6 },
  userBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  userBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", maxWidth: 100 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 32 },
  notConnectedCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 14,
    overflow: "hidden",
    width: "100%",
    maxWidth: 340,
  },
  githubIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  notConnectedTitle: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  notConnectedText: { fontSize: 14, lineHeight: 22, textAlign: "center" },
  loadingText: { fontSize: 13, letterSpacing: 1.2, marginTop: 12 },
  errorText: { fontSize: 15, textAlign: "center", fontFamily: "Inter_600SemiBold" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15 },
  langScroll: { paddingHorizontal: 20, gap: 8, paddingBottom: 4 },
  langPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  langDot: { width: 8, height: 8, borderRadius: 4 },
  langDotSm: { width: 7, height: 7, borderRadius: 4 },
  langText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  countRow: { paddingHorizontal: 20, marginTop: 12, marginBottom: 8 },
  countText: { fontSize: 10, letterSpacing: 1.8 },
  repoList: { paddingHorizontal: 20, gap: 10 },
  repoCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  repoTop: { flexDirection: "row", gap: 12 },
  repoNameRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 4, flexWrap: "wrap" },
  repoName: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  privateBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  privateBadgeText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  repoDesc: { fontSize: 13, lineHeight: 19 },
  repoMeta: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12 },
  buildRepoBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  buildRepoBtnText: { fontFamily: "Inter_700Bold", fontSize: 14, color: "#000" },
  manualSection: { gap: 12 },
  manualLabel: { fontSize: 10, letterSpacing: 1.8 },
  urlInput: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  urlInputText: { flex: 1, fontSize: 14 },
  importUrlBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
  },
  importUrlBtnText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  empty: { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 14, textAlign: "center" },
});
