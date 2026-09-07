import { and, eq, inArray, or, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, leads } from "@/db/schema";
import { NO_SITE_CLASSES, type WebsiteClass } from "../classify";
import { now } from "../config";
import { checkWebsite } from "../enrich/website-check";
import { getFetcher } from "../fetcher";
import { activeRelease } from "../ingest/releases";
import { computeScore } from "../scoring/score";
import type { JobContext } from "./registry";
import { JobStopped } from "./registry";

/**
 * §4.5 — weekly no-spend freshness sweep for leads in active statuses:
 * re-check website status (own fetch + cached PageSpeed only), flag newly-launched
 * sites (a "no website" lead that now has one is GONE as a hot lead), dead hosts,
 * and businesses that disappeared from the latest release. Re-pulls stay manual.
 */

const ACTIVE_STATUSES = ["new", "contacted", "interested"];
const RECHECK_AFTER_DAYS = 7;
const MAX_PER_RUN = 500;

export async function runFreshness(ctx: JobContext): Promise<void> {
  const db = getDb();
  const fetcher = await getFetcher();
  const cutoff = new Date(now().getTime() - RECHECK_AFTER_DAYS * 86400_000).toISOString();

  const stale = await db
    .select({ lead: leads, business: businesses })
    .from(leads)
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(
      and(
        inArray(leads.status, ACTIVE_STATUSES),
        sql`${businesses.websiteRaw} IS NOT NULL`,
        or(isNull(leads.lastVerifiedAt), lt(leads.lastVerifiedAt, cutoff)),
      ),
    )
    .limit(MAX_PER_RUN);

  let rechecked = 0;
  let launched = 0;
  let died = 0;
  for (const { lead, business } of stale) {
    if (ctx.shouldStop()) throw new JobStopped();
    const wasNoSite = NO_SITE_CLASSES.includes(business.websiteClass as WebsiteClass);
    try {
      const outcome = await checkWebsite(fetcher, business.websiteRaw!);
      const ts = now().toISOString();
      const tags = new Set(lead.tags ?? []);
      if (wasNoSite && outcome.websiteClass === "real_site") {
        tags.add("site-launched"); // no longer a hot no-website lead
        launched++;
      }
      if (!wasNoSite && (outcome.websiteClass === "dead" || outcome.websiteClass === "parked")) {
        tags.add("site-died");
        died++;
      }
      const mobileScore = lead.pagespeed && lead.pagespeed.mobileScore >= 0 ? lead.pagespeed.mobileScore : null;
      const { score, reasons } = computeScore({ websiteClass: outcome.websiteClass, check: outcome.check, mobileScore });
      await db.update(businesses).set({ websiteClass: outcome.websiteClass, updatedAt: ts }).where(eq(businesses.id, business.id));
      await db
        .update(leads)
        .set({ websiteCheck: outcome.check, score, scoreReasons: reasons, tags: [...tags], lastVerifiedAt: ts, updatedAt: ts })
        .where(eq(leads.id, lead.id));
      rechecked++;
    } catch {
      // freshness is best-effort; leave the lead for the next sweep
    }
    if (rechecked % 50 === 0) await ctx.checkpoint({ rechecked, launched, died });
  }

  // leads whose business vanished from the active release (§4.0 release diffing feeds this)
  const rel = await activeRelease("overture");
  let disappeared = 0;
  if (rel) {
    const gone = await db
      .select({ lead: leads })
      .from(leads)
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .where(
        and(
          inArray(leads.status, ACTIVE_STATUSES),
          sql`${businesses.gersId} IS NOT NULL AND coalesce(${businesses.lastSeenRelease}, '') != ${rel.releaseId}`,
        ),
      )
      .limit(2000);
    const ts = now().toISOString();
    for (const { lead } of gone) {
      const tags = new Set(lead.tags ?? []);
      if (tags.has("not-in-latest-release")) continue;
      tags.add("not-in-latest-release");
      await db.update(leads).set({ tags: [...tags], updatedAt: ts }).where(eq(leads.id, lead.id));
      disappeared++;
    }
  }
  await ctx.checkpoint({ rechecked, launched, died, disappeared, done: true });
}
