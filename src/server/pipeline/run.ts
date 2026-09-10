import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { businesses, campaignLeads, campaigns, leads, spendLedger } from "@/db/schema";
import { budgetGuard, BudgetExceededError, recordIntent, recordSpend, updateIntent } from "../budget";
import { defaults, env, now } from "../config";
import { getFetcher } from "../fetcher";
import { checkWebsite, fetchOwnerPages } from "../enrich/website-check";
import { extractOwnerHeuristic } from "../enrich/owner-heuristic";
import { aiAvailable, getAIProvider } from "../providers/ai";
import { getListingsProvider, topUpAvailable } from "../providers/listings";
import {
  cachedPagespeed,
  consumePagespeedQuota,
  getPageSpeed,
  pagespeedAvailable,
  storePagespeed,
} from "../providers/pagespeed";
import { computeScore } from "../scoring/score";
import { isSuppressed, loadSuppressionSets } from "../suppression";
import { JobStopped, type JobContext } from "../jobs/registry";
import { activeRelease } from "../ingest/releases";
import { estimateCampaign } from "./estimate";
import { fanOutCities } from "./fanout";
import { candidateConditions, candidateOrder } from "./query";
import { gates } from "./scheduler";
import { mergeRawListing } from "./topup";
import type { WebsiteClass } from "../classify";

/** C7 — the campaign pipeline. Every stage idempotent & resumable; pause/cancel honored
 * between batches; provider effects guarded by intents; budget checked before every
 * billable call. */

export const STAGE_ORDER = ["plan", "pull", "dedupe", "website_check", "pagespeed", "owner_extract", "score", "ready"] as const;
type Stage = (typeof STAGE_ORDER)[number];

type Campaign = typeof campaigns.$inferSelect;

async function reload(id: number): Promise<Campaign> {
  const [c] = await getDb().select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!c) throw new Error(`campaign ${id} not found`);
  return c;
}

/** 'continue' | 'paused' | 'canceled' — also flips the campaign status when requested. */
async function control(id: number): Promise<"continue" | "paused" | "canceled"> {
  const db = getDb();
  const c = await reload(id);
  if (c.cancelRequested || c.status === "canceled") {
    await db
      .update(campaigns)
      .set({ status: "canceled", cancelRequested: false, completedAt: now().toISOString() })
      .where(eq(campaigns.id, id));
    return "canceled";
  }
  if (c.pauseRequested || c.status === "paused") {
    await db.update(campaigns).set({ status: "paused", pauseRequested: false }).where(eq(campaigns.id, id));
    return "paused";
  }
  return "continue";
}

async function bumpCounts(id: number, patch: Record<string, number>): Promise<void> {
  const db = getDb();
  const c = await reload(id);
  await db
    .update(campaigns)
    .set({ stageCounts: { ...(c.stageCounts ?? {}), ...patch } })
    .where(eq(campaigns.id, id));
}
async function bumpError(id: number, stage: Stage, n = 1): Promise<void> {
  const db = getDb();
  const c = await reload(id);
  const errors = { ...(c.stageErrors ?? {}) };
  errors[stage] = (errors[stage] ?? 0) + n;
  await db.update(campaigns).set({ stageErrors: errors }).where(eq(campaigns.id, id));
}

export async function runCampaign(ctx: JobContext): Promise<void> {
  const db = getDb();
  const campaignId = (ctx.job.payload as { campaignId?: number } | null)?.campaignId ?? ctx.job.campaignId;
  if (!campaignId) throw new Error("campaign_run: no campaignId");
  let c = await reload(campaignId);
  if (["completed", "canceled", "failed", "draft"].includes(c.status)) return;
  if (!c.startedAt) await db.update(campaigns).set({ startedAt: now().toISOString() }).where(eq(campaigns.id, campaignId));

  const progress = (ctx.job.progress ?? {}) as { stageIndex?: number; cityIndex?: number };
  try {
    for (let si = progress.stageIndex ?? 0; si < STAGE_ORDER.length; si++) {
      const stage = STAGE_ORDER[si];
      if (ctx.shouldStop()) throw new JobStopped(); // slice deadline / shutdown (D19)
      if ((await control(campaignId)) !== "continue") return;
      await db.update(campaigns).set({ currentStage: stage }).where(eq(campaigns.id, campaignId));
      c = await reload(campaignId);
      switch (stage) {
        case "plan":
          await stagePlan(c);
          break;
        case "pull":
          await stagePull(c, ctx, progress);
          break;
        case "dedupe":
          await stageDedupe(c);
          break;
        case "website_check":
          await stageWebsiteCheck(c, ctx);
          break;
        case "pagespeed":
          await stagePagespeed(c, ctx);
          break;
        case "owner_extract":
          await stageOwnerExtract(c, ctx);
          break;
        case "score":
          await stageScore(c);
          break;
        case "ready":
          await stageReady(c);
          break;
      }
      await ctx.checkpoint({ stageIndex: si + 1 });
      if ((await control(campaignId)) !== "continue") return;
    }
  } catch (err) {
    // a slice-deadline/shutdown stop is NOT a failure — the job requeues and the next
    // slice resumes from the checkpoint; only a real error on the FINAL attempt
    // flips the campaign to failed (earlier attempts leave it running for the retry)
    if (err instanceof JobStopped) throw err;
    if (ctx.job.attempts >= ctx.job.maxAttempts) {
      await db
        .update(campaigns)
        .set({ status: "failed", completedAt: now().toISOString() })
        .where(eq(campaigns.id, campaignId));
    }
    throw err;
  }
}

