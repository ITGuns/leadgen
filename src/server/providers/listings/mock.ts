import { defaults } from "../../config";
import type { ListingsProvider, RawListing } from "../types";
import { mockHash } from "../types";

/** Deterministic offline top-up provider (§4.7). Same async contract as the real one,
 *  including a slice of jobs that stay pending for a couple of polls. */

const FIRST = ["Ken", "Lupe", "Sal", "Marge", "Otis", "Vera", "Reed", "Nadia"];
const SUFFIX = ["Services", "Solutions", "Bros", "and Sons", "Group", "Works"];

export class MockListingsProvider implements ListingsProvider {
  readonly name = "mock";
  private polls = new Map<string, number>();

  estimateCostUSD(recordsPlanned: number): number {
    return (recordsPlanned / 1000) * defaults.outscraperCostPer1k;
  }

  async submit(q: { category: string; city: string; region: string; limit: number }): Promise<{ providerJobId: string }> {
    return { providerJobId: `mockjob:${q.category}:${q.city}:${q.region}:${q.limit}` };
  }

  async poll(providerJobId: string): Promise<"pending" | "ready" | "failed"> {
    const n = (this.polls.get(providerJobId) ?? 0) + 1;
    this.polls.set(providerJobId, n);
    const h = mockHash(providerJobId);
    if (h % 13 === 0 && n < 3) return "pending"; // some jobs take a few polls
    return "ready";
  }

  async fetchPage(providerJobId: string): Promise<{ records: RawListing[]; nextCursor?: string; actualCostUSD?: number }> {
    const [, category, city, region, limitStr] = providerJobId.split(":");
    const limit = parseInt(limitStr, 10) || 50;
    const h = mockHash(providerJobId);
    const count = Math.min(limit, 20 + (h % 60));
    const records: RawListing[] = [];
    for (let i = 0; i < count; i++) {
      const hh = mockHash(`${providerJobId}:${i}`);
      const name = `${FIRST[hh % FIRST.length]}'s ${category} ${SUFFIX[(hh >>> 3) % SUFFIX.length]}`;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const hasSite = hh % 10 < 4;
      records.push({
        providerPlaceId: `mockplace:${hh.toString(16)}`,
        name,
        phone: `+1512${200 + (hh % 700)}${String(1000 + (hh % 9000))}`,
        website: hasSite ? `https://www.${slug}.lf-${hh % 3 === 0 ? "wp-poor" : "custom-old"}.test` : null,
        email: hh % 5 === 0 ? `info@${slug}.lf-mail.test` : null,
        street: `${100 + (hh % 900)} Market St`,
        city,
        region,
        postal: null,
        lat: 30 + (hh % 100) / 100,
        lng: -97 - (hh % 100) / 100,
        category,
        ownerName: hh % 6 === 0 ? `${FIRST[(hh >>> 5) % FIRST.length]} ${["Ames", "Boyd", "Cole"][hh % 3]}` : null,
      });
    }
    return { records, actualCostUSD: this.estimateCostUSD(records.length) };
  }
}
