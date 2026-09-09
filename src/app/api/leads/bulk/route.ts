import { withAuth } from "@/server/auth";
import { bulkPatchLeads } from "@/server/leads";

export const POST = withAuth(async (req, identity) => {
  const { ids, patch } = (await req.json()) as {
    ids?: number[];
    patch?: { status?: string; assignee?: string | null; tags?: string[] };
  };
  if (!ids?.length || !patch) return Response.json({ error: "ids and patch required" }, { status: 400 });
  if (!ids.every((i) => Number.isInteger(i) && i > 0)) return Response.json({ error: "ids must be positive integers" }, { status: 400 });
  if (patch.tags !== undefined && (!Array.isArray(patch.tags) || patch.tags.some((t) => typeof t !== "string"))) {
    return Response.json({ error: "tags must be an array of strings" }, { status: 400 });
  }
  const updated = await bulkPatchLeads(ids, patch, identity.email);
  return Response.json({ updated });
});
