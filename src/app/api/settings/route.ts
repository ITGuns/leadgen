import fs from "node:fs";
import path from "node:path";
import { withAuth } from "@/server/auth";
import { audit } from "@/server/audit";
import { defaults, env } from "@/server/config";
import { getSetting, setSetting } from "@/server/settings";
import { effectiveSecret, secureSet } from "@/server/secure-store";
import { anthropicKey } from "@/server/providers/ai";
import { pagespeedKey, pagespeedQuotaRemaining } from "@/server/providers/pagespeed";
import { outscraperKey } from "@/server/providers/listings/outscraper";
import { driveConfigured, driveFolderId, googleClientId, googleClientSecret } from "@/server/providers/drive/oauth";
import { monthSpendUSD, monthlyCeilingUSD } from "@/server/budget";

/** §3.7 — settings & ops. Secrets: presence only, never values (D8). */

export const GET = withAuth(async () => {
  const compliance = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "compliance.json"), "utf8"));
  const attribution = fs.readFileSync(path.join(process.cwd(), "data", "ATTRIBUTION.md"), "utf8");
  return Response.json({
    mockMode: env.mockMode,
    keys: {
      pagespeed: !!(await pagespeedKey()),
      anthropic: !!(await anthropicKey()),
      outscraper: !!(await outscraperKey()),
      googleClientId: !!(await googleClientId()),
      googleClientSecret: !!(await googleClientSecret()),
      hf: !!(await effectiveSecret("hf_token", env.hfToken())),
      alertWebhook: !!(await effectiveSecret("alert_webhook_url", "")),
    },
    drive: { connected: await driveConfigured(), folderId: await driveFolderId() },
    ops: {
      monthlySpendCeilingUSD: await monthlyCeilingUSD(),
      monthSpendUSD: await monthSpendUSD(),
      pagespeedDailyQuota: await getSetting("pagespeedDailyQuota", defaults.pagespeedDailyQuota),
      pagespeedQuotaRemaining: await pagespeedQuotaRemaining(),
      cityPopulationFloor: await getSetting("cityPopulationFloor", defaults.cityPopulationFloor),
      jobConcurrency: await getSetting("jobConcurrency", defaults.jobConcurrency),
      fetchGlobal: await getSetting("fetchGlobal", defaults.fetchGlobal),
      fetchPerDomain: await getSetting("fetchPerDomain", defaults.fetchPerDomain),
      lastBackupAt: await getSetting<string | null>("lastBackupAt", null),
      lastBackupFile: await getSetting<string | null>("lastBackupFile", null),
    },
    env: {
      overtureRelease: env.overtureRelease() || "(unset — mock uses bundled fixture)",
      fsqRelease: env.fsqRelease() || "(unset)",
      appUrl: env.appUrl(),
      cfAccessConfigured: !!(env.cfAccessTeamDomain() && env.cfAccessAud()),
    },
    compliance,
    attribution,
  });
});

export const POST = withAuth(async (req, identity) => {
  const body = (await req.json()) as {
    monthlySpendCeilingUSD?: number;
    pagespeedDailyQuota?: number;
    cityPopulationFloor?: number;
    jobConcurrency?: number;
    fetchGlobal?: number;
    fetchPerDomain?: number;
    driveFolderId?: string;
    keys?: Partial<Record<"pagespeed" | "anthropic" | "outscraper" | "googleClientId" | "googleClientSecret" | "hf" | "alertWebhook", string>>;
  };
  const changed: string[] = [];
  if (typeof body.monthlySpendCeilingUSD === "number" && body.monthlySpendCeilingUSD >= 0) {
    await setSetting("monthlySpendCeilingUSD", body.monthlySpendCeilingUSD);
    changed.push("monthlySpendCeilingUSD");
  }
  if (typeof body.pagespeedDailyQuota === "number" && body.pagespeedDailyQuota > 0) {
    await setSetting("pagespeedDailyQuota", Math.min(body.pagespeedDailyQuota, 25_000));
    changed.push("pagespeedDailyQuota");
  }
  if (typeof body.cityPopulationFloor === "number" && body.cityPopulationFloor >= 0) {
    await setSetting("cityPopulationFloor", body.cityPopulationFloor);
    changed.push("cityPopulationFloor");
  }
  // §3.7 concurrency limits — singletons read these at boot, so a restart applies them
  if (typeof body.jobConcurrency === "number" && body.jobConcurrency >= 1 && body.jobConcurrency <= 8) {
    await setSetting("jobConcurrency", Math.round(body.jobConcurrency));
    changed.push("jobConcurrency");
  }
  if (typeof body.fetchGlobal === "number" && body.fetchGlobal >= 1 && body.fetchGlobal <= 32) {
    await setSetting("fetchGlobal", Math.round(body.fetchGlobal));
    changed.push("fetchGlobal");
  }
  if (typeof body.fetchPerDomain === "number" && body.fetchPerDomain >= 1 && body.fetchPerDomain <= 4) {
    await setSetting("fetchPerDomain", Math.round(body.fetchPerDomain));
    changed.push("fetchPerDomain");
  }
  if (typeof body.driveFolderId === "string") {
    await secureSet("google_drive_folder_id", body.driveFolderId.trim());
    changed.push("driveFolderId");
  }
  const keyStoreNames: Record<string, string> = {
    pagespeed: "pagespeed_api_key",
    anthropic: "anthropic_api_key",
    outscraper: "outscraper_api_key",
    googleClientId: "google_client_id",
    googleClientSecret: "google_client_secret",
    hf: "hf_token",
    alertWebhook: "alert_webhook_url",
  };
  for (const [k, storeName] of Object.entries(keyStoreNames)) {
    const v = body.keys?.[k as keyof typeof body.keys];
    if (typeof v === "string" && v.trim()) {
      await secureSet(storeName, v.trim());
      changed.push(`key:${k}`);
    }
  }
  await audit(identity.email, "settings.update", { changed }); // names only, never values
  return Response.json({ ok: true, changed });
});
