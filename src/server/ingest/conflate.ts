import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, placesFsq, placesOverture, releases, type BusinessSources } from "@/db/schema";
import { classifyStatic } from "../classify";
import { now } from "../config";
import { identityKeyFor } from "../identity";
import { domainOf, haversineMeters, jaroWinkler, normalizeName, normalizePhone } from "../normalize";
import type { JobContext } from "../jobs/registry";
import { JobStopped } from "../jobs/registry";
import { activeRelease } from "./releases";
import { flagChains } from "./chains";

/**
 * CONTRACTS C4 — conflation into `businesses`.
 * Overture rows are the spine (identityKey = overture:<gers>, ids stable across releases
 * so leads never detach). FSQ fills gaps on matched records: phone → domain → name+50m,
 * and NEVER merges when both sides carry different verified phones (gate G1d).
 */

export async function runConflate(ctx: JobContext): Promise<void> {
  const db = getDb();
  const overtureRel = await activeRelease("overture");
  if (!overtureRel) throw new Error("no active overture release — run the extract first");
  const fsqRel = await activeRelease("fsq");
  const ts = now().toISOString();

  // ---- 1) Overture rows → businesses upsert (batched, resumable) ----
  const progress = (ctx.job.progress ?? {}) as { offset?: number; fsqDone?: boolean; stats?: ConflateStats };
  const stats: ConflateStats = {
    overtureUpserts: 0, fsqMatchedPhone: 0, fsqMatchedDomain: 0, fsqMatchedNameLoc: 0,
    fsqConflictSkips: 0, fsqFilledPhones: 0, fsqFilledWebsites: 0, fsqFilledEmails: 0, chainsFlagged: 0,
    created: 0, changedWebsites: 0, changedPhones: 0, disappeared: 0,
    ...(progress.stats ?? {}),
  };
  const BATCH = 500;
  if (!progress.fsqDone) {
    for (let offset = progress.offset ?? 0; ; offset += BATCH) {
      if (ctx.shouldStop()) throw new JobStopped();
      const rows = await db
        .select()
        .from(placesOverture)
        .where(eq(placesOverture.releaseId, overtureRel.releaseId))
        .orderBy(placesOverture.gersId)
        .limit(BATCH)
        .offset(offset);
      if (rows.length === 0) break;
      await db.transaction(async (tx) => {
        for (const r of rows) {
          const phone = (r.phones ?? []).map(normalizePhone).find(Boolean) ?? null;
          const websiteRaw = (r.websites ?? [])[0] ?? null;
          const websiteNormalized = websiteRaw ? domainOf(websiteRaw) : null;
          const staticClass = classifyStatic(r.websites, r.socials);
          const [existing] = await tx.select().from(businesses).where(eq(businesses.gersId, r.gersId)).limit(1);
          const base = {
            name: r.name,
            normalizedName: normalizeName(r.name),
            phone: phone ?? existing?.phone ?? null,
            phoneSource: phone ? "overture" : existing?.phoneSource ?? null,
            websiteRaw: websiteRaw ?? existing?.websiteRaw ?? null,
            websiteNormalized: websiteNormalized ?? existing?.websiteNormalized ?? null,
            websiteSource: websiteRaw ? "overture" : existing?.websiteSource ?? null,
            socials: r.socials ?? [],
            emails: (r.emails ?? []).length ? r.emails : existing?.emails ?? [],
            street: r.street, city: r.city, region: r.region, postal: r.postal,
            lat: r.lat, lng: r.lng,
            taxonomyPrimary: r.taxonomyPrimary,
            taxonomyAlternates: r.taxonomyAlternates ?? [],
            confidence: r.confidence,
            operatingStatus: r.operatingStatus ?? "unknown",
            lastSeenRelease: overtureRel.releaseId,
            updatedAt: ts,
          };
          if (existing) {
            // keep a fetched classification unless the website itself changed
            const websiteChanged = (websiteRaw ?? null) !== (existing.websiteRaw ?? null);
            // §4.0 release diff: count changes only across releases, so a same-release re-run diffs to zero
            const fromPriorRelease = existing.lastSeenRelease !== overtureRel.releaseId;
            if (fromPriorRelease && websiteChanged) stats.changedWebsites++;
            if (fromPriorRelease && phone && existing.phone && phone !== existing.phone) stats.changedPhones++;
            const websiteClass = websiteChanged
              ? staticClass
              : existing.websiteClass === "unknown" ? staticClass : existing.websiteClass;
            const sources: BusinessSources = { ...(existing.sources ?? {}), overture: { release: overtureRel.releaseId } };
            await tx.update(businesses).set({ ...base, websiteClass, sources }).where(eq(businesses.id, existing.id));
          } else {
            await tx.insert(businesses).values({
              ...base,
              gersId: r.gersId,
              identityKey: identityKeyFor({ gersId: r.gersId, name: r.name }),
              websiteClass: staticClass,
              sources: { overture: { release: overtureRel.releaseId } },
              firstSeenRelease: overtureRel.releaseId,
              createdAt: ts,
            });
            stats.created++;
          }
          stats.overtureUpserts++;
        }
      });
      await ctx.checkpoint({ offset: offset + rows.length, stats });
    }
    await ctx.checkpoint({ fsqDone: false, offset: -1, stats }); // overture pass complete
  }

  // ---- 2) FSQ gap-fill on matched records ----
  if (fsqRel && !progress.fsqDone) {
    const fsqRows = await db.select().from(placesFsq).where(eq(placesFsq.releaseId, fsqRel.releaseId));
    let processed = 0;
    for (const f of fsqRows) {
      if (ctx.shouldStop()) throw new JobStopped();
      const fPhone = normalizePhone(f.tel);
      const fDomain = domainOf(f.website);
      const fName = normalizeName(f.name);

      let match: typeof businesses.$inferSelect | undefined;
      let how: "phone" | "domain" | "nameloc" | undefined;
      if (fPhone) {
        [match] = await db.select().from(businesses).where(eq(businesses.phone, fPhone)).limit(1);
        if (match) how = "phone";
      }
      if (!match && fDomain) {
        [match] = await db.select().from(businesses).where(eq(businesses.websiteNormalized, fDomain)).limit(1);
        if (match) how = "domain";
      }
      if (!match && fName && f.lat != null && f.lng != null) {
        const candidates = await db
          .select()
          .from(businesses)
          .where(and(eq(businesses.normalizedName, fName), eq(businesses.region, f.region ?? "")))
          .limit(25);
        match = candidates.find(
          (c) =>
            c.lat != null && c.lng != null &&
            haversineMeters(c.lat, c.lng, f.lat!, f.lng!) <= 50 &&
            jaroWinkler(c.normalizedName, fName) >= 0.85,
        );
        if (match) how = "nameloc";
      }

      if (match) {
        // G1d: never merge two records with different verified phones
        if (fPhone && match.phone && fPhone !== match.phone) {
          stats.fsqConflictSkips++;
          const sources: BusinessSources = { ...(match.sources ?? {}) };
          sources.conflicts = [
            ...(sources.conflicts ?? []),
            { field: "phone", kept: match.phone, other: fPhone, otherSource: "fsq" },
          ];
          await db.update(businesses).set({ sources, updatedAt: ts }).where(eq(businesses.id, match.id));
        } else {
          const patch: Partial<typeof businesses.$inferInsert> = { updatedAt: ts };
          const sources: BusinessSources = { ...(match.sources ?? {}), fsq: { release: fsqRel.releaseId, fsqId: f.fsqId } };
          if (fPhone && !match.phone) {
            patch.phone = fPhone;
            patch.phoneSource = "fsq";
            stats.fsqFilledPhones++;
          }
          if (fDomain && !match.websiteRaw) {
            patch.websiteRaw = f.website;
            patch.websiteNormalized = fDomain;
            patch.websiteSource = "fsq";
            patch.websiteClass = classifyStatic([f.website!], match.socials);
            stats.fsqFilledWebsites++;
          } else if (fDomain && match.websiteNormalized && fDomain !== match.websiteNormalized) {
            sources.conflicts = [
              ...(sources.conflicts ?? []),
              { field: "website", kept: match.websiteNormalized, other: fDomain, otherSource: "fsq" },
            ];
          }
          if (f.email && !(match.emails ?? []).length) {
            patch.emails = [f.email];
            stats.fsqFilledEmails++;
          }
          patch.sources = sources;
          await db.update(businesses).set(patch).where(eq(businesses.id, match.id));
          await db.update(placesFsq).set({ matchedGersId: match.gersId }).where(eq(placesFsq.fsqId, f.fsqId));
          if (how === "phone") stats.fsqMatchedPhone++;
          else if (how === "domain") stats.fsqMatchedDomain++;
          else stats.fsqMatchedNameLoc++;
        }
      }
      processed++;
      if (processed % 200 === 0) await ctx.checkpoint({ stats });
    }
  }

  // ---- 3) chain flagging (§4.2) ----
  stats.chainsFlagged = await flagChains();

  // ---- 4) release diff summary (§4.0): new / changed / disappeared, stored on the
  // active release row and rendered in Settings; disappeared records feed §4.5 ----
  const [disappearedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(businesses)
    .where(sql`${businesses.gersId} IS NOT NULL AND coalesce(${businesses.lastSeenRelease}, '') != ${overtureRel.releaseId}`);
  stats.disappeared = disappearedRow?.n ?? 0;
  const [relRow] = await db.select().from(releases).where(eq(releases.id, overtureRel.id)).limit(1);
  const gateReport = {
    ...((relRow?.gateReport as Record<string, unknown> | null) ?? {}),
    diff: {
      new: stats.created,
      changedWebsites: stats.changedWebsites,
      changedPhones: stats.changedPhones,
      disappeared: stats.disappeared,
      computedAt: now().toISOString(),
    },
  };
  await db.update(releases).set({ gateReport }).where(eq(releases.id, overtureRel.id));

  await ctx.checkpoint({ fsqDone: true, stats });
}

export type ConflateStats = {
  overtureUpserts: number;
  fsqMatchedPhone: number;
  fsqMatchedDomain: number;
  fsqMatchedNameLoc: number;
  fsqConflictSkips: number;
  fsqFilledPhones: number;
  fsqFilledWebsites: number;
  fsqFilledEmails: number;
  chainsFlagged: number;
  // §4.0 release diff (relative to whatever the businesses table held before this run)
  created: number;
  changedWebsites: number;
  changedPhones: number;
  disappeared: number;
};

/** Businesses that disappeared from the active release (freshness §4.5). */
export async function disappearedBusinessIds(): Promise<number[]> {
  const rel = await activeRelease("overture");
  if (!rel) return [];
  const rows = await getDb()
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(sql`${businesses.lastSeenRelease} != ${rel.releaseId}`, inArray(businesses.operatingStatus, ["open", "unknown"])));
  return rows.map((r) => r.id);
}
