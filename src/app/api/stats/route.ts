import { withAuth } from "@/server/auth";
import { monthSpendUSD, monthlyCeilingUSD } from "@/server/budget";
import { dashboardStats } from "@/server/leads";
import { activeRelease } from "@/server/ingest/releases";
import { pagespeedQuotaRemaining } from "@/server/providers/pagespeed";
import { getSetting } from "@/server/settings";

export const GET = withAuth(async () => {
  return Response.json({
    ...dashboardStats(),
    monthSpendUSD: monthSpendUSD(),
    monthlyCeilingUSD: monthlyCeilingUSD(),
    releases: {
      overture: activeRelease("overture") ?? null,
      fsq: activeRelease("fsq") ?? null,
    },
    pagespeedQuotaRemaining: pagespeedQuotaRemaining(),
    lastBackup: getSetting<string | null>("lastBackupAt", null),
  });
});
