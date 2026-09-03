import { describe, expect, it } from "vitest";
import { identityKeyFor } from "@/server/identity";

describe("identityKeyFor (CONTRACTS C3 precedence)", () => {
  it("prefers gers id", () => {
    expect(identityKeyFor({ gersId: "g1", phone: "5125550134", name: "Acme" })).toBe("overture:g1");
  });
  it("falls back to E.164 phone", () => {
    expect(identityKeyFor({ phone: "(512) 555-0134", name: "Acme" })).toBe("phone:+15125550134");
  });
  it("then domain+name", () => {
    expect(identityKeyFor({ website: "https://www.acme.com/", name: "Acme Roofing LLC" })).toBe(
      "dn:acme.com|acme roofing",
    );
  });
  it("last resort name+location", () => {
    expect(identityKeyFor({ name: "Acme Roofing", city: "Austin", region: "tx" })).toBe("nl:acme roofing|austin|TX");
  });
  it("same business, two formats, one key", () => {
    const a = identityKeyFor({ phone: "512-555-0134", name: "ACME ROOFING LLC" });
    const b = identityKeyFor({ phone: "+1 (512) 555 0134", name: "The Acme Roofing" });
    expect(a).toBe(b);
  });
});