// ---------- stages ----------

async function stagePlan(c: Campaign): Promise<void> {
  const db = getDb();
  const overture = await activeRelease("overture");
  if (!overture) throw new Error("no active Overture release — run the monthly ingest first (Settings → Data)");
  const fsq = await activeRelease("fsq");
  const estimate = await estimateCampaign(c);
  if (estimate.totalUSD > c.caps.budgetCapUSD) {
    throw new BudgetExceededError("campaign", estimate.totalUSD, c.caps.budgetCapUSD);
  }
  await db
    .update(campaigns)
    .set({ releaseOverture: overture.releaseId, releaseFsq: fsq?.releaseId ?? null, estimate })
    .where(eq(campaigns.id, c.id));
  await bumpCounts(c.id, { planned: estimate.plannedRecords });
}

async function attachedCount(campaignId: number): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, campaignId));
  return row?.n ?? 0;
}

async function ensureLead(businessId: number): Promise<number> {
  const db = getDb();
  const [existing] = await db.select({ id: leads.id }).from(leads).where(eq(leads.businessId, businessId)).limit(1);
  if (existing) return existing.id;
  const ts = now().toISOString();
  const [row] = await db.insert(leads).values({ businessId, createdAt: ts, updatedAt: ts }).returning({ id: leads.id });
  return row.id;
}

/** true when the lead was newly attached (conflict = already attached). */
async function attachLead(campaignId: number, leadId: number): Promise<boolean> {
  const rows = await getDb()
    .insert(campaignLeads)
    .values({ campaignId, leadId, addedAt: now().toISOString() })
    .onConflictDoNothing()
    .returning({ leadId: campaignLeads.leadId });
  return rows.length > 0;
}

