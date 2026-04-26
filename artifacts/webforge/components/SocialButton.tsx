import { FontAwesome } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

type Provider = "google" | "facebook" | "apple" | "github";

const META: Record<
  Provider,
  { label: string; icon: keyof typeof FontAwesome.glyphMap; color: string }
> = {
  google: { label: "Continue with Google", icon: "google", color: "#FFFFFF" },
  facebook: {
    label: "Continue with Facebook",
    icon: "facebook",
    color: "#1877F2",
  },
  apple: { label: "Continue with Apple", icon: "apple", color: "#FFFFFF" },
  github: { label: "Continue with GitHub", icon: "github", color: "#FFFFFF" },
};

interface Props {
  provider: Provider;
  onPress: () => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
}

export function SocialButton({ provider, onPress, loading, disabled }: Props) {
  const colors = useColors();
  const meta = META[provider];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: colors.cardElevated,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}
    >
      <View style={styles.iconWrap}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : (
          <FontAwesome name={meta.icon} size={18} color={meta.color} />
        )}
      </View>
      <Text
        style={{
          flex: 1,
          textAlign: "center",
          color: colors.foreground,
          fontFamily: "Inter_600SemiBold",
          fontSize: 15,
        }}
      >
        {meta.label}
      </Text>
      <View style={styles.iconWrap} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  iconWrap: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
