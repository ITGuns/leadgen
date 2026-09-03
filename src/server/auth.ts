import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env, MOCK_IDENTITY } from "./config";

/**
 * ARCH A5 / G8 — every route verifies the Cloudflare Access JWT
 * (`Cf-Access-Jwt-Assertion`). The tunnel is the only door; this guard is the lock on
 * it. MOCK_MODE substitutes a fixed dev identity so local runs work without a tunnel.
 */

export type Identity = { email: string; name: string };

type G = typeof globalThis & { __leadforgeJwks?: { key: JWTVerifyGetKey; teamDomain: string } };
const g = globalThis as G;

function jwks(teamDomain: string): JWTVerifyGetKey {
  if (!g.__leadforgeJwks || g.__leadforgeJwks.teamDomain !== teamDomain) {
    g.__leadforgeJwks = {
      teamDomain,
      key: createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`)),
    };
  }
  return g.__leadforgeJwks.key;
}

/** Injectable core for tests (G8): verify a token against a key set + issuer + aud. */
export async function verifyAccessJWT(
  token: string,
  opts: { getKey: JWTVerifyGetKey; issuer: string; audience: string },
): Promise<Identity | null> {
  try {
    const { payload } = await jwtVerify(token, opts.getKey, {
      issuer: opts.issuer,
      audience: opts.audience,
    });
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!email) return null;
    return { email, name: typeof payload.name === "string" ? payload.name : email.split("@")[0] };
  } catch {
    return null;
  }
}

/** G8 test seam: lets the access-gate suite verify real-mode 401/200 behavior with a
 * locally-signed key set instead of Cloudflare's remote certs endpoint. */
type TestJwks = { getKey: JWTVerifyGetKey; issuer: string; audience: string };
export function __setTestJwks(t: TestJwks | null): void {
  (globalThis as { __leadforgeTestJwks?: TestJwks | null }).__leadforgeTestJwks = t;
}

export async function getIdentity(req: Request): Promise<Identity | null> {
  if (env.mockMode) return MOCK_IDENTITY;
  const token = req.headers.get("cf-access-jwt-assertion");
  const testJwks = (globalThis as { __leadforgeTestJwks?: TestJwks | null }).__leadforgeTestJwks;
  if (testJwks) {
    if (!token) return null;
    return verifyAccessJWT(token, testJwks);
  }
  const teamDomain = env.cfAccessTeamDomain();
  const aud = env.cfAccessAud();
  if (!teamDomain || !aud) return null; // real mode without Access config = locked shut, never open
  if (!token) return null;
  return verifyAccessJWT(token, { getKey: jwks(teamDomain), issuer: `https://${teamDomain}`, audience: aud });
}

type Handler = (req: Request, identity: Identity, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Route wrapper: 401 JSON on every unauthenticated request, incl. exports (G8). */
export function withAuth(handler: Handler) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    const identity = await getIdentity(req);
    if (!identity) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    try {
      return await handler(req, identity, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 500 });
    }
  };
}
