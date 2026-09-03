import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { taxonomyMappings } from "@/db/schema";
import { withAuth } from "@/server/auth";
import { audit } from "@/server/audit";

/** §3.7 — category catalog editor: confirmed niche→taxonomy mappings. */

export const GET = withAuth(async () => {
  return Response.json({ mappings: getDb().select().from(taxonomyMappings).orderBy(desc(taxonomyMappings.confirmedAt)).all() });
});

export const DELETE = withAuth(async (req, identity) => {
  const { niche } = (await req.json()) as { niche?: string };
  if (!niche) return Response.json({ error: "niche required" }, { status: 400 });
  getDb().delete(taxonomyMappings).where(eq(taxonomyMappings.niche, niche)).run();
  audit(identity.email, "taxonomy.mapping_deleted", { niche });
  return Response.json({ ok: true });
});
