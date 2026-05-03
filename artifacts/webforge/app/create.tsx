// ---------------------------------------------------------------------------
// Model selector
// ---------------------------------------------------------------------------

const BUILD_MODELS: { value: string; label: string; hint: string }[] = [
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini", hint: "Fast · default" },
  { value: "openai/gpt-4o", label: "GPT-4o", hint: "High quality" },
  { value: "openai/gpt-5.3-codex", label: "Codex 5.3", hint: "Most capable" },
  { value: "openai/gpt-5.1-codex", label: "Codex 5.1", hint: "Balanced" },
  { value: "openai/gpt-5.1-codex-mini", label: "Codex Mini", hint: "Fastest" },
];

function ModelSelector({
  selectedModel,
  onSelect,
  colors,