async function stagePull(c: Campaign, ctx: JobContext, progress: { cityIndex?: number }): Promise<void> {
  const db = getDb();
  const cap = c.smoke ? defaults.smokeRecordLimit : c.caps.maxRecords;
  const clientSuppression = await loadSuppressionSets("client");
  let attached = await attachedCount(c.id);
  let suppressedSkipped = 0;

  // ---- free local pull (instant, $0) ----
  const cond = candidateConditions(c);
  let offset = 0;
  while (attached < cap) {
    if (ctx.shouldStop()) throw new JobStopped();
    if ((await control(c.id)) !== "continue") return;
    const batch = await db
      .select()
      .from(businesses)
      .where(cond)
      .orderBy(candidateOrder())
      .limit(500)
      .offset(offset);
    if (batch.length === 0) break;
    for (const b of batch) {
      if (attached >= cap) break;
      if (isSuppressed(b, clientSuppression)) {
        suppressedSkipped++;
        continue;
      }
      const leadId = await ensureLead(b.id);
      if (await attachLead(c.id, leadId)) attached++;
    }
    offset += batch.length;
    await ctx.checkpoint({ pullOffset: offset });
  }
  await bumpCounts(c.id, { pulled: attached, suppressed_clients: suppressedSkipped });

  // ---- optional paid top-up (§4.1/§4.4) ----
  if (c.topUp?.enabled && (await topUpAvailable()) && attached < cap) {
    const provider = await getListingsProvider();
    const cities = await fanOutCities(c.states, { cityList: c.cityList });
    await bumpCounts(c.id, { cities_planned: cities.length });
    let citiesQueried = 0;
    // the top-up carries its own cap on top of the campaign cap and monthly ceiling
    const [spentRow] = await db
      .select({ total: sql<number>`coalesce(sum(amount_usd), 0)::float` })
      .from(spendLedger)
      .where(and(eq(spendLedger.campaignId, c.id), eq(spendLedger.provider, "outscraper")));
    let topUpSpent = spentRow?.total ?? 0;
    for (let ci = progress.cityIndex ?? 0; ci < cities.length && attached < cap; ci++) {
      if ((await control(c.id)) !== "continue") return;
      const city = cities[ci];
      const query = { category: c.niche, city: city.city, region: city.stateId, limit: 50 };
      const estCost = provider.estimateCostUSD(query.limit);
      if (topUpSpent + estCost > c.topUp.capUSD) {
        await bumpCounts(c.id, { topup_budget_stopped: 1 });
        break;
      }
      try {
        await budgetGuard(c.id, estCost);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          await bumpCounts(c.id, { topup_budget_stopped: 1 });
          break;
        }
        throw err;
      }

      const intent = await recordIntent("outscraper", query, c.id, estCost);
      if (intent.status === "fetched" || intent.status === "abandoned" || intent.status === "stalled") continue;

      let providerJobId = intent.providerJobId;
      if (!providerJobId) {
        try {
          const submitted = await provider.submit(query);
          providerJobId = submitted.providerJobId;
          await updateIntent(intent.id, { status: "submitted", providerJobId });
        } catch {
          await updateIntent(intent.id, { status: "abandoned" });
          await bumpError(c.id, "pull");
          continue;
        }
      }

      // poll with backoff; a job stuck past the timeout is marked stalled and surfaced,
      // never resubmitted (§4.4 — a submitted job is billed whether or not fetched)
      const startedAt = Date.now();
      const timeoutMs = env.mockMode ? 10_000 : 30 * 60_000;
      let state: "pending" | "ready" | "failed" = "pending";
      let backoff = env.mockMode ? 5 : 2000;
      for (;;) {
        state = await provider.poll(providerJobId);
        if (state !== "pending") break;
        if (Date.now() - startedAt > timeoutMs) break;
        if ((await control(c.id)) !== "continue") return;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, env.mockMode ? 50 : 30_000);
      }
      if (state === "pending") {
        await updateIntent(intent.id, { status: "stalled" });
        await bumpError(c.id, "pull");
        continue;
      }
      if (state === "failed") {
        await updateIntent(intent.id, { status: "abandoned" });
        await bumpError(c.id, "pull");
        continue;
      }

      // fetch every page — partial results persisted page-by-page so nothing is lost
      let cursor: string | undefined;
      let pages = 0;
      let actualTotal = 0;
      do {
        const page = await provider.fetchPage(providerJobId, cursor);
        pages++;
        actualTotal += page.actualCostUSD ?? 0;
        for (const raw of page.records) {
          const merged = await mergeRawListing(raw, intent.id);
          if (!merged) continue;
          const [b] = await db.select().from(businesses).where(eq(businesses.id, merged.businessId)).limit(1);
          if (isSuppressed(b!, clientSuppression)) {
            suppressedSkipped++;
            continue;
          }
          const leadId = await ensureLead(merged.businessId);
          if (merged.ownerName) {
            await db
              .update(leads)
              .set({
                ownerName: merged.ownerName,
                ownerSource: "outscraper",
                ownerEvidence: "Outscraper listing owner field",
                ownerConfidence: "low",
                updatedAt: now().toISOString(),
              })
              .where(and(eq(leads.id, leadId), isNull(leads.ownerName)));
          }
          if (attached < cap && (await attachLead(c.id, leadId))) attached++;
        }
        await updateIntent(intent.id, { pagesFetched: pages });
        cursor = page.nextCursor;
      } while (cursor);

      const cost = actualTotal > 0 ? actualTotal : estCost;
      await updateIntent(intent.id, { status: "fetched", actualCostUSD: cost });
      await recordSpend("outscraper", c.id, cost, actualTotal > 0 ? "actual" : "estimated", `${query.category} · ${city.city}, ${city.stateId}`);
      topUpSpent += cost;
      citiesQueried++;
      await bumpCounts(c.id, { pulled: attached, cities_queried: citiesQueried, suppressed_clients: suppressedSkipped });
      await ctx.checkpoint({ cityIndex: ci + 1 });
    }
  }
}

async function stageDedupe(c: Campaign): Promise<void> {
  // conflation dedupes at merge time (C4); this stage reports the resulting distinct set
  await bumpCounts(c.id, { deduped: await attachedCount(c.id) });
}

function campaignLeadRows(campaignId: number, where?: SQL) {
  const db = getDb();
  return db
    .select({ lead: leads, business: businesses })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(where ? and(eq(campaignLeads.campaignId, campaignId), where) : eq(campaignLeads.campaignId, campaignId));
}

