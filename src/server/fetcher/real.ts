import PQueue from "p-queue";
import fs from "node:fs";
import path from "node:path";
import { defaults } from "../config";
import type { FetchResult, Fetcher } from "../providers/types";
import { parseRobots, robotsAllows, type RobotsRules } from "./robots";

/** CONTRACTS C6 — polite fetcher: ≤2/domain, ≤10 global, 8s timeout, robots.txt,
 * identified UA (config/compliance.json), 2MB body cap, no JS rendering. */

type ComplianceConfig = { userAgent: string };
let compliance: ComplianceConfig | null = null;
export function userAgent(): string {
  if (!compliance) {
    compliance = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "compliance.json"), "utf8"));
  }
  return compliance!.userAgent;
}

export class RealFetcher implements Fetcher {
  private global = new PQueue({ concurrency: defaults.fetchGlobal });
  private perDomain = new Map<string, PQueue>();
  private robotsCache = new Map<string, { rules: RobotsRules | null; at: number }>();

  private domainQueue(host: string): PQueue {
    let q = this.perDomain.get(host);
    if (!q) {
      q = new PQueue({ concurrency: defaults.fetchPerDomain });
      this.perDomain.set(host, q);
      if (this.perDomain.size > 5000) this.perDomain.clear(); // bounded memory over long runs
    }
    return q;
  }

  private async robotsFor(origin: string, host: string): Promise<RobotsRules | null> {
    const cached = this.robotsCache.get(host);
    if (cached && Date.now() - cached.at < 6 * 3600_000) return cached.rules;
    let rules: RobotsRules | null = null;
    try {
      const res = await this.rawGet(`${origin}/robots.txt`, 4000);
      if (res.ok && res.status === 200) rules = parseRobots(res.body, userAgent());
    } catch {
      rules = null; // unreachable robots = no restrictions knowable; proceed politely
    }
    this.robotsCache.set(host, { rules, at: Date.now() });
    return rules;
  }

  private async rawGet(url: string, timeoutMs: number): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "user-agent": userAgent(), accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      });
      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            if (received > defaults.fetchMaxBytes) {
              await reader.cancel();
              break;
            }
            chunks.push(value);
          }
        }
      }
      const body = Buffer.concat(chunks).toString("utf8");
      return {
        ok: res.ok,
        status: res.status,
        finalUrl: res.url || url,
        ssl: (res.url || url).startsWith("https:"),
        body,
        error: received > defaults.fetchMaxBytes ? "toolarge" : undefined,
      };
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).name;
      const error =
        cause === "ENOTFOUND" || cause === "EAI_AGAIN" ? "dns"
        : cause === "ECONNREFUSED" || cause === "ECONNRESET" ? "refused"
        : cause === "AbortError" || (err as Error).name === "AbortError" || cause === "UND_ERR_CONNECT_TIMEOUT" ? "timeout"
        : "other";
      return { ok: false, status: 0, finalUrl: url, ssl: url.startsWith("https:"), body: "", error };
    } finally {
      clearTimeout(timer);
    }
  }

  async get(url: string): Promise<FetchResult> {
    let parsed: URL;
    try {
      parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    } catch {
      return { ok: false, status: 0, finalUrl: url, ssl: false, body: "", error: "other" };
    }
    const host = parsed.hostname.toLowerCase();
    return this.global.add(() =>
      this.domainQueue(host).add(async (): Promise<FetchResult> => {
        const rules = await this.robotsFor(parsed.origin, host);
        if (rules && !robotsAllows(rules, parsed.pathname || "/")) {
          return { ok: false, status: 0, finalUrl: parsed.href, ssl: parsed.protocol === "https:", body: "", error: "robots" };
        }
        return this.rawGet(parsed.href, defaults.fetchTimeoutMs);
      }),
    ) as Promise<FetchResult>;
  }
}
