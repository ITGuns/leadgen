import fs from "node:fs";
import { env } from "../config";

/**
 * D19 — export artifacts on Vercel go to Supabase Storage (bucket "exports", private):
 * /tmp is per-invocation, so the file written by the export job would vanish before the
 * download click. Raw fetch against the Storage API with the service-role key — no SDK.
 * When SUPABASE_URL is unset (local/Docker), exports stay on the local filesystem and
 * none of this runs. `exports.path` uses the `supabase:<object-path>` prefix to mark
 * which store holds the file.
 */

export const EXPORTS_BUCKET = "exports";
export const SUPABASE_PATH_PREFIX = "supabase:";

export function storageConfigured(): boolean {
  return !!(env.supabaseUrl() && env.supabaseServiceKey());
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const key = env.supabaseServiceKey();
  return { authorization: `Bearer ${key}`, apikey: key, ...extra };
}

export async function uploadExport(localPath: string, objectPath: string, contentType: string): Promise<string> {
  const body = fs.readFileSync(localPath);
  const res = await fetch(`${env.supabaseUrl()}/storage/v1/object/${EXPORTS_BUCKET}/${encodeURIComponent(objectPath)}`, {
    method: "POST",
    headers: headers({ "content-type": contentType, "x-upsert": "true" }),
    body,
  });
  if (!res.ok) {
    throw new Error(
      `supabase storage upload failed (${res.status}): ${(await res.text()).slice(0, 300)} — create a private bucket named "${EXPORTS_BUCKET}" (HANDOFF · Deploy)`,
    );
  }
  return `${SUPABASE_PATH_PREFIX}${objectPath}`;
}

/** Time-limited signed URL for the download route to redirect to. */
export async function signedExportUrl(storedPath: string, expiresInSeconds = 600): Promise<string> {
  const objectPath = storedPath.slice(SUPABASE_PATH_PREFIX.length);
  const res = await fetch(
    `${env.supabaseUrl()}/storage/v1/object/sign/${EXPORTS_BUCKET}/${encodeURIComponent(objectPath)}`,
    {
      method: "POST",
      headers: headers({ "content-type": "application/json" }),
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    },
  );
  if (!res.ok) throw new Error(`supabase storage sign failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { signedURL: string };
  return `${env.supabaseUrl()}/storage/v1${data.signedURL}`;
}
