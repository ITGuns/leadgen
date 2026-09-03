import { normalizeName } from "../normalize";
import type { OwnerExtraction } from "../providers/types";

/**
 * §3.3 — free heuristic owner extractor. Rules of the contract:
 *  · a name is accepted only when the page ties it to THIS business with an
 *    owner/founder/proprietor/principal role — never team rosters, reviewers,
 *    franchise executives, or web-designer credits
 *  · no snippet = no name (evidence is mandatory)
 *  · multi-location sites yield confidence 'low' by rule
 */

// Case-tolerant role words with a case-SENSITIVE name pattern — an `i` flag on the
// whole regex would let lowercase junk match as a name.
const ROLE = "(?:[Cc]o-?[Oo]wner|[Oo]wner(?:-[Oo]perator)?|[Ff]ounder|[Pp]roprietor|[Pp]rincipal)";
const NAME = "([A-Z][a-zA-Z'’-]+(?:\\s+[A-Z]\\.?)?\\s+[A-Z][a-zA-Z'’-]+)";

const PATTERNS: RegExp[] = [
  // "John Smith, Owner" / "John Smith — owner and lead technician" / "John Smith is the owner"
  new RegExp(`${NAME}\\s*(?:,|—|–|-|:)?\\s*(?:is\\s+the\\s+|as\\s+)?(?:the\\s+)?${ROLE}\\b`, "g"),
  // "Owner: John Smith" / "Owner John Smith" / "owner and operator, John Smith"
  new RegExp(`\\b${ROLE}\\s*(?:[Aa]nd\\s+[Oo]perator)?\\s*(?:,|:|—|–|-)?\\s+${NAME}`, "g"),
  // "founded by John Smith" / "owned and operated by John Smith"
  new RegExp(`\\b(?:[Ff]ounded|[Ee]stablished|[Ss]tarted|[Oo]wned(?:\\s+and\\s+[Oo]perated)?)\\s+by\\s+${NAME}`, "g"),
];

const REJECT_NEARBY = [
  // "stars" only counts as ratings context with a quantity — "Lone Star Pest" is a business name
  /review|testimonial|★|\brated\b|\b(?:\d+|one|two|three|four|five)\s*[- ]?stars?\b|yelp|google/i,
  /designed by|website by|built by|powered by|created by|developed by/i,
  /franchise|corporate|nationwide ceo|chain/i,
];
// role words we never accept on their own (guide: owner/founder/proprietor/principal only)
const WEAK_ROLE_NEARBY = /\b(?:ceo|president|manager|director)\b/i;

const MULTI_LOCATION = /\b\d+\s+locations\b|locations\s+across|[Ss]erving\s+[A-Z][a-z]+,\s+[A-Z][a-z]+,?\s+and\s+[A-Z][a-z]+/;

const NOT_NAMES = new Set(["all rights", "privacy policy", "united states", "customer service", "family business"]);

function windowAround(text: string, index: number, len: number, radius = 130): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + len + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

export function extractOwnerHeuristic(input: {
  businessName: string;
  pages: { url: string; text: string }[];
}): OwnerExtraction | null {
  const bizTokens = new Set(normalizeName(input.businessName).split(" ").filter((w) => w.length > 2));

  for (const page of input.pages) {
    const text = page.text;
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      for (const m of text.matchAll(pattern)) {
        const name = m[1];
        if (!name || NOT_NAMES.has(name.toLowerCase())) continue;
        const idx = m.index ?? 0;
        const near = text.slice(Math.max(0, idx - 90), Math.min(text.length, idx + m[0].length + 90));
        if (REJECT_NEARBY.some((r) => r.test(near))) continue;
        if (WEAK_ROLE_NEARBY.test(m[0])) continue;
        // reject candidates that are actually part of the business name itself ("Baker Family Roofing" → "Baker")
        const nameTokens = normalizeName(name).split(" ");
        if (nameTokens.every((t) => bizTokens.has(t))) continue;

        const roleMatch = m[0].match(new RegExp(ROLE, "i"));
        const evidence = windowAround(text, idx, m[0].length);
        const isAboutPage = /about|team|story/.test(page.url);
        const tiedToBusiness = [...bizTokens].some((t) => near.toLowerCase().includes(t)) || isAboutPage;
        if (!tiedToBusiness) continue;
        const multiLocation = MULTI_LOCATION.test(text);
        return {
          ownerName: name.replace(/\s+/g, " ").trim(),
          role: roleMatch ? roleMatch[0].toLowerCase() : undefined,
          evidenceSnippet: evidence,
          confidence: multiLocation ? "low" : "high",
        };
      }
    }
  }
  return null;
}
