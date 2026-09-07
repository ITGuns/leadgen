import Link from "next/link";
import { listCampaigns } from "@/server/campaigns";
import { fmtDate, fmtUSD } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  running: "text-sky-300",
  completed: "text-emerald-300",
  paused: "text-yellow-300",
  failed: "text-red-300",
  canceled: "text-zinc-500",
  draft: "text-zinc-400",
};

export default async function CampaignsPage() {
  const campaigns = await listCampaigns();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Campaigns</h1>
        <Link href="/campaigns/new" className="btn btn-primary">New campaign</Link>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead><tr className="border-b border-zinc-800">
            <th className="th">Name</th><th className="th">Niche</th><th className="th">States</th><th className="th">Status</th>
            <th className="th">Stage</th><th className="th">Leads</th><th className="th">Est.</th><th className="th">Spend</th><th className="th">Created</th>
          </tr></thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                <td className="td"><Link className="text-emerald-400 hover:underline" href={`/campaigns/${c.id}`}>{c.name}</Link>{c.smoke ? <span className="chip ml-2">smoke</span> : null}</td>
                <td className="td">{c.niche}</td>
                <td className="td text-zinc-400">{c.states.length > 4 ? `${c.states.length} states` : c.states.join(", ")}</td>
                <td className={`td font-medium ${STATUS_STYLE[c.status] ?? ""}`}>{c.status}</td>
                <td className="td text-zinc-400">{c.currentStage ?? "—"}</td>
                <td className="td">{c.stageCounts?.ready ?? c.stageCounts?.pulled ?? 0}</td>
                <td className="td text-zinc-400">{fmtUSD(c.estimate?.totalUSD)}</td>
                <td className="td">{fmtUSD(c.spendUSD)}</td>
                <td className="td text-zinc-500">{fmtDate(c.createdAt)}</td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr><td colSpan={9} className="td py-8 text-center text-zinc-500">No campaigns yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
