import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaigns, jobs, leads, type CampaignCaps, type CampaignFilters, type CampaignTopUp } from "@/db/schema";
import { z } from "zod";
import { audit } from "./audit";
import { defaults, now } from "./config";
import { taxonomyCatalog } from "./ingest/taxonomy";
import { estimateCampaign } from "./pipeline/estimate";
import { enqueueJob } from "./jobs/worker";

/** §3.1 campaign lifecycle. Run is refused unless the estimate fits the hard budget cap. */

export const CampaignInputSchema = z.object({
  name: z.string().min(1).max(120),
  niche: z.string().min(2).max(80),
  confirmedTaxonomy: z.array(z.string().min(1)).min(1).max(12),
  states: z.array(z.string().length(2)).min(1).max(51),
  cityList: z.array(z.string().min(1)).max(500).nullish(),
  filters: z.object({
    hasWebsite: z.enum(["any", "yes", "no"]),
    minConfidence: z.number().min(0).max(1),
    hasPhone: z.boolean(),
    operatingOnly: z.boolean(),
    sources: z.array(z.enum(["overture", "fsq", "outscraper"])).min(1),
    excludeChains: z.boolean(),
    includeContactless: z.boolean(),
  }),
  caps: z.object({ maxRecords: z.number().int().min(1).max(200_000), budgetCapUSD: z.number().min(0).max(10_000) }),
  smoke: z.boolean(),
  aiOwnerExtraction: z.boolean(),
  topUp: z.object({ enabled: z.boolean(), provider: z.literal("outscraper"), capUSD: z.number().min(0).max(1_000) }).nullish(),
});
export type CampaignInput = z.infer<typeof CampaignInputSchema>;

export async function createCampaign(input: CampaignInput, createdBy: string) {
  const catalog = taxonomyCatalog();
  const unknown = input.confirmedTaxonomy.filter((t) => !catalog.has(t));
  if (unknown.length) throw new Error(`taxonomy codes not in catalog: ${unknown.join(", ")}`);
  const [row] = await getDb()
    .insert(campaigns)
    .values({
      name: input.name,
      niche: input.niche,
      confirmedTaxonomy: input.confirmedTaxonomy,
      states: input.states.map((s) => s.toUpperCase()),
      cityList: input.cityList ?? null,
      filters: input.filters as CampaignFilters,
      caps: input.caps as CampaignCaps,
      smoke: input.smoke,
      aiOwnerExtraction: input.aiOwnerExtraction,
      topUp: (input.topUp ?? null) as CampaignTopUp | null,
      createdBy,
      createdAt: now().toISOString(),
    })
    .returning();
  // best-effort: a transient estimate failure must not orphan the created row behind a 500
  let estimate = null as Awaited<ReturnType<typeof estimateCampaign>> | null;
  try {
    estimate = await estimateCampaign(row);
    await getDb().update(campaigns).set({ estimate }).where(eq(campaigns.id, row.id));
  } catch {
    // the plan stage re-estimates before any run; the builder shows "—" until then
  }
  await audit(createdBy, "campaign.create", { id: row.id, name: row.name, niche: row.niche });
  return { ...row, estimate };
}

export async function startCampaign(id: number, actor: string) {
  const db = getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!c) throw new Error("campaign not found");
  if (c.status === "running") return c;
  if (!["draft", "paused", "failed", "canceled"].includes(c.status)) {
    throw new Error(`cannot start a ${c.status} campaign`);
  }
  const estimate = await estimateCampaign(c);
  if (estimate.totalUSD > c.caps.budgetCapUSD) {
    throw new Error(
      `estimate $${estimate.totalUSD.toFixed(2)} exceeds the hard budget cap $${c.caps.budgetCapUSD.toFixed(2)} — raise the cap or reduce scope`,
    );
  }
  await db
    .update(campaigns)
    .set({ status: "running", pauseRequested: false, cancelRequested: false, estimate })
    .where(eq(campaigns.id, id));
  await enqueueJob("campaign_run", { campaignId: id }, { campaignId: id, dedupe: true, maxAttempts: 3 });
  await audit(actor, "campaign.start", { id, estimateUSD: estimate.totalUSD, smoke: c.smoke });
  return { ...c, status: "running", pauseRequested: false, cancelRequested: false, estimate };
}

