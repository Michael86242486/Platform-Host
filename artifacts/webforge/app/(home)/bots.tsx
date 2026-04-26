import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Alert,
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
  useHostBot,
  useListBots,
  useStopBot,
} from "@workspace/api-client-react";

import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { Surface } from "@/components/Surface";
import { useColors } from "@/hooks/useColors";

export default function BotsScreen() {
  const colors = useColors();
  const [token, setToken] = useState("");
  const [showInput, setShowInput] = useState(false);

  const botsQuery = useListBots({
    query: { queryKey: getListBotsQueryKey(), refetchInterval: 4000 },
  });
  const hostMutation = useHostBot();
  const stopMutation = useStopBot();

  const bots = botsQuery.data ?? [];

  const onHost = async () => {
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token.trim())) {
      Alert.alert(
        "Invalid token",
        "That doesn't look like a Telegram bot token. Get one from @BotFather.",
      );
      return;
    }
    try {
      await hostMutation.mutateAsync({ data: { token: token.trim() } });
      setToken("");
      setShowInput(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      botsQuery.refetch();
    } catch (e) {
      Alert.alert("Could not host bot", e instanceof Error ? e.message : "Error");
    }
  };

  const onStop = (id: string, label: string) => {
    Alert.alert("Stop bot?", `Stop hosting @${label}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Stop",
        style: "destructive",
        onPress: async () => {
          await stopMutation.mutateAsync({ id });
          botsQuery.refetch();
        },
      },
    ]);
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
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <View style={{ marginBottom: 16 }}>
            <MonoText
              style={{
                color: colors.primary,
                fontSize: 11,
                letterSpacing: 1.4,
              }}
            >
              {">_ telegram bots"}
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
              Bots
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 14,
                marginTop: 6,
              }}
            >
              Host your own Telegram bots that build sites for you and your
              users — straight from chat.
            </Text>
          </View>

          {showInput ? (
            <Surface padded style={{ marginBottom: 20, gap: 12 }}>
              <MonoText
                style={{
                  color: colors.mutedForeground,
                  fontSize: 11,
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                }}
              >
                Bot token
              </MonoText>
              <TextInput
                value={token}
                onChangeText={setToken}
                placeholder="123456789:ABCdef..."
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  color: colors.foreground,
                  fontFamily: Platform.select({
                    ios: "Menlo",
                    default: "monospace",
                  }),
                  fontSize: 13,
                }}
              />
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 12,
                }}
              >
                Get a token from @BotFather on Telegram. Your bot keeps
                running 24/7 in our hosting layer.
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <NeonButton
                  title="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setShowInput(false);
                    setToken("");
                  }}
                  style={{ flex: 1 }}
                />
                <NeonButton
                  title="Host bot"
                  onPress={onHost}
                  loading={hostMutation.isPending}
                  disabled={!token}
                  style={{ flex: 1.4 }}
                />
              </View>
            </Surface>
          ) : (
            <NeonButton
              title="🤖  Host a new bot"
              onPress={() => setShowInput(true)}
              fullWidth
              style={{ marginBottom: 20 }}
            />
          )}

          <View style={{ gap: 12 }}>
            {bots.length === 0 ? (
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
                <Feather name="send" size={22} color={colors.primary} />
                <Text
                  style={{
                    color: colors.foreground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 15,
                  }}
                >
                  No bots hosted
                </Text>
                <Text
                  style={{
                    color: colors.mutedForeground,
                    textAlign: "center",
                    fontSize: 13,
                  }}
                >
                  Add your first one above. Try /create on it once it's live.
                </Text>
              </View>
            ) : (
              bots.map((b) => (
                <Surface key={b.id} padded>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <View style={{ flex: 1, gap: 6 }}>
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
                            backgroundColor:
                              b.status === "active"
                                ? colors.success
                                : b.status === "error"
                                  ? colors.destructive
                                  : colors.mutedForeground,
                            shadowColor:
                              b.status === "active"
                                ? colors.success
                                : "transparent",
                            shadowOpacity: 0.7,
                            shadowRadius: 6,
                          }}
                        />
                        <Text
                          style={{
                            color: colors.foreground,
                            fontSize: 17,
                            fontFamily: "Inter_700Bold",
                            letterSpacing: -0.3,
                          }}
                        >
                          @{b.username ?? "pending"}
                        </Text>
                      </View>
                      <MonoText
                        style={{
                          color: colors.mutedForeground,
                          fontSize: 12,
                        }}
                      >
                        {b.tokenPreview}
                      </MonoText>
                      {b.lastError ? (
                        <Text
                          style={{
                            color: colors.destructive,
                            fontSize: 12,
                          }}
                        >
                          {b.lastError}
                        </Text>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() =>
                        onStop(b.id, b.username ?? b.tokenPreview)
                      }
                      style={({ pressed }) => ({
                        padding: 8,
                        borderRadius: 8,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Feather
                        name="trash-2"
                        size={18}
                        color={colors.destructive}
                      />
                    </Pressable>
                  </View>
                </Surface>
              ))
            )}
          </View>

          <View style={{ marginTop: 28, gap: 8 }}>
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: "uppercase",
              }}
            >
              {">_ supported commands"}
            </MonoText>
            {[
              "/create — build a new site",
              "/edit — edit a site",
              "/status — check progress",
              "/preview — get the live link",
              "/mysites — list your sites",
              "/retry — retry a failed build",
              "/delete — delete a site",
              "/tasks /queue — see jobs",
              "/hostbot — host another bot",
              "/mybots — list hosted bots",
              "/stopbot — stop hosting a bot",
            ].map((line) => (
              <MonoText
                key={line}
                style={{
                  color: colors.foreground,
                  fontSize: 13,
                  lineHeight: 20,
                }}
              >
                {line}
              </MonoText>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
