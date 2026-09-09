import { desc, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { suppressions } from "@/db/schema";
import { withAuth } from "@/server/auth";
import { importSuppressions } from "@/server/suppression";

export const GET = withAuth(async () => {
  const [rows, countRows] = await Promise.all([
    getDb().select().from(suppressions).orderBy(desc(suppressions.id)).limit(500),
    getDb().select({ kind: suppressions.kind, n: sql<number>`count(*)::int` }).from(suppressions).groupBy(suppressions.kind),
  ]);
  const counts = { client: 0, dnc: 0 };
  for (const r of countRows) counts[r.kind as "client" | "dnc"] = r.n;
  return Response.json({ rows, counts });
});

export const POST = withAuth(async (req, identity) => {
  const { kind, entries, source } = (await req.json()) as { kind?: string; entries?: string[]; source?: string };
  if (kind !== "client" && kind !== "dnc") return Response.json({ error: "kind must be client or dnc" }, { status: 400 });
  if (!entries?.length) return Response.json({ error: "entries required" }, { status: 400 });
  const truncated = entries.length > 50_000; // never silently drop DNC entries (compliance)
  const result = await importSuppressions(kind, entries.slice(0, 50_000), identity.email, source);
  return Response.json({ ...result, truncated, received: entries.length }, { status: 201 });
});
