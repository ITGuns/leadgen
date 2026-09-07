import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { getDb } from "@/db/client";
import { secureConfig } from "@/db/schema";
import { effectiveSecret, secureDelete, secureGet, secureSet } from "@/server/secure-store";

/** D8 (revised D19) — ciphertext lives in the secure_config table; values never
 * appear in plaintext at rest and a tampered payload reads as absent. */

describe("secure store (D8)", () => {
  beforeAll(async () => {
    await freshDb();
  });
  afterEach(async () => {
    await secureDelete("test_key");
  });

  it("roundtrips JSON values encrypted at rest", async () => {
    await secureSet("test_key", { token: "abc123", n: 2 });
    expect(await secureGet("test_key")).toEqual({ token: "abc123", n: 2 });
    const [row] = await getDb().select().from(secureConfig).where(eq(secureConfig.name, "test_key")).limit(1);
    expect(row!.payload).not.toContain("abc123");
  });

  it("returns null for missing or tampered payloads", async () => {
    expect(await secureGet("test_key")).toBeNull();
    await secureSet("test_key", "v");
    const [row] = await getDb().select().from(secureConfig).where(eq(secureConfig.name, "test_key")).limit(1);
    await getDb()
      .update(secureConfig)
      .set({ payload: "AAAA" + row!.payload })
      .where(eq(secureConfig.name, "test_key"));
    expect(await secureGet("test_key")).toBeNull();
  });

  it("effectiveSecret prefers the stored value over env", async () => {
    expect(await effectiveSecret("test_key", "from-env")).toBe("from-env");
    await secureSet("test_key", "from-store");
    expect(await effectiveSecret("test_key", "from-env")).toBe("from-store");
  });
});
