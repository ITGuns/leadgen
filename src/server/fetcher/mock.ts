import type { FetchResult, Fetcher } from "../providers/types";
import { mockHash } from "../providers/types";

/**
 * DECISIONS D14 — deterministic offline fetcher. Behavior derives from the domain's
 * `.lf-{profile}.test` token (see scripts/generate-fixtures.ts); anything else gets a
 * hash-stable default. Serves homepage + /about with owner snippets on a stable subset
 * so website-check, owner extraction, scoring, and e2e all run keyless.
 */

const FIRST = ["Jim", "Maria", "Dale", "Rosa", "Hank", "Tina", "Carlos", "Peggy", "Walt", "June"];
const LAST = ["Baker", "Nguyen", "Ortiz", "Miller", "Hayes", "Kowalski", "Trujillo", "Bennett"];
const ROLES = ["Owner", "Founder", "Proprietor", "Principal", "Owner-Operator"];

export function mockOwnerFor(domain: string): { name: string; role: string } | null {
  const h = mockHash(`owner:${domain}`);
  if (h % 10 >= 6) return null; // 60% of real sites carry an extractable owner
  return { name: `${FIRST[h % FIRST.length]} ${LAST[(h >> 4) % LAST.length]}`, role: ROLES[(h >> 8) % ROLES.length] };
}
export function mockIsMultiLocation(domain: string): boolean {
  return mockHash(`multi:${domain}`) % 10 === 7;
}

export function profileOf(url: string): string {
  const m = url.match(/\.lf-([a-z0-9-]+)\.test/);
  if (m) return m[1];
  const host = url.replace(/^https?:\/\//, "").split(/[/?]/)[0];
  if (host === "bit.ly" || host.endsWith(".bit.ly")) return "shortener";
  return ["custom-good", "sq-decent"][mockHash(`default:${host}`) % 2];
}

function page(domain: string, profile: string, path: string): string {
  const h = mockHash(`${domain}${path}`);
  const year =
    profile === "custom-good" ? 2026 :
    profile === "sq-decent" ? 2024 :
    profile === "custom-old" ? 2015 :
    profile === "wp-poor" ? 2018 :
    profile === "wix-noviewport" ? 2020 :
    profile === "gd-old" ? 2016 : 2019;
  const viewport = profile === "wix-noviewport" || profile === "gd-old" ? "" : `<meta name="viewport" content="width=device-width, initial-scale=1">`;
  const builderMark =
    profile.startsWith("wp") ? `<link rel="stylesheet" href="/wp-content/themes/biz/style.css"><script src="/wp-includes/js/jquery.js"></script>` :
    profile.startsWith("wix") ? `<script src="https://static.parastorage.com/services/wix-thunderbolt/app.js"></script><img src="https://static.wixstatic.com/media/logo.png">` :
    profile.startsWith("sq") ? `<!-- This is Squarespace. --><script src="https://assets.squarespace.com/universal/scripts-compressed/common.js"></script>` :
    profile.startsWith("gd") ? `<img src="https://img1.wsimg.com/isteam/ip/logo.jpg"><meta name="generator" content="GoDaddy Website Builder 8.0">` :
    profile.startsWith("weebly") ? `<script src="https://cdn2.editmysite.com/js/site.js"></script><meta name="generator" content="Weebly">` : "";
  const form = profile === "wp-poor" || profile === "weebly-poor" ? "" : `<form action="/contact"><input name="email" placeholder="Email"><textarea name="message"></textarea><button>Send</button></form>`;
  const tel = h % 3 === 0 ? `<a href="tel:+15125550134">Call us</a>` : "";
  const booking = profile === "custom-good" && h % 2 === 0 ? `<a href="https://calendly.com/biz">Book now</a>` : "";
  const biz = domain.split(".")[0].replace(/-/g, " ");

  let aboutBlock = "";
  if (path === "/about") {
    const owner = mockOwnerFor(domain);
    const multi = mockIsMultiLocation(domain);
    const style = mockHash(`style:${domain}`) % 4;
    if (owner) {
      aboutBlock =
        style === 0 ? `<p>${owner.name}, ${owner.role} of ${biz}, has served the community for ${5 + (h % 20)} years.</p>` :
        style === 1 ? `<p>${owner.role}: ${owner.name}</p><p>We are a family business.</p>` :
        style === 2 ? `<p>${biz} was founded by ${owner.name} in ${1995 + (h % 25)}. As ${owner.role.toLowerCase()}, ${owner.name.split(" ")[0]} still answers the phone.</p>` :
        `<p>Meet ${owner.name} — ${owner.role.toLowerCase()} and lead technician.</p>`;
    } else {
      aboutBlock = `<p>Our experienced team has proudly served the area for over ${5 + (h % 20)} years.</p>`;
    }
    if (multi) aboutBlock += `<p>Now with 12 locations across Texas, Florida, and Georgia.</p>`;
    // deterministic trap content on some pages: reviews with names that must NOT extract
    if (h % 5 === 0) aboutBlock += `<p>"Great service, highly recommend!" — Sandra Pickens, Google review ★★★★★</p>`;
    if (h % 7 === 0) aboutBlock += `<footer>Website designed by Chad Malone Creative</footer>`;
  }

  return `<!doctype html><html><head><title>${biz}</title>${viewport}${builderMark}</head>
<body><h1>${biz}</h1><p>Quality service in your area.</p>${aboutBlock}${form}${tel}${booking}
<footer>&copy; ${year} ${biz}. All rights reserved.</footer></body></html>`;
}

export class MockFetcher implements Fetcher {
  async get(url: string): Promise<FetchResult> {
    const profile = profileOf(url);
    const domain = url.replace(/^https?:\/\//, "").split(/[/?]/)[0].replace(/^www\./, "");
    const path = "/" + (url.replace(/^https?:\/\/[^/]+\/?/, "").split("?")[0] || "");
    const ssl = url.startsWith("https");

    if (profile === "dead") return { ok: false, status: 0, finalUrl: url, ssl, body: "", error: "dns" };
    if (profile === "robots") return { ok: false, status: 0, finalUrl: url, ssl, body: "", error: "robots" };
    if (profile === "parked")
      return { ok: true, status: 200, finalUrl: url, ssl, body: "<html><body>This domain is for sale. sedoparking.com</body></html>" };
    if (profile === "fbredir")
      return { ok: true, status: 200, finalUrl: `https://www.facebook.com/${domain.split(".")[0]}`, ssl: true, body: "<html><body>Facebook page</body></html>" };
    if (profile === "shortener") {
      const h = mockHash(`short:${url}`);
      if (h % 5 < 3) return { ok: true, status: 200, finalUrl: `https://www.facebook.com/short${h % 1000}`, ssl: true, body: "<html><body>Facebook</body></html>" };
      const target = `https://www.resolved${h % 1000}.lf-custom-old.test`;
      return { ok: true, status: 200, finalUrl: target, ssl: true, body: page(`resolved${h % 1000}.lf-custom-old.test`, "custom-old", "/") };
    }
    if (profile === "http500") return { ok: false, status: 503, finalUrl: url, ssl, body: "err" };
    return { ok: true, status: 200, finalUrl: url, ssl, body: page(domain, profile, path === "//" ? "/" : path) };
  }
}
