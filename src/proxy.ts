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

/** Constant-time string compare (edge runtime — no node:crypto here). */
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** D23 — APP_PASSWORD gate: the app's own front door for platforms whose free tier
 * cannot protect the production domain (Vercel Standard Protection covers only
 * deployment/preview URLs — verified live). HTTP Basic over HTTPS; any username. */
function basicAuthOk(req: NextRequest, password: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const pass = decoded.slice(decoded.indexOf(":") + 1);
    return safeEqual(pass, password);
  } catch {
    return false;
  }
}

export default async function proxy(req: NextRequest) {
  const mock = (process.env.MOCK_MODE ?? "1") === "1" || (process.env.MOCK_MODE ?? "").toLowerCase() === "true";
  if (mock) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  // D23 — built-in password gate (takes precedence over the platform-trust switch:
  // if a password is configured, it is always required)
  const appPassword = process.env.APP_PASSWORD ?? "";
  if (appPassword) {
    if (basicAuthOk(req, appPassword)) return NextResponse.next();
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="LeadForge", charset="UTF-8"', "content-type": "text/plain" },
    });
  }
  // D20 — Vercel Deployment Protection (or another platform gate) fronts the app;
  // the platform authenticated the request before it reached us. Explicit opt-in.
  const trustPlatform = (process.env.AUTH_TRUST_PLATFORM ?? "") === "1" || (process.env.AUTH_TRUST_PLATFORM ?? "").toLowerCase() === "true";
  if (trustPlatform) return NextResponse.next();

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
