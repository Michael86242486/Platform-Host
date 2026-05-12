import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MonoText } from "@/components/MonoText";
import { NeonButton } from "@/components/NeonButton";
import { useColors } from "@/hooks/useColors";

type ProjectCategory = "game" | "saas" | "ecommerce" | "mvp" | "portfolio" | "landing" | "tool";

interface ProjectTemplate {
  id: string;
  category: ProjectCategory;
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
  previewImage: string;
  prompt: string;
  badge?: string;
  tags: string[];
}

const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "fifa",
    category: "game",
    title: "FIFA 2026",
    description: "Playable football game with physics, AI goalkeeper, scoring, and sound effects",
    icon: "award",
    color: "#00FFC2",
    previewImage: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=600&h=360&fit=crop&q=80",
    badge: "GAME",
    tags: ["Canvas", "Physics", "AI", "Sound"],
    prompt: "Build a fully playable FIFA 2026 football game in HTML5 Canvas with: realistic ball physics (spin, curve, bounce), player movement with WASD/arrow keys, sprint (Shift), shoot (Space), pass (X), tackle (Z), AI goalkeeper with reactions, AI opponent team with pathfinding, scoreboard, timer (90 minutes), goal celebrations with particle effects, crowd cheering via Web Audio API, halftime/fulltime screens, 3 difficulty modes (easy/medium/hard), and a menu screen with team selection. Make it visually stunning with a green pitch, player sprites, and smooth 60fps animation."
  },
  {
    id: "tetris",
    category: "game",
    title: "Tetris Pro",
    description: "Classic Tetris with ghost piece, hold piece, T-spins, and neon visual style",
    icon: "grid",
    color: "#58A6FF",
    previewImage: "https://images.unsplash.com/photo-1500462918059-b1a0cb512f1d?w=600&h=360&fit=crop&q=80",
    badge: "GAME",
    tags: ["Canvas", "Classic", "Score"],
    prompt: "Build a polished Tetris game with HTML5 Canvas. Include: all 7 tetrominoes with correct colors, ghost piece preview, hold piece, next piece queue (3 pieces), wall kicks and proper rotation, scoring system (single=100, double=300, triple=500, tetris=800, back-to-back bonus), level progression with increasing speed, line clear animations, combo counter, local high score, T-spin detection, keyboard + touch controls, Web Audio API sounds, beautiful neon dark theme."
  },
  {
    id: "chess",
    category: "game",
    title: "Chess Engine",
    description: "Full chess with minimax AI, move highlighting, timers, and analysis",
    icon: "compass",
    color: "#BC8CFF",
    previewImage: "https://images.unsplash.com/photo-1529699211952-734e80c4d42b?w=600&h=360&fit=crop&q=80",
    badge: "GAME",
    tags: ["AI", "Logic", "Classic"],
    prompt: "Build a complete chess game with HTML5 Canvas: full chess rules (castling, en passant, promotion, check/checkmate/stalemate detection), AI opponent with minimax algorithm + alpha-beta pruning (3 difficulty levels), move highlighting (valid moves shown on click), move history with notation, take-back feature, timer for both players, board flip for two-player mode, beautiful wooden board texture, piece animation, check warning highlight, and game analysis showing best moves."
  },
  {
    id: "snake",
    category: "game",
    title: "Snake Master",
    description: "Modern Snake with power-ups, combos, particle effects, and leaderboard",
    icon: "activity",
    color: "#3FB950",
    previewImage: "https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?w=600&h=360&fit=crop&q=80",
    badge: "GAME",
    tags: ["Canvas", "Score", "Levels"],
    prompt: "Build a modern Snake game with HTML5 Canvas. Include: smooth movement, power-ups (speed boost, slow, double points, invincibility), 5 difficulty levels, particle effects when eating food, combo multiplier, local leaderboard, neon cyberpunk visual style, Web Audio API sound effects, mobile touch controls, pause/resume, and a beautiful game over screen with score breakdown."
  },
  {
    id: "platformer",
    category: "game",
    title: "Platform Runner",
    description: "Side-scrolling platformer with enemies, collectibles, and a boss fight",
    icon: "box",
    color: "#FF6B6B",
    previewImage: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&h=360&fit=crop&q=80",
    badge: "GAME",
    tags: ["Canvas", "Physics", "Enemies"],
    prompt: "Build a complete side-scrolling platformer game with HTML5 Canvas. Include: player with jump/double-jump/run mechanics, gravity and collision detection, 3 different enemy types with AI, collectible coins and power-ups, health system with lives, parallax background scrolling, 5 levels with increasing difficulty, checkpoints, boss fight on level 5, Web Audio API for jump/coin/hurt sounds, mobile touch controls, smooth 60fps animation."
  },
  {
    id: "saas-dashboard",
    category: "saas",
    title: "SaaS Dashboard",
    description: "Full analytics platform with charts, user management, and billing page",
    icon: "bar-chart-2",
    color: "#BC8CFF",
    previewImage: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&h=360&fit=crop&q=80",
    badge: "SAAS",
    tags: ["Auth", "Charts", "Dark Mode"],
    prompt: "Build a complete SaaS analytics dashboard with: dark mode, interactive Chart.js charts (revenue line chart, user growth bar chart, conversion funnel, geographic heatmap), user management table with search/filter/pagination, billing/subscription page with plan comparison, settings page, notification center, sidebar navigation with collapse, responsive design, smooth animations, and real demo data to make it look live."
  },
  {
    id: "ecommerce",
    category: "ecommerce",
    title: "E-Commerce Store",
    description: "Complete online store with cart, checkout, wishlist, and order history",
    icon: "shopping-cart",
    color: "#FFD166",
    previewImage: "https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=600&h=360&fit=crop&q=80",
    badge: "MVP",
    tags: ["Cart", "Products", "Checkout"],
    prompt: "Build a complete e-commerce store with: product grid with filters and search, product detail pages with image gallery, shopping cart with quantity management, checkout flow (address, payment, confirmation), user account dashboard, order history, wishlist, product reviews and ratings, related products, featured products carousel, promotional banners, and a beautiful responsive design."
  },
  {
    id: "ai-chat",
    category: "tool",
    title: "AI Chat App",
    description: "ChatGPT-style interface with history, markdown rendering, and code blocks",
    icon: "message-circle",
    color: "#00FFC2",
    previewImage: "https://images.unsplash.com/photo-1675557009483-cbfac29e7a5b?w=600&h=360&fit=crop&q=80",
    badge: "AI",
    tags: ["Chat", "Markdown", "History"],
    prompt: "Build a polished AI chat interface like ChatGPT with: multi-turn conversation UI, markdown rendering with code highlighting, conversation history sidebar, new chat button, model selector, streaming response simulation, copy code blocks, regenerate response button, token counter, export chat as markdown, dark/light mode toggle, keyboard shortcuts (Cmd+Enter to send, Cmd+K for new chat), and beautiful glassmorphism design."
  },
  {
    id: "startup-landing",
    category: "landing",
    title: "Startup Landing",
    description: "High-converting landing page with scroll animations and live counters",
    icon: "trending-up",
    color: "#FF6B6B",
    previewImage: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&h=360&fit=crop&q=80",
    badge: "LANDING",
    tags: ["GSAP", "Conversion", "Modern"],
    prompt: "Build a high-converting startup landing page with: full-screen hero with animated background particles (Three.js), scroll-triggered GSAP animations, feature showcase with interactive demos, social proof section with animated counters, pricing table with toggle (monthly/annual), testimonial carousel, FAQ accordion, email signup with success animation, sticky navigation with blur effect, and mobile-optimized layout."
  },
  {
    id: "portfolio",
    category: "portfolio",
    title: "Dev Portfolio",
    description: "Stunning developer portfolio with projects, skills, blog, and contact form",
    icon: "user",
    color: "#58A6FF",
    previewImage: "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=600&h=360&fit=crop&q=80",
    badge: "PORTFOLIO",
    tags: ["Showcase", "Blog", "Contact"],
    prompt: "Build a stunning developer portfolio website with: immersive hero section with typing animation and particle background, featured projects grid with live previews and GitHub links, skills visualization with animated progress bars, work experience timeline, blog section with featured articles, contact form with validation, dark/light mode, smooth page transitions, and a terminal-style command palette."
  },
  {
    id: "task-manager",
    category: "saas",
    title: "Project Manager",
    description: "Trello-like kanban with drag-and-drop, teams, deadlines, and labels",
    icon: "trello",
    color: "#3FB950",
    previewImage: "https://images.unsplash.com/photo-1611224923853-80b023f02d71?w=600&h=360&fit=crop&q=80",
    badge: "MVP",
    tags: ["Kanban", "Teams", "Drag-Drop"],
    prompt: "Build a Trello-like project management app with: drag-and-drop kanban board (4 columns: Backlog, In Progress, Review, Done), task cards with title, description, priority, assignee, due date, labels, task detail modal, multiple boards support, team members panel, search across all tasks, filter by priority/assignee/label, keyboard shortcuts, undo/redo stack, smooth animations, dark theme, and local storage persistence."
  },
  {
    id: "github-import",
    category: "tool",
    title: "Import GitHub Repo",
    description: "Connect your GitHub and let AI analyze and build from your real repository",
    icon: "github",
    color: "#E6EDF3",
    previewImage: "https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=600&h=360&fit=crop&q=80",
    badge: "GITHUB",
    tags: ["GitHub", "Import", "Build"],
    prompt: "__GITHUB_IMPORT__"
  },
];

