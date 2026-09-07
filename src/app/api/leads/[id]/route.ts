import { withAuth } from "@/server/auth";
import { getLeadDetail, patchLead } from "@/server/leads";

export const GET = withAuth(async (_req, _identity, ctx) => {
  const { id } = await ctx.params;
  const detail = await getLeadDetail(Number(id));
  if (!detail) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(detail);
});

export const PATCH = withAuth(async (req, identity, ctx) => {
  const { id } = await ctx.params;
  const patch = (await req.json()) as { status?: string; assignee?: string | null; tags?: string[] };
  const detail = await patchLead(Number(id), patch, identity.email);
  return Response.json(detail);
});
