import crypto from "node:crypto";
import { withAuth } from "@/server/auth";
import { buildAuthUrl, googleClientId, googleClientSecret } from "@/server/providers/drive/oauth";
import { setSetting } from "@/server/settings";

/** Starts the one-time Drive consent (procurement §4). User OAuth or Shared Drive —
 * never a bare service account. */
export const GET = withAuth(async () => {
  if (!(await googleClientId()) || !(await googleClientSecret())) {
    return Response.json({ error: "enter the Google OAuth client id + secret in Settings first (BLOCKERS B2)" }, { status: 400 });
  }
  const state = crypto.randomBytes(16).toString("hex");
  await setSetting("googleOauthState", state);
  return Response.json({ url: await buildAuthUrl(state) });
});
