import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { getSqlite } from "@/db/client";
import { defaults, env, now } from "../config";
import { setSetting } from "../settings";
import { driveAvailable, getDrive } from "../providers/drive";
import { driveFolderId } from "../providers/drive/oauth";
import type { JobContext } from "./registry";

/**
 * ARCH A3.7 — nightly snapshot via SQLite's ONLINE BACKUP API (never a raw copy of a
 * live WAL database), gzipped, 30-day retention, pushed to Drive when configured.
 * A corrupt backup is worse than none: the snapshot is taken by SQLite itself.
 */

export async function runBackup(ctx: JobContext): Promise<void> {
  const dir = env.backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rawPath = path.join(dir, `leadforge-${stamp}.db`);
  const gzPath = `${rawPath}.gz`;

  await getSqlite().backup(rawPath); // online backup API
  ctx.checkpoint({ snapshot: rawPath });

  await new Promise<void>((resolve, reject) => {
    const inp = fs.createReadStream(rawPath);
    const out = fs.createWriteStream(gzPath);
    inp.pipe(zlib.createGzip({ level: 6 })).pipe(out).on("finish", resolve).on("error", reject);
    inp.on("error", reject);
  });
  fs.unlinkSync(rawPath);

  // retention
  const cutoff = now().getTime() - defaults.backupRetentionDays * 86400_000;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".db.gz")) continue;
    const full = path.join(dir, f);
    if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
  }

  let driveLink: string | null = null;
  if (driveAvailable()) {
    const uploaded = await getDrive().upload(gzPath, path.basename(gzPath), driveFolderId(), "application/gzip");
    driveLink = uploaded.webViewLink;
  }
  setSetting("lastBackupAt", now().toISOString());
  setSetting("lastBackupFile", path.basename(gzPath));
  ctx.checkpoint({ done: true, gz: gzPath, driveLink });
}
