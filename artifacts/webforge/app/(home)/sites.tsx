import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  getListSitesQueryKey,
  useListSites,
} from "@workspace/api-client-react";

import { MonoText } from "@/components/MonoText";
import { SiteCard } from "@/components/SiteCard";
import { useColors } from "@/hooks/useColors";

export default function SitesScreen() {
  const colors = useColors();
  const router = useRouter();
  const { data, refetch, isFetching, isLoading } = useListSites({
    query: { queryKey: getListSitesQueryKey(), refetchInterval: 2500 },
  });
  const sites = data ?? [];

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <View
        style={{
          paddingHorizontal: 20,
          paddingVertical: 16,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <View>
          <MonoText
            style={{
              color: colors.primary,
              fontSize: 11,
              letterSpacing: 1.4,
            }}
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
            padding: 12,
            borderRadius: 12,
            backgroundColor: colors.cardElevated,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Feather name="plus" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={{ padding: 20, gap: 12 }}
        data={sites}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <SiteCard site={item} onPress={() => router.push(`/site/${item.id}`)} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View
            style={{
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 16,
              borderStyle: "dashed",
              padding: 32,
              alignItems: "center",
              gap: 10,
              marginTop: 20,
            }}
          >
            <Feather name="globe" size={28} color={colors.primary} />
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 18,
              }}
            >
              Nothing here yet
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                textAlign: "center",
                fontSize: 13,
              }}
            >
              Tap the + above to forge your first site.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
