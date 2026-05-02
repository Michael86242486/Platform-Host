import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { MonoText } from "./MonoText";

export type SiteStatus =
  | "queued"
  | "analyzing"
  | "awaiting_confirmation"
  | "building"
  | "ready"
  | "failed";

export interface SiteSummary {
  id: string;
  name: string;
  slug: string;
  status: SiteStatus | string;
  progress: number;
  message?: string | null;
  coverColor?: string | null;
  publicUrl?: string | null;
  createdAt?: string | null;
  model?: string | null;
  files?: string[];
}

interface Props {
  site: SiteSummary;
  onPress?: () => void;
}

interface StatusMeta {
  label: string;
  color: string;
  showProgress: boolean;
}

function getStatusMeta(
  status: string | undefined,
  progress: number,
  colors: ReturnType<typeof useColors>,
): StatusMeta {
  const pct = Math.max(0, Math.min(100, Math.round(progress || 0)));
  switch (status) {
    case "ready":
      return { label: "LIVE", color: colors.success, showProgress: false };
    case "building":
      return {
        label: `BUILDING ${pct}%`,
        color: colors.primary,
        showProgress: true,
      };
    case "analyzing":
      return {
        label: `ANALYZING ${pct}%`,
        color: colors.primary,
        showProgress: true,
      };
    case "awaiting_confirmation":
      return {
        label: "REVIEW",
        color: colors.warning ?? colors.primary,
        showProgress: false,
      };
    case "queued":
      return {
        label: "QUEUED",
        color: colors.mutedForeground,
        showProgress: true,
      };
    case "failed":
      return {
        label: "FAILED",
        color: colors.destructive,
        showProgress: false,
      };
    default:
      return {
        label: (status || "UNKNOWN").toString().toUpperCase().slice(0, 16),
        color: colors.mutedForeground,
        showProgress: false,
      };
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString();
}

export function SiteCard({ site, onPress }: Props) {
  const colors = useColors();
  const accent = site.coverColor || colors.primary;
  const progress = Math.max(0, Math.min(100, Math.round(site.progress ?? 0)));
  const statusMeta = getStatusMeta(site.status, progress, colors);
  const name = site.name?.trim() || "Untitled site";
  const slug = site.slug?.trim() || "draft";
  const pageCount = site.files?.length ?? 0;
  const isLive = site.status === "ready";

  const onCopyLink = async (e: { stopPropagation?: () => void }) => {
    if (!site.publicUrl) return;
    await Clipboard.setStringAsync(site.publicUrl);
    void Haptics.selectionAsync();
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${statusMeta.label.toLowerCase()}`}
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

      {/* Top row: status badge + copy button */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 14,
          paddingBottom: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
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

        {isLive && site.publicUrl ? (
          <Pressable
            onPress={onCopyLink}
            hitSlop={10}
            style={({ pressed }) => ({
              padding: 6,
              borderRadius: 8,
              backgroundColor: `${accent}18`,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="copy" size={13} color={accent} />
          </Pressable>
        ) : null}
      </View>

      {/* Main info */}
      <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
        <Text
          numberOfLines={1}
          style={{
            color: colors.foreground,
            fontFamily: "Inter_700Bold",
            fontSize: 18,
            letterSpacing: -0.4,
          }}
        >
          {name}
        </Text>

        {/* Slug + page count row */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginTop: 5,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              flex: 1,
            }}
          >
            <Feather name="link-2" size={11} color={colors.mutedForeground} />
            <MonoText
              numberOfLines={1}
              style={{ color: colors.mutedForeground, fontSize: 11, flex: 1 }}
            >
              /{slug}
            </MonoText>
          </View>

          {pageCount > 0 && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 3,
              }}
            >
              <Feather name="file-text" size={11} color={colors.mutedForeground} />
              <MonoText
                style={{ color: colors.mutedForeground, fontSize: 11 }}
              >
                {pageCount}p
              </MonoText>
            </View>
          )}

          {site.createdAt ? (
            <MonoText
              style={{ color: colors.mutedForeground, fontSize: 11 }}
            >
              {timeAgo(site.createdAt)}
            </MonoText>
          ) : null}
        </View>

        {/* Progress bar */}
        {statusMeta.showProgress ? (
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
                width: `${Math.max(4, progress)}%`,
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
