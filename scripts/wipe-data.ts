/**
 * Ops utility — empty every DATA table (schema and migrations stay intact).
 * Used to clear demo/mock rows before loading real data (HANDOFF · Deploy).
 *
 * Deliberately guarded: refuses to run unless WIPE=YES is set.
 *
 *   WIPE=YES DATABASE_URL=<pooler url> npx tsx scripts/wipe-data.ts
 *   WIPE=YES npx tsx scripts/wipe-data.ts        # local PGlite
 */
import { initDb, getDb } from "@/db/client";
import { sql } from "drizzle-orm";

const TABLES = [
  "campaign_leads", "notes", "leads", "exports", "intents", "spend_ledger",
  "quota_usage", "suppressions", "audit_log", "taxonomy_mappings",
  "pagespeed_cache", "chains", "campaigns", "businesses", "places_overture",
  "places_fsq", "releases", "jobs", "app_settings", "secure_config",
];

(async () => {
  if (process.env.WIPE !== "YES") {
    console.error("refusing: set WIPE=YES to confirm emptying every data table");
    process.exit(1);
  }
  await initDb();
  const list = TABLES.map((t) => `"${t}"`).join(", ");
  await getDb().execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
  // postgres-js returns the row array directly; PGlite wraps it in {rows}
  const rowsOf = (res: unknown): { n: number }[] =>
    Array.isArray(res) ? (res as { n: number }[]) : ((res as { rows: { n: number }[] }).rows ?? []);
  const [b] = rowsOf(await getDb().execute(sql`select count(*)::int as n from businesses`));
  const [r] = rowsOf(await getDb().execute(sql`select count(*)::int as n from releases`));
  console.log(`wiped — businesses: ${b.n} · releases: ${r.n} · target: ${process.env.DATABASE_URL ? "shared database" : "local PGlite"}`);
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
