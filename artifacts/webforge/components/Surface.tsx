import { View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

import { useColors } from "@/hooks/useColors";

interface Props extends ViewProps {
  elevated?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Surface({
  elevated,
  padded,
  style,
  children,
  ...rest
}: Props) {
  const colors = useColors();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: elevated ? colors.cardElevated : colors.card,
          borderRadius: colors.radius,
          borderWidth: 1,
          borderColor: colors.border,
          padding: padded ? 16 : 0,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
