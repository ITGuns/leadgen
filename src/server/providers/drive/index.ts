import fs from "node:fs";
import path from "node:path";
import { env } from "../../config";
import type { DrivePort } from "../types";
import { accessToken, driveConfigured } from "./oauth";

/** Drive upload via multipart (files ≤ ~50 MB — exports/backups fit; supportsAllDrives
 * covers Shared Drives). Mock writes into EXPORTS_DIR/drive-mock (§4.7). */

export class RealDrive implements DrivePort {
  readonly name = "drive";
  async upload(localPath: string, name: string, folderId: string, mime: string): Promise<{ id: string; webViewLink: string }> {
    const token = await accessToken();
    const metadata = { name, parents: folderId ? [folderId] : undefined, mimeType: mime };
    const boundary = `leadforge${Date.now().toString(16)}`;
    const fileBuf = fs.readFileSync(localPath);
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`,
      ),
      fileBuf,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    if (!res.ok) throw new Error(`drive upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { id: string; webViewLink?: string };
    return { id: data.id, webViewLink: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view` };
  }

  async ensureFolder(name: string, parentId: string): Promise<{ id: string }> {
    const token = await accessToken();
    const safeName = name.replaceAll("\\", "").replaceAll("'", "\\'");
    const q = `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchUrl = new URL("https://www.googleapis.com/drive/v3/files");
    searchUrl.searchParams.set("q", q);
    searchUrl.searchParams.set("supportsAllDrives", "true");
    searchUrl.searchParams.set("includeItemsFromAllDrives", "true");
    searchUrl.searchParams.set("fields", "files(id)");
    const found = await fetch(searchUrl, { headers: { authorization: `Bearer ${token}` } });
    if (!found.ok) throw new Error(`drive folder search failed (${found.status}): ${(await found.text()).slice(0, 300)}`);
    const existing = ((await found.json()) as { files?: { id: string }[] }).files?.[0];
    if (existing) return { id: existing.id };
    const created = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined }),
    });
    if (!created.ok) throw new Error(`drive folder create failed (${created.status}): ${(await created.text()).slice(0, 300)}`);
    return { id: ((await created.json()) as { id: string }).id };
  }
}

export class MockDrive implements DrivePort {
  readonly name = "mock";

  private root(): string {
    return path.join(env.exportsDir(), "drive-mock");
  }

  async upload(localPath: string, name: string, folderId: string): Promise<{ id: string; webViewLink: string }> {
    // mock folder ids are sanitized directory names produced by ensureFolder below
    const dir = folderId && /^[\w#·& -]{1,80}$/.test(folderId) ? path.join(this.root(), folderId) : this.root();
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name);
    fs.copyFileSync(localPath, dest);
    return { id: `mock-${name}`, webViewLink: `file://${dest}` };
  }

  async ensureFolder(name: string): Promise<{ id: string }> {
    const safe = name.replace(/[^\w#·& -]/g, "_").slice(0, 80) || "folder";
    fs.mkdirSync(path.join(this.root(), safe), { recursive: true });
    return { id: safe };
  }
}

export async function getDrive(): Promise<DrivePort> {
  if (env.mockMode) return new MockDrive();
  return (await driveConfigured()) ? new RealDrive() : new MockDrive();
}

export async function driveAvailable(): Promise<boolean> {
  return env.mockMode || (await driveConfigured());
}
