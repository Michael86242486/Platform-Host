import slugify from "slugify";
import { eq } from "drizzle-orm";

import { db, sitesTable } from "./db";

const RANDOM_SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomSuffix(len = 5): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += RANDOM_SUFFIX_ALPHABET[
      Math.floor(Math.random() * RANDOM_SUFFIX_ALPHABET.length)
    ];
  }
  return out;
}

export async function uniqueSlug(seed: string): Promise<string> {
  const base = slugify(seed || "site", {
    lower: true,
    strict: true,
    trim: true,
  })
    .slice(0, 32)
    .replace(/^-+|-+$/g, "") || "site";

  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = `${base}-${randomSuffix()}`;
    const existing = await db
      .select({ id: sitesTable.id })
      .from(sitesTable)
      .where(eq(sitesTable.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  return `${base}-${randomSuffix(8)}`;
}

export function inferSiteName(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 40) return capitalize(cleaned);
  // Take the first phrase up to a punctuation mark or 40 chars
  const phrase = cleaned.split(/[.,;:!?\n]/)[0];
  return capitalize(phrase.length > 40 ? phrase.slice(0, 40) + "…" : phrase);
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
