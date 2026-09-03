import PQueue from "p-queue";
import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { defaults, now } from "../config";
import { getHandler, JobStopped, type JobRow } from "./registry";

/**
 * ARCHITECTURE A4 — in-process worker over the persisted jobs table.
 * Single process; SQLite serializes claims. Jobs are resumable checkpoints:
 * on boot, `running` rows revert to `pending` and handlers continue from job.progress.
 */

export function enqueueJob(
  type: string,
  payload?: Record<string, unknown>,
  opts?: { campaignId?: number; priority?: number; runAfter?: Date; maxAttempts?: number; dedupe?: boolean },
): JobRow {
  const db = getDb();
  if (opts?.dedupe) {
    const existing = db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, type),
          sql`${jobs.payload} = ${JSON.stringify(payload ?? null)}`,
          or(eq(jobs.status, "pending"), eq(jobs.status, "running")),
        ),
      )
      .get();
    if (existing) return existing;
  }
  return db
    .insert(jobs)
    .values({
      type,
      payload: payload ?? null,
      campaignId: opts?.campaignId,
      priority: opts?.priority ?? 0,
      maxAttempts: opts?.maxAttempts ?? 3,
      runAfter: opts?.runAfter ? opts.runAfter.toISOString() : null,
      createdAt: now().toISOString(),
    })
    .returning()
    .get();
}

export function cancelJob(id: number): void {
  const db = getDb();
  db.update(jobs)
    .set({ status: "canceled", finishedAt: now().toISOString() })
    .where(and(eq(jobs.id, id), or(eq(jobs.status, "pending"), eq(jobs.status, "running"))))
    .run();
}

export class Worker {
  private queue: PQueue;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private canceledCache = new Map<number, boolean>();

  constructor(private concurrency = defaults.jobConcurrency, private tickMs = defaults.workerTickMs) {
    this.queue = new PQueue({ concurrency });
  }

  /** Crash recovery: anything left `running` from a previous process resumes as pending. */
  recover(): number {
    const res = getDb()
      .update(jobs)
      .set({ status: "pending", heartbeatAt: null })
      .where(eq(jobs.status, "running"))
      .run();
    return res.changes;
  }

  start(): void {
    if (this.timer) return;
    this.recover();
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.queue.onIdle();
    this.stopping = false;
  }

  /** Claim up to available capacity and dispatch. Also callable directly in tests.
   *  Scheduling comparisons use REAL wall-clock time — the frozen mock clock is for
   *  data timestamps only, and would make backoff retries never come due. */
  async tick(): Promise<void> {
    if (this.stopping) return;
    const capacity = this.concurrency - this.queue.size - this.queue.pending;
    if (capacity <= 0) return;
    const db = getDb();
    const nowIso = new Date().toISOString();
    const claimable = db
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), or(isNull(jobs.runAfter), lte(jobs.runAfter, nowIso))))
      .orderBy(desc(jobs.priority), asc(jobs.createdAt))
      .limit(capacity)
      .all();
    for (const job of claimable) {
      const claimed = db
        .update(jobs)
        .set({ status: "running", startedAt: nowIso, heartbeatAt: nowIso, attempts: job.attempts + 1 })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "pending")))
        .run();
      if (claimed.changes === 0) continue;
      void this.queue.add(() => this.run(job.id));
    }
  }

  /** Wait until nothing is pending or running (test/e2e helper). */
  async drain(timeoutMs = 60_000): Promise<void> {
    const start = Date.now();
    for (;;) {
      await this.tick();
      await this.queue.onIdle();
      const open = getDb()
        .select({ n: sql<number>`count(*)` })
        .from(jobs)
        .where(or(eq(jobs.status, "pending"), eq(jobs.status, "running")))
        .get();
      if (!open?.n) return;
      if (Date.now() - start > timeoutMs) throw new Error("worker drain timeout");
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  private isCanceled(id: number): boolean {
    const row = getDb().select({ status: jobs.status }).from(jobs).where(eq(jobs.id, id)).get();
    return row?.status === "canceled";
  }

  private async run(id: number): Promise<void> {
    const db = getDb();
    const job = db.select().from(jobs).where(eq(jobs.id, id)).get();
    if (!job || job.status !== "running") return;
    const handler = getHandler(job.type);
    const heartbeat = setInterval(() => {
      db.update(jobs).set({ heartbeatAt: now().toISOString() }).where(eq(jobs.id, id)).run();
    }, 5000);
    heartbeat.unref?.();
    let lastCancelCheck = 0;
    const ctx = {
      job,
      checkpoint: (progress: Record<string, unknown>) => {
        const merged = { ...(job.progress as Record<string, unknown> | null), ...progress };
        job.progress = merged;
        db.update(jobs).set({ progress: merged, heartbeatAt: now().toISOString() }).where(eq(jobs.id, id)).run();
      },
      shouldStop: () => {
        if (this.stopping) return true;
        const t = Date.now();
        if (t - lastCancelCheck > 500) {
          lastCancelCheck = t;
          this.canceledCache.set(id, this.isCanceled(id));
        }
        return this.canceledCache.get(id) ?? false;
      },
    };
    try {
      if (!handler) throw new Error(`no handler registered for job type '${job.type}'`);
      await handler(ctx);
      db.update(jobs)
        .set({ status: "completed", finishedAt: now().toISOString() })
        .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
        .run();
    } catch (err) {
      if (err instanceof JobStopped) {
        // Canceled or shutdown: worker-stop → back to pending (resume later); cancel → keep canceled.
        db.update(jobs)
          .set({ status: this.isCanceled(id) ? "canceled" : "pending", finishedAt: null })
          .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
          .run();
        return;
      }
      const message = err instanceof Error ? `${err.message}` : String(err);
      const fresh = db.select().from(jobs).where(eq(jobs.id, id)).get();
      const attempts = fresh?.attempts ?? job.attempts + 1;
      const maxAttempts = fresh?.maxAttempts ?? job.maxAttempts;
      if (attempts < maxAttempts) {
        const backoffMs = Math.min(60_000, 2 ** attempts * 250);
        db.update(jobs)
          .set({ status: "pending", lastError: message, runAfter: new Date(Date.now() + backoffMs).toISOString() })
          .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
          .run();
      } else {
        db.update(jobs)
          .set({ status: "failed", lastError: message, finishedAt: now().toISOString() })
          .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
          .run();
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}

type G = typeof globalThis & { __leadforgeWorker?: Worker };
const g = globalThis as G;

export function getWorker(): Worker {
  if (!g.__leadforgeWorker) g.__leadforgeWorker = new Worker();
  return g.__leadforgeWorker;
}
