import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaigns, type CampaignCaps, type CampaignFilters, type CampaignTopUp } from "@/db/schema";
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

export function createCampaign(input: CampaignInput, createdBy: string) {
  const catalog = taxonomyCatalog();
  const unknown = input.confirmedTaxonomy.filter((t) => !catalog.has(t));
  if (unknown.length) throw new Error(`taxonomy codes not in catalog: ${unknown.join(", ")}`);
  const row = getDb()
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
    .returning()
    .get();
  const estimate = estimateCampaign(row);
  getDb().update(campaigns).set({ estimate }).where(eq(campaigns.id, row.id)).run();
  audit(createdBy, "campaign.create", { id: row.id, name: row.name, niche: row.niche });
  return { ...row, estimate };
}

export function startCampaign(id: number, actor: string) {
  const db = getDb();
  const c = db.select().from(campaigns).where(eq(campaigns.id, id)).get();
  if (!c) throw new Error("campaign not found");
  if (c.status === "running") return c;
  if (!["draft", "paused", "failed", "canceled"].includes(c.status)) {
    throw new Error(`cannot start a ${c.status} campaign`);
  }
  const estimate = estimateCampaign(c);
  if (estimate.totalUSD > c.caps.budgetCapUSD) {
    throw new Error(
      `estimate $${estimate.totalUSD.toFixed(2)} exceeds the hard budget cap $${c.caps.budgetCapUSD.toFixed(2)} — raise the cap or reduce scope`,
    );
  }
  db.update(campaigns)
    .set({ status: "running", pauseRequested: false, cancelRequested: false, estimate })
    .where(eq(campaigns.id, id))
    .run();
  enqueueJob("campaign_run", { campaignId: id }, { campaignId: id, dedupe: true, maxAttempts: 3 });
  audit(actor, "campaign.start", { id, estimateUSD: estimate.totalUSD, smoke: c.smoke });
  return db.select().from(campaigns).where(eq(campaigns.id, id)).get()!;
}

export function pauseCampaign(id: number, actor: string): void {
  getDb().update(campaigns).set({ pauseRequested: true }).where(eq(campaigns.id, id)).run();
  audit(actor, "campaign.pause", { id });
}

export function resumeCampaign(id: number, actor: string): void {
  const db = getDb();
  const c = db.select().from(campaigns).where(eq(campaigns.id, id)).get();
  if (!c) throw new Error("campaign not found");
  if (c.status !== "paused") throw new Error("campaign is not paused");
  db.update(campaigns).set({ status: "running", pauseRequested: false }).where(eq(campaigns.id, id)).run();
  enqueueJob("campaign_run", { campaignId: id }, { campaignId: id, dedupe: true });
  audit(actor, "campaign.resume", { id });
}

export function cancelCampaign(id: number, actor: string): void {
  const db = getDb();
  const c = db.select().from(campaigns).where(eq(campaigns.id, id)).get();
  if (!c) throw new Error("campaign not found");
  if (c.status === "running") {
    db.update(campaigns).set({ cancelRequested: true }).where(eq(campaigns.id, id)).run();
  } else if (["draft", "paused"].includes(c.status)) {
    db.update(campaigns).set({ status: "canceled", completedAt: now().toISOString() }).where(eq(campaigns.id, id)).run();
  }
  audit(actor, "campaign.cancel", { id });
}

export function listCampaigns() {
  return getDb().select().from(campaigns).orderBy(desc(campaigns.id)).all();
}

export function getCampaign(id: number) {
  return getDb().select().from(campaigns).where(eq(campaigns.id, id)).get();
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
