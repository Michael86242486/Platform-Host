import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MonoText } from "@/components/MonoText";
import { Surface } from "@/components/Surface";
import { useColors } from "@/hooks/useColors";
import {
  AGENT_MODES,
  CODEX_MODELS,
  AgentMode,
  CodexModel,
  isPuterAvailable,
  sendCodexMessage,
} from "@/lib/puter";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

const QUICK_PROMPTS = [
  "Review this code for security issues:\n```js\nconst query = `SELECT * FROM users WHERE id = ${req.params.id}`;\n```",
  "Analyze these logs:\nERROR: Cannot read properties of undefined (reading 'map')\nat Dashboard.render (Dashboard.js:42)",
  "Debug this: TypeError: Cannot set property 'innerHTML' of null",
];

function MessageBubble({
  message,
  colors,
}: {
  message: Message;
  colors: ReturnType<typeof useColors>;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const parts = parseMessage(message.content);

  return (
    <View
      style={[
        styles.bubble,
        isUser
          ? { alignSelf: "flex-end", maxWidth: "85%" }
          : { alignSelf: "flex-start", maxWidth: "95%" },
      ]}
    >
      {!isUser && (
        <View style={styles.agentHeader}>
          <View
            style={[
              styles.agentDot,
              { backgroundColor: colors.primary, shadowColor: colors.primary },
            ]}
          />
          <MonoText
            style={{ color: colors.primary, fontSize: 10, letterSpacing: 1.4 }}
          >
            CODEX
          </MonoText>
        </View>
      )}
      <View
        style={[
          styles.bubbleInner,
          isUser
            ? {
                backgroundColor: `${colors.primary}1A`,
                borderColor: `${colors.primary}40`,
                borderWidth: 1,
              }
            : {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth: 1,
              },
        ]}
      >
        {parts.map((part, i) => {
          if (part.type === "code") {
            return (
              <View
                key={i}
                style={[
                  styles.codeBlock,
                  { backgroundColor: "#0A0E14", borderColor: colors.border },
                ]}
              >
                <View
                  style={[
                    styles.codeHeader,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <MonoText
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 10,
                      letterSpacing: 1.2,
                    }}
                  >
                    {part.lang?.toUpperCase() || "CODE"}
                  </MonoText>
                  <Pressable
                    onPress={async () => {
                      await Clipboard.setStringAsync(part.content);
                    }}
                  >
                    <Feather name="copy" size={12} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                <MonoText
                  style={{
                    color: colors.codeGreen,
                    fontSize: 12,
                    lineHeight: 20,
                    padding: 12,
                  }}
                >
                  {part.content}
                </MonoText>
              </View>
            );
          }
          return (
            <Text
              key={i}
              style={[
                styles.messageText,
                {
                  color: isUser ? colors.foreground : colors.foreground,
                  lineHeight: 22,
                },
              ]}
            >
              {renderInline(part.content, colors)}
            </Text>
          );
        })}
        {message.streaming && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <MonoText style={{ color: colors.mutedForeground, fontSize: 10 }}>
              thinking…
            </MonoText>
          </View>
        )}
      </View>
      {!isUser && !message.streaming && message.content.length > 0 && (
        <Pressable onPress={handleCopy} style={styles.copyBtn}>
          <Feather
            name={copied ? "check" : "copy"}
            size={11}
            color={copied ? colors.success : colors.mutedForeground}
          />
          <MonoText
            style={{
              color: copied ? colors.success : colors.mutedForeground,
              fontSize: 9,
              letterSpacing: 0.8,
            }}
          >
            {copied ? "COPIED" : "COPY"}
          </MonoText>
        </Pressable>
      )}
    </View>
  );
}

interface ParsedPart {
  type: "text" | "code";
  content: string;
  lang?: string;
}

function parseMessage(content: string): ParsedPart[] {
  const parts: ParsedPart[] = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      parts.push({ type: "text", content: content.slice(last, m.index) });
    }
    parts.push({ type: "code", lang: m[1] || undefined, content: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    parts.push({ type: "text", content: content.slice(last) });
  }
  return parts.length > 0 ? parts : [{ type: "text", content }];
}

