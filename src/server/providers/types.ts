import { z } from "zod";

/** CONTRACTS C9 — provider interfaces. Mock twins are deterministic and offline. */

export type RawListing = {
  providerPlaceId?: string;
  name: string;
  phone?: string | null;
  website?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  region?: string | null;
  postal?: string | null;
  lat?: number | null;
  lng?: number | null;
  category?: string | null;
  ownerName?: string | null; // Outscraper sometimes carries this — merged per §3.3
};

export interface ListingsProvider {
  readonly name: string;
  estimateCostUSD(recordsPlanned: number): number;
  submit(q: { category: string; city: string; region: string; limit: number }): Promise<{ providerJobId: string }>;
  poll(providerJobId: string): Promise<"pending" | "ready" | "failed">;
  fetchPage(
    providerJobId: string,
    cursor?: string,
  ): Promise<{ records: RawListing[]; nextCursor?: string; actualCostUSD?: number }>;
}

/** Anti-hallucination at the schema level: a name requires an evidence snippet. */
export const OwnerExtractionSchema = z
  .object({
    ownerName: z.string().min(2).optional(),
    role: z.string().optional(),
    evidenceSnippet: z.string().min(10),
    confidence: z.enum(["high", "low"]),
  })
  .refine((o) => !o.ownerName || o.evidenceSnippet.length >= 10, { message: "no snippet = no name" });
export type OwnerExtraction = z.infer<typeof OwnerExtractionSchema>;

export interface AIProvider {
  readonly name: string;
  readonly costPerOwnerCallUSD: number;
  /** costUSD is the ACTUAL spend when the provider reports usage, else the flat estimate (C10). */
  extractOwner(input: {
    businessName: string;
    multiLocation: boolean;
    pages: { url: string; text: string }[];
  }): Promise<{ extraction: OwnerExtraction | null; costUSD: number }>;
  proposeTaxonomy(niche: string, catalog: string[]): Promise<string[]>;
}

export interface PageSpeedProvider {
  readonly name: string;
  runMobile(url: string): Promise<{ mobileScore: number; lcpMs: number }>;
}

export interface DrivePort {
  readonly name: string;
  upload(localPath: string, name: string, folderId: string, mime: string): Promise<{ id: string; webViewLink: string }>;
  /** Find-or-create a subfolder under `parentId` (§3.5 optional per-campaign subfolder). */
  ensureFolder(name: string, parentId: string): Promise<{ id: string }>;
}

export type FetchResult = {
  ok: boolean;
  status: number;
  finalUrl: string;
  ssl: boolean;
  body: string; // capped at fetchMaxBytes
  error?: "dns" | "timeout" | "refused" | "robots" | "toolarge" | "other";
};

export interface Fetcher {
  /** Polite GET per CONTRACTS C6: robots, per-domain/global limits, timeout, UA, byte cap. */
  get(url: string): Promise<FetchResult>;
}

/** Stable tiny hash for deterministic mocks/fixtures. */
export function mockHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
