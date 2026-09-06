import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { env } from "../config";
import { effectiveSecret } from "../secure-store";

/**
 * One DuckDB in-memory instance per extract run. Real mode loads httpfs for the public
 * sources (ARCH A3.1): Overture is an anonymous S3 bucket; FSQ OS Places is a gated
 * HF dataset (free account, auto-approved — probed 2026-09-06) authenticated with a
 * DuckDB huggingface secret when HF_TOKEN is configured. Mock mode reads the bundled
 * parquet through the exact same SQL path (§4.7). Results come back as JSON —
 * `to_json(t)` per row — so nested structs arrive as plain JS values.
 */
export async function withDuck<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    if (!env.mockMode) {
      await conn.run("INSTALL httpfs; LOAD httpfs;");
      await conn.run("SET s3_region='us-west-2';");
      const hfToken = effectiveSecret("hf_token", env.hfToken());
      if (hfToken) {
        await conn.run(`CREATE SECRET hf (TYPE HUGGINGFACE, TOKEN '${hfToken.replaceAll("'", "''")}')`);
      }
    }
    return await fn(conn);
  } finally {
    conn.closeSync?.();
  }
}

export async function queryJson<T = Record<string, unknown>>(conn: DuckDBConnection, innerSql: string): Promise<T[]> {
  const reader = await conn.runAndReadAll(`SELECT to_json(t) AS j FROM (${innerSql}) t`);
  const rows = reader.getRows();
  return rows.map((r) => JSON.parse(String(r[0])) as T);
}
