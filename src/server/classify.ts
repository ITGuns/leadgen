import { domainOf } from "./normalize";
import type { FetchResult } from "./providers/types";

/** CONTRACTS C5 — URL classification. Static pass is offline (host lists); the
 * fetch pass resolves `unknown` to real_site / parked / dead / social_only. */

export const SOCIAL_HOSTS = [
  "facebook.com", "m.facebook.com", "instagram.com", "linktr.ee", "linktree.com", "tiktok.com",
  "twitter.com", "x.com", "youtube.com", "pinterest.com",
];
export const AGGREGATOR_HOSTS = [
  "yelp.com", "angi.com", "angieslist.com", "homeadvisor.com", "thumbtack.com", "houzz.com", "bbb.org",
  "yellowpages.com", "mapquest.com", "nextdoor.com", "porch.com", "expertise.com", "findlaw.com", "avvo.com",
  "healthgrades.com", "zocdoc.com", "opentable.com", "doordash.com", "grubhub.com", "ubereats.com",
  "business.site", "superpages.com", "manta.com", "buildzoom.com",
];
export const SHORTENER_HOSTS = ["bit.ly", "goo.gl", "tinyurl.com", "t.co", "lnkd.in", "qrco.de", "rebrand.ly", "ow.ly"];

export type StaticClass = "none" | "social_only" | "aggregator" | "unknown";
export type WebsiteClass = StaticClass | "real_site" | "parked" | "dead";

function hostMatches(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}
export function isSocialHost(host: string | null): boolean {
  return !!host && hostMatches(host, SOCIAL_HOSTS);
}
export function isShortener(host: string | null): boolean {
  return !!host && hostMatches(host, SHORTENER_HOSTS);
}

/** Overture provides websites & socials separately — a business whose only link is a
 * Facebook page is social_only, never "has website" (§3.3). */
export function classifyStatic(websites: string[] | null | undefined, socials: string[] | null | undefined): StaticClass {
  const sites = (websites ?? []).map(domainOf).filter(Boolean) as string[];
  const hasSocials = (socials ?? []).length > 0;
  if (sites.length === 0) return hasSocials ? "social_only" : "none";
  const host = sites[0];
  if (hostMatches(host, SOCIAL_HOSTS)) return "social_only";
  if (hostMatches(host, AGGREGATOR_HOSTS)) return "aggregator";
  return "unknown"; // incl. shorteners — resolved by the fetch pass
}

const PARKED_PATTERNS = [
  /this domain (?:is|may be) for sale/i,
  /buy this domain/i,
  /domain (?:is )?parked/i,
  /sedoparking|parkingcrew|hugedomains|afternic|dan\.com\/buy/i,
  /godaddy[^<]{0,40}(?:parked|domain)/i,
];

/** Resolve an `unknown` classification with the fetch result. */
export function classifyFetched(fetched: FetchResult): WebsiteClass {
  if (fetched.error === "dns" || fetched.error === "refused") return "dead";
  if (fetched.error === "timeout") return "dead";
  const finalHost = domainOf(fetched.finalUrl);
  if (finalHost && hostMatches(finalHost, SOCIAL_HOSTS)) return "social_only";
  if (finalHost && hostMatches(finalHost, AGGREGATOR_HOSTS)) return "aggregator";
  if (!fetched.ok && (fetched.status === 0 || fetched.status >= 500 || fetched.status === 404)) return "dead";
  if (PARKED_PATTERNS.some((p) => p.test(fetched.body))) return "parked";
  return "real_site";
}

/** Classes that score & filter like "no real website" (C5). */
export const NO_SITE_CLASSES: WebsiteClass[] = ["none", "aggregator", "parked", "dead", "social_only"];
