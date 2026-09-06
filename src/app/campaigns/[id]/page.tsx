"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtDate, fmtUSD } from "@/lib/format";

type CampaignResp = {
  campaign: {
    id: number; name: string; niche: string; states: string[]; status: string; currentStage: string | null;
    smoke: boolean; aiOwnerExtraction: boolean; releaseOverture: string | null; releaseFsq: string | null;
    estimate: { plannedRecords: number; totalUSD: number; citiesFannedOut?: number } | null;
    stageCounts: Record<string, number> | null; stageErrors: Record<string, number> | null;
    confirmedTaxonomy: string[]; createdBy: string; createdAt: string; completedAt: string | null;
    caps: { maxRecords: number; budgetCapUSD: number };
    topUp: { enabled: boolean; capUSD: number } | null;
  };
  leadCount: number;
  spendUSD: number;
  stalledIntents: { id: number; query: unknown }[];
};

const STAGES = ["plan", "pull", "dedupe", "website_check", "pagespeed", "owner_extract", "score", "ready"];
const STAGE_LABEL: Record<string, string> = {
  plan: "Plan", pull: "Pull listings", dedupe: "Dedupe", website_check: "Website check",
  pagespeed: "PageSpeed", owner_extract: "Owner extraction", score: "Score", ready: "Ready",
};
const STAGE_COUNT_KEY: Record<string, string> = {
  plan: "planned", pull: "pulled", dedupe: "deduped", website_check: "website_checked",
  pagespeed: "pagespeed_done", owner_extract: "owners_found", score: "scored", ready: "ready",
};

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<CampaignResp | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setData(await api<CampaignResp>(`/api/campaigns/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [refresh]);

  async function action(a: string) {
    setError("");
    try {
      await api(`/api/campaigns/${id}/actions`, { method: "POST", body: JSON.stringify({ action: a }) });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!data) return <div className="text-zinc-500">Loading…</div>;
  const c = data.campaign;
  const counts = c.stageCounts ?? {};
  const errors = c.stageErrors ?? {};
  const stageIdx = c.currentStage ? STAGES.indexOf(c.currentStage) : -1;

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{c.name} {c.smoke && <span className="chip ml-2 align-middle">smoke · 200 max</span>}</h1>
          <div className="mt-1 text-xs text-zinc-500">
            {c.niche} · {c.states.join(", ")} · categories: {c.confirmedTaxonomy.join(", ")} · by {c.createdBy} {fmtDate(c.createdAt)}
          </div>
          <div className="mt-1 text-xs text-zinc-600">
            Data releases: Overture {c.releaseOverture ?? "—"} · FSQ {c.releaseFsq ?? "—"} (recorded for reproducibility)
          </div>
        </div>
        <div className="flex gap-2">
          {["draft", "failed", "canceled"].includes(c.status) && <button className="btn btn-primary" onClick={() => action("run")}>Run</button>}
          {c.status === "running" && <button className="btn" onClick={() => action("pause")}>Pause</button>}
          {c.status === "paused" && <button className="btn btn-primary" onClick={() => action("resume")}>Resume</button>}
          {["completed", "failed"].includes(c.status) && Object.values(errors).some((n) => n > 0) && (
            <button className="btn" onClick={() => action("retry_errors")}>Retry {Object.values(errors).reduce((a, b) => a + b, 0)} errors</button>
          )}
          {["running", "paused", "draft"].includes(c.status) && <button className="btn btn-danger" onClick={() => action("cancel")}>Cancel</button>}
        </div>
      </div>

      {error && <div className="rounded-md border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card"><div className="text-xs text-zinc-500">Status</div><div className="mt-0.5 text-lg font-bold capitalize">{c.status}</div></div>
        <div className="card"><div className="text-xs text-zinc-500">Leads</div><div className="mt-0.5 text-lg font-bold">{data.leadCount.toLocaleString()}</div></div>
        <div className="card"><div className="text-xs text-zinc-500">Cost accrued</div><div className="mt-0.5 text-lg font-bold">{fmtUSD(data.spendUSD)}</div><div className="text-[11px] text-zinc-500">cap {fmtUSD(c.caps.budgetCapUSD)}</div></div>
        <div className="card"><div className="text-xs text-zinc-500">Estimate</div><div className="mt-0.5 text-lg font-bold">{fmtUSD(c.estimate?.totalUSD)}</div><div className="text-[11px] text-zinc-500">{c.estimate?.plannedRecords?.toLocaleString?.() ?? "?"} records{c.estimate?.citiesFannedOut != null ? ` · ${c.estimate.citiesFannedOut} cities queried` : ""}</div></div>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">Pipeline</h2>
        <ol className="space-y-1.5">
          {STAGES.map((s, i) => {
            const done = c.status === "completed" || (stageIdx >= 0 && i < stageIdx);
            const active = c.status === "running" && s === c.currentStage;
            const count = counts[STAGE_COUNT_KEY[s]];
            const errs = errors[s];
            return (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${done ? "bg-emerald-500" : active ? "animate-pulse bg-sky-400" : "bg-zinc-700"}`} />
                <span className={`w-36 ${done || active ? "text-zinc-200" : "text-zinc-500"}`}>{STAGE_LABEL[s]}</span>
                <span className="text-zinc-400">{count != null ? count.toLocaleString() : ""}</span>
                {s === "pull" && counts.suppressed_clients ? <span className="chip">− {counts.suppressed_clients} client-suppressed</span> : null}
                {s === "pull" && counts.cities_queried ? <span className="chip">{counts.cities_queried}/{counts.cities_planned} cities queried</span> : null}
                {s === "pull" && counts.topup_budget_stopped ? <span className="chip border-yellow-800 text-yellow-300">top-up stopped at budget cap</span> : null}
                {s === "pagespeed" && counts.pagespeed_quota_exhausted ? <span className="chip border-yellow-800 text-yellow-300">daily quota exhausted</span> : null}
                {s === "score" && counts.filtered_post_classification ? <span className="chip">− {counts.filtered_post_classification} filtered post-classification</span> : null}
                {s === "owner_extract" && counts.ai_budget_stopped ? <span className="chip border-yellow-800 text-yellow-300">AI stopped at budget cap</span> : null}
                {errs ? <span className="chip border-red-800 text-red-300">{errs} errors</span> : null}
              </li>
            );
          })}
        </ol>
      </div>

      {data.stalledIntents.length > 0 && (
        <div className="card border-yellow-800">
          <h2 className="text-sm font-semibold text-yellow-300">Stalled provider jobs (billed even if unfetched — never auto-resubmitted)</h2>
          <p className="mt-1 text-xs text-zinc-400">Check the Outscraper dashboard before any manual resubmit (§4.4). {data.stalledIntents.length} job(s) stalled.</p>
        </div>
      )}

      <div className="flex gap-2">
        <Link className="btn" href={`/leads?campaignId=${c.id}`}>Open leads →</Link>
        {c.status === "completed" && <Link className="btn" href={`/exports?campaignId=${c.id}`}>Export…</Link>}
      </div>
    </div>
  );
}
