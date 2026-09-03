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

export function loadSuppressionSets(kind: "client" | "dnc"): SuppressionSets {
  const rows = getDb().select().from(suppressions).where(eq(suppressions.kind, kind)).all();
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
export function importSuppressions(
  kind: "client" | "dnc",
  entries: string[],
  actor: string,
  source?: string,
): { added: number; invalid: number; duplicates: number } {
  const db = getDb();
  let added = 0, invalid = 0, duplicates = 0;
  const ts = now().toISOString();
  for (const raw of entries) {
    const value = raw.trim();
    if (!value) continue;
    const phone = normalizePhone(value);
    const domain = phone ? null : domainOf(value)?.split(/[/?]/)[0] ?? null;
    if (!phone && !domain) {
      invalid++;
      continue;
    }
    try {
      const res = db
        .insert(suppressions)
        .values({ kind, phone, domain, source: source ?? "manual import", createdAt: ts })
        .onConflictDoNothing()
        .run();
      if (res.changes) added++;
      else duplicates++;
    } catch {
      invalid++;
    }
  }
  audit(actor, "suppressions.import", { kind, added, invalid, duplicates, source });
  return { added, invalid, duplicates };
}
