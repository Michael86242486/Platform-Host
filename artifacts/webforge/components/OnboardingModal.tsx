import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Brand } from "@/components/Brand";
import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { useColors } from "@/hooks/useColors";

const OPTIONS = [
  { id: "clients",   icon: "💼", label: "Client work",       desc: "Ship sites for clients fast"     },
  { id: "personal",  icon: "🚀", label: "Personal projects",  desc: "Build things I care about"       },
  { id: "prototype", icon: "⚡", label: "Quick prototypes",   desc: "Validate ideas in minutes"       },
  { id: "business",  icon: "📈", label: "Side business",      desc: "Launch a product or startup"     },
  { id: "learning",  icon: "🧪", label: "Experimenting",      desc: "Learn & explore AI building"     },
  { id: "agency",    icon: "🏢", label: "Agency / team",      desc: "Scale web delivery for a team"   },
];

interface Props {
  visible: boolean;
  onDone: (name: string, choice: string) => void;
}

export function OnboardingModal({ visible, onDone }: Props) {
  const colors = useColors();
  const [step, setStep] = useState<1 | 2>(1);
  const [firstName, setFirstName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(60)).current;
  const stepFade  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 340, useNativeDriver: false }),
        Animated.spring(slideAnim, { toValue: 0, tension: 68, friction: 11, useNativeDriver: false }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      slideAnim.setValue(60);
      stepFade.setValue(1);
      setStep(1);
      setFirstName("");
      setSelected(null);
      setSaving(false);
    }
  }, [visible]);

  const advanceToStep2 = () => {
    Animated.timing(stepFade, { toValue: 0, duration: 160, useNativeDriver: false }).start(() => {
      setStep(2);
      Animated.timing(stepFade, { toValue: 1, duration: 200, useNativeDriver: false }).start();
    });
  };

  const handleFinish = async () => {
    if (!selected) return;
    setSaving(true);
    onDone(firstName.trim(), selected);
  };

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
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
            <Brand size={34} />
            <View style={styles.stepDots}>
              {[1, 2].map((n) => (
                <View
                  key={n}
                  style={[
                    styles.dot,
                    {
                      backgroundColor: step >= n ? colors.primary : colors.border,
                      width: step === n ? 18 : 7,
                    },
                  ]}
                />
              ))}
            </View>
          </View>

          <Animated.View style={{ opacity: stepFade, gap: 20 }}>
            {step === 1 ? (
              <Step1
                firstName={firstName}
                setFirstName={setFirstName}
                onNext={advanceToStep2}
                colors={colors}
              />
            ) : (
              <Step2
                selected={selected}
                setSelected={setSelected}
                firstName={firstName.trim()}
                onFinish={handleFinish}
                saving={saving}
                colors={colors}
              />
            )}
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Step1({
  firstName,
  setFirstName,
  onNext,
  colors,
}: {
  firstName: string;
  setFirstName: (v: string) => void;
  onNext: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <>
      <View style={styles.textBlock}>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          Welcome to WebForge
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          What should we call you?
        </Text>
        <MonoText style={[styles.hint, { color: colors.primary }]}>
          {"// first name is enough"}
        </MonoText>
      </View>

      <TextInput
        value={firstName}
        onChangeText={setFirstName}
        placeholder="e.g. Alex"
        placeholderTextColor={colors.mutedForeground}
        autoFocus
        autoCapitalize="words"
        returnKeyType="next"
        onSubmitEditing={() => firstName.trim() && onNext()}
        style={[
          styles.nameInput,
          {
            backgroundColor: colors.cardElevated,
            borderColor: firstName.trim() ? colors.primary : colors.border,
            color: colors.foreground,
            fontFamily: "Inter_500Medium",
          },
        ]}
      />

      <View style={styles.footer}>
        <NeonButton
          title="Next →"
          onPress={onNext}
          disabled={!firstName.trim()}
          fullWidth
        />
        <Pressable onPress={onNext} style={styles.skip}>
          <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
            {"// skip — I'll add my name later"}
          </MonoText>
        </Pressable>
      </View>
    </>
  );
}

function Step2({
  selected,
  setSelected,
  firstName,
  onFinish,
  saving,
  colors,
}: {
  selected: string | null;
  setSelected: (v: string) => void;
  firstName: string;
  onFinish: () => void;
  saving: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const greeting = firstName ? `Nice to meet you, ${firstName}.` : "One more thing.";
  return (
    <>
      <View style={styles.textBlock}>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {greeting}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          What will you mainly use WebForge for?
        </Text>
        <MonoText style={[styles.hint, { color: colors.primary }]}>
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
                  backgroundColor: isSelected ? colors.primary + "18" : colors.cardElevated,
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
                style={[styles.optionDesc, { color: colors.mutedForeground }]}
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
          title={saving ? "Saving…" : "Get started →"}
          onPress={onFinish}
          disabled={!selected || saving}
          fullWidth
        />
        <Pressable onPress={onFinish} style={styles.skip}>
          <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
            {"// skip for now"}
          </MonoText>
        </Pressable>
      </View>
    </>
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
    paddingBottom: Platform.OS === "ios" ? 48 : 36,
    paddingTop: 24,
    paddingHorizontal: 20,
    gap: 0,
  },
  header: {
    alignItems: "center",
    marginBottom: 20,
    gap: 14,
  },
  stepDots: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  dot: {
    height: 7,
    borderRadius: 4,
  },
  textBlock: {
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    letterSpacing: -0.8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  hint: {
    fontSize: 11,
    letterSpacing: 1.2,
  },
  nameInput: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 20,
    letterSpacing: -0.4,
    textAlign: "center",
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
  optionIcon: { fontSize: 22 },
  optionLabel: { fontSize: 14, letterSpacing: -0.2, marginTop: 2 },
  optionDesc:  { fontSize: 11, lineHeight: 15 },
  footer: {
    gap: 12,
    marginTop: 4,
  },
  skip: {
    alignItems: "center",
    paddingVertical: 4,
  },
});
