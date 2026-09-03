import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { pagespeedCache, quotaUsage } from "@/db/schema";
import { defaults, env, now } from "../../config";
import { getSetting } from "../../settings";
import { domainOf } from "../../normalize";
import { effectiveSecret } from "../../secure-store";
import type { PageSpeedProvider } from "../types";
import { mockHash } from "../types";

/** §3.3/§4.4 — PageSpeed mobile scoring: 25k/day tracked quota, 30-day per-domain cache. */

export class RealPageSpeed implements PageSpeedProvider {
  readonly name = "pagespeed";
  constructor(private apiKey: string) {}
  async runMobile(url: string): Promise<{ mobileScore: number; lcpMs: number }> {
    const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    endpoint.searchParams.set("url", url.startsWith("http") ? url : `https://${url}`);
    endpoint.searchParams.set("strategy", "MOBILE");
    endpoint.searchParams.set("category", "PERFORMANCE");
    endpoint.searchParams.set("key", this.apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000); // calls take 10-30s (§3 procurement)
    try {
      const res = await fetch(endpoint, { signal: controller.signal });
      if (!res.ok) throw new Error(`pagespeed ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as {
        lighthouseResult?: {
          categories?: { performance?: { score?: number } };
          audits?: { "largest-contentful-paint"?: { numericValue?: number } };
        };
      };
      const score = data.lighthouseResult?.categories?.performance?.score;
      const lcp = data.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue;
      if (score == null) throw new Error("pagespeed: no performance score in response");
      return { mobileScore: Math.round(score * 100), lcpMs: Math.round(lcp ?? 0) };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Deterministic mock keyed off the fixture domain's profile token (D14). */
export class MockPageSpeed implements PageSpeedProvider {
  readonly name = "mock";
  async runMobile(url: string): Promise<{ mobileScore: number; lcpMs: number }> {
    const m = url.match(/\.lf-([a-z0-9-]+)\.test/);
    const profile = m ? m[1] : "default";
    const h = mockHash(`ps:${url}`);
    const range: Record<string, [number, number]> = {
      "custom-good": [82, 97], "sq-decent": [55, 75], "custom-old": [45, 65],
      "wp-poor": [15, 40], "wix-noviewport": [25, 45], "gd-old": [20, 40],
      "weebly-poor": [18, 35], default: [40, 70],
    };
    const [lo, hi] = range[profile] ?? range.default;
    const mobileScore = lo + (h % (hi - lo + 1));
    const lcpMs = Math.round(1800 + (100 - mobileScore) * 90 + (h % 500));
    return { mobileScore, lcpMs };
  }
}

export function pagespeedKey(): string {
  return effectiveSecret("pagespeed_api_key", env.pagespeedApiKey());
}
export function getPageSpeed(): PageSpeedProvider {
  if (env.mockMode) return new MockPageSpeed();
  const key = pagespeedKey();
  return key ? new RealPageSpeed(key) : new MockPageSpeed();
}
export function pagespeedAvailable(): boolean {
  return env.mockMode || !!pagespeedKey();
}

// ---- daily quota tracking (shared across campaigns via the global scheduler) ----

function today(): string {
  return now().toISOString().slice(0, 10);
}

export function pagespeedQuotaRemaining(): number {
  const limit = getSetting<number>("pagespeedDailyQuota", defaults.pagespeedDailyQuota) - defaults.pagespeedQuotaSafety;
  const row = getDb()
    .select()
    .from(quotaUsage)
    .where(and(eq(quotaUsage.provider, "pagespeed"), eq(quotaUsage.day, today())))
    .get();
  return Math.max(0, limit - (row?.count ?? 0));
}

export function consumePagespeedQuota(): boolean {
  if (pagespeedQuotaRemaining() <= 0) return false;
  getDb()
    .insert(quotaUsage)
    .values({ provider: "pagespeed", day: today(), count: 1 })
    .onConflictDoUpdate({
      target: [quotaUsage.provider, quotaUsage.day],
      set: { count: sql`${quotaUsage.count} + 1` },
    })
    .run();
  return true;
}

// ---- 30-day per-domain cache ----

export function cachedPagespeed(url: string): { mobileScore: number; lcpMs: number } | null {
  const domain = domainOf(url);
  if (!domain) return null;
  const row = getDb().select().from(pagespeedCache).where(eq(pagespeedCache.domain, domain)).get();
  if (!row) return null;
  const ageMs = now().getTime() - new Date(row.fetchedAt).getTime();
  if (ageMs > defaults.pagespeedCacheDays * 86400_000) return null;
  return { mobileScore: row.mobileScore, lcpMs: row.lcpMs };
}

export function storePagespeed(url: string, result: { mobileScore: number; lcpMs: number }): void {
  const domain = domainOf(url);
  if (!domain) return;
  getDb()
    .insert(pagespeedCache)
    .values({ domain, mobileScore: result.mobileScore, lcpMs: result.lcpMs, fetchedAt: now().toISOString() })
    .onConflictDoUpdate({
      target: pagespeedCache.domain,
      set: { mobileScore: result.mobileScore, lcpMs: result.lcpMs, fetchedAt: now().toISOString() },
    })
    .run();
}
