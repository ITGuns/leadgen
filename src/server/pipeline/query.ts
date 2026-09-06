import { SQL, and, sql } from "drizzle-orm";
import { businesses, type campaigns } from "@/db/schema";

/**
 * The §3.1 campaign filters as ONE condition builder — estimate and pull must count
 * the same universe (C7). Free-first: this is a local query, instant, $0.
 */

type Campaign = typeof campaigns.$inferSelect;

export function candidateConditions(campaign: Campaign): SQL {
  const f = campaign.filters;
  const parts: SQL[] = [];

  const tax = campaign.confirmedTaxonomy;
  const taxList = sql.join(tax.map((t) => sql`${t}`), sql`, `);
  parts.push(
    sql`(${businesses.taxonomyPrimary} IN (${taxList}) OR EXISTS (
      SELECT 1 FROM json_each(coalesce(${businesses.taxonomyAlternates}, '[]')) je WHERE je.value IN (${taxList})))`,
  );

  const stateList = sql.join(campaign.states.map((s) => sql`${s.toUpperCase()}`), sql`, `);
  parts.push(sql`${businesses.region} IN (${stateList})`);

  if (campaign.cityList?.length) {
    // §3.1 — "optional city/ZIP list upload for precision": 5-digit entries match postal,
    // everything else matches the city name; a business passes on either.
    const entries = campaign.cityList.map((c) => c.trim()).filter(Boolean);
    const zips = entries.filter((c) => /^\d{5}$/.test(c));
    const cities = entries.filter((c) => !/^\d{5}$/.test(c)).map((c) => c.toLowerCase());
    const geoParts: SQL[] = [];
    if (cities.length)
      geoParts.push(sql`lower(coalesce(${businesses.city}, '')) IN (${sql.join(cities.map((c) => sql`${c}`), sql`, `)})`);
    if (zips.length)
      geoParts.push(sql`coalesce(${businesses.postal}, '') IN (${sql.join(zips.map((z) => sql`${z}`), sql`, `)})`);
    if (geoParts.length) parts.push(sql`(${sql.join(geoParts, sql` OR `)})`);
  }

  // "open" filter excludes confirmed-closed; unknown/null pass (real data is often null — probe 2026-09-03)
  if (f.operatingOnly) parts.push(sql`coalesce(${businesses.operatingStatus}, 'unknown') != 'closed'`);

  parts.push(sql`coalesce(${businesses.confidence}, 0) >= ${f.minConfidence}`);

  if (f.hasPhone) parts.push(sql`${businesses.phone} IS NOT NULL`);

  // D17 — two-phase website filter: static classes at pull time; score stage re-enforces post-fetch
  if (f.hasWebsite === "yes") parts.push(sql`${businesses.websiteClass} IN ('real_site', 'unknown')`);
  if (f.hasWebsite === "no")
    parts.push(sql`${businesses.websiteClass} IN ('none', 'social_only', 'aggregator', 'parked', 'dead')`);

  if (f.excludeChains) parts.push(sql`${businesses.chain} = 0`);

  if (f.sources?.length && f.sources.length < 3) {
    const srcParts = f.sources.map((s) => sql`json_extract(${businesses.sources}, ${"$." + s}) IS NOT NULL`);
    parts.push(sql`(${sql.join(srcParts, sql` OR `)})`);
  }

  if (!f.includeContactless) {
    parts.push(
      sql`(${businesses.phone} IS NOT NULL OR ${businesses.websiteRaw} IS NOT NULL OR coalesce(json_array_length(${businesses.emails}), 0) > 0)`,
    );
  }

  return and(...parts)!;
}

export function candidateOrder(): SQL {
  return sql`coalesce(${businesses.confidence}, 0) DESC, ${businesses.id} ASC`;
}
