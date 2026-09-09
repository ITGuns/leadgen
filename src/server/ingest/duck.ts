import type { DuckDBConnection } from "@duckdb/node-api";
import { env, isServerless } from "../config";
import { effectiveSecret } from "../secure-store";

/**
 * One DuckDB in-memory instance per extract run. Real mode loads httpfs for the public
 * sources (ARCH A3.1): Overture is an anonymous S3 bucket; FSQ OS Places is a gated
 * HF dataset authenticated with a DuckDB huggingface secret when HF_TOKEN is set.
 * Mock mode reads the bundled parquet through the exact same SQL path (§4.7).
 *
 * D19: the extract never runs on Vercel — the native DuckDB module stays out of the
 * serverless bundle (dynamic import + tracing exclude); the monthly extract runs from
 * any workstation via scripts/workstation-extract.ts straight into Supabase.
 */
export async function withDuck<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  if (isServerless()) {
    throw new Error(
      "the DuckDB extract does not run on serverless — run it from a workstation: DATABASE_URL=<supabase> npx tsx scripts/workstation-extract.ts <STATES> (HANDOFF · Monthly)",
    );
  }
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    if (!env.mockMode) {
      await conn.run("INSTALL httpfs; LOAD httpfs;");
      await conn.run("SET s3_region='us-west-2';");
      // scripts/net-proxy.ts — a local CONNECT tunnel with its own DNS, for networks
      // whose router resolver flakes under heavy S3 streaming (TLS stays end-to-end)
      const proxy = process.env.DUCKDB_HTTP_PROXY;
      if (proxy) await conn.run(`SET http_proxy='${proxy.replaceAll("'", "''")}'`);
      const hfToken = await effectiveSecret("hf_token", env.hfToken());
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

const TRANSIENT = /resolve hostname|getaddrinfo|ENOTFOUND|ETIMEDOUT|ECONNRESET|Connection error|timed out|Could not establish/i;

/** queryJson with retries for transient network faults (flaky DNS mid-scan kills
 * hours of S3 streaming otherwise — hit live on a workstation extract, D22). */
export async function queryJsonRetry<T = Record<string, unknown>>(
  conn: DuckDBConnection,
  innerSql: string,
  tries = 8,
): Promise<T[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await queryJson<T>(conn, innerSql);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= tries || !TRANSIENT.test(msg)) throw err;
      console.warn(`[ingest] transient network fault (attempt ${attempt}/${tries}) — retrying in 25s: ${msg.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 25_000));
    }
  }
}
