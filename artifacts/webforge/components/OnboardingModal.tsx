import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Brand } from "@/components/Brand";
import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { useColors } from "@/hooks/useColors";

const OPTIONS = [
  {
    id: "clients",
    icon: "💼",
    label: "Client work",
    desc: "Ship sites for clients fast",
  },
  {
    id: "personal",
    icon: "🚀",
    label: "Personal projects",
    desc: "Build things I care about",
  },
  {
    id: "prototype",
    icon: "⚡",
    label: "Quick prototypes",
    desc: "Validate ideas in minutes",
  },
  {
    id: "business",
    icon: "📈",
    label: "Side business",
    desc: "Launch a product or startup",
  },
  {
    id: "learning",
    icon: "🧪",
    label: "Experimenting",
    desc: "Learn & explore AI building",
  },
  {
    id: "agency",
    icon: "🏢",
    label: "Agency / team",
    desc: "Scale web delivery for a team",
  },
];

interface Props {
  visible: boolean;
  onDone: (choice: string) => void;
}

export function OnboardingModal({ visible, onDone }: Props) {
  const colors = useColors();
  const [selected, setSelected] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(60)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 340,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 68,
          friction: 11,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      slideAnim.setValue(60);
      setSelected(null);
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
    >
      <View style={[styles.overlay, { backgroundColor: "rgba(10,14,20,0.92)" }]}>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.header}>
            <Brand size={36} />
            <Text
              style={[
                styles.title,
                { color: colors.foreground, fontFamily: "Inter_700Bold" },
              ]}
            >
              Welcome to WebForge
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              What will you mainly use it for?
            </Text>
            <MonoText
              style={[styles.hint, { color: colors.primary }]}
            >
              {"// pick one to personalise your experience"}
            </MonoText>
          </View>

          <View style={styles.grid}>
            {OPTIONS.map((opt) => {
              const isSelected = selected === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => setSelected(opt.id)}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: isSelected
                        ? colors.primary + "18"
                        : colors.cardElevated,
                      borderColor: isSelected ? colors.primary : colors.border,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text style={styles.optionIcon}>{opt.icon}</Text>
                  <Text
                    style={[
                      styles.optionLabel,
                      {
                        color: isSelected ? colors.primary : colors.foreground,
                        fontFamily: "Inter_600SemiBold",
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <Text
                    style={[
                      styles.optionDesc,
                      { color: colors.mutedForeground },
                    ]}
                    numberOfLines={1}
                  >
                    {opt.desc}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.footer}>
            <NeonButton
              title="Get started →"
              onPress={() => selected && onDone(selected)}
              disabled={!selected}
              fullWidth
            />
            <Pressable onPress={() => onDone("skip")} style={styles.skip}>
              <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
                {"// skip for now"}
              </MonoText>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingBottom: 40,
    paddingTop: 28,
    paddingHorizontal: 20,
    gap: 20,
  },
  header: {
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 26,
    letterSpacing: -0.8,
    marginTop: 4,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  hint: {
    fontSize: 11,
    letterSpacing: 1.2,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  option: {
    width: "47%",
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    gap: 4,
  },
  optionIcon: {
    fontSize: 22,
  },
  optionLabel: {
    fontSize: 14,
    letterSpacing: -0.2,
    marginTop: 2,
  },
  optionDesc: {
    fontSize: 11,
    lineHeight: 15,
  },
  footer: {
    gap: 12,
    marginTop: 4,
  },
  skip: {
    alignItems: "center",
    paddingVertical: 4,
  },
});
