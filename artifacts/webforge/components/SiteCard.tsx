import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { MonoText } from "./MonoText";

export interface SiteSummary {
  id: string;
  name: string;
  slug: string;
  status: "queued" | "generating" | "ready" | "failed";
  progress: number;
  message?: string | null;
  coverColor?: string | null;
  publicUrl?: string | null;
}

interface Props {
  site: SiteSummary;
  onPress?: () => void;
}

export function SiteCard({ site, onPress }: Props) {
  const colors = useColors();
  const accent = site.coverColor || colors.primary;
  const statusMeta = (() => {
    switch (site.status) {
      case "ready":
        return { label: "LIVE", color: colors.success };
      case "generating":
        return { label: `${site.progress}%`, color: colors.primary };
      case "queued":
        return { label: "QUEUED", color: colors.mutedForeground };
      case "failed":
        return { label: "FAILED", color: colors.destructive };
    }
  })();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.92 : 1,
          transform: [{ scale: pressed ? 0.995 : 1 }],
        },
      ]}
    >
      <LinearGradient
        colors={[`${accent}22`, "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={{
          height: 80,
          justifyContent: "flex-end",
          padding: 16,
        }}
      >
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
              backgroundColor: statusMeta.color,
              shadowColor: statusMeta.color,
              shadowOpacity: 0.8,
              shadowRadius: 8,
            }}
          />
          <MonoText
            style={{
              color: statusMeta.color,
              fontSize: 11,
              letterSpacing: 1.4,
              fontWeight: "700",
            }}
          >
            {statusMeta.label}
          </MonoText>
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
        <Text
          numberOfLines={1}
          style={{
            color: colors.foreground,
            fontFamily: "Inter_700Bold",
            fontSize: 18,
            letterSpacing: -0.4,
          }}
        >
          {site.name}
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginTop: 4,
          }}
        >
          <Feather name="link-2" size={12} color={colors.mutedForeground} />
          <MonoText
            numberOfLines={1}
            style={{
              color: colors.mutedForeground,
              fontSize: 12,
              flex: 1,
            }}
          >
            /{site.slug}
          </MonoText>
        </View>
        {site.status === "generating" || site.status === "queued" ? (
          <View
            style={{
              height: 3,
              backgroundColor: colors.border,
              borderRadius: 2,
              marginTop: 12,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${Math.max(4, site.progress)}%`,
                backgroundColor: accent,
                height: "100%",
              }}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
});
