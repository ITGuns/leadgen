import { DuckDBInstance } from "@duckdb/node-api";

(async () => {
  const inst = await DuckDBInstance.create(":memory:");
  const conn = await inst.connect();
  await conn.run("INSTALL httpfs; LOAD httpfs;");
  await conn.run("SET s3_region='us-west-2';");
  const sql = `SELECT to_json(t) AS j FROM (
    SELECT names."primary" AS name, taxonomy."primary" AS tax, taxonomy.alternates AS alts,
           addresses[1].region AS region, addresses[1].locality AS city, phones, websites, confidence, operating_status
    FROM read_parquet('s3://overturemaps-us-west-2/release/2026-08-19.0/theme=places/type=place/*', hive_partitioning=1)
    WHERE bbox.xmin >= -97.70 AND bbox.xmax <= -97.60 AND bbox.ymin >= 30.50 AND bbox.ymax <= 30.54
    LIMIT 8) t`;
  const r = await conn.runAndReadAll(sql);
  for (const row of r.getRows()) console.log(String(row[0]).slice(0, 260));
})().catch((e) => {
  console.error("PROBE FAILED:", e.message);
  process.exit(1);
});
