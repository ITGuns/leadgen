import { env, now } from "../../config";
import { secureGet, secureSet } from "../../secure-store";
import { effectiveSecret } from "../../secure-store";

/**
 * D3/D12 — Google Drive via user OAuth (Workspace account) or a Shared Drive; NEVER a
 * bare service account (no My Drive quota — uploads fail silently). drive.file scope
 * only. Raw fetch, no googleapis. The refresh token lives in the encrypted config
 * store (secure_config table under APP_SECRET — D8-revised), not in plain rows.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

type StoredToken = { refreshToken: string; accessToken?: string; expiresAt?: number; account?: string };

export async function googleClientId(): Promise<string> {
  return effectiveSecret("google_client_id", env.googleClientId());
}
export async function googleClientSecret(): Promise<string> {
  return effectiveSecret("google_client_secret", env.googleClientSecret());
}
export async function driveFolderId(): Promise<string> {
  return effectiveSecret("google_drive_folder_id", env.googleDriveFolderId());
}

export function oauthRedirectUri(): string {
  return `${env.appUrl().replace(/\/$/, "")}/api/google/callback`;
}

export async function driveConfigured(): Promise<boolean> {
  return !!(
    (await googleClientId()) &&
    (await googleClientSecret()) &&
    (await secureGet<StoredToken>("google_drive_token"))
  );
}

export async function buildAuthUrl(state: string): Promise<string> {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", await googleClientId());
  url.searchParams.set("redirect_uri", oauthRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // ensure a refresh token on re-consent
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(code: string): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: await googleClientId(),
      client_secret: await googleClientSecret(),
      redirect_uri: oauthRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  if (!data.refresh_token) {
    throw new Error("google returned no refresh token — remove the app's prior grant at myaccount.google.com/permissions and retry");
  }
  await secureSet("google_drive_token", {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: now().getTime() + (data.expires_in - 60) * 1000,
  } satisfies StoredToken);
}

export async function accessToken(): Promise<string> {
  const stored = await secureGet<StoredToken>("google_drive_token");
  if (!stored) throw new Error("Drive is not connected — complete the OAuth consent in Settings (BLOCKERS B2)");
  if (stored.accessToken && stored.expiresAt && Date.now() < stored.expiresAt) return stored.accessToken;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: stored.refreshToken,
      client_id: await googleClientId(),
      client_secret: await googleClientSecret(),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`google token refresh failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  await secureSet("google_drive_token", {
    ...stored,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  } satisfies StoredToken);
  return data.access_token;
}
