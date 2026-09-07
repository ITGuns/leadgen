import { defaults, env } from "../../config";
import { effectiveSecret } from "../../secure-store";
import type { ListingsProvider, RawListing } from "../types";

/**
 * §4.4 — Outscraper Google Maps adapter (paid top-up ONLY, off by default).
 * Async contract: submit → poll (the caller owns backoff + the 30-min stall timeout)
 * → fetch. A submitted job is billed whether or not results are fetched, which is why
 * the caller writes the intent row BEFORE submit (C10). Endpoint shapes verified on
 * first real run (BLOCKERS B8).
 */

const BASE = "https://api.app.outscraper.com";

type OutscraperResult = {
  id?: string;
  status?: string;
  data?: Record<string, unknown>[][];
};

export class OutscraperProvider implements ListingsProvider {
  readonly name = "outscraper";
  constructor(private apiKey: string) {}

  estimateCostUSD(recordsPlanned: number): number {
    return (recordsPlanned / 1000) * defaults.outscraperCostPer1k;
  }

  private async call(path: string, params?: Record<string, string>): Promise<OutscraperResult> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { "X-API-KEY": this.apiKey } });
    if (!res.ok) throw new Error(`outscraper ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as OutscraperResult;
  }

  async submit(q: { category: string; city: string; region: string; limit: number }): Promise<{ providerJobId: string }> {
    const result = await this.call("/maps/search-v3", {
      query: `${q.category}, ${q.city}, ${q.region}`,
      limit: String(q.limit),
      async: "true",
      dropDuplicates: "true",
    });
    if (!result.id) throw new Error("outscraper: submit returned no request id");
    return { providerJobId: result.id };
  }

  async poll(providerJobId: string): Promise<"pending" | "ready" | "failed"> {
    const result = await this.call(`/requests/${providerJobId}`);
    const status = (result.status ?? "").toLowerCase();
    if (status === "success" || status === "finished") return "ready";
    if (status === "pending" || status === "processing" || status === "in progress") return "pending";
    return "failed";
  }

  async fetchPage(providerJobId: string): Promise<{ records: RawListing[]; nextCursor?: string; actualCostUSD?: number }> {
    const result = await this.call(`/requests/${providerJobId}`);
    const rows = (result.data ?? []).flat();
    const records: RawListing[] = rows.map((r) => ({
      providerPlaceId: str(r, "place_id") ?? str(r, "google_id") ?? undefined,
      name: str(r, "name") ?? "",
      phone: str(r, "phone"),
      website: str(r, "site") ?? str(r, "website"),
      email: str(r, "email_1") ?? str(r, "email"),
      street: str(r, "street"),
      city: str(r, "city"),
      region: str(r, "us_state") ?? str(r, "state"),
      postal: str(r, "postal_code"),
      lat: numOf(r, "latitude"),
      lng: numOf(r, "longitude"),
      category: str(r, "category") ?? str(r, "type"),
      ownerName: str(r, "owner_title") ? null : str(r, "owner_name"), // owner_title present = business-page owner field is the biz itself
    }));
    return { records: records.filter((r) => r.name), actualCostUSD: this.estimateCostUSD(records.length) };
  }
}

function str(r: Record<string, unknown>, k: string): string | null {
  const v = r[k];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function numOf(r: Record<string, unknown>, k: string): number | null {
  const v = r[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function outscraperKey(): Promise<string> {
  return effectiveSecret("outscraper_api_key", env.outscraperApiKey());
}
