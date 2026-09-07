import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { appSettings } from "@/db/schema";
import { now } from "./config";

/** Runtime-tunable operational settings, stored in app_settings. Not for secrets. */

export async function getSetting<T>(key: string, dflt: T): Promise<T> {
  const rows = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const row = rows[0];
  if (!row || row.value === null || row.value === undefined) return dflt;
  return row.value as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await getDb()
    .insert(appSettings)
    .values({ key, value, updatedAt: now().toISOString() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now().toISOString() } });
}
