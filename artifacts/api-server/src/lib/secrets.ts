import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";

import { db, secretsTable } from "./db";
import { logger } from "./logger";

/**
 * Per-user encrypted secrets vault.
 *
 * Storage format for a value: base64(iv) ":" base64(authTag) ":" base64(ciphertext)
 * Encryption: AES-256-GCM with a 12-byte random IV per write.
 *
 * Master key derivation:
 *   - If WEBFORGE_SECRETS_KEY is set, use it directly (32 bytes after sha256).
 *   - Otherwise derive from SESSION_SECRET || DATABASE_URL || a stable fallback.
 *     This is intentionally deterministic so secrets survive restarts even when
 *     WEBFORGE_SECRETS_KEY hasn't been provisioned.
 */
function masterKey(): Buffer {
  const explicit = process.env["WEBFORGE_SECRETS_KEY"];
  if (explicit) return createHash("sha256").update(explicit).digest();
  const seed =
    process.env["SESSION_SECRET"] ||
    process.env["DATABASE_URL"] ||
    "webforge-default-secrets-key-do-not-use-in-prod";
  return createHash("sha256").update(seed).digest();
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("malformed ciphertext");
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

export function isValidSecretName(name: string): boolean {
  return SECRET_NAME_RE.test(name);
}

export interface StoredSecretSummary {
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listSecrets(
  userId: string,
): Promise<StoredSecretSummary[]> {
  const rows = await db
    .select({
      name: secretsTable.name,
      createdAt: secretsTable.createdAt,
      updatedAt: secretsTable.updatedAt,
    })
    .from(secretsTable)
    .where(eq(secretsTable.userId, userId))
    .orderBy(asc(secretsTable.name));
  return rows;
}

/**
 * Insert or update a user's secret. Validates the name and re-encrypts on
 * every write. Returns true on success.
 */
export async function setSecret(
  userId: string,
  name: string,
  value: string,
): Promise<boolean> {
  if (!isValidSecretName(name)) return false;
  const ct = encrypt(value);
  await db
    .insert(secretsTable)
    .values({ userId, name, value: ct })
    .onConflictDoUpdate({
      target: [secretsTable.userId, secretsTable.name],
      set: { value: ct, updatedAt: new Date() },
    });
  return true;
}

export async function deleteSecret(
  userId: string,
  name: string,
): Promise<boolean> {
  const res = await db
    .delete(secretsTable)
    .where(and(eq(secretsTable.userId, userId), eq(secretsTable.name, name)))
    .returning({ id: secretsTable.id });
  return res.length > 0;
}

/**
 * Decrypt every secret for a user. Used at build-time to inject secrets into
 * generated sites. Decryption failures (e.g. master key changed) are logged
 * and the bad row is skipped — we never throw to a build worker.
 */
export async function getDecryptedSecrets(
  userId: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ name: secretsTable.name, value: secretsTable.value })
    .from(secretsTable)
    .where(eq(secretsTable.userId, userId));
  const out: Record<string, string> = {};
  for (const r of rows) {
    try {
      out[r.name] = decrypt(r.value);
    } catch (err) {
      logger.warn(
        { err: String(err), name: r.name, userId },
        "secret decryption failed; skipping",
      );
    }
  }
  return out;
}

/**
 * Inject secrets into a built file map. Replaces any literal `${SECRET_NAME}`
 * occurrence in any file body with the secret's plaintext value. Names that
 * were referenced but not stored are left as-is so the developer notices.
 */
export function injectSecretsIntoFiles(
  files: Record<string, string>,
  secrets: Record<string, string>,
): Record<string, string> {
  if (Object.keys(secrets).length === 0) return files;
  const out: Record<string, string> = {};
  for (const [path, body] of Object.entries(files)) {
    out[path] = body.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (full, name: string) => {
      return Object.prototype.hasOwnProperty.call(secrets, name)
        ? secrets[name]
        : full;
    });
  }
  return out;
}
