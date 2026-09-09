import { withAuth } from "@/server/auth";
import { getLeadDetail, patchLead } from "@/server/leads";

function leadId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const GET = withAuth(async (_req, _identity, ctx) => {
  const id = leadId((await ctx.params).id);
  if (!id) return Response.json({ error: "not found" }, { status: 404 });
  const detail = await getLeadDetail(id);
  if (!detail) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(detail);
});

export const PATCH = withAuth(async (req, identity, ctx) => {
  const id = leadId((await ctx.params).id);
  if (!id) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { status?: string; assignee?: string | null; tags?: unknown } | null;
  if (!body) return Response.json({ error: "invalid JSON body" }, { status: 400 });
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== "string"))) {
    return Response.json({ error: "tags must be an array of strings" }, { status: 400 });
  }
  try {
    const detail = await patchLead(id, body as { status?: string; assignee?: string | null; tags?: string[] }, identity.email);
    if (!detail) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(detail);
  } catch (err) {
    if (err instanceof Error && err.message === "bad status") return Response.json({ error: "bad status" }, { status: 400 });
    throw err;
  }
});
