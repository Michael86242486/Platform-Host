import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  getGetSiteQueryKey,
  useDeleteSite,
  useGetSite,
  useRegenerateSitePage,
  useRemoveSiteDomain,
  useRetrySite,
  useSetSiteDomain,
  useVerifySiteDomain,
  type Site,
  type SitePlanPage,
} from "@workspace/api-client-react";

import { MatrixRain } from "@/components/MatrixRain";
import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { Surface } from "@/components/Surface";
import { useColors } from "@/hooks/useColors";

export default function SiteDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();

  const siteQuery = useGetSite(String(id), {
    query: {
      queryKey: getGetSiteQueryKey(String(id)),
      refetchInterval: (q) => {
        const s = q.state.data as Site | undefined;
        if (!s) return 1500;
        return s.status === "ready" || s.status === "failed" ? false : 1200;
      },
    },
  });
  const retry = useRetrySite();
  const del = useDeleteSite();
  const setDomain = useSetSiteDomain();
  const removeDomain = useRemoveSiteDomain();
  const verifyDomain = useVerifySiteDomain();
  const regeneratePage = useRegenerateSitePage();
  const [regeneratingPath, setRegeneratingPath] = React.useState<string | null>(
    null,
  );

  const site = siteQuery.data as Site | undefined;

  const onShare = async () => {
    if (!site?.publicUrl) return;
    await Share.share({
      message: `${site.name}\n${site.publicUrl}`,
      url: site.publicUrl,
    });
  };

  const onCopy = async () => {
    if (!site?.publicUrl) return;
    await Clipboard.setStringAsync(site.publicUrl);
    void Haptics.selectionAsync();
    Alert.alert("Copied", "Link copied to clipboard.");
  };

  const onDelete = () => {
    if (!site) return;
    Alert.alert("Delete site?", `Delete "${site.name}"? This is permanent.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await del.mutateAsync({ id: site.id });
          router.back();
        },
      },
    ]);
  };

  const onRetry = async () => {
    if (!site) return;
    await retry.mutateAsync({ id: site.id });
    siteQuery.refetch();
  };

  const onRegeneratePage = async (page: SitePlanPage) => {
    if (!site || regeneratingPath) return;
    setRegeneratingPath(page.path);
    void Haptics.selectionAsync();
    try {
      await regeneratePage.mutateAsync({
        id: site.id,
        data: { path: page.path },
      });
      await siteQuery.refetch();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't regenerate page";
      Alert.alert("Regenerate failed", msg);
    } finally {
      setRegeneratingPath(null);
    }
  };

  const confirmRegenerate = (page: SitePlanPage) => {
    Alert.alert(
      "Regenerate this page?",
      `Re-render "${page.title}" (/${page.path}) from the deterministic template. Other pages and shared assets stay untouched.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Regenerate",
          style: "default",
          onPress: () => void onRegeneratePage(page),
        },
      ],
    );
  };

  if (!site) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const isWorking =
    site.status === "queued" ||
    site.status === "analyzing" ||
    site.status === "building" ||
    site.status === "awaiting_confirmation";
  const accent = site.coverColor || colors.primary;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 12,
            paddingVertical: 8,
            justifyContent: "space-between",
          }}
        >
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({
              padding: 10,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="chevron-left" size={26} color={colors.foreground} />
          </Pressable>
          <Pressable
            onPress={onDelete}
            style={({ pressed }) => ({
              padding: 10,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="trash-2" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        >
          <View style={{ marginBottom: 16 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor:
                    site.status === "ready"
                      ? colors.success
                      : site.status === "failed"
                        ? colors.destructive
                        : accent,
                  shadowColor: accent,
                  shadowOpacity: 0.7,
                  shadowRadius: 6,
                }}
              />
              <MonoText
                style={{
                  color:
                    site.status === "ready"
                      ? colors.success
                      : site.status === "failed"
                        ? colors.destructive
                        : accent,
                  fontSize: 11,
                  letterSpacing: 1.4,
                  fontWeight: "700",
                }}
              >
                {site.status.toUpperCase()}
              </MonoText>
            </View>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 30,
                fontFamily: "Inter_700Bold",
                letterSpacing: -0.8,
              }}
            >
              {site.name}
            </Text>
            <MonoText
              numberOfLines={1}
              style={{
                color: colors.mutedForeground,
                fontSize: 13,
                marginTop: 4,
              }}
            >
              /{site.slug}
            </MonoText>
          </View>

          <PreviewCard
            site={site}
            width={width - 40}
            onShare={onShare}
            onCopy={onCopy}
            onRetry={onRetry}
          />

          <Surface padded style={{ marginTop: 16, gap: 8 }}>
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: "uppercase",
              }}
            >
              Prompt
            </MonoText>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 14,
                lineHeight: 21,
              }}
            >
              {site.prompt}
            </Text>
          </Surface>

          <DomainSection
            site={site}
            onSet={async (domain) => {
              await setDomain.mutateAsync({ id: site.id, data: { domain } });
              await siteQuery.refetch();
            }}
            onVerify={async () => {
              await verifyDomain.mutateAsync({ id: site.id });
              await siteQuery.refetch();
            }}
            onRemove={async () => {
              await removeDomain.mutateAsync({ id: site.id });
              await siteQuery.refetch();
            }}
            isBusy={
              setDomain.isPending ||
              removeDomain.isPending ||
              verifyDomain.isPending
            }
          />

          {isWorking ? (
            <Surface padded style={{ marginTop: 16, gap: 10 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
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
                  Build log
                </MonoText>
                <MonoText style={{ color: accent, fontSize: 12 }}>
                  {site.progress}%
                </MonoText>
              </View>
              <View
                style={{
                  height: 4,
                  backgroundColor: colors.border,
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    width: `${Math.max(2, site.progress)}%`,
                    backgroundColor: accent,
                    height: "100%",
                  }}
                />
              </View>
              <MonoText
                style={{
                  color: colors.foreground,
                  fontSize: 13,
                }}
              >
                {">_ "} {site.message ?? "starting…"}
              </MonoText>
            </Surface>
          ) : null}

          {site.plan && site.plan.pages.length > 0 ? (
            <PagesSection
              pages={site.plan.pages}
              accent={accent}
              regeneratingPath={regeneratingPath}
              onRegenerate={confirmRegenerate}
              disabled={isWorking}
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function PreviewCard({
  site,
  width,
  onShare,
  onCopy,
  onRetry,
}: {
  site: Site;
  width: number;
  onShare: () => void;
  onCopy: () => void;
  onRetry: () => void;
}) {
  const colors = useColors();
  const accent = site.coverColor || colors.primary;
  const aspect = 0.62;
  const height = width * aspect;

  return (
    <View
      style={{
        width,
        height,
        borderRadius: 20,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
      }}
    >
      <View style={StyleSheet.absoluteFill}>
        <FakeBrowser site={site} accent={accent} />
      </View>

      {site.status !== "ready" ? (
        <BlurOverlay site={site} accent={accent} onRetry={onRetry} />
      ) : (
        <View
          style={{
            position: "absolute",
            bottom: 12,
            right: 12,
            flexDirection: "row",
            gap: 8,
          }}
        >
          <SmallActionButton icon="copy" onPress={onCopy} />
          <SmallActionButton icon="share-2" onPress={onShare} />
        </View>
      )}
    </View>
  );
}

function SmallActionButton({
  icon,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.cardElevated,
        borderColor: colors.border,
        borderWidth: 1,
        padding: 10,
        borderRadius: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Feather name={icon} size={16} color={colors.foreground} />
    </Pressable>
  );
}

function FakeBrowser({
  site,
  accent,
}: {
  site: Site;
  accent: string;
}) {
  const colors = useColors();
  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={[`${accent}33`, "#000"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: "#0008",
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
        }}
      >
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <View
            key={c}
            style={{
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: c,
            }}
          />
        ))}
        <View
          style={{
            flex: 1,
            backgroundColor: "#0006",
            marginLeft: 10,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
          }}
        >
          <MonoText
            numberOfLines={1}
            style={{ color: "#fff8", fontSize: 10 }}
          >
            {site.publicUrl ?? `webforge.app/${site.slug}`}
          </MonoText>
        </View>
      </View>
      <View
        style={{
          flex: 1,
          padding: 14,
          justifyContent: "center",
          alignItems: "center",
          gap: 10,
        }}
      >
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: `${accent}77`,
          }}
        >
          <MonoText
            style={{ color: accent, fontSize: 9, letterSpacing: 1.4 }}
          >
            ● LIVE
          </MonoText>
        </View>
        <Text
          numberOfLines={2}
          style={{
            color: "#fff",
            fontFamily: "Inter_700Bold",
            fontSize: 22,
            letterSpacing: -0.5,
            textAlign: "center",
          }}
        >
          {site.name}
        </Text>
        <View
          style={{
            backgroundColor: accent,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 10,
          }}
        >
          <Text
            style={{
              color: "#000",
              fontFamily: "Inter_700Bold",
              fontSize: 12,
            }}
          >
            Get started →
          </Text>
        </View>
      </View>
    </View>
  );
}

