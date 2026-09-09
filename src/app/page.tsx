import Link from "next/link";
import { dashboardStats } from "@/server/leads";
import { listCampaigns } from "@/server/campaigns";
import { monthSpendUSD, monthlyCeilingUSD } from "@/server/budget";
import { activeRelease } from "@/server/ingest/releases";
import { getSetting } from "@/server/settings";
import { fmtDate, fmtUSD, STATUS_LABEL } from "@/lib/format";
import { PageHeader, EmptyState, StatusChip } from "@/components/ui";

export const dynamic = "force-dynamic";

const DatabaseIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
    <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </svg>
);

export default async function Dashboard() {
  // TODO: pass a limit to listCampaigns() once it grows a limit arg.
  const [stats, allCampaigns, overture, fsq, spend, ceiling, lastBackup] = await Promise.all([
    dashboardStats(),
    listCampaigns(),
    activeRelease("overture"),
    activeRelease("fsq"),
    monthSpendUSD(),
    monthlyCeilingUSD(),
    getSetting<string | null>("lastBackupAt", null),
  ]);
  const campaigns = allCampaigns.slice(0, 6);
  const byStatus = Object.fromEntries(stats.byStatus.map((s) => [s.status, s.n]));
  const worked = Math.max(0, stats.leadCount - (byStatus["new"] ?? 0));
  const pipelineFoot = Object.entries(STATUS_LABEL)
    .map(([k, label]) => `${label} ${(byStatus[k] ?? 0).toLocaleString()}`)
    .join(" · ");
  const spendPct = ceiling > 0 ? Math.min(100, (spend / ceiling) * 100) : 0;
  const spendBarCls = spendPct >= 90 ? "bg-red-500" : spendPct >= 75 ? "bg-amber-500" : "bg-emerald-500";

  if (stats.businessCount === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" sub="Local dataset, campaigns, and spend at a glance" />
        <div className="card flex min-h-[420px] items-center justify-center">
          <EmptyState
            icon={DatabaseIcon}
            title="No business data loaded yet"
            hint="This deployment's database is empty. Load businesses by running the workstation extract against the local dataset — see HANDOFF.md · Deploy for the runbook. Once data lands, create your first campaign."
            action={
              <Link href="/campaigns/new" className="btn btn-primary">
                New campaign
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        sub="Local dataset, campaigns, and spend at a glance"
        actions={
          <Link href="/campaigns/new" className="btn btn-primary">
            New campaign
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat">
          <div className="stat-label">Businesses</div>
          <div className="stat-value">{stats.businessCount.toLocaleString()}</div>
          <div className="stat-foot">
            Overture {overture?.releaseId ?? "not ingested"} · FSQ {fsq?.releaseId ?? "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Leads</div>
          <div className="stat-value">{stats.leadCount.toLocaleString()}</div>
          <div className="stat-foot">
            {stats.hotLeads.toLocaleString()} hot (score ≥ 80) · {stats.ownersFound.toLocaleString()} owners found
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Pipeline</div>
          <div className="stat-value">{worked.toLocaleString()}</div>
          <div className="stat-foot">{stats.leadCount === 0 ? "No leads yet — pipeline fills as campaigns run" : pipelineFoot}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Spend this month</div>
          <div className="stat-value">{fmtUSD(spend)}</div>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised"
            role="progressbar"
            aria-label="Monthly spend against ceiling"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(spendPct)}
          >
            <div className={`h-full rounded-full ${spendBarCls}`} style={{ width: `${spendPct}%` }} />
          </div>
          <div className="stat-foot">
            {fmtUSD(ceiling)} ceiling · last backup {lastBackup ? fmtDate(lastBackup) : "never"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="section-label">Recent campaigns</h2>
            <Link href="/campaigns" className="text-xs font-medium text-emerald-400 hover:underline">
              View all →
            </Link>
          </div>
          {campaigns.length === 0 ? (
            <div className="card card-tight">
              <EmptyState
                title="No campaigns yet"
                hint="Create one to pull leads from the local dataset — a state-level run completes in seconds at $0."
                action={
                  <Link href="/campaigns/new" className="btn btn-sm">
                    Create a campaign
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="th">Campaign</th>
                    <th className="th">Niche</th>
                    <th className="th">States</th>
                    <th className="th">Status</th>
                    <th className="th text-right">Leads</th>
                    <th className="th text-right">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="row-hover">
                      <td className="td whitespace-nowrap">
                        <Link href={`/campaigns/${c.id}`} className="font-medium text-zinc-100 hover:text-emerald-400">
                          {c.name}
                        </Link>
                        {c.smoke ? <span className="chip chip-muted ml-2">smoke</span> : null}
                      </td>
                      <td className="td whitespace-nowrap">{c.niche}</td>
                      <td className="td whitespace-nowrap text-zinc-400" title={c.states.join(", ")}>
                        {c.states.length > 3 ? `${c.states.slice(0, 3).join(", ")} +${c.states.length - 3}` : c.states.join(", ")}
                      </td>
                      <td className="td">
                        <StatusChip status={c.status} />
                      </td>
                      <td className="td text-right tabular-nums">
                        {(c.stageCounts?.ready ?? c.stageCounts?.pulled ?? 0).toLocaleString()}
                      </td>
                      <td className="td text-right tabular-nums">{fmtUSD(c.spendUSD)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="section-label">Recent activity</h2>
          <div className="card">
            {stats.recentAudit.length === 0 ? (
              <p className="text-xs text-zinc-600">Nothing yet — actions land here as campaigns run.</p>
            ) : (
              <ol className="space-y-0">
                {stats.recentAudit.map((a, i) => (
                  <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
                    <div className="flex flex-col items-center" aria-hidden>
                      <span className="dot mt-1.5 bg-emerald-500/80" />
                      {i < stats.recentAudit.length - 1 ? <span className="mt-1.5 w-px flex-1 bg-line" /> : null}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm text-zinc-200">{a.action}</div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {a.actor} · {fmtDate(a.createdAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
