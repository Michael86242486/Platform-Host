import { Feather } from "@expo/vector-icons";

import { useAuth, useUser } from "@/lib/auth";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Brand } from "@/components/Brand";
import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { Surface } from "@/components/Surface";
import { useColors } from "@/hooks/useColors";

export default function ProfileScreen() {
  const colors = useColors();
  const { signOut } = useAuth();
  const { user } = useUser();
  const router = useRouter();

  const onSignOut = async () => {
    await signOut();
    router.replace("/(auth)/sign-in");
  };

  const email = user?.email ?? undefined;
  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    email ||
    "developer";

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View
          style={{
            alignItems: "center",
            gap: 14,
            marginBottom: 28,
          }}
        >
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              borderWidth: 2,
              borderColor: colors.primary,
              padding: 3,
              shadowColor: colors.primary,
              shadowOpacity: 0.5,
              shadowRadius: 16,
            }}
          >
            {user?.imageUrl ? (
              <Image
                source={{ uri: user.imageUrl }}
                style={{ flex: 1, borderRadius: 40 }}
                contentFit="cover"
              />
            ) : (
              <View
                style={{
                  flex: 1,
                  borderRadius: 40,
                  backgroundColor: colors.cardElevated,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="user" size={32} color={colors.primary} />
              </View>
            )}
          </View>
          <View style={{ alignItems: "center", gap: 4 }}>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 22,
                fontFamily: "Inter_700Bold",
                letterSpacing: -0.4,
              }}
            >
              {name}
            </Text>
            {email ? (
              <MonoText
                style={{ color: colors.mutedForeground, fontSize: 13 }}
              >
                {email}
              </MonoText>
            ) : null}
          </View>
        </View>

        <Surface padded style={{ marginBottom: 16, gap: 12 }}>
          <MonoText
            style={{
              color: colors.mutedForeground,
              fontSize: 11,
              letterSpacing: 1.4,
              textTransform: "uppercase",
            }}
          >
            About WebForge
          </MonoText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Brand size={28} showWordmark={false} />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 15,
                }}
              >
                v1.0
              </Text>
              <Text
                style={{ color: colors.mutedForeground, fontSize: 12 }}
              >
                Forge sites from a single prompt.
              </Text>
            </View>
          </View>
        </Surface>

        <NeonButton
          title="Sign out"
          variant="secondary"
          onPress={onSignOut}
          fullWidth
          icon={<Feather name="log-out" size={16} color={colors.foreground} />}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