function BlurOverlay({
  site,
  accent,
  onRetry,
}: {
  site: Site;
  accent: string;
  onRetry: () => void;
}) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "#0007" }]}>
      <View style={StyleSheet.absoluteFill}>
        <MatrixRain width={width - 40} height={300} intensity={0.4} />
      </View>
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: "#000A",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            gap: 14,
          },
        ]}
      >
        {site.status === "failed" ? (
          <>
            <Feather name="alert-triangle" size={32} color={colors.destructive} />
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 18,
                textAlign: "center",
              }}
            >
              Build failed
            </Text>
            {site.error ? (
              <MonoText
                style={{
                  color: colors.mutedForeground,
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                {site.error}
              </MonoText>
            ) : null}
            <NeonButton
              title="Retry build"
              onPress={onRetry}
              icon={
                <Feather name="refresh-cw" size={16} color={colors.primaryForeground} />
              }
            />
          </>
        ) : (
          <>
            <Animated.View style={{ opacity }}>
              <MonoText
                style={{
                  color: accent,
                  fontSize: 11,
                  letterSpacing: 1.6,
                  fontWeight: "700",
                }}
              >
                ● GENERATING
              </MonoText>
            </Animated.View>
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 22,
                letterSpacing: -0.5,
                textAlign: "center",
              }}
            >
              Forging your site
            </Text>
            <View
              style={{
                width: "80%",
                height: 4,
                backgroundColor: "#fff1",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: `${Math.max(3, site.progress)}%`,
                  backgroundColor: accent,
                  height: "100%",
                }}
              />
            </View>
            <MonoText
              style={{
                color: colors.mutedForeground,
                fontSize: 12,
              }}
            >
              {site.message ?? "warming up…"}
            </MonoText>
          </>
        )}
      </View>
    </View>
  );
}

