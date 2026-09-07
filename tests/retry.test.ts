import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { freshDb } from "./helpers";
import { getDb } from "@/db/client";
import { businesses, campaignLeads, leads } from "@/db/schema";
import { registerAllHandlers } from "@/server/jobs/handlers";
import { Worker, enqueueJob } from "@/server/jobs/worker";
import { createCampaign, defaultFilters, getCampaign, retryErrors, startCampaign } from "@/server/campaigns";

/** §3.2 — per-stage error counts WITH retry: failure markers are cleared and the
 * idempotent stages redo exactly the cleared work. */

describe("campaign retry-errors", () => {
  let campaignId: number;
  let erroredCheckLeadId: number;
  let erroredPagespeedLeadId: number;
  const w = new Worker(1, 10);

  beforeAll(async () => {
    await freshDb();
    registerAllHandlers();
    await enqueueJob("ingest_overture", { states: ["TX"], chain: true }, { maxAttempts: 1 });
    await w.drain(120_000);
    const c = await createCampaign(
      {
        name: "retry test", niche: "roofers", confirmedTaxonomy: ["roofing", "ceiling_and_roofing_repair_and_service"],
        states: ["TX"], filters: defaultFilters(), caps: { maxRecords: 5000, budgetCapUSD: 0 },
        smoke: true, aiOwnerExtraction: false, topUp: null,
      },
      "t@g.com",
    );
    campaignId = c.id;
    await startCampaign(campaignId, "t@g.com");
    await w.drain(180_000);

    // simulate stage failures on two real-site leads (the markers the stages write on unexpected errors)
    const realSite = await getDb()
      .select({ lead: leads })
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .where(sql`campaign_leads.campaign_id = ${campaignId} AND ${businesses.websiteClass} = 'real_site'`)
      .limit(2);
    expect(realSite.length).toBe(2);
    erroredCheckLeadId = realSite[0].lead.id;
    erroredPagespeedLeadId = realSite[1].lead.id;
    const ts = new Date().toISOString();
    await getDb().update(leads)
      .set({ websiteCheck: { ok: false, error: "other", fetchedAt: ts } })
      .where(eq(leads.id, erroredCheckLeadId));
    await getDb().update(leads)
      .set({ pagespeed: { mobileScore: -1, lcpMs: -1, fetchedAt: ts } })
      .where(eq(leads.id, erroredPagespeedLeadId));
    await getDb().execute(sql`UPDATE campaigns SET stage_errors = '{"website_check":1,"pagespeed":1}' WHERE id = ${campaignId}`);
  }, 300_000);

  async function deadishCount(): Promise<number> {
    const rows = (await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .where(sql`campaign_leads.campaign_id = ${campaignId} AND (${leads.websiteCheck} ->> 'error') IN ('dns','timeout','refused')`));
    return rows[0]!.n;
  }

  it("clears only the failure markers, re-runs, and heals both leads", async () => {
    const cleared = await retryErrors(campaignId, "t@g.com");
    expect(cleared.websiteChecksCleared).toBe(1);
    expect(cleared.pagespeedCleared).toBe(1);
    expect((await getCampaign(campaignId))!.status).toBe("running");
    expect((await getCampaign(campaignId))!.stageErrors).toEqual({});

    await w.drain(180_000);
    const c = (await getCampaign(campaignId))!;
    expect(c.status).toBe("completed");

    const [healedCheck] = await getDb().select().from(leads).where(eq(leads.id, erroredCheckLeadId)).limit(1);
    expect(healedCheck!.websiteCheck).not.toBeNull();
    expect(healedCheck!.websiteCheck!.ok).toBe(true);
    const [healedPagespeed] = await getDb().select().from(leads).where(eq(leads.id, erroredPagespeedLeadId)).limit(1);
    expect(healedPagespeed!.pagespeed).not.toBeNull();
    expect(healedPagespeed!.pagespeed!.mobileScore).toBeGreaterThanOrEqual(0);
  }, 240_000);

  it("legit classifications (dead/timeout) are results, not errors — retry leaves them alone", async () => {
    const deadish = await deadishCount();
    const cleared = await retryErrors(campaignId, "t@g.com");
    expect(cleared.websiteChecksCleared).toBe(0); // nothing marked 'other' remains
    expect(deadish).toBe(await deadishCount());
  });

  it("refuses to retry a running campaign", async () => {
    await w.drain(180_000); // settle the run started by the previous test
    await getDb().execute(sql`UPDATE campaigns SET status = 'running' WHERE id = ${campaignId}`);
    await expect(retryErrors(campaignId, "t@g.com")).rejects.toThrow(/completed\/failed/);
    await getDb().execute(sql`UPDATE campaigns SET status = 'completed' WHERE id = ${campaignId}`);
  }, 200_000);
});
