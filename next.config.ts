import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // slim Docker runtime image (ARCH A1)
  serverExternalPackages: [
    "better-sqlite3",
    "@duckdb/node-api",
    "@duckdb/node-bindings",
    "exceljs",
  ],
};

export default nextConfig;
