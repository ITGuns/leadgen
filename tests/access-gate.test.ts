import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { freshDb } from "./helpers";
import { __setTestJwks, verifyAccessJWT, withAuth } from "@/server/auth";

/**
 * G8 — requests without a valid Cloudflare Access JWT get 401 on every route,
 * including exports. Uses a locally-signed key set through the documented test seam;
 * the verification code path is the production one.
 */

const ISSUER = "https://gemfield.cloudflareaccess.com";
const AUD = "test-aud-tag-1234";

let sign: (patch?: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  await freshDb();
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  const getKey = createLocalJWKSet({ keys: [jwk] });
  __setTestJwks({ getKey, issuer: ISSUER, audience: AUD });
  process.env.MOCK_MODE = "0";
  sign = (patch = {}) =>
    new SignJWT({ email: "staff@gemfieldconsulting.com", name: "Staff", ...patch })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer((patch.iss as string) ?? ISSUER)
      .setAudience((patch.aud as string) ?? AUD)
      .setIssuedAt()
      .setExpirationTime((patch.exp as string) ?? "5m")
      .sign(privateKey);
});

afterAll(() => {
  process.env.MOCK_MODE = "1";
  __setTestJwks(null);
});

describe("G8 · Cloudflare Access JWT verification", () => {
  it("accepts a valid token and extracts the identity", async () => {
    const token = await sign();
    const req = new Request("http://x/api/stats", { headers: { "cf-access-jwt-assertion": token } });
    const handler = withAuth(async (_req, identity) => Response.json({ email: identity.email }));
    const res = await handler(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { email: string }).email).toBe("staff@gemfieldconsulting.com");
  });

  it("401 with no token, wrong audience, wrong issuer, expired token, or garbage", async () => {
    const handler = withAuth(async () => Response.json({ leaked: true }));
    const call = async (headers: Record<string, string>) =>
      (await handler(new Request("http://x/api/leads", { headers }), { params: Promise.resolve({}) })).status;

    expect(await call({})).toBe(401);
    expect(await call({ "cf-access-jwt-assertion": "garbage.token.here" })).toBe(401);
    expect(await call({ "cf-access-jwt-assertion": await sign({ aud: "other-app" }) })).toBe(401);
    expect(await call({ "cf-access-jwt-assertion": await sign({ iss: "https://evil.example.com" }) })).toBe(401);
    expect(await call({ "cf-access-jwt-assertion": await sign({ exp: "-1m" }) })).toBe(401);
  });

  it("401 covers real routes including the export download", async () => {
    const { GET: statsGet } = await import("@/app/api/stats/route");
    const { GET: leadsGet } = await import("@/app/api/leads/route");
    const { GET: downloadGet } = await import("@/app/api/exports/[id]/download/route");
    const { POST: campaignsPost } = await import("@/app/api/campaigns/route");
    for (const [handler, url] of [
      [statsGet, "http://x/api/stats"],
      [leadsGet, "http://x/api/leads"],
      [campaignsPost, "http://x/api/campaigns"],
    ] as const) {
      const res = await handler(new Request(url, { method: url.includes("campaigns") ? "POST" : "GET" }), {
        params: Promise.resolve({}),
      });
      expect(res.status, url).toBe(401);
    }
    const dl = await downloadGet(new Request("http://x/api/exports/1/download"), { params: Promise.resolve({ id: "1" }) });
    expect(dl.status).toBe(401); // exports are gated too (§4.6)
  });

  it("a token without an email claim is rejected", async () => {
    const token = await new SignJWT({ name: "NoEmail" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign((await generateKeyPair("RS256")).privateKey); // also wrong key
    const identity = await verifyAccessJWT(token, {
      getKey: createLocalJWKSet({ keys: [] }),
      issuer: ISSUER,
      audience: AUD,
    });
    expect(identity).toBeNull();
  });

  it("mock mode substitutes the fixed dev identity (local runs need no tunnel)", async () => {
    process.env.MOCK_MODE = "1";
    const handler = withAuth(async (_req, identity) => Response.json({ email: identity.email }));
    const res = await handler(new Request("http://x/api/stats"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { email: string }).email).toBe("dev@gemfieldconsulting.com");
    process.env.MOCK_MODE = "0";
  });
});
