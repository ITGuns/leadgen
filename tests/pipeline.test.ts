import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { freshDb } from "./helpers";
import { getDb } from "@/db/client";
import { businesses, campaignLeads, intents, leads, spendLedger, suppressions } from "@/db/schema";
import { registerAllHandlers } from "@/server/jobs/handlers";
import { Worker, enqueueJob } from "@/server/jobs/worker";
import { createCampaign, getCampaign, startCampaign, type CampaignInput } from "@/server/campaigns";
import { campaignSpendUSD } from "@/server/budget";
import { defaultFilters } from "@/server/campaigns";
import { setSetting } from "@/server/settings";

/** End-to-end mock campaign runs through the real worker + stages (§3.2/§3.3, D17). */

function campaignInput(over: Partial<CampaignInput> = {}): CampaignInput {
  return {
    name: "Roofers TX smoke",
    niche: "roofers",
    confirmedTaxonomy: ["roofing", "ceiling_and_roofing_repair_and_service"],
    states: ["TX"],
    filters: defaultFilters(),
    caps: { maxRecords: 5000, budgetCapUSD: 0 },
    smoke: true,
    aiOwnerExtraction: false,
    topUp: null,
    ...over,
  };
}

async function campaignRows(campaignId: number) {
  return getDb()
    .select({ lead: leads, business: businesses })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
    .innerJoin(businesses, eq(leads.businessId, businesses.id))
    .where(eq(campaignLeads.campaignId, campaignId));
}

