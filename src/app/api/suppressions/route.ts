import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { suppressions } from "@/db/schema";
import { withAuth } from "@/server/auth";
import { importSuppressions } from "@/server/suppression";

export const GET = withAuth(async () => {
  const rows = await getDb().select().from(suppressions).orderBy(desc(suppressions.id)).limit(500);
  const counts = { client: 0, dnc: 0 };
  for (const r of await getDb().select().from(suppressions)) counts[r.kind as "client" | "dnc"]++;
  return Response.json({ rows, counts });
});

export const POST = withAuth(async (req, identity) => {
  const { kind, entries, source } = (await req.json()) as { kind?: string; entries?: string[]; source?: string };
  if (kind !== "client" && kind !== "dnc") return Response.json({ error: "kind must be client or dnc" }, { status: 400 });
  if (!entries?.length) return Response.json({ error: "entries required" }, { status: 400 });
  const result = await importSuppressions(kind, entries.slice(0, 50_000), identity.email, source);
  return Response.json(result, { status: 201 });
});
