import { env } from "../../config";
import type { ListingsProvider } from "../types";
import { MockListingsProvider } from "./mock";
import { OutscraperProvider, outscraperKey } from "./outscraper";

type G = typeof globalThis & { __leadforgeListings?: ListingsProvider };
const g = globalThis as G;

export function getListingsProvider(): ListingsProvider {
  if (!g.__leadforgeListings) {
    const key = outscraperKey();
    g.__leadforgeListings = env.mockMode || !key ? new MockListingsProvider() : new OutscraperProvider(key);
  }
  return g.__leadforgeListings;
}

export function topUpAvailable(): boolean {
  return env.mockMode || !!outscraperKey();
}
