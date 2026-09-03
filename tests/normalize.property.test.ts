import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { domainOf, normalizeName, normalizePhone, normalizeWebsite, jaroWinkler } from "@/server/normalize";

describe("normalizePhone", () => {
  it("produces E.164 for US numbers in any common format", () => {
    for (const raw of ["(512) 555-0134", "512-555-0134", "512.555.0134", "+1 512 555 0134", "15125550134"]) {
      expect(normalizePhone(raw)).toBe("+15125550134");
    }
  });
  it("rejects garbage", () => {
    expect(normalizePhone("call us!")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
  it("is idempotent (property)", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizePhone(s);
        if (once !== null) expect(normalizePhone(once)).toBe(once);
      }),
    );
  });
});

describe("normalizeWebsite", () => {
  it("strips scheme, www, trailing slash, fragments, tracking params", () => {
    expect(normalizeWebsite("HTTPS://WWW.Acme-Roofing.com/")).toBe("acme-roofing.com");
    expect(normalizeWebsite("http://acme.com/Services/?utm_source=x&utm_medium=y#top")).toBe("acme.com/services");
    expect(normalizeWebsite("acme.com/a/?gclid=zz&page=2")).toBe("acme.com/a?page=2");
    expect(normalizeWebsite("www.acme.com")).toBe("acme.com");
  });
  it("rejects non-urls", () => {
    expect(normalizeWebsite("not a url at all")).toBeNull();
    expect(normalizeWebsite("mailto:x@y.com")).toBeNull();
    expect(normalizeWebsite("")).toBeNull();
  });
  it("is idempotent over realistic urls (property)", () => {
    const urlArb = fc
      .tuple(
        fc.constantFrom("http://", "https://", ""),
        fc.constantFrom("www.", ""),
        fc.domain(),
        fc.constantFrom("", "/about", "/Services/", "/a/b/"),
        fc.constantFrom("", "?utm_source=g", "?page=2&utm_campaign=x", "#frag"),
      )
      .map((parts) => parts.join(""));
    fc.assert(
      fc.property(urlArb, (u) => {
        const once = normalizeWebsite(u);
        expect(once).not.toBeNull();
        expect(normalizeWebsite(once!)).toBe(once);
      }),
    );
  });
  it("domainOf returns host only", () => {
    expect(domainOf("https://www.acme.com/services?x=1")).toBe("acme.com");
  });
});

describe("normalizeName", () => {
  it("drops legal suffixes, 'the', punctuation, case", () => {
    expect(normalizeName("The Acme Roofing Co.")).toBe("acme roofing");
    expect(normalizeName("ACME ROOFING, LLC")).toBe("acme roofing");
    expect(normalizeName("Bob's Plumbing & Heating Inc")).toBe("bob s plumbing and heating");
  });
  it("is idempotent (property)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (s) => {
        const once = normalizeName(s);
        expect(normalizeName(once)).toBe(once);
      }),
    );
  });
});

describe("jaroWinkler", () => {
  it("behaves sanely", () => {
    expect(jaroWinkler("acme roofing", "acme roofing")).toBe(1);
    expect(jaroWinkler("acme roofing", "acme roofing co")).toBeGreaterThan(0.9);
    expect(jaroWinkler("acme roofing", "zebra plumbing")).toBeLessThan(0.6);
  });
});
