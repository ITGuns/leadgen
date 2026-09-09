import { withAuth } from "@/server/auth";
import { monthSpendUSD, monthlyCeilingUSD } from "@/server/budget";
import { dashboardStats } from "@/server/leads";
import { activeRelease } from "@/server/ingest/releases";
import { pagespeedQuotaRemaining } from "@/server/providers/pagespeed";
import { getSetting } from "@/server/settings";

export const GET = withAuth(async () => {
  // independent reads in one round trip of wall time (remote DB latency)
  const [stats, spend, ceiling, overture, fsq, quota, lastBackup] = await Promise.all([
    dashboardStats(),
    monthSpendUSD(),
    monthlyCeilingUSD(),
    activeRelease("overture"),
    activeRelease("fsq"),
    pagespeedQuotaRemaining(),
    getSetting<string | null>("lastBackupAt", null),
  ]);
  return Response.json({
    ...stats,
    monthSpendUSD: spend,
    monthlyCeilingUSD: ceiling,
    releases: { overture: overture ?? null, fsq: fsq ?? null },
    pagespeedQuotaRemaining: quota,
    lastBackup,
  });
});
