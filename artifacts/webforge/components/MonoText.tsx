import { Platform, Text, type TextProps } from "react-native";

const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace",
});

export function MonoText({ style, ...rest }: TextProps) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: MONO, letterSpacing: 0 }, style]}
    />
  );
}
