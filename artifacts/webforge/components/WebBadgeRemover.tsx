import { useEffect } from "react";
import { Platform } from "react-native";

const STYLE_ID = "webforge-badge-hide";

const CSS = `
  replit-badge,
  replit-pill,
  #replit-badge,
  #replit-pill,
  [data-replit-badge],
  [data-replit-pill],
  .replit-badge,
  .replit-pill,
  iframe[src*="replit.com/badge"],
  iframe[src*="replit.com/public/banner"],
  iframe[src*="replit-pill"],
  div[class*="replit-badge"],
  div[class*="replit-pill"],
  a[href*="replit.com/refer"][href*="utm_source=badge"],
  a[href^="https://replit.com/"][href*="utm_source"],
  a[aria-label*="Made with Replit" i],
  div[aria-label*="Made with Replit" i] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    width: 0 !important;
    height: 0 !important;
    position: fixed !important;
    left: -9999px !important;
  }
`;

const SUSPECT = /replit[-_ ]?(pill|badge)/i;

function looksLikeBadge(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const el = node as HTMLElement & { src?: string };
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "replit-badge" || tag === "replit-pill") return true;
  if (el.id && SUSPECT.test(el.id)) return true;
  const cls = el.className;
  if (typeof cls === "string" && SUSPECT.test(cls)) return true;
  const label = el.getAttribute && el.getAttribute("aria-label");
  if (label && /made with replit/i.test(label)) return true;
  if (
    tag === "script" &&
    el.src &&
    /replit-pill|replit-cdn\.com\/replit-pill/.test(el.src)
  )
    return true;
  if (
    tag === "iframe" &&
    el.src &&
    /replit\.com\/(badge|public\/banner)|replit-pill/.test(el.src)
  )
    return true;
  return false;
}

function purge(root: ParentNode | Document): number {
  let removed = 0;
  try {
    const sel =
      "replit-badge,replit-pill,[data-replit-badge],[data-replit-pill]," +
      ".replit-badge,.replit-pill,iframe[src*='replit-pill']," +
      "iframe[src*='replit.com/badge'],script[src*='replit-pill']," +
      "[id^='replit-']";
    root.querySelectorAll(sel).forEach((n) => {
      n.remove();
      removed++;
    });
    // Custom elements with "replit" in their tag name
    root.querySelectorAll("*").forEach((n) => {
      const tag = (n.tagName || "").toLowerCase();
      if (tag.includes("-") && SUSPECT.test(tag)) {
        n.remove();
        removed++;
      }
    });
    root.querySelectorAll("a,div,span").forEach((n) => {
      const text = n.textContent ?? "";
      if (
        /made with replit/i.test(text) &&
        (n as HTMLElement).children.length <= 3
      ) {
        let target: HTMLElement = n as HTMLElement;
        for (let i = 0; i < 3 && target.parentElement; i++) {
          if (target.parentElement.children.length > 4) break;
          target = target.parentElement;
        }
        target.remove();
        removed++;
      }
    });
  } catch {
    // no-op
  }
  return removed;
}

export function WebBadgeRemover(): null {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof document === "undefined") return;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const obs = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((n) => {
          if (looksLikeBadge(n)) {
            try {
              (n as ChildNode).remove();
            } catch {
              // no-op
            }
          } else if ((n as Element).querySelectorAll) {
            purge(n as Element);
          }
        });
      });
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    purge(document);
    // Periodic safety net — Replit's pill loads asynchronously and re-mounts.
    const interval = setInterval(() => {
      purge(document);
    }, 500);

    return () => {
      obs.disconnect();
      clearInterval(interval);
    };
  }, []);

  return null;
}
