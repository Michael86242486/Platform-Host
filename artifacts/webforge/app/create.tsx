import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
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

import { useCreateSite } from "@workspace/api-client-react";

import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { useColors } from "@/hooks/useColors";

const SUGGESTIONS = [
  "A coffee shop landing page in warm sunset colors",
  "A portfolio for an indie game developer",
  "A barbershop site with online booking",
  "A community newsletter signup page",
  "A neon dev portfolio with terminal vibes",
];

export default function CreateScreen() {
  const colors = useColors();
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const create = useCreateSite();

  const onSubmit = async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 4) return;
    try {
      const site = await create.mutateAsync({
        data: { prompt: trimmed, name: null },
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/site/${site.id}`);
    } catch (e) {
      Alert.alert(
        "Could not start build",
        e instanceof Error ? e.message : "Unknown error",
      );
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 8,
          justifyContent: "space-between",
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            padding: 8,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="x" size={24} color={colors.mutedForeground} />
        </Pressable>
        <MonoText
          style={{
            color: colors.primary,
            fontSize: 11,
            letterSpacing: 1.4,
          }}
        >
          {">_ new site"}
        </MonoText>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            padding: 20,
            paddingBottom: 40,
            gap: 16,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 6 }}>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 30,
                fontFamily: "Inter_700Bold",
                letterSpacing: -0.8,
              }}
            >
              What should we forge?
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 14,
                lineHeight: 20,
              }}
            >
              Describe the site you want — a sentence is enough. We'll pick the
              palette, layout, and copy.
            </Text>
          </View>

          <View
            style={{
              backgroundColor: colors.cardElevated,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 16,
              padding: 14,
            }}
          >
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="e.g. A minimal photographer portfolio with a dark hero…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              autoFocus
              style={{
                color: colors.foreground,
                fontFamily: "Inter_500Medium",
                fontSize: 16,
                minHeight: 120,
                textAlignVertical: "top",
              }}
            />
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 8,
              }}
            >
              <MonoText
                style={{
                  color:
                    prompt.length > 800
                      ? colors.warning
                      : colors.mutedForeground,
                  fontSize: 11,
                }}
              >
                {prompt.length}/1000
              </MonoText>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Feather name="zap" size={12} color={colors.primary} />
                <MonoText
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 11,
                    letterSpacing: 1.2,
                  }}
                >
                  ~5s build
                </MonoText>
              </View>
            </View>
          </View>

          <NeonButton
            title="✨ Forge it"
            onPress={onSubmit}
            loading={create.isPending}
            disabled={prompt.trim().length < 4}
            fullWidth
          />

          <View style={{ marginTop: 20, gap: 10 }}>
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: "uppercase",
              }}
            >
              Try one of these
            </MonoText>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setPrompt(s)}
                style={({ pressed }) => ({
                  padding: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  opacity: pressed ? 0.85 : 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                })}
              >
                <Feather name="arrow-up-right" size={16} color={colors.primary} />
                <Text
                  style={{
                    color: colors.foreground,
                    fontSize: 14,
                    flex: 1,
                  }}
                >
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
