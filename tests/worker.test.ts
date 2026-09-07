import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers";
import { getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { registerHandler, JobStopped } from "@/server/jobs/registry";
import { Worker, cancelJob, enqueueJob } from "@/server/jobs/worker";

async function jobRow(id: number) {
  const [row] = await getDb().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row!;
}

describe("job worker (ARCH A4)", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("runs a job to completion with checkpoints", async () => {
    const seen: number[] = [];
    registerHandler("t_ok", async (ctx) => {
      const from = ((ctx.job.progress as { i?: number } | null)?.i ?? 0) as number;
      for (let i = from; i < 3; i++) {
        seen.push(i);
        await ctx.checkpoint({ i: i + 1 });
      }
    });
    const job = await enqueueJob("t_ok");
    const w = new Worker(1, 10);
    await w.drain();
    const done = await jobRow(job.id);
    expect(done.status).toBe("completed");
    expect(done.progress).toEqual({ i: 3 });
    expect(seen).toEqual([0, 1, 2]);
  });

  it("resumes from checkpoint after a crash (running → pending on recover)", async () => {
    const seen: number[] = [];
    registerHandler("t_resume", async (ctx) => {
      const from = ((ctx.job.progress as { i?: number } | null)?.i ?? 0) as number;
      for (let i = from; i < 4; i++) {
        seen.push(i);
        await ctx.checkpoint({ i: i + 1 });
        if (i === 1 && from === 0) throw Object.assign(new Error("simulated crash"), { name: "Crash" });
      }
    });
    const job = await enqueueJob("t_resume", {}, { maxAttempts: 3 });
    const w = new Worker(1, 10);
    await w.drain(); // first attempt crashes at i=1, retry resumes at i=2 and completes
    const done = await jobRow(job.id);
    expect(done.status).toBe("completed");
    expect(seen).toEqual([0, 1, 2, 3]); // no re-execution of 0/1 — checkpoint honored
  });

  it("reverts orphaned running jobs to pending on recover()", async () => {
    const job = await enqueueJob("t_orphan");
    await getDb().update(jobs).set({ status: "running" }).where(eq(jobs.id, job.id));
    const w = new Worker(1, 10);
    expect(await w.recover()).toBe(1);
    expect((await jobRow(job.id)).status).toBe("pending");
  });

  it("fails after maxAttempts with lastError", async () => {
    registerHandler("t_fail", async () => {
      throw new Error("boom");
    });
    const job = await enqueueJob("t_fail", {}, { maxAttempts: 2 });
    const w = new Worker(1, 10);
    // drain honors runAfter backoff — force retries due by clearing runAfter between ticks
    const start = Date.now();
    for (;;) {
      await w.tick();
      await new Promise((r) => setTimeout(r, 20));
      await getDb().update(jobs).set({ runAfter: null }).where(eq(jobs.id, job.id));
      const row = await jobRow(job.id);
      if (row.status === "failed") break;
      if (Date.now() - start > 10_000) throw new Error("timeout");
    }
    const done = await jobRow(job.id);
    expect(done.status).toBe("failed");
    expect(done.lastError).toContain("boom");
    expect(done.attempts).toBe(2);
  });

  it("cancel stops a long job cleanly", async () => {
    registerHandler("t_cancel", async (ctx) => {
      for (let i = 0; i < 1000; i++) {
        if (ctx.shouldStop()) throw new JobStopped();
        await new Promise((r) => setTimeout(r, 5));
        if (i === 3) await cancelJob(ctx.job.id);
      }
    });
    const job = await enqueueJob("t_cancel");
    const w = new Worker(1, 10);
    await w.tick();
    const start = Date.now();
    for (;;) {
      const row = await jobRow(job.id);
      if (row.status === "canceled") break;
      if (Date.now() - start > 10_000) throw new Error("timeout waiting for cancel");
      await new Promise((r) => setTimeout(r, 20));
    }
    expect((await jobRow(job.id)).status).toBe("canceled");
  });

  it("dedupe avoids double-enqueue of identical pending work", async () => {
    const a = await enqueueJob("t_d", { x: 1 }, { dedupe: true });
    const b = await enqueueJob("t_d", { x: 1 }, { dedupe: true });
    const c = await enqueueJob("t_d", { x: 2 }, { dedupe: true });
    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
  });
});
