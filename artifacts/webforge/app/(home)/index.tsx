import { Feather } from "@expo/vector-icons";

import { useUser } from "@/lib/auth";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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
import { StatTile } from "@/components/StatTile";
import { useColors } from "@/hooks/useColors";

export default function Dashboard() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useUser();
  const { width } = useWindowDimensions();

  const sitesQuery = useListSites({
    query: { queryKey: getListSitesQueryKey(), refetchInterval: 2500 },
  });
  const jobsQuery = useListJobs({
    query: { queryKey: getListJobsQueryKey(), refetchInterval: 2500 },
  });
  const botsQuery = useListBots({
    query: { queryKey: getListBotsQueryKey() },
  });

  const sites = sitesQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const bots = botsQuery.data ?? [];

  const counts = useMemo(() => {
    return {
      sites: sites.length,
      live: sites.filter((s) => s.status === "ready").length,
      working: jobs.filter(
        (j) => j.status === "running" || j.status === "queued",
      ).length,
      bots: bots.filter((b) => b.status === "active").length,
    };
  }, [sites, jobs, bots]);

  const recent = sites.slice(0, 3);

  const onRefresh = () => {
    sitesQuery.refetch();
    jobsQuery.refetch();
    botsQuery.refetch();
  };

  const greeting =
    user?.firstName ||
    (user?.email?.split("@")[0] ?? "developer");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { opacity: 0.35 }]}
      >
        <MatrixRain width={width} height={400} intensity={0.5} />
        <LinearGradient
          colors={[
            "transparent",
            colors.background + "00",
            colors.background,
            colors.background,
          ]}
          locations={[0, 0.4, 0.78, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={sitesQuery.isFetching && !sitesQuery.isLoading}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: 24,
            }}
          >
            <Brand size={28} />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.cardElevated,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: colors.success,
                  shadowColor: colors.success,
                  shadowOpacity: 0.7,
                  shadowRadius: 6,
                }}
              />
              <MonoText
                style={{
                  color: colors.mutedForeground,
                  fontSize: 11,
                  letterSpacing: 1.4,
                }}
              >
                ONLINE
              </MonoText>
            </View>
          </View>

          <View style={{ paddingHorizontal: 20, marginBottom: 22 }}>
            <MonoText
              style={{
                color: colors.primary,
                fontSize: 12,
                letterSpacing: 1.4,
                marginBottom: 4,
              }}
            >
              {">_ welcome back"}
            </MonoText>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 32,
                fontFamily: "Inter_700Bold",
                letterSpacing: -1,
              }}
            >
              Hey, {greeting}.
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                marginTop: 6,
                fontSize: 15,
                lineHeight: 22,
              }}
            >
              What are we building today? Type a prompt and we'll forge a live
              site in seconds.
            </Text>
          </View>

          <View style={{ paddingHorizontal: 20, marginBottom: 22 }}>
            <NeonButton
              title="✨ Forge a new site"
              onPress={() => router.push("/create")}
              fullWidth
            />
          </View>

          <View
            style={{
              flexDirection: "row",
              gap: 10,
              paddingHorizontal: 20,
              marginBottom: 24,
            }}
          >
            <StatTile
              label="Sites"
              value={counts.sites}
              hint={`${counts.live} live`}
              accent={colors.primary}
            />
            <StatTile
              label="Working"
              value={counts.working}
              hint="in queue"
              accent={colors.codeYellow}
            />
            <StatTile
              label="Bots"
              value={counts.bots}
              hint="hosted"
              accent={colors.accent}
            />
          </View>

          <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 18,
                  fontFamily: "Inter_700Bold",
                  letterSpacing: -0.5,
                }}
              >
                Recent sites
              </Text>
              <MonoText
                onPress={() => router.push("/(home)/sites")}
                style={{
                  color: colors.primary,
                  fontSize: 12,
                  letterSpacing: 1.4,
                }}
              >
                ALL →
              </MonoText>
            </View>
          </View>

          {recent.length === 0 ? (
            <View style={{ paddingHorizontal: 20 }}>
              <View
                style={{
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: 16,
                  borderStyle: "dashed",
                  padding: 24,
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Feather name="zap" size={24} color={colors.primary} />
                <Text
                  style={{
                    color: colors.foreground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 15,
                  }}
                >
                  No sites yet
                </Text>
                <Text
                  style={{
                    color: colors.mutedForeground,
                    textAlign: "center",
                    fontSize: 13,
                  }}
                >
                  Forge your first one — it takes about 5 seconds.
                </Text>
              </View>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              {recent.map((s) => (
                <SiteCard
                  key={s.id}
                  site={s}
                  onPress={() => router.push(`/site/${s.id}`)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
