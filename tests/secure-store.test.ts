import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { secureDelete, secureGet, secureSet } from "@/server/secure-store";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lf-sec-"));
process.env.CONFIG_DIR = tmp;

describe("secure store (D8)", () => {
  afterEach(() => secureDelete("test_key"));

  it("roundtrips JSON values encrypted at rest", () => {
    secureSet("test_key", { token: "abc123", n: 2 });
    expect(secureGet("test_key")).toEqual({ token: "abc123", n: 2 });
    const raw = fs.readFileSync(path.join(tmp, "test_key.enc"), "utf8");
    expect(raw).not.toContain("abc123");
  });

  it("returns null for missing or tampered files", () => {
    expect(secureGet("test_key")).toBeNull();
    secureSet("test_key", "v");
    fs.writeFileSync(path.join(tmp, "test_key.enc"), "AAAA" + fs.readFileSync(path.join(tmp, "test_key.enc"), "utf8"));
    expect(secureGet("test_key")).toBeNull();
  });
});
