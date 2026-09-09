import { after } from "next/server";
import { isServerless } from "../config";
import { getWorker } from "./worker";
import { registerAllHandlers } from "./handlers";

/**
 * D19 — snappy serverless job starts: routes that enqueue work call this so the SAME
 * invocation burns a short slice after the response is sent (`after()`), instead of the
 * job waiting up to a minute for the next Vercel Cron tick. Local/Docker keeps the
 * resident interval worker, so this is a no-op there.
 */
export function kickJobsAfterResponse(totalBudgetMs = 240_000): void {
  if (!isServerless()) return;
  after(async () => {
    try {
      registerAllHandlers(); // this bundle's registry copy may be fresh (globalThis-backed, idempotent)
      const worker = await getWorker();
      // Keep slicing while work remains: on Hobby the crons are daily, so this
      // after() window is what actually drives a queued job to completion. Each
      // slice re-checks the queue; handlers are checkpoint-resumable regardless.
      const end = Date.now() + totalBudgetMs;
      for (;;) {
        const left = end - Date.now();
        if (left < 10_000) break;
        const { remaining } = await worker.runSlice(Math.min(left, 60_000));
        if (remaining === 0) break;
      }
    } catch (err) {
      console.error("[leadforge] after-response job slice failed:", err);
    }
  });
}
