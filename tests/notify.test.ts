import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshDb } from "./helpers";
import { registerAllHandlers } from "@/server/jobs/handlers";
import { registerHandler } from "@/server/jobs/registry";
import { Worker, enqueueJob } from "@/server/jobs/worker";
import { secureDelete, secureSet } from "@/server/secure-store";

/** Ops alerting: a job that exhausts retries fires one Slack-compatible webhook POST.
 * No URL configured = silence; webhook failures never break the worker. */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lf-notify-"));
process.env.CONFIG_DIR = tmp;

const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));

describe("failure notification webhook", () => {
  beforeAll(() => {
    freshDb();
    registerAllHandlers();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    secureDelete("alert_webhook_url");
  });

  it("posts the failure with job type, id, and error", async () => {
    secureSet("alert_webhook_url", "https://hooks.example.com/services/T000/B000/x");
    registerHandler("t_alert_fail", async () => {
      throw new Error("ingest exploded");
    });
    const job = enqueueJob("t_alert_fail", {}, { maxAttempts: 1, campaignId: 7 });
    await new Worker(1, 10).drain(30_000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/services/T000/B000/x");
    const payload = JSON.parse(String(init.body)) as { text: string };
    expect(payload.text).toContain("t_alert_fail");
    expect(payload.text).toContain(`#${job.id}`);
    expect(payload.text).toContain("ingest exploded");
    expect(payload.text).toContain("campaign #7");
  });

  it("stays silent with no webhook configured, and a retried-then-recovered job never alerts", async () => {
    secureDelete("alert_webhook_url");
    fetchMock.mockClear();
    registerHandler("t_alert_silent", async () => {
      throw new Error("quiet failure");
    });
    let attempts = 0;
    registerHandler("t_alert_recovers", async () => {
      attempts++;
      if (attempts === 1) throw new Error("transient");
    });
    enqueueJob("t_alert_silent", {}, { maxAttempts: 1 });
    enqueueJob("t_alert_recovers", {}, { maxAttempts: 3 });
    const w = new Worker(1, 10);
    await w.drain(30_000);
    secureSet("alert_webhook_url", "https://hooks.example.com/x"); // configured AFTER the failures settled
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a webhook that itself fails never breaks the worker", async () => {
    secureSet("alert_webhook_url", "https://hooks.example.com/broken");
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    registerHandler("t_alert_broken_hook", async () => {
      throw new Error("boom");
    });
    const job = enqueueJob("t_alert_broken_hook", {}, { maxAttempts: 1 });
    const w = new Worker(1, 10);
    await expect(w.drain(30_000)).resolves.toBeUndefined();
    expect(job.id).toBeGreaterThan(0);
  });
});
