import Link from "next/link";
import { listCampaigns } from "@/server/campaigns";
import { fmtDate, fmtUSD } from "@/lib/format";
import { EmptyState, PageHeader, StatusChip } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = await listCampaigns();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        sub="Plan, run, and monitor lead-generation pipelines."
        actions={
          <Link href="/campaigns/new" className="btn btn-primary">
            New campaign
          </Link>
        }
      />

      {campaigns.length === 0 ? (
        <div className="card card-tight">
          <EmptyState
            title="No campaigns yet"
            hint="A campaign pulls listings for a niche across your target states, checks websites, extracts owners, and scores every lead. Start with a smoke run (200 records max) to validate scope cheaply."
            action={
              <Link href="/campaigns/new" className="btn btn-primary">
                Create your first campaign
              </Link>
            }
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Niche</th>
                <th className="th">States</th>
                <th className="th">Status</th>
                <th className="th">Stage</th>
                <th className="th text-right!">Leads</th>
                <th className="th text-right!">Est.</th>
                <th className="th text-right!">Spend</th>
                <th className="th">Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="row-hover">
                  <td className="td">
                    <Link
                      className="font-medium text-zinc-100 hover:text-emerald-300 focus-visible:text-emerald-300 focus-visible:outline-none"
                      href={`/campaigns/${c.id}`}
                    >
                      {c.name}
                    </Link>
                    {c.smoke ? <span className="chip chip-muted ml-2">smoke</span> : null}
                  </td>
                  <td className="td">{c.niche}</td>
                  <td className="td text-zinc-400">
                    {c.states.length > 4 ? `${c.states.length} states` : c.states.join(", ")}
                  </td>
                  <td className="td">
                    <StatusChip status={c.status} />
                  </td>
                  <td className="td text-zinc-400">{c.currentStage ?? "—"}</td>
                  <td className="td text-right tabular-nums">
                    {(c.stageCounts?.ready ?? c.stageCounts?.pulled ?? 0).toLocaleString()}
                  </td>
                  <td className="td text-right tabular-nums text-zinc-400">{fmtUSD(c.estimate?.totalUSD)}</td>
                  <td className="td text-right tabular-nums">{fmtUSD(c.spendUSD)}</td>
                  <td className="td whitespace-nowrap text-zinc-500">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
