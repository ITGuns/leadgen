/**
 * B5 helper — derive the Overture category taxonomy FROM THE RELEASE DATA.
 * The canonical taxonomy CSV vanished from the OvertureMaps/schema repo (checked
 * 2026-09-06), so this scans DISTINCT taxonomy values (+hierarchy for parents) over
 * a set of states and writes data/overture_taxonomy.csv in the loader's
 * code,label,parent format. Values observed in more states/records rank first.
 *
 * Usage: OVERTURE_RELEASE=2026-08-19.0 npx tsx scripts/derive-taxonomy.ts DE NV CT
 * (anonymous public bucket; each state costs roughly one extract's scan)
 */
import { DuckDBInstance } from "@duckdb/node-api";
import fs from "node:fs";
import path from "node:path";

const release = process.env.OVERTURE_RELEASE || "2026-08-19.0";
const states = process.argv.slice(2).filter((s) => /^[A-Za-z]{2}$/.test(s)).map((s) => s.toUpperCase());
if (!states.length) {
  console.error("usage: npx tsx scripts/derive-taxonomy.ts DE NV CT …");
  process.exit(1);
}

const bboxes = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "state_bboxes.json"), "utf8")) as Record<
  string,
  { xmin: number; xmax: number; ymin: number; ymax: number }
>;

function titleCase(code: string): string {
  return code.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

(async () => {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await conn.run("INSTALL httpfs; LOAD httpfs;");
  await conn.run("SET s3_region='us-west-2';");
  const source = `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*`;

  type Row = { code: string; hier: string[] | null; n: number };
  const agg = new Map<string, { count: number; states: Set<string>; parents: Map<string, number> }>();

  for (const state of states) {
    const b = bboxes[state];
    if (!b) throw new Error(`no bbox for ${state}`);
    const t0 = Date.now();
    const sql = `SELECT to_json(t) AS j FROM (
      SELECT taxonomy."primary" AS code, taxonomy.hierarchy AS hier, count(*) AS n
      FROM read_parquet('${source}', hive_partitioning=1)
      WHERE bbox.xmin >= ${b.xmin} AND bbox.xmax <= ${b.xmax}
        AND bbox.ymin >= ${b.ymin} AND bbox.ymax <= ${b.ymax}
        AND (addresses[1].region IN ('${state}', 'US-${state}')
             OR (addresses[1].region IS NULL AND coalesce(addresses[1].country, 'US') = 'US'))
        AND taxonomy."primary" IS NOT NULL
      GROUP BY 1, 2) t`;
    const reader = await conn.runAndReadAll(sql);
    let stateRows = 0;
    for (const r of reader.getRows()) {
      const row = JSON.parse(String(r[0])) as Row;
      stateRows += row.n;
      let entry = agg.get(row.code);
      if (!entry) {
        entry = { count: 0, states: new Set(), parents: new Map() };
        agg.set(row.code, entry);
      }
      entry.count += row.n;
      entry.states.add(state);
      const h = row.hier ?? [];
      // hierarchy is [root, ..., leaf]; parent = element before the leaf
      const parent = h.length >= 2 ? h[h.length - 2] : "";
      if (parent && parent !== row.code) entry.parents.set(parent, (entry.parents.get(parent) ?? 0) + row.n);
      // register intermediate hierarchy levels so parents resolve too
      for (let i = 0; i < h.length - 1; i++) {
        let mid = agg.get(h[i]);
        if (!mid) {
          mid = { count: 0, states: new Set(), parents: new Map() };
          agg.set(h[i], mid);
        }
        if (i > 0) mid.parents.set(h[i - 1], (mid.parents.get(h[i - 1]) ?? 0) + 1);
      }
    }
    console.log(`${state}: ${stateRows} places scanned, catalog now ${agg.size} codes (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  const rows = [...agg.entries()]
    .map(([code, e]) => {
      const parent = [...e.parents.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      return { code, parent, count: e.count, states: e.states.size };
    })
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const lines = ["code,label,parent"];
  for (const r of rows) lines.push(`${r.code},${titleCase(r.code)},${r.parent}`);
  const outPath = path.join(process.cwd(), "data", "overture_taxonomy.csv");
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  fs.writeFileSync(
    path.join(process.cwd(), "data", ".taxonomy-derivation.json"),
    JSON.stringify({ release, states, derivedAt: new Date().toISOString(), codes: rows.length, topCodes: rows.slice(0, 40) }, null, 1),
  );
  console.log(`wrote ${rows.length} codes → ${outPath}`);
  console.log("top 30:", rows.slice(0, 30).map((r) => r.code).join(", "));
  process.exit(0);
})().catch((e) => {
  console.error("DERIVATION FAILED:", e.message);
  process.exit(1);
});
