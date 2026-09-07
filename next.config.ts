import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // slim Docker runtime image (ARCH A1); Vercel ignores this and does its own tracing
  serverExternalPackages: [
    "@duckdb/node-api",
    "@duckdb/node-bindings",
    "@electric-sql/pglite",
    "postgres",
    "exceljs",
  ],
  // D19 — the native DuckDB module is workstation-only (dynamic import behind an
  // isServerless() guard); keep its ~100MB binaries out of every serverless function.
  outputFileTracingExcludes: {
    "*": ["node_modules/@duckdb/**", "node_modules/playwright*/**"],
  },
};

export default nextConfig;
