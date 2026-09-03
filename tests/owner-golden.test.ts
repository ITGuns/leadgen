import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractOwnerHeuristic } from "@/server/enrich/owner-heuristic";
import { OwnerExtractionSchema } from "@/server/providers/types";

/** G5 — 40+ page fixtures incl. must-not-extract traps. No snippet = no name. */

type GoldenCase = {
  id: string;
  businessName: string;
  pageUrl: string;
  pageText: string;
  expect: { ownerName: string | null; confidence?: "high" | "low" };
};
const golden = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "fixtures", "golden", "owner.json"), "utf8"),
) as { cases: GoldenCase[] };

describe("G5 · owner extraction golden set (heuristic)", () => {
  it("has 40+ cases with traps", () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(40);
    expect(golden.cases.filter((c) => c.expect.ownerName === null).length).toBeGreaterThanOrEqual(10);
  });

  for (const c of golden.cases) {
    it(c.id, () => {
      const result = extractOwnerHeuristic({
        businessName: c.businessName,
        pages: [{ url: c.pageUrl, text: c.pageText }],
      });
      if (c.expect.ownerName === null) {
        expect(result, `must-not-extract trap — got ${JSON.stringify(result)}`).toBeNull();
      } else {
        expect(result, "expected an extraction").not.toBeNull();
        expect(result!.ownerName).toBe(c.expect.ownerName);
        // evidence invariant: snippet exists, appears in the page, and contains the name
        expect(result!.evidenceSnippet.length).toBeGreaterThanOrEqual(10);
        expect(c.pageText).toContain(result!.evidenceSnippet.replaceAll("…", ""));
        expect(result!.evidenceSnippet).toContain(c.expect.ownerName.split(" ")[0]);
        if (c.expect.confidence) expect(result!.confidence).toBe(c.expect.confidence);
      }
    });
  }
});

describe("G5 · schema-level anti-hallucination", () => {
  it("rejects a name without an evidence snippet", () => {
    expect(OwnerExtractionSchema.safeParse({ ownerName: "John Smith", confidence: "high" }).success).toBe(false);
    expect(OwnerExtractionSchema.safeParse({ ownerName: "John Smith", evidenceSnippet: "short", confidence: "high" }).success).toBe(false);
  });
  it("accepts snippet-backed extractions and snippet-only (no-name) results", () => {
    expect(
      OwnerExtractionSchema.safeParse({ ownerName: "John Smith", evidenceSnippet: "John Smith, Owner of the shop", confidence: "high" }).success,
    ).toBe(true);
    expect(OwnerExtractionSchema.safeParse({ evidenceSnippet: "no owner identified on page", confidence: "low" }).success).toBe(true);
  });
});
