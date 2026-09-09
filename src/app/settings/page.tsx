"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, fmtDate, fmtUSD } from "@/lib/format";
import { CardSkeleton, EmptyState, ErrorState, PageHeader, StatusChip } from "@/components/ui";

type SettingsResp = {
  mockMode: boolean;
  serverless: boolean;
  keys: Record<string, boolean>;
  drive: { connected: boolean; folderId: string };
  ops: {
    monthlySpendCeilingUSD: number; monthSpendUSD: number; pagespeedDailyQuota: number;
    pagespeedQuotaRemaining: number; cityPopulationFloor: number; jobConcurrency: number;
    fetchGlobal: number; fetchPerDomain: number; lastBackupAt: string | null; lastBackupFile: string | null;
  };
  env: { overtureRelease: string; fsqRelease: string; appUrl: string; cfAccessConfigured: boolean };
  compliance: { userAgent: string; dncProcess: string; canSpamChecklist: string[]; dataHygiene: string };
  attribution: string;
};
type ReleaseDiff = { new: number; changedWebsites: number; changedPhones: number; disappeared: number };
type IngestResp = {
  releases: { id: number; source: string; releaseId: string; status: string; rowCounts: Record<string, number> | null; finishedAt: string | null; error: string | null; gateReport?: { diff?: ReleaseDiff } | null }[];
  recentJobs: { id: number; type: string; status: string; lastError: string | null; createdAt: string }[];
};
type Mapping = { niche: string; taxonomySet: string[]; confirmedBy: string; confirmedAt: string; timesUsed: number };
type Notice = { kind: "ok" | "err"; text: string };

const KEY_FIELDS: { k: string; label: string; blocker: string }[] = [
  { k: "pagespeed", label: "PageSpeed API key", blocker: "B1" },
  { k: "anthropic", label: "Anthropic API key (optional)", blocker: "B7" },
  { k: "outscraper", label: "Outscraper API key (optional)", blocker: "B8" },
  { k: "googleClientId", label: "Google OAuth client ID", blocker: "B2" },
  { k: "googleClientSecret", label: "Google OAuth client secret", blocker: "B2" },
  { k: "hf", label: "Hugging Face token (FSQ gap-fill)", blocker: "B6" },
  { k: "alertWebhook", label: "Ops alert webhook URL (Slack-compatible, optional)", blocker: "ops" },
];

const EXTRACT_CMD = "DATABASE_URL=<pooler url> npx tsx scripts/workstation-extract.ts TX FL GA";

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function SettingsSkeleton() {
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Settings" sub="Keys, quotas, data releases, and compliance." />
      <CardSkeleton lines={7} />
      <CardSkeleton lines={2} />
      <CardSkeleton lines={4} />
      <CardSkeleton lines={5} />
    </div>
  );
}

