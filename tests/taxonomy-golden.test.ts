import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { confirmTaxonomy, proposeTaxonomy, taxonomyCatalog } from "@/server/ingest/taxonomy";

/** G2 — 30+ niche phrases → expected taxonomy sets, against the REAL Overture catalog
 * (derived from release 2026-08-19.0 — data/.taxonomy-derivation.json). Phrases include
 * variants NOT verbatim in the curated file, exercising normalization + folding + fuzzy. */

const GOLDEN: { phrase: string; mustInclude: string[]; mustExclude?: string[] }[] = [
  { phrase: "roofers", mustInclude: ["roofing"] },
  { phrase: "Roofing!", mustInclude: ["roofing"] },
  { phrase: "roof repair", mustInclude: ["roofing"], mustExclude: ["building_supply_store"] },
  { phrase: "HVAC", mustInclude: ["hvac_service"] },
  { phrase: "heating and cooling", mustInclude: ["hvac_service"] },
  { phrase: "AC repair", mustInclude: ["hvac_service"] },
  { phrase: "plumbers", mustInclude: ["plumbing"] },
  { phrase: "plumber", mustInclude: ["plumbing"] },
  { phrase: "septic pumping", mustInclude: ["septic_service"] },
  { phrase: "electricians", mustInclude: ["electrician"] },
  { phrase: "electrician", mustInclude: ["electrician"] },
  { phrase: "landscapers", mustInclude: ["landscaping"] },
  { phrase: "lawn care", mustInclude: ["lawn_service"] },
  { phrase: "tree removal", mustInclude: ["tree_service"] },
  { phrase: "pest control", mustInclude: ["pest_control_service"] },
  { phrase: "exterminators", mustInclude: ["pest_control_service"] },
  { phrase: "pressure washing", mustInclude: ["pressure_washing"] },
  { phrase: "house cleaning", mustInclude: ["cleaning_service"] },
  { phrase: "carpet cleaning", mustInclude: ["carpet_cleaning"] },
  { phrase: "junk removal", mustInclude: ["junk_removal_and_hauling"] },
  { phrase: "movers", mustInclude: ["mover"] },
  { phrase: "moving company", mustInclude: ["mover"] },
  { phrase: "locksmiths", mustInclude: ["key_and_locksmith"] },
  { phrase: "garage door repair", mustInclude: ["garage_door_service"] },
  { phrase: "fence companies", mustInclude: ["fence_and_gate_sales_service"] },
  { phrase: "painters", mustInclude: ["painting"] },
  { phrase: "general contractors", mustInclude: ["contractor"] },
  { phrase: "handyman services", mustInclude: ["handyman"] },
  { phrase: "PI lawyer", mustInclude: ["personal_injury_law"] },
  { phrase: "personal injury lawyers", mustInclude: ["personal_injury_law"] },
  { phrase: "dentists", mustInclude: ["general_dentistry"] },
  { phrase: "auto repair shops", mustInclude: ["automotive_repair"] },
];

describe("G2 · taxonomy mapping golden set (30+)", () => {
  beforeAll(async () => {
    await freshDb();
  });

  it("has 30+ phrases", () => expect(GOLDEN.length).toBeGreaterThanOrEqual(30));

  for (const g of GOLDEN) {
    it(`"${g.phrase}"`, async () => {
      const proposal = await proposeTaxonomy(g.phrase);
      for (const code of g.mustInclude) {
        expect(proposal.codes, `source=${proposal.source} codes=${proposal.codes.join(",")}`).toContain(code);
      }
      for (const code of g.mustExclude ?? []) {
        expect(proposal.codes).not.toContain(code);
      }
      // every proposed code resolves against the bundled catalog
      for (const code of proposal.codes) expect(taxonomyCatalog().has(code)).toBe(true);
    });
  }

  it("confirmed mappings auto-apply on later runs (§3.1)", async () => {
    expect((await proposeTaxonomy("roofers")).autoApply).toBe(false);
    await confirmTaxonomy("roofers", ["roofing", "ceiling_and_roofing_repair_and_service"], "dev@gemfieldconsulting.com");
    const again = await proposeTaxonomy("Roofers");
    expect(again.autoApply).toBe(true);
    expect(again.source).toBe("confirmed");
    expect(again.codes).toEqual(["roofing", "ceiling_and_roofing_repair_and_service"]);
  });
});
