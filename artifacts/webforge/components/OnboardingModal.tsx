import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { BrandLogo } from "@/components/Brand";
import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { useColors } from "@/hooks/useColors";

const { width: SCREEN_W } = Dimensions.get("window");

const SLIDES = [
  {
    phase: "01",
    headline: "AI builds complete\nwebsites.",
    sub: "Describe what you want — WebForge handles the rest.",
    accent: "#00FFC2" as const,
    icon: "✦",
    isCredit: false,
  },
  {
    phase: "02",
    headline: "Type a prompt.\nPick an AI.",
    sub: "GPT-4, Claude, Gemini — choose your engine and go.",
    accent: "#58A6FF" as const,
    icon: "◈",
    isCredit: false,
  },
  {
    phase: "03",
    headline: "Watch every file\nwrite live.",
    sub: "Real-time console. 7 AI phases. Fully transparent.",
    accent: "#00FFC2" as const,
    icon: "▸",
    isCredit: false,
  },
  {
    phase: "04",
    headline: "Checkpoints saved\nautomatically.",
    sub: "Restore any version. Compare diffs. Never lose work.",
    accent: "#A78BFA" as const,
    icon: "◎",
    isCredit: false,
  },
  {
    phase: "05",
    headline: "Chat to refine.\nDeploy in seconds.",
    sub: "Tell the AI what to change. Your site goes live on Puter.",
    accent: "#58A6FF" as const,
    icon: "⟶",
    isCredit: false,
  },
  {
    phase: "✦",
    headline: "Created by\nMichael.",
    sub: "WebForge  ©  2025",
    accent: "#00FFC2" as const,
    icon: "",
    isCredit: true,
  },
];

// 3 s × 5 slides + 4 s credit = 19 s total
const SLIDE_DURATIONS = [3000, 3000, 3000, 3000, 3000, 4000];

const OPTIONS = [
  { id: "clients",   icon: "💼", label: "Client work",      desc: "Ship sites for clients fast"   },
  { id: "personal",  icon: "🚀", label: "Personal projects", desc: "Build things I care about"     },
  { id: "prototype", icon: "⚡", label: "Quick prototypes",  desc: "Validate ideas in minutes"     },
  { id: "business",  icon: "📈", label: "Side business",     desc: "Launch a product or startup"   },
  { id: "learning",  icon: "🧪", label: "Experimenting",     desc: "Learn & explore AI building"   },
  { id: "agency",    icon: "🏢", label: "Agency / team",     desc: "Scale web delivery for a team" },
];

interface Props {
  visible: boolean;
  onDone: (name: string, choice: string) => void;
}

type Phase = "cinema" | "name" | "purpose";

