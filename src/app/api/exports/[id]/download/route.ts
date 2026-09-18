import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { exportsTable } from "@/db/schema";
import { withAuth } from "@/server/auth";
import { signedExportUrl, SUPABASE_PATH_PREFIX } from "@/server/exports/storage";

/** Auth-gated download (G8 covers exports explicitly). Local files stream from the
 * volume; Supabase-stored artifacts redirect to a short-lived signed URL (D19). */
export const GET = withAuth(async (_req, _identity, ctx) => {
  const { id } = await ctx.params;
  const [record] = await getDb().select().from(exportsTable).where(eq(exportsTable.id, Number(id))).limit(1);
  if (!record || record.status !== "completed" || !record.path) {
    return Response.json({ error: "export not ready" }, { status: 404 });
  }
  if (record.path.startsWith(SUPABASE_PATH_PREFIX)) {
    const url = await signedExportUrl(record.path);
    return Response.redirect(url, 302);
  }
  if (!fs.existsSync(record.path)) return Response.json({ error: "file missing from volume" }, { status: 410 });
  const stream = fs.createReadStream(record.path);
  const filename = path.basename(record.path);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "content-type": record.format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
});