async function stageWebsiteCheck(c: Campaign, ctx: JobContext): Promise<void> {
  const db = getDb();
  const fetcher = await getFetcher();
  let processed = (((await reload(c.id)).stageCounts ?? {}) as Record<string, number>).website_checked ?? 0;
  for (;;) {
    if ((await control(c.id)) !== "continue") return;
    if (ctx.shouldStop()) throw new JobStopped();
    const batch = await campaignLeadRows(
      c.id,
      sql`${businesses.websiteRaw} IS NOT NULL AND ${leads.websiteCheck} IS NULL AND ${businesses.websiteClass} IN ('unknown', 'real_site')`,
    ).limit(20);
    if (batch.length === 0) break;
    await Promise.all(
      batch.map(async ({ lead, business }) => {
        const release = await gates().fetch.acquire(`c${c.id}`);
        try {
          const outcome = await checkWebsite(fetcher, business.websiteRaw!);
          await db
            .update(leads)
            .set({ websiteCheck: outcome.check, lastVerifiedAt: now().toISOString(), updatedAt: now().toISOString() })
            .where(eq(leads.id, lead.id));
          await db
            .update(businesses)
            .set({ websiteClass: outcome.websiteClass, updatedAt: now().toISOString() })
            .where(eq(businesses.id, business.id));
          processed++;
        } catch {
          // unexpected failure (fetch errors classify, they don't throw) — mark attempted so the stage terminates
          await db
            .update(leads)
            .set({
              websiteCheck: { ok: false, error: "other", fetchedAt: now().toISOString() },
              updatedAt: now().toISOString(),
            })
            .where(eq(leads.id, lead.id));
          await bumpError(c.id, "website_check");
        } finally {
          release();
        }
      }),
    );
    await bumpCounts(c.id, { website_checked: processed });
    await ctx.checkpoint({ websiteChecked: processed });
  }
}

async function stagePagespeed(c: Campaign, ctx: JobContext): Promise<void> {
  const db = getDb();
  if (!(await pagespeedAvailable())) {
    await bumpCounts(c.id, { pagespeed_skipped_no_key: 1 });
    return;
  }
  const provider = await getPageSpeed();
  let processed = (((await reload(c.id)).stageCounts ?? {}) as Record<string, number>).pagespeed_done ?? 0;
  for (;;) {
    if ((await control(c.id)) !== "continue") return;
    if (ctx.shouldStop()) throw new JobStopped();
    const batch = await campaignLeadRows(
      c.id,
      sql`${businesses.websiteClass} = 'real_site' AND ${leads.pagespeed} IS NULL AND ${leads.websiteCheck} IS NOT NULL`,
    ).limit(10);
    if (batch.length === 0) break;
    let quotaExhausted = false;
    await Promise.all(
      batch.map(async ({ lead, business }) => {
        if (quotaExhausted) return;
        const url = business.websiteRaw!;
        const cached = await cachedPagespeed(url);
        if (cached) {
          await db
            .update(leads)
            .set({ pagespeed: { ...cached, fetchedAt: now().toISOString() }, updatedAt: now().toISOString() })
            .where(eq(leads.id, lead.id));
          processed++;
          return;
        }
        if (!(await consumePagespeedQuota())) {
          quotaExhausted = true;
          return;
        }
        const release = await gates().pagespeed.acquire(`c${c.id}`);
        try {
          const result = await provider.runMobile(url);
          await storePagespeed(url, result);
          await db
            .update(leads)
            .set({ pagespeed: { ...result, fetchedAt: now().toISOString() }, updatedAt: now().toISOString() })
            .where(eq(leads.id, lead.id));
          processed++;
        } catch {
          await bumpError(c.id, "pagespeed");
          await db
            .update(leads)
            .set({ pagespeed: { mobileScore: -1, lcpMs: -1, fetchedAt: now().toISOString() }, updatedAt: now().toISOString() })
            .where(eq(leads.id, lead.id));
        } finally {
          release();
        }
      }),
    );
    await bumpCounts(c.id, { pagespeed_done: processed });
    await ctx.checkpoint({ pagespeedDone: processed });
    if (quotaExhausted) {
      await bumpCounts(c.id, { pagespeed_quota_exhausted: 1 });
      break; // score stage handles missing mobile scores; freshness can fill in later
    }
  }
}