export function OnboardingModal({ visible, onDone }: Props) {
  const colors = useColors();
  const [phase, setPhase] = useState<Phase>("cinema");
  const [slideIdx, setSlideIdx] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const slideOpacity   = useRef(new Animated.Value(1)).current;
  const slideTranslate = useRef(new Animated.Value(0)).current;
  const progressAnim   = useRef(new Animated.Value(0)).current;
  const containerFade  = useRef(new Animated.Value(0)).current;
  const formSlide      = useRef(new Animated.Value(40)).current;
  const formFade       = useRef(new Animated.Value(0)).current;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const animateProgress = useCallback((idx: number) => {
    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: SLIDE_DURATIONS[idx],
      useNativeDriver: false,
    }).start();
  }, [progressAnim]);

  const revealForm = useCallback(() => {
    clearTimer();
    setPhase("name");
    Animated.parallel([
      Animated.timing(formFade, { toValue: 1, duration: 340, useNativeDriver: true }),
      Animated.spring(formSlide, { toValue: 0, tension: 68, friction: 11, useNativeDriver: true }),
    ]).start();
  }, [clearTimer, formFade, formSlide]);

  const transitionToSlide = useCallback((nextIdx: number) => {
    Animated.parallel([
      Animated.timing(slideOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideTranslate, { toValue: -20, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setSlideIdx(nextIdx);
      slideTranslate.setValue(20);
      Animated.parallel([
        Animated.timing(slideOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
        Animated.timing(slideTranslate, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start();
      animateProgress(nextIdx);
    });
  }, [slideOpacity, slideTranslate, animateProgress]);

  const scheduleCinema = useCallback((idx: number) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      const next = idx + 1;
      if (next < SLIDES.length) {
        transitionToSlide(next);
        scheduleCinema(next);
      } else {
        revealForm();
      }
    }, SLIDE_DURATIONS[idx]);
  }, [clearTimer, transitionToSlide, revealForm]);

  useEffect(() => {
    if (visible) {
      setPhase("cinema");
      setSlideIdx(0);
      setFirstName("");
      setSelected(null);
      setSaving(false);
      slideOpacity.setValue(1);
      slideTranslate.setValue(0);
      formFade.setValue(0);
      formSlide.setValue(40);
      containerFade.setValue(0);
      Animated.timing(containerFade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
      animateProgress(0);
      scheduleCinema(0);
    } else {
      clearTimer();
    }
    return clearTimer;
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const skipToCreditSlide = () => {
    clearTimer();
    const last = SLIDES.length - 1;
    transitionToSlide(last);
    timerRef.current = setTimeout(revealForm, SLIDE_DURATIONS[last]);
  };

  const slide = SLIDES[slideIdx];

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.fullScreen, { opacity: containerFade }]}>
        <LinearGradient
          colors={["#020508", "#0A0E14", "#060A10"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Subtle vertical grid lines */}
        <View style={styles.grid} pointerEvents="none">
          {Array.from({ length: 9 }).map((_, k) => (
            <View key={k} style={[styles.gridLine, { left: `${k * 12.5}%` as unknown as number }]} />
          ))}
        </View>

        {phase === "cinema" ? (
          <>
            {/* Top bar */}
            <View style={styles.topBar}>
              <BrandLogo size={28} />
              <Pressable onPress={skipToCreditSlide} hitSlop={12}>
                <MonoText style={{ color: "#ffffff33", fontSize: 11, letterSpacing: 0.8 }}>
                  skip ›
                </MonoText>
              </Pressable>
            </View>

            {/* Slide-progress strips */}
            <View style={styles.progressRow}>
              {SLIDES.map((_, k) => (
                <View key={k} style={[styles.track, { backgroundColor: "#ffffff14" }]}>
                  {k === slideIdx ? (
                    <Animated.View
                      style={[
                        styles.fill,
                        {
                          backgroundColor: slide.accent,
                          width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
                        },
                      ]}
                    />
                  ) : (
                    <View style={[styles.fill, { width: k < slideIdx ? "100%" : "0%", backgroundColor: "#ffffff44" }]} />
                  )}
                </View>
              ))}
            </View>

            {/* Slide body */}
            <Animated.View
              style={[styles.slideWrap, { opacity: slideOpacity, transform: [{ translateY: slideTranslate }] }]}
            >
              {slide.isCredit ? (
                <CreditSlide slide={slide} />
              ) : (
                <RegularSlide slide={slide} />
              )}
            </Animated.View>

            <View style={styles.bottomHint}>
              <MonoText style={{ color: "#ffffff1A", fontSize: 10 }}>tap skip to jump ahead</MonoText>
            </View>
          </>
        ) : (
          <Animated.View
            style={[styles.formWrap, { opacity: formFade, transform: [{ translateY: formSlide }] }]}
          >
            <View style={styles.formHeader}>
              <BrandLogo size={32} />
              <View style={styles.pills}>
                {[0, 1].map((k) => (
                  <View
                    key={k}
                    style={[
                      styles.pill,
                      {
                        backgroundColor:
                          (phase === "name" ? 0 : 1) === k ? "#00FFC2" : "#ffffff22",
                        width: (phase === "name" ? 0 : 1) === k ? 20 : 8,
                      },
                    ]}
                  />
                ))}
              </View>
            </View>

            {phase === "name" ? (
              <NameStep
                firstName={firstName}
                setFirstName={setFirstName}
                onNext={() => setPhase("purpose")}
                colors={colors}
              />
            ) : (
              <PurposeStep
                selected={selected}
                setSelected={setSelected}
                firstName={firstName.trim()}
                onFinish={() => {
                  if (!selected) return;
                  setSaving(true);
                  onDone(firstName.trim(), selected);
                }}
                saving={saving}
                colors={colors}
              />
            )}
          </Animated.View>
        )}
      </Animated.View>
    </Modal>
  );
}

function RegularSlide({ slide }: { slide: typeof SLIDES[0] }) {
  return (
    <View style={rs.wrap}>
      <View style={rs.topRow}>
        <MonoText style={[rs.phase, { color: slide.accent + "88" }]}>
          {`// phase ${slide.phase}`}
        </MonoText>
        {slide.icon ? <Text style={[rs.icon, { color: slide.accent }]}>{slide.icon}</Text> : null}
      </View>
      <Text style={rs.headline}>
        {slide.headline.split("\n").map((line, idx, arr) => (
          <React.Fragment key={idx}>
            {idx < arr.length - 1 ? (
              <Text style={{ color: "#ffffff" }}>{line + "\n"}</Text>
            ) : (
              <Text style={{ color: slide.accent }}>{line}</Text>
            )}
          </React.Fragment>
        ))}
      </Text>
      <View style={[rs.bar, { backgroundColor: slide.accent }]} />
      <Text style={rs.sub}>{slide.sub}</Text>
    </View>
  );
}

function CreditSlide({ slide }: { slide: typeof SLIDES[0] }) {
  return (
    <View style={cs.wrap}>
      <View style={[cs.accentLine, { backgroundColor: slide.accent }]} />
      <MonoText style={[cs.tag, { color: slide.accent }]}>
        {"// made with intention"}
      </MonoText>
      <Text style={cs.headline}>
        <Text style={{ color: "#ffffff" }}>{"Created by\n"}</Text>
        <Text style={{ color: slide.accent }}>{"Michael"}</Text>
        <Text style={{ color: "#ffffff22" }}>{"."}</Text>
      </Text>
      <View style={[cs.divider, { backgroundColor: slide.accent + "30" }]} />
      <MonoText style={cs.copy}>{"WebForge  ©  2025"}</MonoText>
      <MonoText style={cs.build}>{"// built with ❤️ + Puter AI"}</MonoText>
    </View>
  );
}

function NameStep({
  firstName, setFirstName, onNext, colors,
}: {
  firstName: string;
  setFirstName: (v: string) => void;
  onNext: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={fs.body}>
      <View style={fs.textBlock}>
        <Text style={[fs.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          Welcome to WebForge
        </Text>
        <Text style={[fs.sub, { color: colors.mutedForeground }]}>
          What should we call you?
        </Text>
        <MonoText style={[fs.hint, { color: "#00FFC2" }]}>
          {"// first name is fine"}
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
          fs.input,
          {
            backgroundColor: "#0D1219",
            borderColor: firstName.trim() ? "#00FFC2" : colors.border,
            color: colors.foreground,
            fontFamily: "Inter_500Medium",
          },
        ]}
      />

      <View style={fs.footer}>
        <NeonButton title="Next →" onPress={onNext} disabled={!firstName.trim()} fullWidth />
        <Pressable onPress={onNext} style={fs.skip}>
          <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
            {"// skip — I'll add my name later"}
          </MonoText>
        </Pressable>
      </View>
    </View>
  );
}

function PurposeStep({
  selected, setSelected, firstName, onFinish, saving, colors,
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
    <View style={fs.body}>
      <View style={fs.textBlock}>
        <Text style={[fs.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {greeting}
        </Text>
        <Text style={[fs.sub, { color: colors.mutedForeground }]}>
          What will you mainly use WebForge for?
        </Text>
        <MonoText style={[fs.hint, { color: "#00FFC2" }]}>
          {"// shapes your experience"}
        </MonoText>
      </View>

      <View style={fs.grid}>
        {OPTIONS.map((opt) => {
          const active = selected === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => setSelected(opt.id)}
              style={({ pressed }) => [
                fs.card,
                {
                  backgroundColor: active ? "#00FFC218" : "#0D1219",
                  borderColor: active ? "#00FFC2" : colors.border,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <Text style={{ fontSize: 20 }}>{opt.icon}</Text>
              <Text
                style={[fs.optLabel, { color: active ? "#00FFC2" : colors.foreground, fontFamily: "Inter_600SemiBold" }]}
              >
                {opt.label}
              </Text>
              <Text style={[fs.optDesc, { color: colors.mutedForeground }]} numberOfLines={1}>
                {opt.desc}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={fs.footer}>
        <NeonButton
          title={saving ? "Saving…" : "Get started →"}
          onPress={onFinish}
          disabled={!selected || saving}
          fullWidth
        />
        <Pressable onPress={onFinish} style={fs.skip}>
          <MonoText style={{ color: colors.mutedForeground, fontSize: 11 }}>
            {"// skip for now"}
          </MonoText>
        </Pressable>
      </View>
    </View>
  );
}

const HL = Math.min(SCREEN_W * 0.115, 46);
const CHL = Math.min(SCREEN_W * 0.148, 62);

const styles = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: "#020508" },
  grid: { ...StyleSheet.absoluteFillObject, flexDirection: "row" },
  gridLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "#ffffff03" },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "ios" ? 58 : 40,
    paddingBottom: 12,
  },
  progressRow: { flexDirection: "row", gap: 4, paddingHorizontal: 24 },
  track: { flex: 1, height: 2, borderRadius: 1, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 1 },
  slideWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 28, paddingBottom: 60 },
  bottomHint: { alignItems: "center", paddingBottom: Platform.OS === "ios" ? 40 : 24 },
  formWrap: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: Platform.OS === "ios" ? 64 : 48,
    paddingBottom: Platform.OS === "ios" ? 44 : 32,
  },
  formHeader: { alignItems: "center", gap: 16, marginBottom: 28 },
  pills: { flexDirection: "row", gap: 6, alignItems: "center" },
  pill: { height: 7, borderRadius: 4 },
});

const rs = StyleSheet.create({
  wrap: { gap: 16 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  phase: { fontSize: 12, letterSpacing: 1.2 },
  icon: { fontSize: 28 },
  headline: { fontSize: HL, fontFamily: "Inter_700Bold", letterSpacing: -1.5, lineHeight: HL * 1.12 },
  bar: { width: 40, height: 3, borderRadius: 2 },
  sub: { fontSize: 16, lineHeight: 24, color: "#ffffff88" },
});

const cs = StyleSheet.create({
  wrap: { alignItems: "flex-start", gap: 14 },
  accentLine: { width: 56, height: 3, borderRadius: 2, marginBottom: 8 },
  tag: { fontSize: 12, letterSpacing: 1.2 },
  headline: { fontSize: CHL, fontFamily: "Inter_700Bold", letterSpacing: -2.5, lineHeight: CHL * 1.08 },
  divider: { width: "60%", height: 1, marginVertical: 8 },
  copy: { fontSize: 18, letterSpacing: 3, color: "#ffffff55" },
  build: { fontSize: 12, letterSpacing: 0.8, color: "#ffffff22", marginTop: 4 },
});

const fs = StyleSheet.create({
  body: { flex: 1, gap: 0 },
  textBlock: { alignItems: "center", gap: 6, marginBottom: 24 },
  title: { fontSize: 26, letterSpacing: -0.8, textAlign: "center" },
  sub: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  hint: { fontSize: 11, letterSpacing: 1.2 },
  input: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 22,
    letterSpacing: -0.4,
    textAlign: "center",
    marginBottom: 20,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, flex: 1 },
  card: { width: "47%", borderRadius: 14, borderWidth: 1.5, padding: 14, gap: 4 },
  optLabel: { fontSize: 14, letterSpacing: -0.2, marginTop: 2 },
  optDesc: { fontSize: 11, lineHeight: 15 },
  footer: { gap: 12, marginTop: "auto" as unknown as number },
  skip: { alignItems: "center", paddingVertical: 4 },
});
