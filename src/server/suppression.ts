import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { suppressions, type businesses } from "@/db/schema";
import { audit } from "./audit";
import { domainOf, normalizePhone } from "./normalize";
import { now } from "./config";

/**
 * §3.6 — two lists, different jobs:
 *  · kind='client' (do-not-prospect): existing Gemfield clients — excluded from
 *    campaign pulls AND exports by default. Cold-calling a customer is structural, not
 *    a judgment call.
 *  · kind='dnc': scrubbed numbers/domains — leads still visible (badged), NEVER export.
 */

export type SuppressionSets = { phones: Set<string>; domains: Set<string> };

export async function loadSuppressionSets(kind: "client" | "dnc"): Promise<SuppressionSets> {
  // only the two matching columns — this table can hold 50k+ DNC rows
  const rows = await getDb()
    .select({ phone: suppressions.phone, domain: suppressions.domain })
    .from(suppressions)
    .where(eq(suppressions.kind, kind));
  return {
    phones: new Set(rows.map((r) => r.phone).filter(Boolean) as string[]),
    domains: new Set(rows.map((r) => r.domain).filter(Boolean) as string[]),
  };
}

export function isSuppressed(
  b: Pick<typeof businesses.$inferSelect, "phone" | "websiteNormalized">,
  sets: SuppressionSets,
): boolean {
  if (b.phone && sets.phones.has(b.phone)) return true;
  if (b.websiteNormalized) {
    const domain = b.websiteNormalized.split(/[/?]/)[0];
    if (sets.domains.has(domain)) return true;
  }
  return false;
}

/** Import a pasted batch of phones/domains. Returns counts; audit-logged. */
export async function importSuppressions(
  kind: "client" | "dnc",
  entries: string[],
  actor: string,
  source?: string,
): Promise<{ added: number; invalid: number; duplicates: number }> {
  const db = getDb();
  let invalid = 0;
  const ts = now().toISOString();
  const values: (typeof suppressions.$inferInsert)[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const raw of entries) {
    const value = raw.trim();
    if (!value) continue;
    const phone = normalizePhone(value);
    const domain = phone ? null : domainOf(value)?.split(/[/?]/)[0] ?? null;
    if (!phone && !domain) {
      invalid++;
      continue;
    }
    const key = `${kind}|${phone ?? ""}|${domain ?? ""}`;
    if (seen.has(key)) {
      duplicates++; // duplicate within the paste itself
      continue;
    }
    seen.add(key);
    values.push({ kind, phone, domain, source: source ?? "manual import", createdAt: ts });
  }
  // chunked multi-row inserts — a 50k DNC paste must not be 50k round trips
  let added = 0;
  for (let c = 0; c < values.length; c += 1000) {
    const chunk = values.slice(c, c + 1000);
    const rows = await db.insert(suppressions).values(chunk).onConflictDoNothing().returning({ id: suppressions.id });
    added += rows.length;
    duplicates += chunk.length - rows.length; // already present in the table
  }
  await audit(actor, "suppressions.import", { kind, added, invalid, duplicates, source });
  return { added, invalid, duplicates };
}
