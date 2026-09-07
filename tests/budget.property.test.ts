import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { freshDb } from "./helpers";
import { getDb } from "@/db/client";
import { campaigns } from "@/db/schema";
import { BudgetExceededError, budgetGuard, campaignSpendUSD, recordIntent, recordSpend } from "@/server/budget";
import { setSetting } from "@/server/settings";

async function makeCampaign(budgetCapUSD: number): Promise<number> {
  const [row] = await getDb()
    .insert(campaigns)
    .values({
      name: "t",
      niche: "roofers",
      confirmedTaxonomy: ["roofing"],
      states: ["TX"],
      filters: {
        hasWebsite: "any",
        minConfidence: 0.6,
        hasPhone: false,
        operatingOnly: true,
        sources: ["overture"],
        excludeChains: false,
        includeContactless: false,
      },
      caps: { maxRecords: 1000, budgetCapUSD },
      createdBy: "test",
      createdAt: new Date().toISOString(),
    })
    .returning({ id: campaigns.id });
  return row.id;
}

describe("G6 · budget-cap invariant", () => {
  beforeEach(async () => {
    await freshDb();
    await setSetting("monthlySpendCeilingUSD", 10_000); // isolate the campaign cap in the property
  });

  it("spend never exceeds cap + one page, over generated plans (property)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 50, noNaN: true }), // campaign cap
        fc.array(fc.double({ min: 0.001, max: 5, noNaN: true }), { minLength: 1, maxLength: 60 }), // page costs
        async (cap, pageCosts) => {
          await freshDb();
          await setSetting("monthlySpendCeilingUSD", 10_000);
          const id = await makeCampaign(cap);
          const maxPage = Math.max(...pageCosts);
          for (const cost of pageCosts) {
            try {
              await budgetGuard(id, cost);
            } catch (e) {
              expect(e).toBeInstanceOf(BudgetExceededError);
              break; // consumer stops on budget exhaustion
            }
            await recordSpend("outscraper", id, cost, "actual", "page");
          }
          expect(await campaignSpendUSD(id)).toBeLessThanOrEqual(cap + maxPage + 1e-9);
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);

  it("monthly ceiling guards globally the same way", async () => {
    await setSetting("monthlySpendCeilingUSD", 5);
    const id = await makeCampaign(100);
    await recordSpend("outscraper", id, 4.5, "actual");
    await expect(budgetGuard(id, 1)).rejects.toThrow(BudgetExceededError);
    await expect(budgetGuard(id, 0.4)).resolves.toBeUndefined();
  });

  it("$0 default cap means no billable call ever passes", async () => {
    const id = await makeCampaign(0);
    await expect(budgetGuard(id, 0.001)).rejects.toThrow(BudgetExceededError);
    await expect(budgetGuard(id, 0)).resolves.toBeUndefined(); // free calls always fine
  });

  it("intents are idempotent by (provider, query) hash", async () => {
    const id = await makeCampaign(10);
    const a = await recordIntent("outscraper", { category: "roofer", city: "Austin" }, id, 0.6);
    const b = await recordIntent("outscraper", { category: "roofer", city: "Austin" }, id, 0.6);
    expect(b.id).toBe(a.id);
    const c = await recordIntent("outscraper", { category: "roofer", city: "Dallas" }, id, 0.6);
    expect(c.id).not.toBe(a.id);
  });
});
