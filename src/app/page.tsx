import Link from "next/link";
import { dashboardStats } from "@/server/leads";
import { listCampaigns } from "@/server/campaigns";
import { monthSpendUSD, monthlyCeilingUSD } from "@/server/budget";
import { activeRelease } from "@/server/ingest/releases";
import { getSetting } from "@/server/settings";
import { fmtDate, fmtUSD, STATUS_LABEL } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const stats = await dashboardStats();
  const campaigns = (await listCampaigns()).slice(0, 6);
  const overture = await activeRelease("overture");
  const fsq = await activeRelease("fsq");
  const spend = await monthSpendUSD();
  const ceiling = await monthlyCeilingUSD();
  const lastBackup = await getSetting<string | null>("lastBackupAt", null);
  const byStatus = Object.fromEntries(stats.byStatus.map((s) => [s.status, s.n]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <Link href="/campaigns/new" className="btn btn-primary">New campaign</Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card"><div className="text-xs text-zinc-500">Businesses in local DB</div>
          <div className="mt-1 text-2xl font-bold">{stats.businessCount.toLocaleString()}</div>
          <div className="mt-1 text-[11px] text-zinc-500">Overture {overture?.releaseId ?? "— run ingest"} · FSQ {fsq?.releaseId ?? "—"}</div></div>
        <div className="card"><div className="text-xs text-zinc-500">Leads</div>
          <div className="mt-1 text-2xl font-bold">{stats.leadCount.toLocaleString()}</div>
          <div className="mt-1 text-[11px] text-zinc-500">{stats.hotLeads.toLocaleString()} hot (score ≥ 80) · {stats.ownersFound.toLocaleString()} owners found</div></div>
        <div className="card"><div className="text-xs text-zinc-500">Pipeline</div>
          <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
            {Object.entries(STATUS_LABEL).map(([k, label]) => (
              <span key={k} className="chip">{label}: {byStatus[k] ?? 0}</span>
            ))}
          </div></div>
        <div className="card"><div className="text-xs text-zinc-500">Spend this month</div>
          <div className="mt-1 text-2xl font-bold">{fmtUSD(spend)}</div>
          <div className="mt-1 text-[11px] text-zinc-500">ceiling {fmtUSD(ceiling)} · last backup {lastBackup ? fmtDate(lastBackup) : "never"}</div></div>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">Recent campaigns</h2>
          <Link href="/campaigns" className="text-xs text-emerald-400 hover:underline">all campaigns →</Link>
        </div>
        {campaigns.length === 0 ? (
          <p className="text-sm text-zinc-500">None yet. Create one to pull leads from the local dataset — a state-level run completes in seconds at $0.</p>
        ) : (
          <table className="w-full">
            <thead><tr className="border-b border-zinc-800">
              <th className="th">Name</th><th className="th">Niche</th><th className="th">States</th><th className="th">Status</th><th className="th">Leads</th><th className="th">Spend</th>
            </tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                  <td className="td"><Link className="text-emerald-400 hover:underline" href={`/campaigns/${c.id}`}>{c.name}</Link>{c.smoke ? <span className="chip ml-2">smoke</span> : null}</td>
                  <td className="td">{c.niche}</td>
                  <td className="td text-zinc-400">{c.states.join(", ")}</td>
                  <td className="td">{c.status}</td>
                  <td className="td">{c.stageCounts?.ready ?? c.stageCounts?.pulled ?? 0}</td>
                  <td className="td">{fmtUSD(c.spendUSD)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="mb-2 text-sm font-semibold text-zinc-300">Recent activity</h2>
        <ul className="space-y-1 text-xs text-zinc-400">
          {stats.recentAudit.map((a) => (
            <li key={a.id}><span className="text-zinc-500">{fmtDate(a.createdAt)}</span> · {a.actor} · {a.action}</li>
          ))}
          {stats.recentAudit.length === 0 && <li className="text-zinc-600">No activity yet.</li>}
        </ul>
      </div>
    </div>
  );
}
