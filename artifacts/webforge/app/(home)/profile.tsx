import { Feather } from "@expo/vector-icons";

import { useAuth, useUser } from "@/lib/auth";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Brand } from "@/components/Brand";
import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { Surface } from "@/components/Surface";
import { useColors } from "@/hooks/useColors";

export default function ProfileScreen() {
  const colors = useColors();
  const { signOut, updateUser } = useAuth();
  const { user } = useUser();
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName]   = useState(user?.lastName ?? "");
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setFirstName(user?.firstName ?? "");
      setLastName(user?.lastName ?? "");
      setSaveError(null);
    }
  }, [editing, user]);

  const onSignOut = async () => {
    await signOut();
    router.replace("/(auth)/sign-in");
  };

  const onSave = async () => {
    setSaving(true);
    setSaveError(null);
    const result = await updateUser({ firstName, lastName });
    setSaving(false);
    if (result.ok) {
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        setEditing(false);
      }, 1200);
    } else {
      setSaveError(result.error);
    }
  };

  const email = user?.email ?? undefined;
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    email ||
    "developer";

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>

        {/* Avatar + name */}
        <View style={{ alignItems: "center", gap: 14, marginBottom: 28 }}>
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
              {displayName}
            </Text>
            {email ? (
              <MonoText style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {email}
              </MonoText>
            ) : null}
          </View>
        </View>

        {/* Edit name card */}
        <Surface padded style={{ marginBottom: 16, gap: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: "uppercase",
              }}
            >
              Profile
            </MonoText>
            {!editing && (
              <Pressable
                onPress={() => setEditing(true)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Feather name="edit-2" size={13} color={colors.primary} />
                <MonoText style={{ color: colors.primary, fontSize: 11, letterSpacing: 1 }}>
                  EDIT
                </MonoText>
              </Pressable>
            )}
          </View>

          {editing ? (
            <View style={{ gap: 10 }}>
              <View style={{ gap: 6 }}>
                <MonoText style={{ color: colors.mutedForeground, fontSize: 11, letterSpacing: 1 }}>
                  FIRST NAME
                </MonoText>
                <TextInput
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First name"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                  returnKeyType="next"
                  style={{
                    backgroundColor: colors.cardElevated,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 11,
                    color: colors.foreground,
                    fontFamily: "Inter_500Medium",
                    fontSize: 15,
                  }}
                />
              </View>
              <View style={{ gap: 6 }}>
                <MonoText style={{ color: colors.mutedForeground, fontSize: 11, letterSpacing: 1 }}>
                  LAST NAME
                </MonoText>
                <TextInput
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last name"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={onSave}
                  style={{
                    backgroundColor: colors.cardElevated,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 11,
                    color: colors.foreground,
                    fontFamily: "Inter_500Medium",
                    fontSize: 15,
                  }}
                />
              </View>

              {saveError ? (
                <Text style={{ color: colors.destructive, fontSize: 12 }}>
                  {saveError}
                </Text>
              ) : null}

              <View style={{ flexDirection: "row", gap: 10, marginTop: 2 }}>
                <Pressable
                  onPress={() => setEditing(false)}
                  style={({ pressed }) => ({
                    flex: 1,
                    alignItems: "center",
                    paddingVertical: 11,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.cardElevated,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onSave}
                  disabled={saving}
                  style={({ pressed }) => ({
                    flex: 2,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingVertical: 11,
                    borderRadius: 10,
                    backgroundColor: saved ? colors.success : colors.primary,
                    opacity: pressed || saving ? 0.7 : 1,
                    flexDirection: "row",
                    gap: 6,
                  })}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={{ color: "#000", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                      {saved ? "✓ Saved" : "Save name"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <NameRow label="First name" value={user?.firstName} colors={colors} />
              <NameRow label="Last name"  value={user?.lastName}  colors={colors} />
              <NameRow label="Email"      value={user?.email}     colors={colors} mono />
            </View>
          )}
        </Surface>

        {/* About */}
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
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
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

function NameRow({
  label,
  value,
  colors,
  mono = false,
}: {
  label: string;
  value?: string | null;
  colors: ReturnType<typeof useColors>;
  mono?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <MonoText style={{ color: colors.mutedForeground, fontSize: 12 }}>
        {label}
      </MonoText>
      {mono ? (
        <MonoText style={{ color: colors.foreground, fontSize: 13 }}>
          {value ?? "—"}
        </MonoText>
      ) : (
        <Text style={{ color: value ? colors.foreground : colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
          {value ?? "—"}
        </Text>
      )}
    </View>
  );
}
