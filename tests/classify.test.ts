import { describe, expect, it } from "vitest";
import { classifyFetched, classifyStatic } from "@/server/classify";
import { MockFetcher } from "@/server/fetcher/mock";
import { checkWebsite, detectBuilder, detectCopyrightYear } from "@/server/enrich/website-check";

describe("C5 · static classification", () => {
  it("none / social_only from websites vs socials fields", () => {
    expect(classifyStatic(null, null)).toBe("none");
    expect(classifyStatic([], [])).toBe("none");
    expect(classifyStatic(null, ["https://www.facebook.com/acme"])).toBe("social_only");
    expect(classifyStatic(["https://www.facebook.com/acme"], null)).toBe("social_only");
    expect(classifyStatic(["https://instagram.com/x"], ["https://facebook.com/x"])).toBe("social_only");
  });
  it("aggregators are never 'has website'", () => {
    for (const url of [
      "https://www.yelp.com/biz/acme-roofing",
      "https://www.homeadvisor.com/rated.acme.html",
      "https://www.angi.com/companylist/acme.htm",
      "https://acme.business.site",
      "https://www.bbb.org/us/tx/austin/profile/acme",
    ]) {
      expect(classifyStatic([url], null)).toBe("aggregator");
    }
  });
  it("real candidates and shorteners stay unknown until fetched", () => {
    expect(classifyStatic(["https://www.acmeroofing.com"], null)).toBe("unknown");
    expect(classifyStatic(["https://bit.ly/abc123"], null)).toBe("unknown");
  });
});

describe("C5 · fetch-pass classification", () => {
  it("dead / parked / social-redirect / real", () => {
    const base = { ok: true, status: 200, finalUrl: "https://a.com", ssl: true, body: "<html>hi</html>" } as const;
    expect(classifyFetched({ ...base, ok: false, status: 0, body: "", error: "dns" })).toBe("dead");
    expect(classifyFetched({ ...base, ok: false, status: 0, body: "", error: "timeout" })).toBe("dead");
    expect(classifyFetched({ ...base, body: "This domain is for sale — sedoparking.com" })).toBe("parked");
    expect(classifyFetched({ ...base, finalUrl: "https://www.facebook.com/acme" })).toBe("social_only");
    expect(classifyFetched({ ...base, ok: false, status: 404, body: "" })).toBe("dead");
    expect(classifyFetched(base)).toBe("real_site");
  });
});

describe("C6 · website check over the mock fetcher", () => {
  const fetcher = new MockFetcher();

  it("builder fingerprints", () => {
    expect(detectBuilder('<link href="/wp-content/x.css">')).toBe("wordpress");
    expect(detectBuilder('<img src="https://static.wixstatic.com/a.png">')).toBe("wix");
    expect(detectBuilder("<!-- This is Squarespace. -->")).toBe("squarespace");
    expect(detectBuilder('<img src="https://img1.wsimg.com/x.jpg">')).toBe("godaddy");
    expect(detectBuilder('<script src="https://cdn2.editmysite.com/js/site.js">')).toBe("weebly");
    expect(detectBuilder("<html><body>plain</body></html>")).toBe("custom");
  });

  it("copyright year takes the max plausible year", () => {
    expect(detectCopyrightYear("© 2016 Acme")).toBe(2016);
    expect(detectCopyrightYear("&copy; 2004–2022 Acme")).toBe(2022);
    expect(detectCopyrightYear("Copyright 1999 and © 2025")).toBe(2025);
    expect(detectCopyrightYear("no year here")).toBeNull();
  });

  it("classifies mock profiles end-to-end", async () => {
    const wp = await checkWebsite(fetcher, "https://www.acme.lf-wp-poor.test");
    expect(wp.websiteClass).toBe("real_site");
    expect(wp.check.builder).toBe("wordpress");
    expect(wp.check.copyrightYear).toBe(2018);

    const wix = await checkWebsite(fetcher, "https://www.acme.lf-wix-noviewport.test");
    expect(wix.check.hasViewportMeta).toBe(false);
    expect(wix.check.builder).toBe("wix");

    const parked = await checkWebsite(fetcher, "https://www.acme.lf-parked.test");
    expect(parked.websiteClass).toBe("parked");

    const dead = await checkWebsite(fetcher, "https://www.acme.lf-dead.test");
    expect(dead.websiteClass).toBe("dead");

    const fb = await checkWebsite(fetcher, "https://www.acme.lf-fbredir.test");
    expect(fb.websiteClass).toBe("social_only");
    expect(fb.check.redirectedToSocial).toBe(true);

    const good = await checkWebsite(fetcher, "https://www.acme.lf-custom-good.test");
    expect(good.websiteClass).toBe("real_site");
    expect(good.check.builder).toBe("custom");
    expect(good.check.hasContactForm).toBe(true);
    expect(good.check.copyrightYear).toBe(2026);
  });
});
