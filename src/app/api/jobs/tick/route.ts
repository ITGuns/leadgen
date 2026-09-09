import { env, isServerless } from "@/server/config";
import { cronTick } from "@/server/jobs/cron";
import { getWorker } from "@/server/jobs/worker";

/**
 * D19 — the serverless heartbeat. Vercel Cron hits this every minute with
 * `Authorization: Bearer $CRON_SECRET`; it schedules recurring jobs (nightly backup
 * check, weekly freshness) and then burns one time-boxed worker slice. Handlers are
 * checkpoint-resumable, so long jobs continue across ticks. Locally the resident
 * worker makes this route unnecessary (but it still works, for parity testing).
 */

export const maxDuration = 300; // needs Vercel Pro for the full 300s; Hobby clamps to 60s

function authorized(req: Request): boolean {
  const secret = env.cronSecret();
  // no secret: allow only LOCAL mock runs — a deployed instance without CRON_SECRET
  // must never expose a public job-runner endpoint, mock mode or not
  if (!secret) return env.mockMode && !isServerless();
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  await cronTick();
  const worker = await getWorker();
  const result = await worker.runSlice(env.jobSliceMs());
  return Response.json({ ok: true, ...result });
}

export const POST = GET;
