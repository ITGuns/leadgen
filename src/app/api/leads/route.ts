import { withAuth } from "@/server/auth";
import { listLeads, type LeadFilters } from "@/server/leads";

export const GET = withAuth(async (req) => {
  const p = new URL(req.url).searchParams;
  const filters: LeadFilters = {
    q: p.get("q") || undefined,
    status: p.getAll("status").filter(Boolean),
    states: p.getAll("state").filter(Boolean),
    minScore: Number.isFinite(Number(p.get("minScore"))) && p.get("minScore") ? Number(p.get("minScore")) : undefined,
    campaignId: Number.isInteger(Number(p.get("campaignId"))) && Number(p.get("campaignId")) > 0 ? Number(p.get("campaignId")) : undefined,
    hasWebsite: (p.get("hasWebsite") as "yes" | "no" | null) || undefined,
    ownerFound: p.get("ownerFound") === "1" ? true : p.get("ownerFound") === "0" ? false : undefined,
    assignee: p.get("assignee") || undefined,
    tag: p.get("tag") || undefined,
    sort: (p.get("sort") as LeadFilters["sort"]) || undefined,
    dir: (p.get("dir") as "asc" | "desc" | null) || undefined,
    page: Number.isInteger(Number(p.get("page"))) && Number(p.get("page")) > 0 ? Number(p.get("page")) : undefined,
    pageSize: Number.isInteger(Number(p.get("pageSize"))) && Number(p.get("pageSize")) > 0 ? Number(p.get("pageSize")) : undefined,
  };
  return Response.json(await listLeads(filters));
});
