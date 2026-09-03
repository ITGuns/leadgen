import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { env } from "@/server/config";

/** Unauthenticated liveness probe for Docker healthcheck — no data exposed. */
export async function GET() {
  try {
    getDb().run(sql`SELECT 1`);
    return Response.json({ ok: true, mock: env.mockMode });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
