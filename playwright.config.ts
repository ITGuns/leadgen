import { defineConfig } from "@playwright/test";

/** §4.7 — mock-mode full campaign E2E. Keyless; isolated DB per run. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // one shared app instance + single-process PGlite
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3311",
    trace: "retain-on-failure",
  },
  webServer: {
    // State reset happens HERE, not in globalSetup: Playwright boots the web server
    // BEFORE globalSetup runs, and deleting the PGlite data dir under a live instance
    // corrupts it (SQLite survived that via POSIX unlink; PGlite's NODEFS does not).
    command: "rm -rf .data/e2e-pg .data/e2e-exports .data/e2e-backups && npm run dev -- -p 3311",
    url: "http://localhost:3311/api/health",
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
    env: {
      MOCK_MODE: "1",
      PGLITE_DIR: ".data/e2e-pg",
      EXPORTS_DIR: ".data/e2e-exports",
      BACKUPS_DIR: ".data/e2e-backups",
    },
  },
});
