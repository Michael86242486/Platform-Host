import { useUser } from "@/lib/auth";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import {
  getListBotsQueryKey,
  getListJobsQueryKey,
  getListSitesQueryKey,
  useListBots,
  useListJobs,
  useListSites,
} from "@workspace/api-client-react";

import { Brand } from "@/components/Brand";
import { MatrixRain } from "@/components/MatrixRain";
import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { SiteCard } from "@/components/SiteCard";
import { SiteCardSkeleton } from "@/components/SiteCardSkeleton";
import { StateCard } from "@/components/StateCard";
import { useColors } from "@/hooks/useColors";

const QUICK_BUILDS = [
  { icon: "gamepad-2" as const, label: "FIFA 2026 Game", prompt: "Build me a fully playable FIFA 2026 football game with ball physics, player movement, AI goalkeeper, scoring system, and sound effects", color: "#00FFC2" },
  { icon: "shopping-cart" as const, label: "E-commerce MVP", prompt: "Build a complete e-commerce MVP with product listings, cart, checkout flow, and admin dashboard", color: "#58A6FF" },
  { icon: "bar-chart-2" as const, label: "SaaS Dashboard", prompt: "Build a SaaS analytics dashboard with dark mode, charts, user management, and billing page", color: "#BC8CFF" },
  { icon: "code" as const, label: "Portfolio Site", prompt: "Build a stunning developer portfolio with projects showcase, skills, blog, and contact form", color: "#FF6B6B" },
  { icon: "zap" as const, label: "AI Tool", prompt: "Build an AI-powered productivity tool with chat interface, history, and export features", color: "#FFD166" },
  { icon: "globe" as const, label: "Startup Landing", prompt: "Build a high-converting startup landing page with hero, features, testimonials, pricing, and CTA", color: "#3FB950" },
];