function SettingsInner() {
  const search = useSearchParams();
  const [data, setData] = useState<SettingsResp | null>(null);
  const [ingest, setIngest] = useState<IngestResp | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [folderDraft, setFolderDraft] = useState("");
  const [ceilingDraft, setCeilingDraft] = useState("");
  const [floorDraft, setFloorDraft] = useState("");
  const [states, setStates] = useState("TX, FL, GA");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(() => {
    const g = search.get("google");
    if (g === "connected") return { kind: "ok", text: "Google Drive connected." };
    if (g === "state_mismatch")
      return { kind: "err", text: "Google sign-in failed: OAuth state mismatch — the consent flow may have expired or been replayed. Try connecting again." };
    if (g === "error") {
      const detail = search.get("detail");
      return { kind: "err", text: `Google sign-in failed${detail ? `: ${detail}` : "."}` };
    }
    return null;
  });

  const refresh = useCallback(async () => {
    try {
      const [s, i, m] = await Promise.all([
        api<SettingsResp>("/api/settings"),
        api<IngestResp>("/api/ingest"),
        api<{ mappings: Mapping[] }>("/api/taxonomy/mappings"),
      ]);
      setData(s);
      setIngest(i);
      setMappings(m.mappings);
      setFolderDraft(s.drive.folderId);
      setCeilingDraft(String(s.ops.monthlySpendCeilingUSD));
      setFloorDraft(String(s.ops.cityPopulationFloor));
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e));
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save(body: Record<string, unknown>, note: string, busyKey = "save") {
    setNotice(null);
    setBusy(busyKey);
    try {
      const res = await api<{ ok: boolean; changed: string[] }>("/api/settings", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.changed || res.changed.length === 0) {
        setNotice({ kind: "err", text: "Nothing saved — check the values." });
      } else {
        setNotice({ kind: "ok", text: note });
        if ("keys" in body) setKeyDrafts({});
        await refresh();
      }
    } catch (e) {
      setNotice({ kind: "err", text: `Save failed: ${errText(e)}` });
    } finally {
      setBusy(null);
    }
  }

  async function connectDrive() {
    setNotice(null);
    setBusy("drive");
    try {
      const { url } = await api<{ url: string }>("/api/google/connect");
      window.location.href = url; // leaves the page; keep the button disabled meanwhile
    } catch (e) {
      setNotice({ kind: "err", text: `Google connect failed: ${errText(e)}` });
      setBusy(null);
    }
  }

  async function runIngest() {
    setNotice(null);
    setBusy("ingest");
    try {
      await api("/api/ingest", { method: "POST", body: JSON.stringify({ states: states.split(/[\s,]+/).filter(Boolean) }) });
      setNotice({ kind: "ok", text: "Ingest chain queued (overture → fsq → conflate)." });
      await refresh();
    } catch (e) {
      setNotice({ kind: "err", text: `Ingest failed to queue: ${errText(e)}` });
    } finally {
      setBusy(null);
    }
  }

  async function runBackupNow() {
    setNotice(null);
    setBusy("backup");
    try {
      await api("/api/ingest/backup", { method: "POST", body: "{}" });
      setNotice({ kind: "ok", text: "Backup queued." });
    } catch (e) {
      setNotice({ kind: "err", text: `Backup failed to queue: ${errText(e)}` });
    } finally {
      setBusy(null);
    }
  }

  async function deleteMapping(niche: string) {
    setNotice(null);
    setBusy(`mapping:${niche}`);
    try {
      await api("/api/taxonomy/mappings", { method: "DELETE", body: JSON.stringify({ niche }) });
      await refresh();
    } catch (e) {
      setNotice({ kind: "err", text: `Could not forget mapping "${niche}": ${errText(e)}` });
    } finally {
      setBusy(null);
    }
  }

  async function copyExtractCmd() {
    try {
      await navigator.clipboard.writeText(EXTRACT_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice({ kind: "err", text: "Copy failed — select the command text manually." });
    }
  }

  if (!data) {
    if (loadError) {
      return (
        <div className="max-w-4xl space-y-6">
          <PageHeader title="Settings" sub="Keys, quotas, data releases, and compliance." />
          <ErrorState message={`Could not load settings: ${loadError}`} onRetry={refresh} />
        </div>
      );
    }
    return <SettingsSkeleton />;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Settings"
        sub="Keys, quotas, data releases, and compliance."
        actions={
          data.mockMode ? (
            <span className="chip chip-info" title="No provider keys required — all adapters use deterministic mocks.">
              MOCK_MODE — deterministic adapters
            </span>
          ) : undefined
        }
      />

      {loadError && <ErrorState message={`Refresh failed — showing last loaded data. ${loadError}`} onRetry={refresh} />}
      {notice &&
        (notice.kind === "err" ? (
          <div className="alert alert-error" role="alert">
            {notice.text}
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-800/80 bg-emerald-950/50 px-3.5 py-2.5 text-sm text-emerald-200" role="status">
            {notice.text}
          </div>
        ))}

      {/* ---------- API keys ---------- */}
      <section className="card card-tight">
        <div className="card-header">
          <div>
            <h2 className="card-title">API keys</h2>
            <p className="card-sub">Stored encrypted (AES-256-GCM under APP_SECRET, D8) — never in plaintext or git.</p>
          </div>
        </div>
        <div className="space-y-3 p-5">
          {KEY_FIELDS.map((f) => (
            <div key={f.k} className="grid gap-1.5 sm:grid-cols-[minmax(0,19rem)_1fr] sm:items-center sm:gap-3">
              <label htmlFor={`key-${f.k}`} className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                <span>{f.label}</span>
                {data.keys[f.k] ? (
                  <span className="chip chip-accent">Configured</span>
                ) : (
                  <span className="chip chip-muted">Not set · {f.blocker}</span>
                )}
              </label>
              <input
                id={`key-${f.k}`}
                className="input w-full"
                type="password"
                autoComplete="off"
                placeholder={data.keys[f.k] ? "•••••• (enter to replace)" : "paste key…"}
                value={keyDrafts[f.k] ?? ""}
                onChange={(e) => setKeyDrafts({ ...keyDrafts, [f.k]: e.target.value })}
              />
            </div>
          ))}
          <div className="pt-1">
            <button
              className="btn btn-primary"
              disabled={busy !== null || !Object.values(keyDrafts).some((v) => v.trim())}
              onClick={() => save({ keys: keyDrafts }, "Keys saved.")}
            >
              {busy === "save" ? "Saving…" : "Save keys"}
            </button>
          </div>
        </div>
      </section>

      {/* ---------- Google Drive ---------- */}
      <section className="card card-tight">
        <div className="card-header">
          <div>
            <h2 className="card-title">Google Drive</h2>
            <p className="card-sub">Export destination for campaign workbooks and backups.</p>
          </div>
          {data.drive.connected ? (
            <span className="chip chip-accent">Connected</span>
          ) : (
            <button className="btn" onClick={connectDrive} disabled={busy !== null}>
              {busy === "drive" ? "Redirecting…" : "Connect (one-time consent)"}
            </button>
          )}
        </div>
        <div className="space-y-3 p-5">
          <div className="grid gap-1.5 sm:grid-cols-[minmax(0,19rem)_1fr] sm:items-center sm:gap-3">
            <label htmlFor="drive-folder" className="text-sm text-zinc-300">
              Export folder ID <span className="text-zinc-500">(Shared Drive recommended)</span>
            </label>
            <div className="flex items-center gap-2">
              <input id="drive-folder" className="input w-full flex-1" value={folderDraft} onChange={(e) => setFolderDraft(e.target.value)} />
              <button
                className="btn shrink-0"
                disabled={busy !== null}
                onClick={() => save({ driveFolderId: folderDraft }, "Folder saved.")}
              >
                Save
              </button>
            </div>
          </div>
          <p className="text-xs leading-5 text-zinc-500">
            User OAuth (Workspace account) or a Shared Drive — never a bare service account: no My Drive quota, uploads fail silently.
          </p>
        </div>
      </section>

      {/* ---------- Data & releases ---------- */}
      <section className="card card-tight">
        <div className="card-header">
          <div>
            <h2 className="card-title">Data &amp; releases</h2>
            <p className="card-sub">
              Pinned: Overture <b className="text-zinc-300">{data.env.overtureRelease}</b> · FSQ{" "}
              <b className="text-zinc-300">{data.env.fsqRelease}</b> — bump via .env, then run the extract.
            </p>
          </div>
        </div>
        <div className="space-y-4 p-5">
          {data.serverless ? (
            <div className="alert alert-info flex-col items-stretch gap-2">
              <div>
                <b>Serverless host</b> — the monthly DuckDB extract cannot run here (needs ≥4 GB RAM, ~20 GB disk, §4.0). Run it
                from a workstation against the pooler URL:
              </div>
              <div className="flex items-center gap-2">
                <code className="block flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-line bg-bg px-3 py-2 font-mono text-xs text-zinc-300">
                  {EXTRACT_CMD}
                </code>
                <button className="btn btn-sm shrink-0" onClick={copyExtractCmd} aria-label="Copy extract command">
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label htmlFor="extract-states" className="section-label block">
                  States to extract
                </label>
                <input
                  id="extract-states"
                  className="input w-full sm:w-64"
                  value={states}
                  onChange={(e) => setStates(e.target.value)}
                  placeholder="TX, FL, GA"
                />
              </div>
              <button className="btn" onClick={runIngest} disabled={busy !== null}>
                {busy === "ingest" ? "Queueing…" : "Run monthly extract"}
              </button>
              <span className="pb-2.5 text-[11px] text-zinc-500">host needs ≥4 GB RAM; ~20 GB disk (§4.0)</span>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="th">Source</th>
                  <th className="th">Release</th>
                  <th className="th">Status</th>
                  <th className="th">Rows</th>
                  <th className="th">Finished</th>
                </tr>
              </thead>
              <tbody>
                {(ingest?.releases ?? []).map((r) => (
                  <tr key={r.id} className="row-hover">
                    <td className="td font-medium text-zinc-100">{r.source}</td>
                    <td className="td text-zinc-400">{r.releaseId}</td>
                    <td className="td">
                      <StatusChip status={r.status} />
                      {r.error && <div className="mt-1 text-xs text-red-400">{r.error}</div>}
                    </td>
                    <td className="td text-zinc-400 tabular-nums">
                      {r.rowCounts ? Object.entries(r.rowCounts).map(([s, n]) => `${s}:${n.toLocaleString()}`).join("  ") : "—"}
                      {r.gateReport?.diff && (
                        <div className="mt-0.5 text-[11px] text-zinc-500">
                          diff: +{r.gateReport.diff.new} new · {r.gateReport.diff.changedWebsites} site Δ ·{" "}
                          {r.gateReport.diff.changedPhones} phone Δ · {r.gateReport.diff.disappeared} disappeared
                        </div>
                      )}
                    </td>
                    <td className="td whitespace-nowrap text-zinc-500">{fmtDate(r.finishedAt)}</td>
                  </tr>
                ))}
                {(ingest?.releases ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="td py-8 text-center text-zinc-500">
                      No extracts yet — the first monthly extract will appear here once it runs.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- Spend & quotas ---------- */}
      <section className="card card-tight">
        <div className="card-header">
          <div>
            <h2 className="card-title">Spend &amp; quotas</h2>
            <p className="card-sub">Budget guard runs before every billable call (C10).</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <div className="section-label">Spend this month</div>
            <div className="text-lg font-semibold text-white tabular-nums">{fmtUSD(data.ops.monthSpendUSD)}</div>
            <div className="text-xs text-zinc-500">of {fmtUSD(data.ops.monthlySpendCeilingUSD)} ceiling</div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="spend-ceiling" className="section-label block">
              Monthly ceiling (USD)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="spend-ceiling"
                className="input w-24"
                inputMode="decimal"
                value={ceilingDraft}
                onChange={(e) => setCeilingDraft(e.target.value)}
              />
              <button
                className="btn btn-sm"
                disabled={busy !== null}
                onClick={() => {
                  if (!ceilingDraft.trim()) return setNotice({ kind: "err", text: "Enter a ceiling value first." });
                  save({ monthlySpendCeilingUSD: Number(ceilingDraft) }, "Ceiling saved.");
                }}
              >
                Set
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <div className="section-label">PageSpeed quota left today</div>
            <div className="text-lg font-semibold text-white tabular-nums">{data.ops.pagespeedQuotaRemaining.toLocaleString()}</div>
            <div className="text-xs text-zinc-500">of {data.ops.pagespeedDailyQuota.toLocaleString()} daily</div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pop-floor" className="section-label block">
              City population floor
            </label>
            <div className="flex items-center gap-2">
              <input
                id="pop-floor"
                className="input w-24"
                inputMode="numeric"
                value={floorDraft}
                onChange={(e) => setFloorDraft(e.target.value)}
              />
              <button
                className="btn btn-sm"
                disabled={busy !== null}
                onClick={() => {
                  if (!floorDraft.trim()) return setNotice({ kind: "err", text: "Enter a population floor first." });
                  save({ cityPopulationFloor: Number(floorDraft) }, "Floor saved.");
                }}
              >
                Set
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <div className="section-label">Last backup</div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-200">{data.ops.lastBackupAt ? fmtDate(data.ops.lastBackupAt) : "never"}</span>
              <button className="btn btn-sm" onClick={runBackupNow} disabled={busy !== null}>
                {busy === "backup" ? "Queueing…" : "Backup now"}
              </button>
            </div>
            {data.ops.lastBackupFile && <div className="truncate text-xs text-zinc-500">{data.ops.lastBackupFile}</div>}
          </div>
          <div className="space-y-1">
            <div className="section-label">Access JWT gate</div>
            <div>
              {data.mockMode ? (
                <span className="chip chip-info">dev identity (mock)</span>
              ) : data.env.cfAccessConfigured ? (
                <span className="chip chip-accent">Configured</span>
              ) : (
                <span className="chip chip-danger">NOT configured (B3)</span>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="job-concurrency" className="section-label block">
              Job concurrency (1–8)
            </label>
            <input
              id="job-concurrency"
              className="input w-20"
              inputMode="numeric"
              defaultValue={data.ops.jobConcurrency}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v === data.ops.jobConcurrency) return;
                save({ jobConcurrency: v }, "Job concurrency saved — applies after restart.");
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="fetch-global" className="section-label block">
              Fetch: global (1–32)
            </label>
            <input
              id="fetch-global"
              className="input w-20"
              inputMode="numeric"
              defaultValue={data.ops.fetchGlobal}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v === data.ops.fetchGlobal) return;
                save({ fetchGlobal: v }, "Global fetch limit saved — applies after restart.");
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="fetch-per-domain" className="section-label block">
              Fetch: per-domain (1–4)
            </label>
            <input
              id="fetch-per-domain"
              className="input w-20"
              inputMode="numeric"
              defaultValue={data.ops.fetchPerDomain}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v === data.ops.fetchPerDomain) return;
                save({ fetchPerDomain: v }, "Per-domain fetch limit saved — applies after restart.");
              }}
            />
          </div>
        </div>
        <p className="border-t border-line px-5 py-3 text-[11px] leading-4 text-zinc-500">
          Concurrency limits apply at the next restart (read when the worker/fetcher singletons boot). Politeness floors stay
          hard-coded: 8s timeout, robots.txt, identified UA.
        </p>
      </section>

      {/* ---------- Category catalog ---------- */}
      <section className="card card-tight">
        <div className="card-header">
          <div>
            <h2 className="card-title">Category catalog</h2>
            <p className="card-sub">Confirmed niche → taxonomy mappings, reused across campaigns.</p>
          </div>
        </div>
        <div className="p-5">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="th">Niche</th>
                  <th className="th">Taxonomy set</th>
                  <th className="th">By</th>
                  <th className="th text-right!">Used</th>
                  <th className="th">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.niche} className="row-hover">
                    <td className="td font-medium text-zinc-100">{m.niche}</td>
                    <td className="td text-zinc-400">{m.taxonomySet.join(", ")}</td>
                    <td className="td text-zinc-500">{m.confirmedBy}</td>
                    <td className="td text-right tabular-nums">{m.timesUsed}</td>
                    <td className="td text-right">
                      <button
                        className="btn btn-danger btn-sm"
                        disabled={busy !== null}
                        onClick={() => deleteMapping(m.niche)}
                        aria-label={`Forget mapping for ${m.niche}`}
                      >
                        {busy === `mapping:${m.niche}` ? "…" : "Forget"}
                      </button>
                    </td>
                  </tr>
                ))}
                {mappings.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-0">
                      <EmptyState
                        title="No confirmed mappings yet"
                        hint="A niche's taxonomy mapping is confirmed during its first campaign and reused automatically afterwards."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- Compliance & attribution ---------- */}
      <details className="card card-tight group">
        <summary className="card-header cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <div>
            <h2 className="card-title">Compliance &amp; attribution</h2>
            <p className="card-sub">Fetch UA, DNC process, CAN-SPAM checklist, data hygiene, and license attribution.</p>
          </div>
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="space-y-3 p-5">
          <div className="text-xs text-zinc-400">
            Fetch user agent: <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">{data.compliance.userAgent}</code>
          </div>
          <div className="text-xs leading-5 text-zinc-400">{data.compliance.dncProcess}</div>
          <div className="text-xs leading-5 text-zinc-400">{data.compliance.dataHygiene}</div>
          <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-zinc-500">
            {data.compliance.canSpamChecklist.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <div>
            <div className="section-label mb-1.5">Data attribution (license requirement)</div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 text-[11px] leading-4 text-zinc-400">
              {data.attribution}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <SettingsInner />
    </Suspense>
  );
}
