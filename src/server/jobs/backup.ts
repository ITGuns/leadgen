import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { isSharedDatabase } from "@/db/client";
import { defaults, env, isServerless, now } from "../config";
import { setSetting } from "../settings";
import { driveAvailable, getDrive } from "../providers/drive";
import { driveFolderId } from "../providers/drive/oauth";
import type { JobContext } from "./registry";

/**
 * ARCH A3.7 / D21 — nightly snapshot.
 * · Supabase (DATABASE_URL set): the platform runs managed backups + PITR; a serverless
 *   function cannot stream a pg_dump reliably, so this job records a skip and exits —
 *   verify backups in the Supabase dashboard (HANDOFF · Backups).
 * · Local PGlite: gzip the data directory files (single-process WASM Postgres — quiesced
 *   between jobs; the worker never runs two jobs over the same slice), 30-day retention,
 *   pushed to Drive when configured.
 */

export async function runBackup(ctx: JobContext): Promise<void> {
  if (isSharedDatabase()) {
    await setSetting("lastBackupAt", now().toISOString());
    await setSetting("lastBackupFile", "supabase-managed");
    await ctx.checkpoint({ skipped: true, reason: "Supabase manages database backups (D21) — verify in the Supabase dashboard" });
    return;
  }
  if (isServerless()) {
    await ctx.checkpoint({ skipped: true, reason: "no local database on serverless" });
    return;
  }

  const dir = env.backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const gzPath = path.join(dir, `leadforge-${stamp}.tar.gz`);

  // PGlite keeps the database as flat files under the data dir; tar+gzip via Node only.
  const dataDir = env.pgliteDir();
  const files = collectFiles(dataDir);
  const tar = buildTar(dataDir, files);
  await new Promise<void>((resolve, reject) => {
    zlib.gzip(tar, { level: 6 }, (err, gz) => {
      if (err) return reject(err);
      try {
        fs.writeFileSync(gzPath, gz);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
  await ctx.checkpoint({ snapshot: gzPath });

  // retention
  const cutoff = now().getTime() - defaults.backupRetentionDays * 86400_000;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".gz")) continue;
    const full = path.join(dir, f);
    if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
  }

  let driveLink: string | null = null;
  if (await driveAvailable()) {
    const uploaded = await (await getDrive()).upload(gzPath, path.basename(gzPath), await driveFolderId(), "application/gzip");
    driveLink = uploaded.webViewLink;
  }
  await setSetting("lastBackupAt", now().toISOString());
  await setSetting("lastBackupFile", path.basename(gzPath));
  await ctx.checkpoint({ done: true, gz: gzPath, driveLink });
}

function collectFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Minimal ustar archive — enough for our own restore (tar -xzf works too). */
function buildTar(root: string, files: string[]): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const data = fs.readFileSync(file);
    const rel = path.relative(root, file).split(path.sep).join("/");
    const header = Buffer.alloc(512);
    header.write(rel.slice(0, 100), 0, "utf8");
    header.write("0000644\0", 100, "ascii"); // mode
    header.write("0000000\0", 108, "ascii"); // uid
    header.write("0000000\0", 116, "ascii"); // gid
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, "ascii");
    header.write("        ", 148, "ascii"); // checksum placeholder
    header.write("0", 156, "ascii"); // regular file
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");
    let sum = 0;
    for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
    blocks.push(header, data);
    const pad = 512 - (data.length % 512 || 512);
    if (pad > 0 && pad < 512) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024)); // end-of-archive
  return Buffer.concat(blocks);
}
