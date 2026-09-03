import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "./config";

/**
 * DECISIONS D8 — encrypted at-rest store for secrets entered via the UI
 * (Drive OAuth refresh token, API keys). AES-256-GCM, key = SHA-256(APP_SECRET).
 * Files live under CONFIG_DIR on the /data volume — never in the DB, never in git.
 */

function keyBytes(): Buffer {
  return crypto.createHash("sha256").update(env.appSecret()).digest();
}
function fileFor(name: string): string {
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`bad secure-store key: ${name}`);
  return path.join(env.configDir(), `${name}.enc`);
}

export function secureSet(name: string, value: unknown): void {
  fs.mkdirSync(env.configDir(), { recursive: true });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
  fs.writeFileSync(fileFor(name), payload, { mode: 0o600 });
}

export function secureGet<T>(name: string): T | null {
  const f = fileFor(name);
  if (!fs.existsSync(f)) return null;
  try {
    const buf = Buffer.from(fs.readFileSync(f, "utf8"), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString("utf8")) as T;
  } catch {
    return null; // wrong APP_SECRET or corrupt file — treated as absent
  }
}

export function secureDelete(name: string): void {
  const f = fileFor(name);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

/** Effective secret: UI-entered (secure store) wins over env. */
export function effectiveSecret(name: string, envValue: string): string {
  const stored = secureGet<string>(name);
  return stored || envValue;
}