function DomainSection({
  site,
  onSet,
  onVerify,
  onRemove,
  isBusy,
}: {
  site: Site;
  onSet: (domain: string) => Promise<void>;
  onVerify: () => Promise<void>;
  onRemove: () => Promise<void>;
  isBusy: boolean;
}) {
  const colors = useColors();
  const [input, setInput] = React.useState("");
  const status = site.customDomainStatus;

  const onAttach = async () => {
    const cleaned = input.trim().toLowerCase().replace(/^https?:\/\//, "");
    if (cleaned.length < 3) {
      Alert.alert("Invalid domain", "Enter something like mysite.com");
      return;
    }
    try {
      await onSet(cleaned);
      setInput("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to attach domain";
      Alert.alert("Couldn't attach", msg);
    }
  };

  const onVerifyPress = async () => {
    try {
      await onVerify();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      Alert.alert("Verification failed", msg);
    }
  };

  const onCopyValue = async (value: string) => {
    await Clipboard.setStringAsync(value);
    void Haptics.selectionAsync();
  };

  const statusColor =
    status === "verified"
      ? colors.success
      : status === "failed"
        ? colors.destructive
        : colors.primary;

  return (
    <Surface padded style={{ marginTop: 16, gap: 12 }}>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <Feather name="globe" size={14} color={colors.mutedForeground} />
        <MonoText
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: "uppercase",
          }}
        >
          Custom domain
        </MonoText>
      </View>

      {site.customDomain ? (
        <>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 18,
                letterSpacing: -0.4,
              }}
            >
              {site.customDomain}
            </Text>
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: `${statusColor}77`,
              }}
            >
              <MonoText
                style={{
                  color: statusColor,
                  fontSize: 10,
                  letterSpacing: 1.4,
                  fontWeight: "700",
                }}
              >
                ● {(status ?? "pending").toUpperCase()}
              </MonoText>
            </View>
          </View>

          {status !== "verified" ? (
            <View style={{ gap: 10 }}>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 13,
                  lineHeight: 19,
                }}
              >
                Add these DNS records at your registrar, then tap{" "}
                <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                  Verify
                </Text>
                .
              </Text>

              <DnsRow
                label="CNAME"
                name={site.customDomain}
                value={site.customDomainTarget ?? ""}
                onCopy={() => onCopyValue(site.customDomainTarget ?? "")}
              />
              <DnsRow
                label="TXT"
                name={site.customDomainTxtName ?? ""}
                value={site.customDomainTxtValue ?? ""}
                onCopy={() => onCopyValue(site.customDomainTxtValue ?? "")}
              />

              {site.customDomainError ? (
                <MonoText
                  style={{
                    color: colors.destructive,
                    fontSize: 12,
                  }}
                >
                  {site.customDomainError}
                </MonoText>
              ) : null}
            </View>
          ) : (
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 13,
                lineHeight: 19,
              }}
            >
              Live at{" "}
              <Text style={{ color: colors.primary, fontWeight: "700" }}>
                https://{site.customDomain}
              </Text>
            </Text>
          )}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            {status !== "verified" ? (
              <NeonButton
                title={isBusy ? "Verifying…" : "Verify domain"}
                onPress={onVerifyPress}
                icon={
                  <Feather name="check" size={16} color={colors.primaryForeground} />
                }
              />
            ) : null}
            <Pressable
              onPress={() => {
                Alert.alert("Remove domain?", `Detach ${site.customDomain}?`, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Remove",
                    style: "destructive",
                    onPress: () => {
                      void onRemove();
                    },
                  },
                ]);
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.cardElevated,
                opacity: pressed ? 0.7 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              })}
            >
              <Feather name="x" size={14} color={colors.mutedForeground} />
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 13,
                  fontWeight: "600",
                }}
              >
                Remove
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            Host this site on your own domain. Point a CNAME at our edge and add
            a TXT record to prove ownership.
          </Text>
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              alignItems: "center",
            }}
          >
            <View
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: colors.cardElevated,
              }}
            >
              <MonoTextInput
                value={input}
                onChangeText={setInput}
                placeholder="mysite.com"
              />
            </View>
            <NeonButton
              title={isBusy ? "Adding…" : "Attach"}
              onPress={onAttach}
              icon={<Feather name="link" size={16} color={colors.primaryForeground} />}
            />
          </View>
        </>
      )}
    </Surface>
  );
}

