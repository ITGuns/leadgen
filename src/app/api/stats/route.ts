import { withAuth } from "@/server/auth";
import { monthSpendUSD, monthlyCeilingUSD } from "@/server/budget";
import { dashboardStats } from "@/server/leads";
import { activeRelease } from "@/server/ingest/releases";
import { pagespeedQuotaRemaining } from "@/server/providers/pagespeed";
import { getSetting } from "@/server/settings";

export const GET = withAuth(async () => {
  return Response.json({
    ...(await dashboardStats()),
    monthSpendUSD: await monthSpendUSD(),
    monthlyCeilingUSD: await monthlyCeilingUSD(),
    releases: {
      overture: (await activeRelease("overture")) ?? null,
      fsq: (await activeRelease("fsq")) ?? null,
    },
    pagespeedQuotaRemaining: await pagespeedQuotaRemaining(),
    lastBackup: await getSetting<string | null>("lastBackupAt", null),
  });
});
