import PQueue from "p-queue";
import { and, asc, desc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobs } from "@/db/schema";
import { defaults, now } from "../config";
import { getSetting } from "../settings";
import { getHandler, JobStopped, type JobRow } from "./registry";

/**
 * ARCHITECTURE A4 (revised D19) — the persisted jobs table is the queue in BOTH runtimes:
 *  · persistent (local dev / Docker): interval loop + p-queue, exactly as before
 *  · serverless (Vercel): `runSlice(budgetMs)` — a cron-invoked, time-boxed pass that
 *    claims due jobs and runs them with a deadline; handlers are checkpoint-resumable,
 *    so an unfinished job simply goes back to pending (WITHOUT burning an attempt) and
 *    the next slice continues it. Claims are atomic conditional UPDATE … RETURNING.
 */

export async function enqueueJob(
  type: string,
  payload?: Record<string, unknown>,
  opts?: { campaignId?: number; priority?: number; runAfter?: Date; maxAttempts?: number; dedupe?: boolean },
): Promise<JobRow> {
  const db = getDb();
  if (opts?.dedupe) {
    const [existing] = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, type),
          sql`${jobs.payload} = ${JSON.stringify(payload ?? null)}::jsonb`,
          or(eq(jobs.status, "pending"), eq(jobs.status, "running")),
        ),
      )
      .limit(1);
    if (existing) return existing;
  }
  const [row] = await db
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
    .returning();
  return row;
}

export async function cancelJob(id: number): Promise<void> {
  await getDb()
    .update(jobs)
    .set({ status: "canceled", finishedAt: now().toISOString() })
    .where(and(eq(jobs.id, id), or(eq(jobs.status, "pending"), eq(jobs.status, "running"))));
}

/** A running job whose heartbeat went silent this long is considered orphaned. */
const STALE_HEARTBEAT_MS = 10 * 60_000;

export class Worker {
  private queue: PQueue;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;
  private canceledCache = new Map<number, boolean>();

  constructor(private concurrency = defaults.jobConcurrency, private tickMs = defaults.workerTickMs) {
    this.queue = new PQueue({ concurrency });
  }

  /** Crash recovery: `running` jobs from a dead process resume as pending.
   * Persistent mode recovers everything at boot; serverless slices recover only
   * stale-heartbeat orphans (another slice may legitimately be mid-job). */
  async recover(onlyStale = false): Promise<number> {
    const staleBefore = new Date(Date.now() - STALE_HEARTBEAT_MS).toISOString();
    const rows = await getDb()
      .update(jobs)
      .set({ status: "pending", heartbeatAt: null })
      .where(
        onlyStale
          ? and(eq(jobs.status, "running"), or(isNull(jobs.heartbeatAt), lt(jobs.heartbeatAt, staleBefore)))
          : eq(jobs.status, "running"),
      )
      .returning({ id: jobs.id });
    return rows.length;
  }

