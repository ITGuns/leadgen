import { withAuth } from "@/server/auth";
import { addNote } from "@/server/leads";

export const POST = withAuth(async (req, identity, ctx) => {
  const { id } = await ctx.params;
  const { body } = (await req.json()) as { body?: string };
  if (!body?.trim()) return Response.json({ error: "note body required" }, { status: 400 });
  return Response.json({ note: await addNote(Number(id), identity.email, body.trim()) }, { status: 201 });
});
