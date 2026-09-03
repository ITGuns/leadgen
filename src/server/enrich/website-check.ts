import type { WebsiteCheck } from "@/db/schema";
import { classifyFetched, isShortener, type WebsiteClass } from "../classify";
import { now } from "../config";
import { domainOf } from "../normalize";
import type { Fetcher } from "../providers/types";

/** CONTRACTS C6 — website check + fetch-pass classification for `unknown` candidates. */

const BUILDERS: [RegExp, string][] = [
  [/wp-content|wp-includes|wp-json|generator[^>]*wordpress/i, "wordpress"],
  [/wixstatic\.com|parastorage\.com|generator[^>]*wix/i, "wix"],
  [/squarespace\.com|this is squarespace|sqsp\.net/i, "squarespace"],
  [/wsimg\.com|godaddy website builder|generator[^>]*godaddy/i, "godaddy"],
  [/editmysite\.com|generator[^>]*weebly/i, "weebly"],
  [/dudaone|dudamobile|cdn\.multiscreensite/i, "duda"],
  [/cdn\.shopify\.com|shopify\.com\/s\//i, "shopify"],
];

export function detectBuilder(html: string): string {
  for (const [re, name] of BUILDERS) if (re.test(html)) return name;
  return "custom";
}

export function detectCopyrightYear(html: string): number | null {
  const matches = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)];
  const years = matches.map((m) => parseInt(m[1], 10)).filter((y) => y >= 1990 && y <= 2100);
  return years.length ? Math.max(...years) : null;
}

export type WebsiteCheckOutcome = { check: WebsiteCheck; websiteClass: WebsiteClass };

export async function checkWebsite(fetcher: Fetcher, rawUrl: string): Promise<WebsiteCheckOutcome> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let fetched = await fetcher.get(url);
  // shorteners: one resolution hop, then classify the destination
  if (isShortener(domainOf(rawUrl)) && fetched.ok && fetched.finalUrl !== url) {
    fetched = { ...fetched };
  }
  const websiteClass = classifyFetched(fetched);
  const html = fetched.body ?? "";
  const finalHost = domainOf(fetched.finalUrl);
  const startHost = domainOf(url);

  const check: WebsiteCheck = {
    finalUrl: fetched.finalUrl,
    httpStatus: fetched.status,
    ok: fetched.ok,
    ssl: fetched.ssl,
    redirectedToSocial: websiteClass === "social_only" && !!finalHost && finalHost !== startHost,
    builder: websiteClass === "real_site" ? detectBuilder(html) : null,
    copyrightYear: websiteClass === "real_site" ? detectCopyrightYear(html) : null,
    hasContactForm: /<form[\s>][^]*?(email|contact|message)/i.test(html),
    hasBooking: /calendly|acuity|book (?:now|online)|schedule (?:an? )?(?:appointment|estimate|service)|housecallpro/i.test(html),
    hasClickToCall: /href=["']tel:/i.test(html),
    hasViewportMeta: /<meta[^>]+name=["']viewport["']/i.test(html),
    htmlBytes: html.length,
    error: fetched.error,
    fetchedAt: now().toISOString(),
  };
  return { check, websiteClass };
}

/** Fetch homepage + likely about/team pages for owner extraction (own site only, §3.6). */
export async function fetchOwnerPages(fetcher: Fetcher, siteUrl: string): Promise<{ url: string; text: string }[]> {
  const pages: { url: string; text: string }[] = [];
  let base = siteUrl.trim();
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  const home = await fetcher.get(base);
  if (home.ok) pages.push({ url: home.finalUrl, text: htmlToText(home.body) });
  const origin = home.ok ? new URL(home.finalUrl).origin : new URL(base).origin;
  for (const path of ["/about", "/about-us", "/team", "/our-story"]) {
    if (pages.length >= 3) break;
    const res = await fetcher.get(origin + path);
    if (res.ok && res.status === 200 && res.body) pages.push({ url: res.finalUrl, text: htmlToText(res.body) });
  }
  return pages;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[^]*?<\/script>/gi, " ")
    .replace(/<style[^]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&copy;/gi, "©")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
