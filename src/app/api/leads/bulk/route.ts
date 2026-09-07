import { withAuth } from "@/server/auth";
import { bulkPatchLeads } from "@/server/leads";

export const POST = withAuth(async (req, identity) => {
  const { ids, patch } = (await req.json()) as {
    ids?: number[];
    patch?: { status?: string; assignee?: string | null; tags?: string[] };
  };
  if (!ids?.length || !patch) return Response.json({ error: "ids and patch required" }, { status: 400 });
  const updated = await bulkPatchLeads(ids, patch, identity.email);
  return Response.json({ updated });
});
