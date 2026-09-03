import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { appSettings } from "@/db/schema";
import { now } from "./config";

/** Runtime-tunable operational settings, stored in app_settings. Not for secrets. */

export function getSetting<T>(key: string, dflt: T): T {
  const row = getDb().select().from(appSettings).where(eq(appSettings.key, key)).get();
  if (!row || row.value === null || row.value === undefined) return dflt;
  return row.value as T;
}

export function setSetting(key: string, value: unknown): void {
  const db = getDb();
  db.insert(appSettings)
    .values({ key, value, updatedAt: now().toISOString() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now().toISOString() } })
    .run();
}
