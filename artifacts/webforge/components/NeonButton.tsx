import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useColors } from "@/hooks/useColors";

interface Props {
  title: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  icon?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function NeonButton({
  title,
  onPress,
  loading,
  disabled,
  variant = "primary",
  icon,
  fullWidth,
  style,
}: Props) {
  const colors = useColors();
  const isPrimary = variant === "primary";
  const isGhost = variant === "ghost";

  const handlePress = () => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress?.();
  };

  const content = (
    <View style={styles.row}>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={isPrimary ? colors.primaryForeground : colors.foreground}
        />
      ) : (
        <>
          {icon}
          <Text
            style={{
              fontFamily: "Inter_600SemiBold",
              fontSize: 16,
              color: isPrimary
                ? colors.primaryForeground
                : isGhost
                  ? colors.mutedForeground
                  : colors.foreground,
              letterSpacing: -0.2,
            }}
          >
            {title}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
          width: fullWidth ? "100%" : undefined,
        },
        style,
      ]}
    >
      {isPrimary ? (
        <LinearGradient
          colors={[colors.primary, colors.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.button,
            {
              shadowColor: colors.primary,
              shadowOpacity: 0.45,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 6 },
            },
          ]}
        >
          {content}
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.button,
            {
              backgroundColor: isGhost ? "transparent" : colors.cardElevated,
              borderWidth: isGhost ? 0 : 1,
              borderColor: colors.border,
            },
          ]}
        >
          {content}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