export async function pauseCampaign(id: number, actor: string): Promise<void> {
  await getDb().update(campaigns).set({ pauseRequested: true }).where(eq(campaigns.id, id));
  await audit(actor, "campaign.pause", { id });
}

export async function resumeCampaign(id: number, actor: string): Promise<void> {
  const db = getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!c) throw new Error("campaign not found");
  if (c.status !== "paused") throw new Error("campaign is not paused");
  await db.update(campaigns).set({ status: "running", pauseRequested: false }).where(eq(campaigns.id, id));
  await enqueueJob("campaign_run", { campaignId: id }, { campaignId: id, dedupe: true });
  await audit(actor, "campaign.resume", { id });
}

export async function cancelCampaign(id: number, actor: string): Promise<void> {
  const db = getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!c) throw new Error("campaign not found");
  if (c.status === "running") {
    // a "running" campaign whose job died (failed/crashed) has nobody left to honor
    // the flag — cancel it directly instead of spinning on "Canceling…" forever
    const [live] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.type, "campaign_run"), eq(jobs.campaignId, id), inArray(jobs.status, ["pending", "running"])))
      .limit(1);
    if (live) {
      await db.update(campaigns).set({ cancelRequested: true }).where(eq(campaigns.id, id));
    } else {
      await db
        .update(campaigns)
        .set({ status: "canceled", cancelRequested: false, completedAt: now().toISOString() })
        .where(eq(campaigns.id, id));
    }
  } else if (["draft", "paused"].includes(c.status)) {
    await db.update(campaigns).set({ status: "canceled", completedAt: now().toISOString() }).where(eq(campaigns.id, id));
  }
  await audit(actor, "campaign.cancel", { id });
}

/**
 * §3.2 — per-stage error counts WITH retry. Clears the failure markers left by the
 * website-check ('other' errors only — dead/timeout are classifications, not errors)
 * and PageSpeed (-1 sentinel) stages for this campaign's leads, then re-enqueues the
 * run; idempotent stages redo exactly the cleared work and re-score.
 */
export async function retryErrors(id: number, actor: string) {
  const db = getDb();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!c) throw new Error("campaign not found");
  if (!["completed", "failed"].includes(c.status)) throw new Error("retry is for completed/failed campaigns");
  const inCampaign = sql`${leads.id} IN (SELECT lead_id FROM campaign_leads WHERE campaign_id = ${id})`;
  const ts = now().toISOString();
  const wc = await db
    .update(leads)
    .set({ websiteCheck: null, updatedAt: ts })
    .where(sql`${inCampaign} AND (${leads.websiteCheck} ->> 'error') = 'other'`)
    .returning({ id: leads.id });
  const ps = await db
    .update(leads)
    .set({ pagespeed: null, updatedAt: ts })
    .where(sql`${inCampaign} AND (${leads.pagespeed} ->> 'mobileScore')::int = -1`)
    .returning({ id: leads.id });
  await db
    .update(campaigns)
    .set({ stageErrors: {}, status: "running", pauseRequested: false, cancelRequested: false })
    .where(eq(campaigns.id, id));
  await enqueueJob("campaign_run", { campaignId: id }, { campaignId: id, dedupe: true });
  await audit(actor, "campaign.retry_errors", { id, websiteChecksCleared: wc.length, pagespeedCleared: ps.length });
  return { websiteChecksCleared: wc.length, pagespeedCleared: ps.length };
}

export async function listCampaigns(limit?: number) {
  const q = getDb().select().from(campaigns).orderBy(desc(campaigns.id));
  return limit ? q.limit(limit) : q;
}

export async function getCampaign(id: number) {
  const [c] = await getDb().select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return c;
}

export function defaultFilters(): CampaignFilters {
  return {
    hasWebsite: "any",
    minConfidence: defaults.minConfidenceDefault,
    hasPhone: false,
    operatingOnly: true,
    sources: ["overture", "fsq", "outscraper"],
    excludeChains: true,
    includeContactless: false,
  };
}
