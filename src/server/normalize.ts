import { parsePhoneNumberFromString } from "libphonenumber-js";

/** CONTRACTS C2 — deterministic, idempotent normalizers. */

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|msclkid$|ref$|mc_cid$|mc_eid$)/i;
const LEGAL_SUFFIXES = new Set(["llc", "inc", "co", "corp", "ltd", "llp", "pllc", "pc", "company"]);

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, "US");
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164
}

/** Normalized website = lowercased host (www-stripped) + lowercased path (no trailing /) + kept params. */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  if (hasScheme && !/^https?:\/\//i.test(s)) return null; // mailto:, tel:, ftp:// …
  if (!hasScheme) s = `http://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username) return null;
  let host = url.hostname.toLowerCase();
  if (!host.includes(".")) return null;
  host = host.replace(/^www\./, "");
  let path = url.pathname.toLowerCase().replace(/\/+$/, "");
  if (path === "" || path === "/") path = "";
  const kept: string[] = [];
  for (const [k, v] of url.searchParams.entries()) {
    if (!TRACKING_PARAMS.test(k)) kept.push(`${encodeURIComponent(k.toLowerCase())}=${encodeURIComponent(v)}`);
  }
  return host + path + (kept.length ? `?${kept.join("&")}` : "");
}

/** Registrable-ish host only (www-stripped, lowercased). */
export function domainOf(raw: string | null | undefined): string | null {
  const norm = normalizeWebsite(raw);
  if (!norm) return null;
  return norm.split(/[/?]/)[0] || null;
}

export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = s.split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  if (words.length > 1 && words[0] === "the") words.shift();
  return words.join(" ");
}

/** Simple Jaro-Winkler for conflation name matching (C4/D15). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aM = new Array<boolean>(la).fill(false);
  const bM = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - matchWindow);
    const hi = Math.min(lb - 1, i + matchWindow);
    for (let j = lo; j <= hi; j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = bM[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  const jaro = (matches / la + matches / lb + (matches - t) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, la, lb) && a[i] === b[i]; i++) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
