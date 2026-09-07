import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { getDb } from "@/db/client";
import { jobs, releases } from "@/db/schema";
import { registerAllHandlers } from "@/server/jobs/handlers";
import { Worker, enqueueJob } from "@/server/jobs/worker";
import { fsqConfigured } from "@/server/ingest/fsq";

/** FSQ is optional gap-fill: unconfigured real mode must SKIP and still chain
 * conflation — a missing free HF token can never break the monthly ingest (B6). */

describe("FSQ graceful skip when unconfigured", () => {
  beforeAll(() => {
    freshDb();
    registerAllHandlers();
    process.env.MOCK_MODE = "0";
    delete process.env.FSQ_BASE_URL;
    delete process.env.FSQ_RELEASE;
    delete process.env.HF_TOKEN;
  });
  afterAll(() => {
    process.env.MOCK_MODE = "1";
  });

  it("reports unconfigured without base url or release+token", () => {
    expect(fsqConfigured()).toBe(false);
    process.env.FSQ_RELEASE = "2026-08-11"; // release alone is not enough — the HF dataset is gated
    expect(fsqConfigured()).toBe(false);
    process.env.FSQ_BASE_URL = "s3://some-mirror/fsq";
    expect(fsqConfigured()).toBe(true);
    delete process.env.FSQ_BASE_URL;
    delete process.env.FSQ_RELEASE;
  });

  it("skips the extract, records why, creates no release, and still chains conflate", async () => {
    const job = enqueueJob("ingest_fsq", { chain: true }, { maxAttempts: 1 });
    const w = new Worker(1, 10);
    await w.drain(60_000);
    const done = getDb().select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(done.status).toBe("completed");
    expect((done.progress as { skipped?: boolean }).skipped).toBe(true);
    expect(String((done.progress as { reason?: string }).reason)).toContain("B6");
    const fsqRelease = getDb().select().from(releases).where(eq(releases.source, "fsq")).get();
    expect(fsqRelease).toBeUndefined();
    const conflate = getDb()
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, "conflate")))
      .get();
    expect(conflate).toBeTruthy(); // chained despite the skip (it fails later only because this test seeded no overture data)
  });
});