function renderInline(
  text: string,
  colors: ReturnType<typeof useColors>
): React.ReactNode {
  const segments = text.split(/(`[^`\n]+`|\*\*[^*]+\*\*)/g);
  return segments.map((seg, i) => {
    if (seg.startsWith("`") && seg.endsWith("`")) {
      return (
        <Text
          key={i}
          style={{
            fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
            backgroundColor: `${colors.primary}1A`,
            color: colors.codeCyan,
            fontSize: 12,
          }}
        >
          {seg.slice(1, -1)}
        </Text>
      );
    }
    if (seg.startsWith("**") && seg.endsWith("**")) {
      return (
        <Text key={i} style={{ fontFamily: "Inter_700Bold", color: colors.foreground }}>
          {seg.slice(2, -2)}
        </Text>
      );
    }
    return seg;
  });
}

export default function CodexScreen() {
  const colors = useColors();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<CodexModel>("gpt-5.1-codex");
  const [mode, setMode] = useState<AgentMode>("general");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
    };

    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      if (!isPuterAvailable()) {
        throw new Error(
          "Puter.js is not available. Please open this app in a web browser."
        );
      }

      const history = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content },
      ];

      await sendCodexMessage(history, model, mode, (chunk) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content + chunk, streaming: true }
              : m
          )
        );
        scrollRef.current?.scrollToEnd({ animated: false });
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m
        )
      );
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : "An unknown error occurred.";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: `⚠️ Error: ${errMsg}`,
                streaming: false,
              }
            : m
        )
      );
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, loading, messages, model, mode]);

  const currentMode = AGENT_MODES.find((m) => m.value === mode)!;
  const currentModel = CODEX_MODELS.find((m) => m.value === model)!;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border, backgroundColor: colors.surface },
          ]}
        >
          <View style={styles.headerLeft}>
            <View
              style={[
                styles.onlineDot,
                { backgroundColor: colors.success, shadowColor: colors.success },
              ]}
            />
            <Text
              style={[
                styles.headerTitle,
                { color: colors.foreground },
              ]}
            >
              Codex
            </Text>
            <View
              style={[
                styles.badge,
                { backgroundColor: `${colors.primary}1A`, borderColor: `${colors.primary}40` },
              ]}
            >
              <MonoText style={{ color: colors.primary, fontSize: 9, letterSpacing: 1 }}>
                PUTER.JS
              </MonoText>
            </View>
          </View>

          <Pressable
            onPress={() => setShowModelPicker(!showModelPicker)}
            style={({ pressed }) => [
              styles.modelBtn,
              {
                backgroundColor: colors.cardElevated,
                borderColor: showModelPicker ? colors.primary : colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <MonoText style={{ color: colors.primary, fontSize: 9, letterSpacing: 0.8 }}>
              {currentModel.label.toUpperCase()}
            </MonoText>
            <Feather
              name={showModelPicker ? "chevron-up" : "chevron-down"}
              size={10}
              color={colors.primary}
            />
          </Pressable>
        </View>

        {/* Model picker dropdown */}
        {showModelPicker && (
          <View
            style={[
              styles.modelPicker,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {CODEX_MODELS.map((m) => (
              <Pressable
                key={m.value}
                onPress={() => {
                  setModel(m.value);
                  setShowModelPicker(false);
                }}
                style={({ pressed }) => [
                  styles.modelOption,
                  {
                    backgroundColor:
                      m.value === model
                        ? `${colors.primary}15`
                        : pressed
                        ? colors.cardElevated
                        : "transparent",
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <View>
                  <Text
                    style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }}
                  >
                    {m.label}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 1 }}>
                    {m.hint}
                  </Text>
                </View>
                {m.value === model && (
                  <Feather name="check" size={14} color={colors.primary} />
                )}
              </Pressable>
            ))}
          </View>
        )}

        {/* Mode pills */}
        <View
          style={[styles.modeBar, { borderBottomColor: colors.border }]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
          >
            {AGENT_MODES.map((m) => (
              <Pressable
                key={m.value}
                onPress={() => setMode(m.value)}
                style={[
                  styles.modePill,
                  {
                    backgroundColor:
                      m.value === mode ? `${colors.primary}20` : colors.card,
                    borderColor:
                      m.value === mode ? colors.primary : colors.border,
                  },
                ]}
              >
                <Feather
                  name={m.icon as keyof typeof Feather.glyphMap}
                  size={12}
                  color={m.value === mode ? colors.primary : colors.mutedForeground}
                />
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: "Inter_600SemiBold",
                    color: m.value === mode ? colors.primary : colors.mutedForeground,
                  }}
                >
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <View style={styles.emptyState}>
              <LinearGradient
                colors={[`${colors.primary}22`, `${colors.accent}11`]}
                style={styles.emptyIcon}
              >
                <Feather name="cpu" size={28} color={colors.primary} />
              </LinearGradient>
              <Text
                style={[
                  styles.emptyTitle,
                  { color: colors.foreground },
                ]}
              >
                Codex is ready.
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                Paste code, share logs, or ask anything. Running on{" "}
                <Text style={{ color: colors.primary }}>{currentModel.label}</Text>.
              </Text>

              <View style={{ width: "100%", gap: 8, marginTop: 20 }}>
                <MonoText
                  style={{
                    color: colors.mutedForeground,
                    fontSize: 10,
                    letterSpacing: 1.4,
                    marginBottom: 4,
                  }}
                >
                  QUICK START
                </MonoText>
                {QUICK_PROMPTS.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => sendMessage(p)}
                    style={({ pressed }) => [
                      styles.quickPrompt,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <Feather name="zap" size={12} color={colors.primary} />
                    <Text
                      numberOfLines={2}
                      style={{ color: colors.foreground, fontSize: 12, flex: 1, lineHeight: 18 }}
                    >
                      {p.slice(0, 80)}…
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} colors={colors} />
          ))}
        </ScrollView>

        {/* Input area */}
        <View
          style={[
            styles.inputArea,
            { borderTopColor: colors.border, backgroundColor: colors.surface },
          ]}
        >
          <LinearGradient
            colors={[`${colors.primary}18`, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 14, padding: 1 }}
          >
            <View
              style={[
                styles.inputRow,
                { backgroundColor: colors.cardElevated, borderColor: colors.border },
              ]}
            >
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={`Ask Codex — ${currentMode.label} mode`}
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={[
                  styles.textInput,
                  { color: colors.foreground, fontFamily: "Inter_400Regular" },
                ]}
                onSubmitEditing={() => {
                  if (!loading && input.trim()) sendMessage();
                }}
                blurOnSubmit={false}
              />
              <Pressable
                onPress={() => sendMessage()}
                disabled={!input.trim() || loading}
                style={({ pressed }) => [
                  styles.sendBtn,
                  {
                    backgroundColor:
                      input.trim() && !loading ? colors.primary : colors.muted,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Feather
                    name="arrow-up"
                    size={18}
                    color={input.trim() ? colors.primaryForeground : colors.mutedForeground}
                  />
                )}
              </Pressable>
            </View>
          </LinearGradient>

          {messages.length > 0 && (
            <Pressable
              onPress={() => setMessages([])}
              style={styles.clearBtn}
            >
              <MonoText style={{ color: colors.mutedForeground, fontSize: 10, letterSpacing: 1 }}>
                CLEAR CHAT
              </MonoText>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  modelBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  modelPicker: {
    borderBottomWidth: 1,
    zIndex: 100,
  },
  modelOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modeBar: {
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  messageList: {
    padding: 16,
    gap: 12,
    paddingBottom: 8,
  },
  bubble: {
    gap: 4,
  },
  agentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  agentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOpacity: 0.7,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  bubbleInner: {
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  messageText: {
    fontSize: 14,
  },
  codeBlock: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    marginVertical: 4,
  },
  codeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 4,
    paddingTop: 2,
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 20,
    paddingHorizontal: 8,
    gap: 10,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  quickPrompt: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  inputArea: {
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    borderRadius: 13,
    borderWidth: 1,
    padding: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    maxHeight: 120,
    lineHeight: 22,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtn: {
    alignSelf: "center",
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
});
