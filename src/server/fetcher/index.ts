import { defaults, env } from "../config";
import { getSetting } from "../settings";
import type { Fetcher } from "../providers/types";
import { MockFetcher } from "./mock";
import { RealFetcher } from "./real";

type G = typeof globalThis & { __leadforgeFetcher?: Fetcher };
const g = globalThis as G;

export async function getFetcher(): Promise<Fetcher> {
  if (!g.__leadforgeFetcher) {
    if (env.mockMode) {
      g.__leadforgeFetcher = new MockFetcher();
    } else {
      // §3.7 — concurrency limits are runtime-tunable in Settings; read once at
      // construction (the fetcher is a boot-time singleton, so changes apply on restart)
      const globalLimit = await getSetting("fetchGlobal", defaults.fetchGlobal);
      const perDomainLimit = await getSetting("fetchPerDomain", defaults.fetchPerDomain);
      g.__leadforgeFetcher = new RealFetcher(globalLimit, perDomainLimit);
    }
  }
  return g.__leadforgeFetcher;
}
