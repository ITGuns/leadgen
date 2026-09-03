import { defineConfig } from "@playwright/test";

/** §4.7 — mock-mode full campaign E2E. Keyless; isolated DB per run. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // one shared app instance + SQLite
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3311",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- -p 3311",
    url: "http://localhost:3311/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      MOCK_MODE: "1",
      DATABASE_PATH: ".data/e2e.db",
      EXPORTS_DIR: ".data/e2e-exports",
      BACKUPS_DIR: ".data/e2e-backups",
      CONFIG_DIR: ".data/e2e-config",
    },
  },
  globalSetup: "./e2e/global-setup.ts",
});
