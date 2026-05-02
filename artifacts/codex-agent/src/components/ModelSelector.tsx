import { ChevronDown, Zap } from "lucide-react";
import { CODEX_MODELS, CodexModel } from "@/lib/puter";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";

interface ModelSelectorProps {
  value: CodexModel;
  onChange: (model: CodexModel) => void;
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = CODEX_MODELS.find((m) => m.value === value) ?? CODEX_MODELS[0];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all",
          "bg-card border-border hover:border-primary/50 hover:bg-card/80",
          open && "border-primary/50 bg-card/80"
        )}
      >
        <Zap className="w-3.5 h-3.5 text-primary" />
        <span className="text-foreground">{selected.label}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-72 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Select Model</p>
          </div>
          {CODEX_MODELS.map((model) => (
            <button
              key={model.value}
              onClick={() => {
                onChange(model.value);
                setOpen(false);
              }}
              className={cn(
                "w-full flex flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
                model.value === value && "bg-primary/10"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{model.label}</span>
                {model.value === value && (
                  <span className="text-xs text-primary font-medium">Active</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">{model.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
