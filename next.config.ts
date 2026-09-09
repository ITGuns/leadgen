import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone = slim Docker runtime image (ARCH A1). NEVER on Vercel: its build
  // finalizer expects the default output layout (ENOENT next-server.js.nft.json).
  output: process.env.VERCEL ? undefined : "standalone",
  serverExternalPackages: [
    "@duckdb/node-api",
    "@duckdb/node-bindings",
    "@electric-sql/pglite",
    "pg",
    "exceljs",
  ],
  // D19 — the native DuckDB module is workstation-only (dynamic import behind an
  // isServerless() guard); keep its ~100MB binaries out of every serverless function.
  outputFileTracingExcludes: {
    "*": ["node_modules/@duckdb/**", "node_modules/playwright*/**"],
  },
};

export default nextConfig;
