import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import React, { useState } from "react";
import {
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
  getListBotsQueryKey,
  getListSitesQueryKey,
  useListBots,
  useListSites,
} from "@workspace/api-client-react";

import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { Surface } from "@/components/Surface";
import { useColors } from "@/hooks/useColors";

const QUICK_PROMPTS = [
  "A modern landing page for a mindfulness app",
  "An indie game studio site with a devlog",
  "A bakery site with a menu and online order CTA",
];

export default function CoBuilderScreen() {
  const colors = useColors();
  const router = useRouter();
  const [draft, setDraft] = useState("");

  const botsQuery = useListBots({
    query: { queryKey: getListBotsQueryKey(), refetchInterval: 6000 },
  });
  const sitesQuery = useListSites({
    query: { queryKey: getListSitesQueryKey(), refetchInterval: 5000 },
  });

  const bots = botsQuery.data ?? [];
  const sites = sitesQuery.data ?? [];
  const liveBot = bots.find((b) => b.status === "active") ?? bots[0] ?? null;
  const recentSites = sites.slice(0, 4);

  const onSend = () => {
    const trimmed = draft.trim();
    if (trimmed.length < 4) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDraft("");
    router.push(`/create?prompt=${encodeURIComponent(trimmed)}` as never);
  };

  const openTelegram = () => {
    if (!liveBot?.username) return;
    void Haptics.selectionAsync();
    void Linking.openURL(`https://t.me/${liveBot.username}`);
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 18 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={{ gap: 6 }}>
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
                  backgroundColor: colors.success,
                  shadowColor: colors.success,
                  shadowOpacity: 0.8,
                  shadowRadius: 8,
                }}
              />
              <MonoText
                style={{
                  color: colors.primary,
                  fontSize: 11,
                  letterSpacing: 1.4,
                }}
              >
                {">_ co-builder online"}
              </MonoText>
            </View>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 28,
                fontFamily: "Inter_700Bold",
                letterSpacing: -0.6,
              }}
            >
              Talk to the agent.
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 14,
                lineHeight: 20,
              }}
            >
              Tell the AI co-builder what you want. It'll forge new sites, edit
              existing ones, swap layouts, write copy, anything.
            </Text>
          </View>

          {/* Composer */}
          <LinearGradient
            colors={[`${colors.primary}22`, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 18, padding: 1 }}
          >
            <View
              style={{
                backgroundColor: colors.cardElevated,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 17,
                padding: 14,
                gap: 12,
              }}
            >
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Build me a portfolio for a wedding photographer with a dark hero…"
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_500Medium",
                  fontSize: 15,
                  minHeight: 90,
                  textAlignVertical: "top",
                }}
              />
              <NeonButton
                title="✨ Forge it"
                onPress={onSend}
                disabled={draft.trim().length < 4}
                fullWidth
              />
            </View>
          </LinearGradient>

          <View style={{ gap: 8 }}>
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: "uppercase",
              }}
            >
              Try saying
            </MonoText>
            {QUICK_PROMPTS.map((p) => (
              <Pressable
                key={p}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setDraft(p);
                }}
                style={({ pressed }) => ({
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  opacity: pressed ? 0.8 : 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                })}
              >
                <Feather name="message-square" size={14} color={colors.primary} />
                <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }}>
                  {p}
                </Text>
                <Feather
                  name="arrow-up-right"
                  size={14}
                  color={colors.mutedForeground}
                />
              </Pressable>
            ))}
          </View>

          {/* Edit any existing site via chat */}
          {recentSites.length > 0 ? (
            <View style={{ gap: 8 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <MonoText
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 11,
                    letterSpacing: 1.4,
                    textTransform: "uppercase",
                  }}
                >
                  Chat with a site
                </MonoText>
                <MonoText
                  onPress={() => router.push("/(home)/sites")}
                  style={{
                    color: colors.primary,
                    fontSize: 11,
                    letterSpacing: 1.2,
                  }}
                >
                  ALL →
                </MonoText>
              </View>
              {recentSites.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => router.push(`/site/${s.id}`)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    padding: 12,
                    borderRadius: 12,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      backgroundColor: s.coverColor || colors.primary,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Feather name="globe" size={18} color="#000" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: colors.foreground,
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 14,
                      }}
                    >
                      {s.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 12,
                        marginTop: 2,
                      }}
                    >
                      {s.status === "ready"
                        ? "Tap to chat-edit this site"
                        : (s.message ?? s.status)}
                    </Text>
                  </View>
                  <Feather
                    name="message-circle"
                    size={16}
                    color={colors.primary}
                  />
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Telegram channel info (read-only) */}
          <Surface padded style={{ gap: 10 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: `${colors.primary}22`,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="send" size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: colors.foreground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 14,
                  }}
                >
                  Same agent on Telegram
                </Text>
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  {liveBot?.username
                    ? `Chat your sites at @${liveBot.username}`
                    : liveBot
                      ? `Status: ${liveBot.status}`
                      : "Bringing the bot online…"}
                </Text>
              </View>
              {liveBot?.username ? (
                <Pressable
                  onPress={openTelegram}
                  style={({ pressed }) => ({
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: colors.primary,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <MonoText
                    style={{
                      color: colors.primary,
                      fontSize: 11,
                      letterSpacing: 1.2,
                    }}
                  >
                    OPEN
                  </MonoText>
                </Pressable>
              ) : null}
            </View>
            {liveBot?.lastError ? (
              <Text style={{ color: colors.destructive, fontSize: 11 }}>
                {liveBot.lastError}
              </Text>
            ) : null}
          </Surface>

          {/* Footer credit */}
          <View style={{ alignItems: "center", marginTop: 18, opacity: 0.6 }}>
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 10,
                letterSpacing: 1.6,
              }}
            >
              made with (kidderboy)
            </MonoText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
