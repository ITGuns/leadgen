import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { freshDb } from "./helpers";
import { getDb } from "@/db/client";
import { campaigns } from "@/db/schema";
import { BudgetExceededError, budgetGuard, campaignSpendUSD, recordIntent, recordSpend } from "@/server/budget";
import { setSetting } from "@/server/settings";

function makeCampaign(budgetCapUSD: number): number {
  return getDb()
    .insert(campaigns)
    .values({
      name: "t",
      niche: "roofers",
      confirmedTaxonomy: ["roofing_service"],
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
    .returning({ id: campaigns.id })
    .get().id;
}

describe("G6 · budget-cap invariant", () => {
  beforeEach(() => {
    freshDb();
    setSetting("monthlySpendCeilingUSD", 10_000); // isolate the campaign cap in the property
  });

  it("spend never exceeds cap + one page, over generated plans (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 50, noNaN: true }), // campaign cap
        fc.array(fc.double({ min: 0.001, max: 5, noNaN: true }), { minLength: 1, maxLength: 60 }), // page costs
        (cap, pageCosts) => {
          freshDb();
          setSetting("monthlySpendCeilingUSD", 10_000);
          const id = makeCampaign(cap);
          const maxPage = Math.max(...pageCosts);
          for (const cost of pageCosts) {
            try {
              budgetGuard(id, cost);
            } catch (e) {
              expect(e).toBeInstanceOf(BudgetExceededError);
              break; // consumer stops on budget exhaustion
            }
            recordSpend("outscraper", id, cost, "actual", "page");
          }
          expect(campaignSpendUSD(id)).toBeLessThanOrEqual(cap + maxPage + 1e-9);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("monthly ceiling guards globally the same way", () => {
    setSetting("monthlySpendCeilingUSD", 5);
    const id = makeCampaign(100);
    recordSpend("outscraper", id, 4.5, "actual");
    expect(() => budgetGuard(id, 1)).toThrow(BudgetExceededError);
    expect(() => budgetGuard(id, 0.4)).not.toThrow();
  });

  it("$0 default cap means no billable call ever passes", () => {
    const id = makeCampaign(0);
    expect(() => budgetGuard(id, 0.001)).toThrow(BudgetExceededError);
    expect(() => budgetGuard(id, 0)).not.toThrow(); // free calls always fine
  });

  it("intents are idempotent by (provider, query) hash", () => {
    const id = makeCampaign(10);
    const a = recordIntent("outscraper", { category: "roofer", city: "Austin" }, id, 0.6);
    const b = recordIntent("outscraper", { category: "roofer", city: "Austin" }, id, 0.6);
    expect(b.id).toBe(a.id);
    const c = recordIntent("outscraper", { category: "roofer", city: "Dallas" }, id, 0.6);
    expect(c.id).not.toBe(a.id);
  });
});
