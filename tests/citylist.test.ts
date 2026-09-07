import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { registerAllHandlers } from "@/server/jobs/handlers";
import { Worker, enqueueJob } from "@/server/jobs/worker";
import { createCampaign, defaultFilters, type CampaignInput } from "@/server/campaigns";
import { estimateCampaign } from "@/server/pipeline/estimate";
import { fanOutCities } from "@/server/pipeline/fanout";

/** §3.1 — "optional city/ZIP list upload for precision": city names and 5-digit ZIPs
 * both narrow the free local pull; ZIPs are ignored by the paid fan-out (city-keyed). */

function input(cityList: string[] | null): CampaignInput {
  return {
    name: "geo precision", niche: "plumbers", confirmedTaxonomy: ["plumbing", "electrician", "hvac_service"],
    states: ["TX"], cityList, filters: { ...defaultFilters(), excludeChains: false },
    caps: { maxRecords: 5000, budgetCapUSD: 0 }, smoke: false, aiOwnerExtraction: false, topUp: null,
  };
}

async function planned(cityList: string[] | null): Promise<number> {
  const campaign = await createCampaign(input(cityList), "t@g.com");
  return (await estimateCampaign(campaign)).plannedRecords;
}

describe("city/ZIP list precision", () => {
  let all: number;
  beforeAll(async () => {
    await freshDb();
    registerAllHandlers();
    await enqueueJob("ingest_overture", { states: ["TX"], chain: true }, { maxAttempts: 1 });
    await new Worker(1, 10).drain(120_000);
    all = await planned(null);
    expect(all).toBeGreaterThan(30);
  }, 180_000);

  it("city names narrow the pull", async () => {
    const austin = await planned(["Austin"]);
    expect(austin).toBeGreaterThan(0);
    expect(austin).toBeLessThan(all);
  });

  it("5-digit ZIPs match postal codes — same universe as the city they belong to (fixture: Austin=78701)", async () => {
    const byCity = await planned(["austin"]);
    const byZip = await planned(["78701"]);
    expect(byZip).toBe(byCity);
  });

  it("mixed lists OR together", async () => {
    const austin = await planned(["Austin"]);
    const dallas = await planned(["Dallas"]);
    const mixed = await planned(["78701", "Dallas"]);
    expect(mixed).toBe(austin + dallas); // fixture cities are disjoint
  });

  it("fan-out uses city-name entries only and never zeroes out on ZIP-only lists", async () => {
    const named = await fanOutCities(["TX"], { cityList: ["Austin", "78701"] });
    expect(named.map((c) => c.city)).toEqual(["Austin"]);
    const zipOnly = await fanOutCities(["TX"], { cityList: ["78701"] });
    expect(zipOnly.length).toBeGreaterThan(1); // falls back to the full state fan-out
  });
});