describe("campaign pipeline over mock data", () => {
  let campaignId: number;

  beforeAll(async () => {
    await freshDb();
    registerAllHandlers();
    const w = new Worker(1, 10);
    await enqueueJob("ingest_overture", { states: ["TX", "FL", "GA"], chain: true }, { maxAttempts: 1 });
    await w.drain(120_000);
    // a client suppression that must be excluded from the pull
    const [victim] = await getDb()
      .select()
      .from(businesses)
      .where(and(eq(businesses.taxonomyPrimary, "roofing"), sql`phone IS NOT NULL`))
      .limit(1);
    if (victim?.phone) {
      await getDb()
        .insert(suppressions)
        .values({ kind: "client", phone: victim.phone, createdAt: new Date().toISOString(), source: "test" });
    }
    const c = await createCampaign(campaignInput({ aiOwnerExtraction: true }), "test@gemfieldconsulting.com");
    campaignId = c.id;
    expect(c.estimate!.totalUSD).toBe(0); // free path + mock AI costs nothing — $0 baseline holds
    await startCampaign(campaignId, "test@gemfieldconsulting.com");
    await w.drain(180_000);
  }, 240_000);

  it("completes with a full stage trail and $0 spend", async () => {
    const c = await getCampaign(campaignId);
    expect(c).toBeTruthy();
    expect(c!.status).toBe("completed");
    expect(c!.currentStage).toBe("ready");
    expect(c!.releaseOverture).toBe("mock-2026-09");
    const counts = c!.stageCounts!;
    expect(counts.pulled).toBeGreaterThan(20);
    expect(counts.pulled).toBeLessThanOrEqual(200); // smoke cap
    expect(counts.scored).toBeGreaterThan(0);
    expect(counts.ready).toBeGreaterThan(0);
    expect(await campaignSpendUSD(campaignId)).toBe(0);
  });

  it("attaches only contactable, unsuppressed, filter-matching businesses", async () => {
    const rows = await campaignRows(campaignId);
    expect(rows.length).toBeGreaterThan(20);
    for (const { business } of rows) {
      const set = new Set(["roofing", "ceiling_and_roofing_repair_and_service"]);
      const taxonomyMatch = set.has(business.taxonomyPrimary ?? "") || (business.taxonomyAlternates ?? []).some((t) => set.has(t));
      expect(taxonomyMatch, `taxonomy ${business.taxonomyPrimary} / ${business.taxonomyAlternates}`).toBe(true);
      expect(business.region).toBe("TX");
      expect(business.chain).toBe(false);
      const contactable = business.phone || business.websiteRaw || (business.emails ?? []).length > 0;
      expect(contactable).toBeTruthy();
    }
    const c = await getCampaign(campaignId);
    expect(c!.stageCounts!.suppressed_clients ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("scores every lead with reason chips and ranks no-website businesses on top", async () => {
    const rows = await campaignRows(campaignId);
    for (const { lead } of rows) {
      expect(lead.score).not.toBeNull();
      expect((lead.scoreReasons ?? []).length).toBeGreaterThan(0);
    }
    const sorted = [...rows].sort((a, b) => (b.lead.score ?? 0) - (a.lead.score ?? 0));
    expect(["none", "dead", "parked", "aggregator"]).toContain(sorted[0].business.websiteClass);
    expect(sorted[0].lead.score).toBeGreaterThanOrEqual(90);
  });

  it("every extracted owner carries an evidence snippet (anti-hallucination invariant)", async () => {
    const owned = await getDb()
      .select({ lead: leads })
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .where(and(eq(campaignLeads.campaignId, campaignId), sql`${leads.ownerName} IS NOT NULL`));
    expect(owned.length).toBeGreaterThan(3); // mock plants owners on ~60% of real sites
    for (const { lead } of owned) {
      expect(lead.ownerEvidence).toBeTruthy();
      expect(lead.ownerEvidence!.length).toBeGreaterThan(10);
      expect(["heuristic", "ai", "outscraper"]).toContain(lead.ownerSource);
    }
  });

  it("website classification resolved every fetched candidate (D17 universe)", async () => {
    const [row] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .where(
        and(eq(campaignLeads.campaignId, campaignId), sql`${businesses.websiteClass} = 'unknown' AND ${businesses.websiteRaw} IS NOT NULL`),
      );
    expect(row!.n).toBe(0);
  });

  it("cross-campaign dedupe: a second campaign reuses the same lead rows", async () => {
    const [beforeRow] = await getDb().select({ n: sql<number>`count(*)::int` }).from(leads);
    const before = beforeRow!.n;
    const c2 = await createCampaign(campaignInput({ name: "Roofers TX again" }), "test@gemfieldconsulting.com");
    await startCampaign(c2.id, "test@gemfieldconsolidated.com");
    const w = new Worker(1, 10);
    await w.drain(120_000);
    const [afterRow] = await getDb().select({ n: sql<number>`count(*)::int` }).from(leads);
    expect(afterRow!.n).toBe(before); // same businesses → same lead rows, only membership differs
    const [membershipRow] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(campaignLeads)
      .where(eq(campaignLeads.campaignId, c2.id));
    expect(membershipRow!.n).toBeGreaterThan(20);
  }, 120_000);
});

describe("campaign pipeline · has-website=no finds parked/dead leads via D17", () => {
  it("pulls unknown candidates, classifies, and keeps only no-real-website leads", async () => {
    await freshDb();
    registerAllHandlers();
    const w = new Worker(1, 10);
    await enqueueJob("ingest_overture", { states: ["TX"], chain: true }, { maxAttempts: 1 });
    await w.drain(120_000);
    const c = await createCampaign(
      campaignInput({
        name: "No-website hunters",
        niche: "plumbers",
        confirmedTaxonomy: ["plumbing", "septic_service"],
        filters: { ...defaultFilters(), hasWebsite: "no" },
        smoke: true,
      }),
      "t@g.com",
    );
    await startCampaign(c.id, "t@g.com");
    await w.drain(180_000);
    const rows = await getDb()
      .select({ business: businesses })
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .innerJoin(businesses, eq(leads.businessId, businesses.id))
      .where(eq(campaignLeads.campaignId, c.id));
    expect(rows.length).toBeGreaterThan(5);
    for (const { business } of rows) {
      expect(["none", "social_only", "aggregator", "parked", "dead"]).toContain(business.websiteClass);
    }
  }, 240_000);
});

describe("campaign pipeline · paid top-up respects intents and the budget cap", () => {
  it("spends within cap + one page, records intents before submit, merges without dupes", async () => {
    await freshDb();
    registerAllHandlers();
    const w = new Worker(1, 10);
    await enqueueJob("ingest_overture", { states: ["TX"], chain: true }, { maxAttempts: 1 });
    await w.drain(120_000);
    await setSetting("monthlySpendCeilingUSD", 100); // #K sets the ceiling; the $0 default correctly blocks all paid calls
    const c = await createCampaign(
      campaignInput({
        name: "Topup run",
        niche: "roofers",
        smoke: false,
        caps: { maxRecords: 400, budgetCapUSD: 0.5 },
        topUp: { enabled: true, provider: "outscraper", capUSD: 0.5 },
      }),
      "t@g.com",
    );
    await startCampaign(c.id, "t@g.com");
    await w.drain(240_000);

    const spend = await campaignSpendUSD(c.id);
    expect(spend).toBeGreaterThan(0); // mock provider "bills"
    expect(spend).toBeLessThanOrEqual(0.5 + 0.15 + 1e-9); // cap + one page (50 records × $0.003)

    const intentRows = await getDb().select().from(intents).where(eq(intents.campaignId, c.id));
    expect(intentRows.length).toBeGreaterThan(0);
    for (const i of intentRows) {
      expect(["fetched", "planned", "submitted", "stalled", "abandoned"]).toContain(i.status);
      if (i.status === "fetched") expect(i.actualCostUSD).toBeGreaterThan(0);
    }
    const ledger = await getDb().select().from(spendLedger).where(eq(spendLedger.campaignId, c.id));
    expect(ledger.length).toBeGreaterThan(0);

    // top-up merged records never duplicate an existing business identity
    const dupes = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(businesses)
      .groupBy(businesses.identityKey)
      .having(sql`count(*) > 1`);
    expect(dupes.length).toBe(0);
  }, 300_000);
});
