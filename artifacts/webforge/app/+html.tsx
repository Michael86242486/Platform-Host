import { ScrollViewStyleReset } from "expo-router/html";
import React, { type PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren): React.ReactElement {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: badgeHiddenCss }} />
        <script dangerouslySetInnerHTML={{ __html: badgeRemoverJs }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const badgeHiddenCss = `
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

const badgeRemoverJs = `
(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var SUSPECT = /replit[-_ ]?(pill|badge)/i;
  function looksLikeBadge(node) {
    if (!node || node.nodeType !== 1) return false;
    var el = node;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "replit-badge" || tag === "replit-pill") return true;
    if (el.id && SUSPECT.test(el.id)) return true;
    if (el.className && typeof el.className === "string" && SUSPECT.test(el.className)) return true;
    var label = el.getAttribute && el.getAttribute("aria-label");
    if (label && /made with replit/i.test(label)) return true;
    if (tag === "script" && el.src && /replit-pill|replit-cdn\\.com\\/replit-pill/.test(el.src)) return true;
    if (tag === "iframe" && el.src && /replit\\.com\\/(badge|public\\/banner)|replit-pill/.test(el.src)) return true;
    return false;
  }
  function purge(root) {
    if (!root || !root.querySelectorAll) return;
    try {
      root.querySelectorAll("replit-badge,replit-pill,[data-replit-badge],[data-replit-pill],.replit-badge,.replit-pill,iframe[src*='replit-pill'],iframe[src*='replit.com/badge'],script[src*='replit-pill']").forEach(function (n) {
        try { n.remove(); } catch (_) {}
      });
      // Anything with text "Made with Replit"
      root.querySelectorAll("a,div,span").forEach(function (n) {
        try {
          if (n.textContent && /made with replit/i.test(n.textContent) && n.children.length <= 3) {
            // Walk up to a small wrapper and remove
            var target = n;
            for (var i = 0; i < 3 && target.parentElement; i++) {
              if (target.parentElement.children.length > 4) break;
              target = target.parentElement;
            }
            target.remove();
          }
        } catch (_) {}
      });
    } catch (_) {}
  }
  // Observe future insertions
  var obs = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes && m.addedNodes.forEach(function (n) {
        if (looksLikeBadge(n)) {
          try { n.remove(); } catch (_) {}
        } else if (n.querySelectorAll) {
          purge(n);
        }
      });
    });
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  // Initial sweep + retries
  purge(document);
  setTimeout(function () { purge(document); }, 250);
  setTimeout(function () { purge(document); }, 1000);
  setTimeout(function () { purge(document); }, 3000);
})();
`;
