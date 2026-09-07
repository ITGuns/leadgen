import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { secureConfig } from "@/db/schema";
import { env, now } from "./config";

/**
 * DECISIONS D8 (revised for D19) — encrypted at-rest store for secrets entered via
 * the UI (Drive OAuth refresh token, API keys). AES-256-GCM, key = SHA-256(APP_SECRET).
 * Serverless has no persistent volume, so the ciphertext lives in the `secure_config`
 * table — values are never stored or logged in plaintext, and are useless without the
 * APP_SECRET held only in the deployment's env.
 */

function keyBytes(): Buffer {
  return crypto.createHash("sha256").update(env.appSecret()).digest();
}

function assertName(name: string): void {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`bad secure-store key: ${name}`);
}

export async function secureSet(name: string, value: unknown): Promise<void> {
  assertName(name);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
  await getDb()
    .insert(secureConfig)
    .values({ name, payload, updatedAt: now().toISOString() })
    .onConflictDoUpdate({ target: secureConfig.name, set: { payload, updatedAt: now().toISOString() } });
}

export async function secureGet<T>(name: string): Promise<T | null> {
  assertName(name);
  const rows = await getDb().select().from(secureConfig).where(eq(secureConfig.name, name)).limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    const buf = Buffer.from(row.payload, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString("utf8")) as T;
  } catch {
    return null; // wrong APP_SECRET or corrupt payload — treated as absent
  }
}

export async function secureDelete(name: string): Promise<void> {
  assertName(name);
  await getDb().delete(secureConfig).where(eq(secureConfig.name, name));
}

/** Effective secret: UI-entered (secure store) wins over env. */
export async function effectiveSecret(name: string, envValue: string): Promise<string> {
  const stored = await secureGet<string>(name);
  return stored || envValue;
}
