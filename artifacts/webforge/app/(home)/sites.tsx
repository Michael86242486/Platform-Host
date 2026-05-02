import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  getListSitesQueryKey,
  useListSites,
} from "@workspace/api-client-react";

import { MonoText } from "@/components/MonoText";
import { SiteCard } from "@/components/SiteCard";
import { SiteCardSkeleton } from "@/components/SiteCardSkeleton";
import { StateCard } from "@/components/StateCard";
import { useColors } from "@/hooks/useColors";

type FilterKey =
  | "all"
  | "ready"
  | "building"
  | "awaiting_confirmation"
  | "failed";

type SortKey = "newest" | "oldest" | "az";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Live" },
  { key: "building", label: "Building" },
  { key: "awaiting_confirmation", label: "Review" },
  { key: "failed", label: "Failed" },
];

const SORT_CYCLE: SortKey[] = ["newest", "oldest", "az"];
const SORT_LABELS: Record<SortKey, string> = {
  newest: "NEWEST",
  oldest: "OLDEST",
  az: "A → Z",
};

export default function SitesScreen() {
  const colors = useColors();
  const router = useRouter();

  const { data, refetch, isFetching, isLoading, isError, error } =
    useListSites({
      query: { queryKey: getListSitesQueryKey(), refetchInterval: 2500 },
    });

  const sites = data ?? [];

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("newest");

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: sites.length,
      ready: 0,
      building: 0,
      awaiting_confirmation: 0,
      failed: 0,
    };
    for (const s of sites) {
      const st = s.status as string;
      if (st === "ready") c.ready++;
      else if (st === "building" || st === "analyzing" || st === "queued")
        c.building++;
      else if (st === "awaiting_confirmation") c.awaiting_confirmation++;
      else if (st === "failed") c.failed++;
    }
    return c;
  }, [sites]);

  const filtered = useMemo(() => {
    let result = [...sites];

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.slug ?? "").toLowerCase().includes(q),
      );
    }

    if (filter !== "all") {
      if (filter === "building") {
        result = result.filter((s) => {
          const st = s.status as string;
          return st === "building" || st === "analyzing" || st === "queued";
        });
      } else {
        result = result.filter((s) => s.status === filter);
      }
    }

    if (sort === "oldest") result = result.reverse();
    else if (sort === "az")
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));

    return result;
  }, [sites, search, filter, sort]);

  const cycleSort = () => {
    setSort((prev) => {
      const idx = SORT_CYCLE.indexOf(prev);
      return SORT_CYCLE[(idx + 1) % SORT_CYCLE.length];
    });
  };

  const showSkeletons = isLoading && sites.length === 0;
  const showError = isError && sites.length === 0;
  const hasFilters = search.length > 0 || filter !== "all";

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      {/* ── Header ── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <View>
            <MonoText
              style={{ color: colors.primary, fontSize: 11, letterSpacing: 1.4 }}
            >
              {">_ ls ./sites"}
            </MonoText>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 26,
                fontFamily: "Inter_700Bold",
                letterSpacing: -0.6,
                marginTop: 4,
              }}
            >
              Your sites
            </Text>
          </View>

          <Pressable
            onPress={() => router.push("/create")}
            style={({ pressed }) => ({
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: colors.primary,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Feather name="plus" size={16} color="#000" />
            <Text
              style={{
                color: "#000",
                fontFamily: "Inter_700Bold",
                fontSize: 13,
              }}
            >
              New
            </Text>
          </Pressable>
        </View>

        {/* ── Search bar ── */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: colors.cardElevated,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            gap: 8,
            marginBottom: 12,
          }}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or slug…"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
            style={{
              flex: 1,
              color: colors.foreground,
              fontFamily: "Inter_500Medium",
              fontSize: 15,
            }}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        {/* ── Filter pills ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -20 }}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
        >
          {FILTERS.map((f) => {
            const count = counts[f.key];
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  paddingHorizontal: 13,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: active
                    ? `${colors.primary}22`
                    : colors.cardElevated,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                }}
              >
                <Text
                  style={{
                    color: active ? colors.primary : colors.mutedForeground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 13,
                  }}
                >
                  {f.label}
                </Text>
                {count > 0 && (
                  <View
                    style={{
                      backgroundColor: active ? colors.primary : colors.border,
                      borderRadius: 999,
                      minWidth: 18,
                      paddingHorizontal: 5,
                      paddingVertical: 1,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: active ? "#000" : colors.mutedForeground,
                        fontFamily: "Inter_700Bold",
                        fontSize: 10,
                      }}
                    >
                      {count}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Content ── */}
      {showSkeletons ? (
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <SiteCardSkeleton />
          <SiteCardSkeleton />
          <SiteCardSkeleton />
        </View>
      ) : showError ? (
        <View style={{ paddingHorizontal: 20 }}>
          <StateCard
            icon="alert-triangle"
            tone="danger"
            title="Couldn't load your sites"
            message={
              error instanceof Error
                ? error.message
                : "The server didn't respond. Check your connection and try again."
            }
            action={{ label: "Retry", onPress: () => refetch() }}
          />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 40,
            gap: 10,
          }}
          data={filtered}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <SiteCard
              site={item as Parameters<typeof SiteCard>[0]["site"]}
              onPress={() => router.push(`/site/${item.id}`)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            sites.length > 0 ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 6,
                }}
              >
                <MonoText
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 11,
                    letterSpacing: 1,
                  }}
                >
                  {filtered.length} {filtered.length === 1 ? "SITE" : "SITES"}
                  {hasFilters ? " (FILTERED)" : ""}
                </MonoText>
                <Pressable
                  onPress={cycleSort}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Feather
                    name="arrow-up-down"
                    size={12}
                    color={colors.mutedForeground}
                  />
                  <MonoText
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 11,
                      letterSpacing: 1,
                    }}
                  >
                    {SORT_LABELS[sort]}
                  </MonoText>
                </Pressable>
              </View>
            ) : null
          }
          ListEmptyComponent={
            hasFilters ? (
              <StateCard
                icon="search"
                title="No matches"
                message={
                  search
                    ? `No sites matching "${search}"`
                    : `No ${filter === "ready" ? "live" : filter === "awaiting_confirmation" ? "review" : filter} sites yet.`
                }
                action={{
                  label: "Clear filters",
                  onPress: () => {
                    setSearch("");
                    setFilter("all");
                  },
                }}
              />
            ) : (
              <StateCard
                icon="globe"
                title="Nothing here yet"
                message="Tap New above to forge your first site. It takes about 5 seconds."
                action={{
                  label: "Forge a site",
                  onPress: () => router.push("/create"),
                }}
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}
