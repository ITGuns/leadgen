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
}

export class MockDrive implements DrivePort {
  readonly name = "mock";
  async upload(localPath: string, name: string): Promise<{ id: string; webViewLink: string }> {
    const dir = path.join(env.exportsDir(), "drive-mock");
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, name);
    fs.copyFileSync(localPath, dest);
    return { id: `mock-${name}`, webViewLink: `file://${dest}` };
  }
}

export function getDrive(): DrivePort {
  if (env.mockMode) return new MockDrive();
  return driveConfigured() ? new RealDrive() : new MockDrive();
}

export function driveAvailable(): boolean {
  return env.mockMode || driveConfigured();
}
