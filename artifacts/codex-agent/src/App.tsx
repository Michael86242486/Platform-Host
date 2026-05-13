import { useState, useRef, useEffect, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ModelSelector } from "@/components/ModelSelector";
import { MessageRenderer } from "@/components/MessageRenderer";
import {
  sendMessage,
  SYSTEM_PROMPTS,
  type CodexModel,
} from "@/lib/puter";
import { cn } from "@/lib/utils";
import {
  Cpu,
  Send,
  Trash2,
  Code,
  Terminal,
  Bug,
  Search,
  Layers,
  Gamepad2,
  Loader2,
  ChevronRight,
} from "lucide-react";

const queryClient = new QueryClient();

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

type ModeKey = keyof typeof SYSTEM_PROMPTS;

const MODES: { key: ModeKey; label: string; icon: React.ReactNode; hint: string }[] = [
  { key: "general", label: "General", icon: <Cpu className="w-3.5 h-3.5" />, hint: "Code & answers" },
  { key: "codeReview", label: "Review", icon: <Search className="w-3.5 h-3.5" />, hint: "Security & quality" },
  { key: "logAnalysis", label: "Logs", icon: <Terminal className="w-3.5 h-3.5" />, hint: "Parse errors" },
  { key: "debugging", label: "Debug", icon: <Bug className="w-3.5 h-3.5" />, hint: "Fix bugs" },
];

const QUICK_PROMPTS = [
  { label: "Review code security", prompt: "Review this code for security issues:\n```js\nconst query = `SELECT * FROM users WHERE id = ${req.params.id}`;\n```" },
  { label: "Analyze error logs", prompt: "Analyze these logs:\nERROR: Cannot read properties of undefined (reading 'map')\nat Dashboard.render (Dashboard.js:42:18)" },
  { label: "Debug TypeError", prompt: "Debug this: TypeError: Cannot set property 'innerHTML' of null\nOccurs when the DOM element doesn't exist yet at script execution time." },
  { label: "Explain async/await", prompt: "Explain async/await vs Promise.then() with code examples showing when to use each." },
];

function CodexApp() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<CodexModel>("gpt-5.1-codex");
  const [mode, setMode] = useState<ModeKey>("general");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<boolean>(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendUserMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setError(null);

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", streaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput("");
    setLoading(true);
    abortRef.current = false;

    const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

    try {
      await sendMessage(history, model, mode, (chunk) => {
        if (abortRef.current) return;
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: m.content + chunk }
              : m
          )
        );
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errMsg);
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `⚠ Error: ${errMsg}`, streaming: false }
            : m
        )
      );
    } finally {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId ? { ...m, streaming: false } : m
        )
      );
      setLoading(false);
    }
  }, [messages, model, mode, loading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendUserMessage(input);
    }
  };

  const clearMessages = () => {
    setMessages([]);
    setError(null);
    abortRef.current = true;
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Cpu className="w-5 h-5 text-primary" />
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full animate-pulse" />
            </div>
            <span className="font-bold text-sm text-foreground tracking-tight">Codex</span>
          </div>
          <Badge variant="secondary" className="text-[10px] font-mono tracking-wider px-1.5 py-0 bg-primary/10 text-primary border-primary/20">
            AI ENGINE
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <ModelSelector value={model} onChange={setModel} />
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearMessages}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Mode pills */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border overflow-x-auto">
        {MODES.map(m => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all",
              mode === m.key
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-muted-foreground border border-border hover:border-primary/30 hover:text-foreground"
            )}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Cpu className="w-8 h-8 text-primary" />
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary/20 rounded-full border border-primary/40 flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground mb-1">Codex is ready.</h2>
              <p className="text-sm text-muted-foreground max-w-xs">
                Paste code, share logs, describe a bug, or ask anything. Powered by <span className="text-primary font-medium">OpenClaw v2</span>.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-md">
              {QUICK_PROMPTS.map(qp => (
                <button
                  key={qp.label}
                  onClick={() => void sendUserMessage(qp.prompt)}
                  className="flex items-center gap-2 p-3 rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-primary/5 text-left transition-all group"
                >
                  <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{qp.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Cpu className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
                  msg.role === "user"
                    ? "bg-primary/15 border border-primary/30 text-foreground"
                    : "bg-card border border-border text-foreground"
                )}
              >
                {msg.streaming && msg.content === "" ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-xs font-mono">thinking…</span>
                  </div>
                ) : (
                  <MessageRenderer content={msg.content} />
                )}
                {msg.streaming && msg.content.length > 0 && (
                  <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Composer */}
      <div className="p-4 border-t border-border bg-card/30">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Codex anything — paste code, logs, or describe a bug…"
            className="resize-none min-h-[52px] max-h-[200px] bg-card border-border focus:border-primary/50 text-sm rounded-xl"
            rows={2}
            disabled={loading}
          />
          <Button
            onClick={() => void sendUserMessage(input)}
            disabled={!input.trim() || loading}
            className="h-[52px] w-[52px] p-0 rounded-xl bg-primary hover:bg-primary/90 shrink-0"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-muted-foreground font-mono">
            Enter to send · Shift+Enter for newline
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {messages.filter(m => m.role === "user").length} messages
          </span>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <CodexApp />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
