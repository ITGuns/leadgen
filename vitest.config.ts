import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      MOCK_MODE: "1",
      LEADFORGE_FROZEN_CLOCK: "2026-09-03T12:00:00.000Z",
    },
    testTimeout: 30000,
    pool: "forks",
  },
});
