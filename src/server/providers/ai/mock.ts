import type { AIProvider, OwnerExtraction } from "../types";
import { proposeTaxonomy as proposeOffline } from "../../ingest/taxonomy";

/**
 * MockAI (§4.7): deterministic, offline. Owner extraction genuinely reads the provided
 * page text (names planted by the MockFetcher) so the evidence-snippet invariant is
 * exercised end-to-end, not faked.
 */

const ROLE_RE = /([A-Z][a-zA-Z'’-]+\s+[A-Z][a-zA-Z'’-]+)(?:,| —| -| is the| as)?\s+(?:the\s+)?(owner-operator|co-owner|owner|founder|proprietor|principal)/i;
const ROLE_FIRST_RE = /(owner-operator|co-owner|owner|founder|proprietor|principal)\s*[:,]?\s+([A-Z][a-zA-Z'’-]+\s+[A-Z][a-zA-Z'’-]+)/i;
const FOUNDED_RE = /(?:founded|owned and operated) by\s+([A-Z][a-zA-Z'’-]+\s+[A-Z][a-zA-Z'’-]+)/i;

export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  readonly costPerOwnerCallUSD = 0; // mock is free — cost estimates use the real adapter's rate

  async extractOwner(input: {
    businessName: string;
    multiLocation: boolean;
    pages: { url: string; text: string }[];
  }): Promise<{ extraction: OwnerExtraction | null; costUSD: number }> {
    for (const page of input.pages) {
      const text = page.text;
      if (/review|testimonial|designed by|franchise/i.test(text.slice(0, 200)) && !ROLE_RE.test(text)) continue;
      for (const re of [ROLE_RE, ROLE_FIRST_RE, FOUNDED_RE]) {
        const m = text.match(re);
        if (!m) continue;
        const name = re === ROLE_FIRST_RE ? m[2] : m[1];
        const role = re === FOUNDED_RE ? "founder" : (re === ROLE_FIRST_RE ? m[1] : m[2]).toLowerCase();
        const idx = m.index ?? 0;
        const near = text.slice(Math.max(0, idx - 80), idx + m[0].length + 80);
        if (/review|testimonial|designed by|built by|franchise/i.test(near)) continue;
        const snippet = text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + m[0].length + 60)).trim();
        const multi = input.multiLocation || /\d+\s+locations/.test(text);
        return {
          extraction: { ownerName: name, role, evidenceSnippet: snippet, confidence: multi ? "low" : "high" },
          costUSD: 0,
        };
      }
    }
    return { extraction: null, costUSD: 0 };
  }

  async proposeTaxonomy(niche: string): Promise<string[]> {
    return (await proposeOffline(niche)).codes;
  }
}
