import type { businesses, leads } from "@/db/schema";

/** §3.5 — export column model shared by XLSX and CSV. Order here is picker order. */

export type ExportRow = { lead: typeof leads.$inferSelect; business: typeof businesses.$inferSelect };

export type ColumnDef = {
  key: string;
  header: string;
  width: number;
  value: (r: ExportRow) => string | number | null;
  hyperlink?: (r: ExportRow) => string | null;
};

export const EXPORT_COLUMNS: ColumnDef[] = [
  { key: "score", header: "Score", width: 8, value: (r) => r.lead.score },
  { key: "name", header: "Business", width: 32, value: (r) => r.business.name },
  { key: "category", header: "Category", width: 22, value: (r) => r.business.taxonomyPrimary },
  { key: "phone", header: "Phone", width: 16, value: (r) => r.business.phone },
  {
    key: "website", header: "Website", width: 34,
    value: (r) => r.business.websiteRaw,
    hyperlink: (r) => (r.business.websiteRaw && /^https?:\/\//i.test(r.business.websiteRaw) ? r.business.websiteRaw : null),
  },
  { key: "websiteClass", header: "Website class", width: 14, value: (r) => r.business.websiteClass },
  { key: "email", header: "Email", width: 26, value: (r) => (r.business.emails ?? [])[0] ?? null },
  { key: "socials", header: "Socials", width: 30, value: (r) => (r.business.socials ?? []).join(" ") || null },
  { key: "ownerName", header: "Owner", width: 20, value: (r) => r.lead.ownerName },
  { key: "ownerRole", header: "Owner role", width: 14, value: (r) => r.lead.ownerRole },
  { key: "ownerConfidence", header: "Owner confidence", width: 14, value: (r) => r.lead.ownerConfidence },
  { key: "ownerEvidence", header: "Owner evidence", width: 46, value: (r) => r.lead.ownerEvidence },
  { key: "street", header: "Street", width: 26, value: (r) => r.business.street },
  { key: "city", header: "City", width: 16, value: (r) => r.business.city },
  { key: "state", header: "State", width: 7, value: (r) => r.business.region },
  { key: "postal", header: "ZIP", width: 9, value: (r) => r.business.postal },
  { key: "mobileScore", header: "Mobile score", width: 11, value: (r) => (r.lead.pagespeed && r.lead.pagespeed.mobileScore >= 0 ? r.lead.pagespeed.mobileScore : null) },
  { key: "builder", header: "Site builder", width: 12, value: (r) => r.lead.websiteCheck?.builder ?? null },
  { key: "copyrightYear", header: "© year", width: 8, value: (r) => r.lead.websiteCheck?.copyrightYear ?? null },
  { key: "reasons", header: "Score reasons", width: 40, value: (r) => (r.lead.scoreReasons ?? []).map((c) => c.chip).join(" · ") || null },
  { key: "status", header: "Status", width: 13, value: (r) => r.lead.status },
  { key: "assignee", header: "Assignee", width: 18, value: (r) => r.lead.assignee },
  { key: "tags", header: "Tags", width: 18, value: (r) => (r.lead.tags ?? []).join(", ") || null },
  { key: "confidence", header: "Data confidence", width: 13, value: (r) => r.business.confidence },
  { key: "sources", header: "Sources", width: 18, value: (r) => Object.keys(r.business.sources ?? {}).filter((k) => k !== "conflicts").join("+") || null },
  { key: "lastVerified", header: "Last verified", width: 18, value: (r) => r.lead.lastVerifiedAt },
];

export const DEFAULT_COLUMNS = [
  "score", "name", "category", "phone", "website", "websiteClass", "email", "ownerName", "ownerEvidence",
  "city", "state", "mobileScore", "builder", "reasons", "status",
];

export function pickColumns(keys: string[]): ColumnDef[] {
  const wanted = new Set(keys.length ? keys : DEFAULT_COLUMNS);
  return EXPORT_COLUMNS.filter((c) => wanted.has(c.key));
}
