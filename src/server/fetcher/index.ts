import { env } from "../config";
import type { Fetcher } from "../providers/types";
import { MockFetcher } from "./mock";
import { RealFetcher } from "./real";

type G = typeof globalThis & { __leadforgeFetcher?: Fetcher };
const g = globalThis as G;

export function getFetcher(): Fetcher {
  if (!g.__leadforgeFetcher) g.__leadforgeFetcher = env.mockMode ? new MockFetcher() : new RealFetcher();
  return g.__leadforgeFetcher;
}
