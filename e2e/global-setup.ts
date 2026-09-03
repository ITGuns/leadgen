import fs from "node:fs";
import path from "node:path";

/** Fresh isolated state for every e2e run — the app self-seeds from the mock parquet. */
export default function globalSetup(): void {
  for (const p of [".data/e2e.db", ".data/e2e.db-wal", ".data/e2e.db-shm"]) {
    fs.rmSync(path.join(process.cwd(), p), { force: true });
  }
  for (const d of [".data/e2e-exports", ".data/e2e-backups", ".data/e2e-config"]) {
    fs.rmSync(path.join(process.cwd(), d), { recursive: true, force: true });
  }
}