  start(): void {
    if (this.timer) return;
    void this.recover();
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

  /** Claim up to available capacity and dispatch (persistent mode).
   *  Scheduling comparisons use REAL wall-clock time — the frozen mock clock is for
   *  data timestamps only. */
  async tick(): Promise<void> {
    if (this.stopping) return;
    const capacity = this.concurrency - this.queue.size - this.queue.pending;
    if (capacity <= 0) return;
    const claimable = await this.claimables(capacity);
    for (const job of claimable) {
      const claimed = await this.claim(job);
      if (!claimed) continue;
      void this.queue.add(() => this.run(job.id, Infinity));
    }
  }

  private async claimables(limit: number): Promise<JobRow[]> {
    const nowIso = new Date().toISOString();
    return getDb()
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "pending"),
          or(isNull(jobs.runAfter), lte(jobs.runAfter, nowIso)),
          // a job hard-killed by the platform never reaches the failure path — don't
          // let it claim forever once its attempt budget is spent
          sql`${jobs.attempts} < ${jobs.maxAttempts}`,
        ),
      )
      .orderBy(desc(jobs.priority), asc(jobs.createdAt))
      .limit(limit);
  }

  private async claim(job: JobRow): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const rows = await getDb()
      .update(jobs)
      .set({ status: "running", startedAt: nowIso, heartbeatAt: nowIso, attempts: job.attempts + 1 })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "pending")))
      .returning({ id: jobs.id });
    return rows.length > 0;
  }

  /**
   * Serverless slice (D19): recover stale orphans, then run due jobs one at a time
   * until the time budget is spent. Returns counts for the tick route's response.
   */
  async runSlice(budgetMs: number): Promise<{ ran: number; remaining: number }> {
    const sliceEnd = Date.now() + budgetMs;
    await this.recover(true);
    let ran = 0;
    for (;;) {
      const timeLeft = sliceEnd - Date.now();
      if (timeLeft < 5_000) break;
      const [job] = await this.claimables(1);
      if (!job) break;
      if (!(await this.claim(job))) continue;
      await this.run(job.id, sliceEnd - 2_000);
      ran++;
    }
    const remaining = await this.openCount();
    return { ran, remaining };
  }

  private async openCount(): Promise<number> {
    const [row] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(or(eq(jobs.status, "pending"), eq(jobs.status, "running")));
    return row?.n ?? 0;
  }

  /** Wait until nothing is pending or running (test/e2e helper, persistent mode). */
  async drain(timeoutMs = 60_000): Promise<void> {
    const start = Date.now();
    for (;;) {
      await this.tick();
      await this.queue.onIdle();
      if ((await this.openCount()) === 0) return;
      if (Date.now() - start > timeoutMs) throw new Error("worker drain timeout");
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  private async isCanceled(id: number): Promise<boolean> {
    const [row] = await getDb().select({ status: jobs.status }).from(jobs).where(eq(jobs.id, id)).limit(1);
    return row?.status === "canceled";
  }

  private async run(id: number, deadline: number): Promise<void> {
    const db = getDb();
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    if (!job || job.status !== "running") return;
    const handler = getHandler(job.type);
    const heartbeat = setInterval(() => {
      void db.update(jobs).set({ heartbeatAt: now().toISOString() }).where(eq(jobs.id, id));
    }, 5000);
    heartbeat.unref?.();
    let lastCancelCheck = 0;
    let deadlineHit = false;
    const ctx = {
      job,
      deadline,
      checkpoint: async (progress: Record<string, unknown>) => {
        const merged = { ...(job.progress as Record<string, unknown> | null), ...progress };
        job.progress = merged;
        await db.update(jobs).set({ progress: merged, heartbeatAt: now().toISOString() }).where(eq(jobs.id, id));
      },
      shouldStop: () => {
        if (this.stopping) return true;
        if (Date.now() > deadline) {
          deadlineHit = true;
          return true;
        }
        const t = Date.now();
        if (t - lastCancelCheck > 500) {
          lastCancelCheck = t;
          void this.isCanceled(id).then((c) => this.canceledCache.set(id, c));
        }
        return this.canceledCache.get(id) ?? false;
      },
    };
    try {
      if (!handler) throw new Error(`no handler registered for job type '${job.type}'`);
      await handler(ctx);
      await db
        .update(jobs)
        .set({ status: "completed", finishedAt: now().toISOString() })
        .where(and(eq(jobs.id, id), eq(jobs.status, "running")));
    } catch (err) {
      if (err instanceof JobStopped) {
        const canceled = await this.isCanceled(id);
        // deadline/shutdown stops are NOT failures: back to pending without burning
        // the attempt, so a long job can be sliced indefinitely (D19)
        await db
          .update(jobs)
          .set(
            canceled
              ? { status: "canceled", finishedAt: now().toISOString() }
              : { status: "pending", finishedAt: null, attempts: deadlineHit || this.stopping ? sql`greatest(${jobs.attempts} - 1, 0)` : job.attempts },
          )
          .where(and(eq(jobs.id, id), eq(jobs.status, "running")));
        return;
      }
      const message = err instanceof Error ? `${err.message}` : String(err);
      const [fresh] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
      const attempts = fresh?.attempts ?? job.attempts + 1;
      const maxAttempts = fresh?.maxAttempts ?? job.maxAttempts;
      if (attempts < maxAttempts) {
        const backoffMs = Math.min(60_000, 2 ** attempts * 250);
        await db
          .update(jobs)
          .set({ status: "pending", lastError: message, runAfter: new Date(Date.now() + backoffMs).toISOString() })
          .where(and(eq(jobs.id, id), eq(jobs.status, "running")));
      } else {
        await db
          .update(jobs)
          .set({ status: "failed", lastError: message, finishedAt: now().toISOString() })
          .where(and(eq(jobs.id, id), eq(jobs.status, "running")));
        const { notifyFailure } = await import("../notify");
        void notifyFailure(
          `job #${id} (${job.type}) failed after ${attempts} attempt(s)`,
          `${message}${job.campaignId ? ` · campaign #${job.campaignId}` : ""}`,
        );
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}

type G = typeof globalThis & { __leadforgeWorker?: Worker };
const g = globalThis as G;

export async function getWorker(): Promise<Worker> {
  if (!g.__leadforgeWorker) {
    // §3.7 — jobConcurrency is Settings-tunable; the singleton reads it at boot
    g.__leadforgeWorker = new Worker(await getSetting("jobConcurrency", defaults.jobConcurrency));
  }
  return g.__leadforgeWorker;
}