const CATEGORIES: { key: ProjectCategory | "all"; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "all", label: "All", icon: "grid" },
  { key: "game", label: "Games", icon: "award" },
  { key: "saas", label: "SaaS", icon: "bar-chart-2" },
  { key: "ecommerce", label: "Store", icon: "shopping-cart" },
  { key: "landing", label: "Landing", icon: "trending-up" },
  { key: "portfolio", label: "Portfolio", icon: "user" },
  { key: "tool", label: "Tools", icon: "tool" },
];

export default function ProjectsScreen() {
  const colors = useColors();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<ProjectCategory | "all">("all");

  const filtered = PROJECT_TEMPLATES.filter((t) => {
    const matchesCategory = activeCategory === "all" || t.category === activeCategory;
    const matchesSearch =
      !search.trim() ||
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.description.toLowerCase().includes(search.toLowerCase()) ||
      t.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const onBuild = (template: ProjectTemplate) => {
    if (Platform.OS !== "web") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    if (template.prompt === "__GITHUB_IMPORT__") {
      router.push("/github-import");
      return;
    }
    router.push(`/create?prompt=${encodeURIComponent(template.prompt)}` as never);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <MonoText style={[styles.headerLabel, { color: colors.primary }]}>
            {">_ project templates"}
          </MonoText>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Build Anything
          </Text>
        </View>
        <Pressable
          onPress={() => router.push("/create")}
          style={[styles.customBtn, { backgroundColor: colors.primary }]}
        >
          <Feather name="edit-3" size={14} color="#000" />
          <Text style={styles.customBtnText}>Custom</Text>
        </Pressable>
      </View>

      {/* ── Search ── */}
      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={15} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search templates…"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} hitSlop={8}>
            <Feather name="x" size={14} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {/* ── Category pills ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryScroll}
        style={{ marginBottom: 4 }}
      >
        {CATEGORIES.map((cat) => {
          const active = activeCategory === cat.key;
          return (
            <Pressable
              key={cat.key}
              onPress={() => setActiveCategory(cat.key)}
              style={[
                styles.categoryPill,
                {
                  backgroundColor: active ? `${colors.primary}20` : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Feather name={cat.icon} size={12} color={active ? colors.primary : colors.mutedForeground} />
              <Text style={[styles.categoryLabel, { color: active ? colors.primary : colors.mutedForeground }]}>
                {cat.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ── Grid ── */}
      <ScrollView
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
      >
        {filtered.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            colors={colors}
            onBuild={() => onBuild(template)}
          />
        ))}

        {filtered.length === 0 && (
          <View style={styles.emptyState}>
            <Feather name="search" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No templates found</Text>
            <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>
              Try a different search or build something custom
            </Text>
            <NeonButton title="Build Custom" onPress={() => router.push("/create")} style={{ marginTop: 16 }} />
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function TemplateCard({
  template,
  colors,
  onBuild,
}: {
  template: ProjectTemplate;
  colors: ReturnType<typeof useColors>;
  onBuild: () => void;
}) {
  return (
    <Pressable
      onPress={onBuild}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: `${template.color}30`,
          opacity: pressed ? 0.93 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      {/* Preview image */}
      <View style={styles.imageWrap}>
        <Image
          source={{ uri: template.previewImage }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={300}
        />
        {/* Dark overlay so image doesn't look too bright */}
        <LinearGradient
          colors={["transparent", `${colors.card}CC`, colors.card]}
          locations={[0, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
        {/* Badge */}
        {template.badge && (
          <View style={[styles.imageBadge, { backgroundColor: `${template.color}CC` }]}>
            <MonoText style={styles.imageBadgeText}>{template.badge}</MonoText>
          </View>
        )}
        {/* Color accent icon at bottom of image */}
        <View style={[styles.imageIcon, { backgroundColor: `${template.color}20` }]}>
          <Feather name={template.icon} size={20} color={template.color} />
        </View>
      </View>

      {/* Content */}
      <View style={styles.cardContent}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{template.title}</Text>
        <Text style={[styles.cardDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
          {template.description}
        </Text>

        {/* Tags */}
        <View style={styles.tags}>
          {template.tags.slice(0, 4).map((tag) => (
            <View key={tag} style={[styles.tag, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
              <Text style={[styles.tagText, { color: colors.mutedForeground }]}>{tag}</Text>
            </View>
          ))}
        </View>

        {/* Build button */}
        <View
          style={[
            styles.buildBtn,
            { backgroundColor: template.color },
          ]}
        >
          <Feather name={template.id === "github-import" ? "github" : "zap"} size={14} color="#000" />
          <Text style={styles.buildBtnText}>
            {template.id === "github-import" ? "Browse Repos" : "Build This"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
  },
  headerLabel: { fontSize: 11, letterSpacing: 1.4, marginBottom: 2 },
  headerTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.8 },
  customBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
  },
  customBtnText: { color: "#000", fontFamily: "Inter_700Bold", fontSize: 13 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 15 },
  categoryScroll: { paddingHorizontal: 20, gap: 8, paddingBottom: 2 },
  categoryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  categoryLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  grid: { paddingHorizontal: 20, paddingTop: 14, gap: 14 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  imageWrap: {
    height: 160,
    position: "relative",
    justifyContent: "flex-end",
    padding: 12,
  },
  imageBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  imageBadgeText: { fontSize: 9, letterSpacing: 1.2, color: "#000", fontFamily: "Inter_700Bold" },
  imageIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: { padding: 16, gap: 10 },
  cardTitle: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.4 },
  cardDesc: { fontSize: 13, lineHeight: 20 },
  tags: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  tagText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  buildBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 2,
  },
  buildBtnText: { color: "#000", fontFamily: "Inter_700Bold", fontSize: 14, letterSpacing: -0.2 },
  emptyState: { alignItems: "center", paddingTop: 60, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 8 },
  emptySubtext: { fontSize: 14, textAlign: "center", lineHeight: 21 },
});
