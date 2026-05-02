import { CodeBlock } from "./CodeBlock";
import { cn } from "@/lib/utils";

interface MessageRendererProps {
  content: string;
  className?: string;
}

interface ParsedPart {
  type: "text" | "code";
  content: string;
  language?: string;
}

function parseContent(content: string): ParsedPart[] {
  const parts: ParsedPart[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }
    parts.push({
      type: "code",
      language: match[1] || undefined,
      content: match[2].trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: "text", content: content.slice(lastIndex) });
  }

  return parts;
}

function renderText(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("### ")) {
      return <h3 key={i} className="text-base font-semibold text-foreground mt-3 mb-1">{line.slice(4)}</h3>;
    }
    if (line.startsWith("## ")) {
      return <h2 key={i} className="text-lg font-semibold text-foreground mt-4 mb-1">{line.slice(3)}</h2>;
    }
    if (line.startsWith("# ")) {
      return <h1 key={i} className="text-xl font-bold text-foreground mt-4 mb-2">{line.slice(2)}</h1>;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      return (
        <div key={i} className="flex gap-2 my-0.5">
          <span className="text-primary mt-1 flex-shrink-0">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
    }
    const numberedMatch = line.match(/^(\d+)\. (.*)/);
    if (numberedMatch) {
      return (
        <div key={i} className="flex gap-2 my-0.5">
          <span className="text-primary flex-shrink-0 font-mono text-sm">{numberedMatch[1]}.</span>
          <span>{renderInline(numberedMatch[2])}</span>
        </div>
      );
    }
    if (line === "") {
      return <div key={i} className="h-2" />;
    }
    return <div key={i}>{renderInline(line)}</div>;
  });
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="px-1.5 py-0.5 rounded text-xs font-mono bg-muted/70 text-primary border border-border/50">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function MessageRenderer({ content, className }: MessageRendererProps) {
  const parts = parseContent(content);

  return (
    <div className={cn("text-sm leading-relaxed space-y-1", className)}>
      {parts.map((part, i) => {
        if (part.type === "code") {
          return <CodeBlock key={i} code={part.content} language={part.language} className="my-2" />;
        }
        return <div key={i}>{renderText(part.content)}</div>;
      })}
    </div>
  );
}
