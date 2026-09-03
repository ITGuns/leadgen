import { domainOf, normalizeName, normalizePhone } from "./normalize";

/** CONTRACTS C3 — identity key precedence: gers → phone → domain+name → name+location. */
export function identityKeyFor(input: {
  gersId?: string | null;
  phone?: string | null; // raw or E.164 — normalized here
  website?: string | null;
  name: string;
  city?: string | null;
  region?: string | null;
}): string {
  if (input.gersId) return `overture:${input.gersId}`;
  const phone = normalizePhone(input.phone);
  if (phone) return `phone:${phone}`;
  const domain = domainOf(input.website);
  const name = normalizeName(input.name);
  if (domain) return `dn:${domain}|${name}`;
  return `nl:${name}|${(input.city || "").toLowerCase().trim()}|${(input.region || "").toUpperCase().trim()}`;
}
