import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { env } from "../config";

/**
 * One DuckDB in-memory instance per extract run. Real mode loads httpfs for the
 * anonymous public buckets (ARCH A3.1); mock mode reads the bundled parquet through
 * the exact same SQL path (§4.7). Results come back as JSON — `to_json(t)` per row —
 * so nested Overture structs arrive as plain JS values regardless of client version.
 */
export async function withDuck<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    if (!env.mockMode) {
      await conn.run("INSTALL httpfs; LOAD httpfs;");
      await conn.run("SET s3_region='us-west-2';");
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
