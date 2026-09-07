import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, type BusinessSources } from "@/db/schema";
import { classifyStatic } from "../classify";
import { now } from "../config";
import { domainOf, haversineMeters, jaroWinkler, normalizeName, normalizePhone } from "../normalize";
import type { RawListing } from "../providers/types";

/**
 * C4 — paid top-up records join `businesses` through the same matcher as FSQ
 * (phone → domain → name+50m), with the same G1d never-merge rule. Unmatched records
 * become new businesses keyed by the provider place id (C3 precedence).
 */

export type TopUpMergeResult = { businessId: number; created: boolean; ownerName?: string | null };

export async function mergeRawListing(raw: RawListing, intentId: number): Promise<TopUpMergeResult | null> {
  const db = getDb();
  if (!raw.name?.trim()) return null;
  const ts = now().toISOString();
  const phone = normalizePhone(raw.phone);
  const domain = domainOf(raw.website);
  const normalized = normalizeName(raw.name);
  const region = (raw.region ?? "").toUpperCase().slice(0, 2) || null;

  let match: typeof businesses.$inferSelect | undefined;
  if (phone) [match] = await db.select().from(businesses).where(eq(businesses.phone, phone)).limit(1);
  if (!match && domain) [match] = await db.select().from(businesses).where(eq(businesses.websiteNormalized, domain)).limit(1);
  if (!match && normalized && raw.lat != null && raw.lng != null && region) {
    const candidates = await db
      .select()
      .from(businesses)
      .where(and(eq(businesses.normalizedName, normalized), eq(businesses.region, region)))
      .limit(25);
    match = candidates.find(
      (c) =>
        c.lat != null && c.lng != null &&
        haversineMeters(c.lat, c.lng, raw.lat!, raw.lng!) <= 50 &&
        jaroWinkler(c.normalizedName, normalized) >= 0.85,
    );
  }

  if (match) {
    // G1d: differing verified phones = different businesses → record conflict, no merge
    if (phone && match.phone && phone !== match.phone) {
      const sources: BusinessSources = { ...(match.sources ?? {}) };
      sources.conflicts = [
        ...(sources.conflicts ?? []),
        { field: "phone", kept: match.phone, other: phone, otherSource: "outscraper" },
      ];
      await db.update(businesses).set({ sources, updatedAt: ts }).where(eq(businesses.id, match.id));
      return null;
    }
    const patch: Partial<typeof businesses.$inferInsert> = { updatedAt: ts };
    const sources: BusinessSources = {
      ...(match.sources ?? {}),
      outscraper: { placeId: raw.providerPlaceId ?? undefined, intentId },
    };
    if (phone && !match.phone) {
      patch.phone = phone;
      patch.phoneSource = "outscraper";
    }
    if (domain && !match.websiteRaw) {
      patch.websiteRaw = raw.website;
      patch.websiteNormalized = domain;
      patch.websiteSource = "outscraper";
      patch.websiteClass = classifyStatic([raw.website!], match.socials);
    }
    if (raw.email && !(match.emails ?? []).length) patch.emails = [raw.email];
    patch.sources = sources;
    await db.update(businesses).set(patch).where(eq(businesses.id, match.id));
    return { businessId: match.id, created: false, ownerName: raw.ownerName };
  }

  // new business — identity per C3: provider place id → phone → domain+name → name+loc
  const identityKey = raw.providerPlaceId
    ? `gplace:${raw.providerPlaceId}`
    : phone
      ? `phone:${phone}`
      : domain
        ? `dn:${domain}|${normalized}`
        : `nl:${normalized}|${(raw.city ?? "").toLowerCase()}|${region ?? ""}`;
  const [existing] = await db.select().from(businesses).where(eq(businesses.identityKey, identityKey)).limit(1);
  if (existing) return { businessId: existing.id, created: false, ownerName: raw.ownerName };

  const [row] = await db
    .insert(businesses)
    .values({
      identityKey,
      name: raw.name.trim(),
      normalizedName: normalized,
      phone,
      phoneSource: phone ? "outscraper" : null,
      websiteRaw: raw.website ?? null,
      websiteNormalized: domain,
      websiteSource: raw.website ? "outscraper" : null,
      websiteClass: classifyStatic(raw.website ? [raw.website] : [], []),
      socials: [],
      emails: raw.email ? [raw.email] : [],
      street: raw.street,
      city: raw.city,
      region,
      postal: raw.postal,
      lat: raw.lat,
      lng: raw.lng,
      taxonomyPrimary: null, // provider category is not Overture taxonomy — kept in sources only
      taxonomyAlternates: [],
      confidence: null,
      operatingStatus: "open",
      sources: { outscraper: { placeId: raw.providerPlaceId ?? undefined, intentId } },
      createdAt: ts,
      updatedAt: ts,
    })
    .returning({ id: businesses.id });
  return { businessId: row.id, created: true, ownerName: raw.ownerName };
}
