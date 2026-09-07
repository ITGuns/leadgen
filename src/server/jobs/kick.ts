import { after } from "next/server";
import { isServerless } from "../config";
import { getWorker } from "./worker";

/**
 * D19 — snappy serverless job starts: routes that enqueue work call this so the SAME
 * invocation burns a short slice after the response is sent (`after()`), instead of the
 * job waiting up to a minute for the next Vercel Cron tick. Local/Docker keeps the
 * resident interval worker, so this is a no-op there.
 */
export function kickJobsAfterResponse(budgetMs = 25_000): void {
  if (!isServerless()) return;
  after(async () => {
    try {
      const worker = await getWorker();
      await worker.runSlice(budgetMs);
    } catch (err) {
      console.error("[leadforge] after-response job slice failed:", err);
    }
  });
}
