"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, fmtDate, fmtUSD } from "@/lib/format";
import { CardSkeleton, EmptyState, ErrorState, PageHeader, Skeleton, StatusChip } from "@/components/ui";

type CampaignResp = {
  campaign: {
    id: number; name: string; niche: string; states: string[]; status: string; currentStage: string | null;
    smoke: boolean; aiOwnerExtraction: boolean; releaseOverture: string | null; releaseFsq: string | null;
    pauseRequested: boolean; cancelRequested: boolean;
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

const POLL_MS = 1500;
const NOT_FOUND_MESSAGES = new Set(["not found", "404", "400"]);

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const validId = /^\d+$/.test(id);
  const [data, setData] = useState<CampaignResp | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pollWarn, setPollWarn] = useState(false);
  const [notFound, setNotFound] = useState(!validId);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const d = await api<CampaignResp>(`/api/campaigns/${id}`);
      setData(d);
      setLoadError("");
      setPollWarn(false);
    } catch (e) {
      const msg = (e as Error).message;
      if (NOT_FOUND_MESSAGES.has(msg)) {
        setNotFound(true);
      } else {
        // Keep the last good data; the render decides between a full error and a slim warning.
        setLoadError(msg);
        setPollWarn(true);
      }
    } finally {
      inFlight.current = false;
    }
  }, [id]);

  useEffect(() => {
    if (validId) refresh();
  }, [validId, refresh]);

  const c0 = data?.campaign;
  const shouldPoll =
    !!c0 && !notFound &&
    (c0.status === "running" || (c0.status === "paused" && (c0.pauseRequested || c0.cancelRequested)));

  useEffect(() => {
    if (!shouldPoll) return;
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (t == null) t = setInterval(refresh, POLL_MS); };
    const stop = () => { if (t != null) { clearInterval(t); t = null; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { refresh(); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [shouldPoll, refresh]);

  async function action(a: string) {
    setActionError("");
    setBusy(true);
    try {
      await api(`/api/campaigns/${id}/actions`, { method: "POST", body: JSON.stringify({ action: a }) });
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div className="max-w-4xl">
        <div className="card card-tight">
          <EmptyState
            title="Campaign not found"
            hint="This campaign doesn't exist — it may have been removed, or the link is wrong."
            action={<Link href="/campaigns" className="btn">Back to campaigns</Link>}
          />
        </div>
      </div>
    );
  }

  if (!data) {
    if (loadError) {
      return (
        <div className="max-w-4xl">
          <ErrorState message={`Couldn't load this campaign: ${loadError}`} onRetry={refresh} />
        </div>
      );
    }
    return (
      <div className="max-w-4xl space-y-6" aria-busy>
        <div className="space-y-2.5">
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="stat space-y-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
        <CardSkeleton lines={8} />
      </div>
    );
  }

  const c = data.campaign;
  const counts = c.stageCounts ?? {};
  const errors = c.stageErrors ?? {};
  const stageIdx = c.currentStage ? STAGES.indexOf(c.currentStage) : -1;
  const totalErrors = Object.values(errors).reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={c.name}
        sub={`${c.niche} · ${c.states.join(", ")} · by ${c.createdBy} · ${fmtDate(c.createdAt)}`}
        actions={
          <>
            {["draft", "failed", "canceled"].includes(c.status) && (
              <button className="btn btn-primary" disabled={busy} onClick={() => action("run")}>Run</button>
            )}
            {c.status === "running" && (
              <button className="btn" disabled={busy || c.pauseRequested} onClick={() => action("pause")}>
                {c.pauseRequested ? "Pausing…" : "Pause"}
              </button>
            )}
            {c.status === "paused" && (
              <button className="btn btn-primary" disabled={busy} onClick={() => action("resume")}>Resume</button>
            )}
            {["completed", "failed"].includes(c.status) && totalErrors > 0 && (
              <button className="btn" disabled={busy} onClick={() => action("retry_errors")}>
                Retry {totalErrors} errors
              </button>
            )}
            {["running", "paused", "draft"].includes(c.status) && (
              <button className="btn btn-danger" disabled={busy || c.cancelRequested} onClick={() => action("cancel")}>
                {c.cancelRequested ? "Canceling…" : "Cancel"}
              </button>
            )}
          </>
        }
      />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={c.status} />
          {c.smoke && <span className="chip chip-warn">smoke · 200 max</span>}
          {c.aiOwnerExtraction && <span className="chip">AI owner extraction</span>}
          <span className="text-xs text-zinc-500">categories: {c.confirmedTaxonomy.join(", ")}</span>
        </div>
        <p className="text-xs text-zinc-600">
          Data releases: Overture {c.releaseOverture ?? "—"} · FSQ {c.releaseFsq ?? "—"} (recorded for reproducibility)
        </p>
      </div>

      {pollWarn && (
        <div className="alert alert-warn" role="status">
          <div className="flex-1 text-xs">Live refresh is failing — showing the last known state.</div>
          <button className="btn btn-sm shrink-0" onClick={refresh}>Retry now</button>
        </div>
      )}
      {actionError && <ErrorState message={actionError} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat">
          <div className="stat-label">Status</div>
          <div className="mt-2.5"><StatusChip status={c.status} /></div>
          {c.status === "running" && c.currentStage ? (
            <div className="stat-foot">stage: {STAGE_LABEL[c.currentStage] ?? c.currentStage}</div>
          ) : c.completedAt ? (
            <div className="stat-foot">finished {fmtDate(c.completedAt)}</div>
          ) : null}
        </div>
        <div className="stat">
          <div className="stat-label">Leads</div>
          <div className="stat-value">{data.leadCount.toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Cost accrued</div>
          <div className="stat-value">{fmtUSD(data.spendUSD)}</div>
          <div className="stat-foot">cap {fmtUSD(c.caps.budgetCapUSD)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Estimate</div>
          <div className="stat-value">{fmtUSD(c.estimate?.totalUSD)}</div>
          <div className="stat-foot">
            {c.estimate?.plannedRecords?.toLocaleString?.() ?? "?"} records
            {c.estimate?.citiesFannedOut != null ? ` · ${c.estimate.citiesFannedOut} cities queried` : ""}
          </div>
        </div>
      </div>

      <div className="card card-tight">
        <div className="card-header">
          <h2 className="card-title">Pipeline</h2>
          {c.status === "running" && (
            <span className="card-sub inline-flex items-center gap-1.5">
              <span className="dot animate-pulse bg-sky-400" /> live
            </span>
          )}
        </div>
        <ol className="space-y-2 px-5 py-4">
          {STAGES.map((s, i) => {
            const done = c.status === "completed" || (stageIdx >= 0 && i < stageIdx);
            const active = c.status === "running" && s === c.currentStage;
            const count = counts[STAGE_COUNT_KEY[s]];
            const errs = errors[s];
            return (
              <li key={s} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${done ? "bg-emerald-500" : active ? "animate-pulse bg-sky-400" : "bg-zinc-700"}`}
                  aria-hidden
                />
                <span className={`w-36 ${done || active ? "text-zinc-200" : "text-zinc-500"}`}>{STAGE_LABEL[s]}</span>
                <span className="tabular-nums text-zinc-400">{count != null ? count.toLocaleString() : ""}</span>
                {s === "pull" && counts.suppressed_clients ? (
                  <span className="chip chip-muted">− {counts.suppressed_clients} client-suppressed</span>
                ) : null}
                {s === "pull" && counts.cities_queried ? (
                  <span className="chip">{counts.cities_queried}/{counts.cities_planned} cities queried</span>
                ) : null}
                {s === "pull" && counts.topup_budget_stopped ? (
                  <span className="chip chip-warn">top-up stopped at budget cap</span>
                ) : null}
                {s === "pagespeed" && counts.pagespeed_quota_exhausted ? (
                  <span className="chip chip-warn">daily quota exhausted</span>
                ) : null}
                {s === "score" && counts.filtered_post_classification ? (
                  <span className="chip chip-muted">− {counts.filtered_post_classification} filtered post-classification</span>
                ) : null}
                {s === "owner_extract" && counts.ai_budget_stopped ? (
                  <span className="chip chip-warn">AI stopped at budget cap</span>
                ) : null}
                {errs ? <span className="chip chip-danger">{errs} errors</span> : null}
              </li>
            );
          })}
        </ol>
      </div>

      {data.stalledIntents.length > 0 && (
        <div className="alert alert-warn">
          <div>
            <div className="font-semibold">Stalled provider jobs (billed even if unfetched — never auto-resubmitted)</div>
            <p className="mt-1 text-xs text-amber-200/80">
              Check the Outscraper dashboard before any manual resubmit (§4.4). {data.stalledIntents.length} job(s) stalled.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Link className="btn" href={`/leads?campaignId=${c.id}`}>Open leads →</Link>
        {c.status === "completed" && <Link className="btn" href={`/exports?campaignId=${c.id}`}>Export…</Link>}
      </div>
    </div>
  );
}