function DnsRow({
  label,
  name,
  value,
  onCopy,
}: {
  label: string;
  name: string;
  value: string;
  onCopy: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        padding: 10,
        backgroundColor: colors.cardElevated,
        gap: 4,
      }}
    >
      <View
        style={{ flexDirection: "row", justifyContent: "space-between" }}
      >
        <MonoText
          style={{
            color: colors.primary,
            fontSize: 10,
            letterSpacing: 1.6,
            fontWeight: "700",
          }}
        >
          {label}
        </MonoText>
        <Pressable onPress={onCopy} hitSlop={8}>
          <Feather name="copy" size={12} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <MonoText
        numberOfLines={1}
        style={{ color: colors.mutedForeground, fontSize: 11 }}
      >
        Name: <Text style={{ color: colors.foreground }}>{name}</Text>
      </MonoText>
      <MonoText
        numberOfLines={1}
        style={{ color: colors.mutedForeground, fontSize: 11 }}
      >
        Value: <Text style={{ color: colors.foreground }}>{value}</Text>
      </MonoText>
    </View>
  );
}

function MonoTextInput(props: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder?: string;
}) {
  const colors = useColors();
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={colors.mutedForeground}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      style={{
        color: colors.foreground,
        fontFamily: "JetBrainsMono_400Regular",
        fontSize: 14,
        padding: 0,
      }}
    />
  );
}

function PagesSection({
  pages,
  accent,
  regeneratingPath,
  onRegenerate,
  disabled,
}: {
  pages: SitePlanPage[];
  accent: string;
  regeneratingPath: string | null;
  onRegenerate: (page: SitePlanPage) => void;
  disabled: boolean;
}) {
  const colors = useColors();
  return (
    <Surface padded style={{ marginTop: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Feather name="file-text" size={14} color={colors.mutedForeground} />
        <MonoText
          style={{
            color: colors.mutedForeground,
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: "uppercase",
          }}
        >
          Pages
        </MonoText>
      </View>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 12,
          lineHeight: 18,
        }}
      >
        Tap a page to re-render it from the deterministic template. Useful when
        a single page came out broken — leaves the rest of the site untouched.
      </Text>
      <View style={{ gap: 8 }}>
        {pages.map((page) => {
          const busy = regeneratingPath === page.path;
          const isDisabled = disabled || (regeneratingPath !== null && !busy);
          return (
            <Pressable
              key={page.path}
              onPress={() => onRegenerate(page)}
              disabled={isDisabled}
              accessibilityRole="button"
              accessibilityLabel={`Regenerate ${page.title}`}
              style={({ pressed, focused }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: focused ? accent : colors.border,
                backgroundColor: colors.cardElevated,
                opacity: pressed ? 0.7 : isDisabled && !busy ? 0.4 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.foreground,
                    fontSize: 14,
                    fontFamily: "Inter_700Bold",
                    letterSpacing: -0.2,
                  }}
                >
                  {page.title}
                </Text>
                <MonoText
                  numberOfLines={1}
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 11,
                  }}
                >
                  /{page.path}
                </MonoText>
              </View>
              {busy ? (
                <ActivityIndicator size="small" color={accent} />
              ) : (
                <Feather name="refresh-cw" size={16} color={accent} />
              )}
            </Pressable>
          );
        })}
      </View>
    </Surface>
  );
}
