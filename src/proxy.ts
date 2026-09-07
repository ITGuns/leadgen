import { NextResponse, type NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * ARCH A5 / G8 — edge of the app. Every request must carry a valid Cloudflare Access
 * JWT (`Cf-Access-Jwt-Assertion`) unless MOCK_MODE. The tunnel is the only intended
 * door; this guard is the only lock if the app is ever exposed another way — don't.
 * Defense in depth: API routes ALSO verify via withAuth (unit-tested in G8).
 */

// /api/jobs/tick carries its own Bearer CRON_SECRET check (D19) — Vercel Cron
// requests never have a CF Access JWT.
const PUBLIC_PATHS = new Set(["/api/health", "/api/jobs/tick"]);

type G = typeof globalThis & { __lfProxyJwks?: { key: JWTVerifyGetKey; domain: string } };
const g = globalThis as G;

function jwks(domain: string): JWTVerifyGetKey {
  if (!g.__lfProxyJwks || g.__lfProxyJwks.domain !== domain) {
    g.__lfProxyJwks = { domain, key: createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`)) };
  }
  return g.__lfProxyJwks.key;
}

export default async function proxy(req: NextRequest) {
  const mock = (process.env.MOCK_MODE ?? "1") === "1" || (process.env.MOCK_MODE ?? "").toLowerCase() === "true";
  if (mock) return NextResponse.next();
  // D20 — Vercel Deployment Protection (or another platform gate) fronts the app;
  // the platform authenticated the request before it reached us. Explicit opt-in.
  const trustPlatform = (process.env.AUTH_TRUST_PLATFORM ?? "") === "1" || (process.env.AUTH_TRUST_PLATFORM ?? "").toLowerCase() === "true";
  if (trustPlatform) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN ?? "";
  const aud = process.env.CF_ACCESS_AUD ?? "";
  const fail = () =>
    pathname.startsWith("/api/")
      ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
      : new NextResponse("401 — access denied. Sign in through leads.gemfieldconsulting.com (Cloudflare Access).", {
          status: 401,
          headers: { "content-type": "text/plain" },
        });
  if (!teamDomain || !aud) return fail(); // real mode without Access config = locked shut

  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token) return fail();
  try {
    await jwtVerify(token, jwks(teamDomain), { issuer: `https://${teamDomain}`, audience: aud });
    return NextResponse.next();
  } catch {
    return fail();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