export default function Dashboard() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useUser();
  const { width } = useWindowDimensions();

  const sitesQuery = useListSites({
    query: { queryKey: getListSitesQueryKey(), refetchInterval: 3000 },
  });
  const jobsQuery = useListJobs({
    query: { queryKey: getListJobsQueryKey(), refetchInterval: 3000 },
  });
  const botsQuery = useListBots({
    query: { queryKey: getListBotsQueryKey() },
  });

  const sites = sitesQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const bots = botsQuery.data ?? [];

  const counts = useMemo(() => ({
    sites: sites.length,
    live: sites.filter((s) => s.status === "ready").length,
    working: jobs.filter((j) => j.status === "running" || j.status === "queued").length,
    bots: bots.filter((b) => b.status === "active").length,
  }), [sites, jobs, bots]);

  const recent = sites.slice(0, 3);

  const onRefresh = () => {
    sitesQuery.refetch();
    jobsQuery.refetch();
    botsQuery.refetch();
  };

  const greeting = user?.firstName || (user?.email?.split("@")[0] ?? "builder");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0.12 }]}>
        <MatrixRain width={width} height={360} intensity={0.28} />
        <LinearGradient
          colors={["transparent", `${colors.background}00`, colors.background]}
          locations={[0, 0.4, 0.75]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={sitesQuery.isFetching && !sitesQuery.isLoading}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* ─── Header ─── */}
          <View style={styles.header}>
            <Brand size={26} />
            <View style={[styles.statusBadge, { borderColor: colors.border, backgroundColor: colors.cardElevated }]}>
              <View style={[styles.statusDot, { backgroundColor: colors.success, shadowColor: colors.success }]} />
              <MonoText style={[styles.statusText, { color: colors.mutedForeground }]}>
                ONLINE
              </MonoText>
            </View>
          </View>

          {/* ─── Greeting ─── */}
          <View style={styles.greetingSection}>
            <MonoText style={[styles.greetingLabel, { color: colors.primary }]}>
              {">_ ready to forge"}
            </MonoText>
            <Text style={[styles.greetingName, { color: colors.foreground }]}>
              Hey, {greeting}.
            </Text>
            <Text style={[styles.greetingSubtext, { color: colors.mutedForeground }]}>
              Describe what you want to build — websites, games, SaaS apps, MVPs — and watch it come alive.
            </Text>
          </View>

          {/* ─── Forge CTA ─── */}
          <View style={styles.ctaSection}>
            <LinearGradient
              colors={[`${colors.primary}18`, `${colors.accent}0A`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.ctaGradient, { borderColor: `${colors.primary}30` }]}
            >
              <Pressable
                onPress={() => router.push("/create")}
                style={({ pressed }) => [
                  styles.ctaButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.9 : 1,
                    shadowColor: colors.primary,
                  },
                ]}
              >
                <Feather name="zap" size={18} color="#000" />
                <Text style={styles.ctaButtonText}>Start Building</Text>
                <Feather name="arrow-right" size={16} color="#000" />
              </Pressable>
              <Text style={[styles.ctaHint, { color: colors.mutedForeground }]}>
                AI builds it in ~30 seconds · Works on all devices
              </Text>
            </LinearGradient>
          </View>

          {/* ─── Stats row ─── */}
          <View style={styles.statsRow}>
            <StatCard label="Projects" value={counts.sites} sub={`${counts.live} live`} accent={colors.primary} colors={colors} />
            <StatCard label="Building" value={counts.working} sub="active" accent={colors.codeYellow} colors={colors} />
            <StatCard label="Bots" value={counts.bots} sub="hosted" accent={colors.accent} colors={colors} />
          </View>

          {/* ─── Quick Builds ─── */}
          <View style={styles.sectionHeader}>
            <MonoText style={[styles.sectionLabel, { color: colors.mutedForeground }]}>QUICK BUILDS</MonoText>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickBuildsScroll}
          >
            {QUICK_BUILDS.map((item) => (
              <Pressable
                key={item.label}
                onPress={() => router.push(`/create?prompt=${encodeURIComponent(item.prompt)}` as never)}
                style={({ pressed }) => [
                  styles.quickCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: `${item.color}30`,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={[styles.quickIcon, { backgroundColor: `${item.color}15` }]}>
                  <Feather name={item.icon as keyof typeof Feather.glyphMap} size={20} color={item.color} />
                </View>
                <Text style={[styles.quickLabel, { color: colors.foreground }]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* ─── Recent projects ─── */}
          <View style={[styles.sectionHeader, { marginTop: 6 }]}>
            <MonoText style={[styles.sectionLabel, { color: colors.mutedForeground }]}>RECENT PROJECTS</MonoText>
            <Pressable onPress={() => router.push("/(home)/sites")}>
              <MonoText style={[styles.seeAllText, { color: colors.primary }]}>ALL →</MonoText>
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 20 }}>
            {sitesQuery.isLoading && recent.length === 0 ? (
              <View style={{ gap: 10 }}>
                <SiteCardSkeleton />
                <SiteCardSkeleton />
              </View>
            ) : sitesQuery.isError && recent.length === 0 ? (
              <StateCard
                icon="alert-triangle"
                tone="danger"
                title="Couldn't reach the server"
                message="Pull to refresh and try again."
                action={{ label: "Retry", onPress: () => sitesQuery.refetch() }}
              />
            ) : recent.length === 0 ? (
              <StateCard
                icon="zap"
                title="Nothing built yet"
                message="Use a quick build above or tap Start Building to forge your first project."
                action={{ label: "Start Building", onPress: () => router.push("/create") }}
              />
            ) : (
              <View style={{ gap: 10 }}>
                {recent.map((s) => (
                  <SiteCard
                    key={s.id}
                    site={s}
                    onPress={() => router.push(`/site/${s.id}`)}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
  colors,
}: {
  label: string;
  value: number;
  sub: string;
  accent: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.statCard,
        {
          backgroundColor: colors.card,
          borderColor: `${accent}25`,
        },
      ]}
    >
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.foreground }]}>{label}</Text>
      <Text style={[styles.statSub, { color: colors.mutedForeground }]}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOpacity: 0.8,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  statusText: {
    fontSize: 10,
    letterSpacing: 1.4,
  },
  greetingSection: {
    paddingHorizontal: 20,
    marginBottom: 22,
  },
  greetingLabel: {
    fontSize: 11,
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  greetingName: {
    fontSize: 34,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1.2,
    marginBottom: 8,
  },
  greetingSubtext: {
    fontSize: 15,
    lineHeight: 23,
  },
  ctaSection: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  ctaGradient: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    alignItems: "center",
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 28,
    paddingVertical: 15,
    borderRadius: 14,
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  ctaButtonText: {
    color: "#000",
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    letterSpacing: -0.3,
  },
  ctaHint: {
    fontSize: 12,
    textAlign: "center",
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 26,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 2,
  },
  statValue: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  statSub: {
    fontSize: 11,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 1.8,
  },
  seeAllText: {
    fontSize: 11,
    letterSpacing: 1.4,
  },
  quickBuildsScroll: {
    paddingHorizontal: 20,
    paddingBottom: 4,
    gap: 10,
  },
  quickCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    gap: 10,
    width: 100,
  },
  quickIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    lineHeight: 16,
  },
});