async function stageOwnerExtract(c: Campaign, ctx: JobContext): Promise<void> {
  const db = getDb();
  const fetcher = await getFetcher();
  const ai = await getAIProvider();
  const aiOn = await aiAvailable();
  let aiBudgetStopped = false;
  let found = (((await reload(c.id)).stageCounts ?? {}) as Record<string, number>).owners_found ?? 0;
  let processed = 0;
  for (;;) {
    if ((await control(c.id)) !== "continue") return;
    if (ctx.shouldStop()) throw new JobStopped();
    const batch = await campaignLeadRows(c.id, sql`${businesses.websiteClass} = 'real_site' AND ${leads.ownerCheckedAt} IS NULL`).limit(10);
    if (batch.length === 0) break;
    await Promise.all(
      batch.map(async ({ lead, business }) => {
        const ts = now().toISOString();
        if (lead.ownerName) {
          await db.update(leads).set({ ownerCheckedAt: ts }).where(eq(leads.id, lead.id));
          return;
        }
        const release = await gates().fetch.acquire(`c${c.id}`);
        try {
          const pages = await fetchOwnerPages(fetcher, business.websiteRaw!);
          let extraction = extractOwnerHeuristic({ businessName: business.name, pages });
          let source: "heuristic" | "ai" = "heuristic";
          if (!extraction && c.aiOwnerExtraction && aiOn && !aiBudgetStopped && pages.length) {
            try {
              await budgetGuard(c.id, ai.costPerOwnerCallUSD);
              const aiRelease = await gates().ai.acquire(`c${c.id}`);
              try {
                const result = await ai.extractOwner({ businessName: business.name, multiLocation: false, pages });
                if (result.costUSD > 0) {
                  await recordSpend("anthropic", c.id, result.costUSD, ai.name === "anthropic" ? "actual" : "estimated", business.name);
                }
                extraction = result.extraction;
                source = "ai";
              } finally {
                aiRelease();
              }
            } catch (err) {
              if (err instanceof BudgetExceededError) aiBudgetStopped = true;
              else await bumpError(c.id, "owner_extract");
            }
          }
          if (extraction?.ownerName && extraction.evidenceSnippet) {
            found++;
            await db
              .update(leads)
              .set({
                ownerName: extraction.ownerName,
                ownerRole: extraction.role ?? null,
                ownerEvidence: extraction.evidenceSnippet,
                ownerConfidence: extraction.confidence,
                ownerSource: source,
                ownerCheckedAt: ts,
                updatedAt: ts,
              })
              .where(eq(leads.id, lead.id));
          } else {
            await db.update(leads).set({ ownerCheckedAt: ts, updatedAt: ts }).where(eq(leads.id, lead.id));
          }
        } catch {
          await bumpError(c.id, "owner_extract");
          await db.update(leads).set({ ownerCheckedAt: now().toISOString() }).where(eq(leads.id, lead.id));
        } finally {
          release();
        }
        processed++;
      }),
    );
    await bumpCounts(c.id, { owners_found: found });
    await ctx.checkpoint({ ownerProcessed: processed });
  }
  if (aiBudgetStopped) await bumpCounts(c.id, { ai_budget_stopped: 1 });
}

async function stageScore(c: Campaign): Promise<void> {
  const db = getDb();
  const rows = await campaignLeadRows(c.id);
  let filtered = 0;
  await db.transaction(async (tx) => {
    for (const { lead, business } of rows) {
      const mobileScore = lead.pagespeed && lead.pagespeed.mobileScore >= 0 ? lead.pagespeed.mobileScore : null;
      const { score, reasons } = computeScore({
        websiteClass: business.websiteClass as WebsiteClass,
        check: lead.websiteCheck,
        mobileScore,
      });
      await tx
        .update(leads)
        .set({ score, scoreReasons: reasons, updatedAt: now().toISOString() })
        .where(eq(leads.id, lead.id));
      // D17 — post-classification enforcement of the has-website filter
      const cls = business.websiteClass;
      const violates =
        (c.filters.hasWebsite === "yes" && cls !== "real_site" && cls !== "unknown") ||
        (c.filters.hasWebsite === "no" && cls === "real_site");
      if (violates) {
        await tx.delete(campaignLeads).where(and(eq(campaignLeads.campaignId, c.id), eq(campaignLeads.leadId, lead.id)));
        filtered++;
      }
    }
  });
  await bumpCounts(c.id, { scored: rows.length - filtered, filtered_post_classification: filtered });
}

async function stageReady(c: Campaign): Promise<void> {
  const db = getDb();
  await bumpCounts(c.id, { ready: await attachedCount(c.id) });
  await db
    .update(campaigns)
    .set({ status: "completed", currentStage: "ready", completedAt: now().toISOString() })
    .where(eq(campaigns.id, c.id));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { attachedCount };
