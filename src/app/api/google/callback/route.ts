import { withAuth } from "@/server/auth";
import { audit } from "@/server/audit";
import { exchangeCode } from "@/server/providers/drive/oauth";
import { getSetting, setSetting } from "@/server/settings";

export const GET = withAuth(async (req, identity) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = await getSetting<string>("googleOauthState", "");
  if (!code || !state || !expected || state !== expected) {
    return Response.redirect(new URL("/settings?google=state_mismatch", url.origin), 302);
  }
  await setSetting("googleOauthState", "");
  try {
    await exchangeCode(code);
    await audit(identity.email, "drive.connected", {});
    return Response.redirect(new URL("/settings?google=connected", url.origin), 302);
  } catch (err) {
    const message = err instanceof Error ? err.message : "exchange failed";
    return Response.redirect(new URL(`/settings?google=error&detail=${encodeURIComponent(message.slice(0, 120))}`, url.origin), 302);
  }
});
