"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, fmtDate } from "@/lib/format";
import { CardSkeleton, EmptyState, ErrorState, PageHeader, Skeleton, StatusChip } from "@/components/ui";

type ExportRec = {
  id: number; format: string; status: string; rowCount: number | null; driveLink: string | null;
  requestedBy: string; createdAt: string; error: string | null;
  params: { campaignId?: number; includeExcluded?: boolean };
};
type Resp = { exports: ExportRec[]; availableColumns: { key: string; header: string }[]; defaultColumns: string[] };

const ACTIVE_STATUSES = new Set(["pending", "running"]);
const FORMATS = [
  { value: "xlsx", label: "XLSX" },
  { value: "csv", label: "CSV (CRM import)" },
] as const;

function LoadingBlocks() {
  return (
    <>
      <CardSkeleton lines={4} />
      <div className="table-wrap space-y-3 p-5" aria-busy>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </>
  );
}

function ExportsInner() {
  const search = useSearchParams();
  const [data, setData] = useState<Resp | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [campaignId, setCampaignId] = useState(search.get("campaignId") ?? "");
  const [columns, setColumns] = useState<string[]>([]);
  const columnsInitialized = useRef(false);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [toDrive, setToDrive] = useState(false);
  const [driveSubfolder, setDriveSubfolder] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api<Resp>("/api/exports");
      setData(res);
      setLoadError(null);
      if (!columnsInitialized.current) {
        columnsInitialized.current = true;
        setColumns((cur) => (cur.length ? cur : res.defaultColumns));
      }
    } catch (e) {
      setLoadError((e as Error).message || "Failed to load exports");
    }
  }, []);

  // Poll fast only while an export is actually in flight; idle at 10s otherwise.
  const hasActive = data?.exports.some((e) => ACTIVE_STATUSES.has(e.status)) ?? false;
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, hasActive ? 2500 : 10_000);
    return () => clearInterval(t);
  }, [refresh, hasActive]);

  const trimmedCampaign = campaignId.trim();
  const campaignInvalid = trimmedCampaign !== "" && !/^\d+$/.test(trimmedCampaign);
  const noColumns = columns.length === 0;
  const blocked = creating || campaignInvalid || noColumns;

  async function create() {
    if (blocked) return;
    setMsg(null);
    setCreating(true);
    try {
      await api("/api/exports", {
        method: "POST",
        body: JSON.stringify({
          format,
          campaignId: trimmedCampaign ? Number(trimmedCampaign) : undefined,
          columns,
          includeExcluded,
          toDrive,
          driveSubfolder: driveSubfolder || undefined,
        }),
      });
      setMsg({ ok: true, text: "Export queued — it appears below when ready." });
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || "Failed to queue the export." });
    } finally {
      setCreating(false);
    }
  }

  if (!data) {
    return loadError ? <ErrorState message={loadError} onRetry={refresh} /> : <LoadingBlocks />;
  }

  return (
    <>
      {loadError && (
        <div className="alert alert-warn py-2 text-xs" role="status">
          <span className="dot mt-1 bg-amber-400" aria-hidden />
          <span className="flex-1">Live refresh failed — showing last loaded data.</span>
          <button className="btn btn-sm shrink-0" onClick={refresh}>Retry</button>
        </div>
      )}

      <div className="card space-y-5">
        <div>
          <h2 className="card-title">New export</h2>
          <p className="card-sub mt-0.5">Runs as a background job — big exports won&rsquo;t block anything.</p>
        </div>

        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div className="space-y-1.5">
            <div className="section-label" id="export-format-label">Format</div>
            <div className="inline-flex rounded-lg border border-line-strong bg-raised p-0.5" role="radiogroup" aria-labelledby="export-format-label">
              {FORMATS.map((f) => (
                <label
                  key={f.value}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500/40 ${
                    format === f.value ? "bg-emerald-600 text-white shadow" : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  <input
                    type="radio"
                    name="export-format"
                    className="sr-only"
                    checked={format === f.value}
                    onChange={() => setFormat(f.value)}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="section-label block" htmlFor="export-campaign">Campaign</label>
            <input
              id="export-campaign"
              className={`input w-44 ${campaignInvalid ? "border-red-700" : ""}`}
              placeholder="ID (blank = all)"
              inputMode="numeric"
              value={campaignId}
              aria-invalid={campaignInvalid || undefined}
              aria-describedby={campaignInvalid ? "export-campaign-error" : undefined}
              onChange={(e) => setCampaignId(e.target.value)}
            />
            {campaignInvalid && (
              <p id="export-campaign-error" className="text-xs text-red-400">
                Campaign ID must be a whole number — fix it or clear the field to export all campaigns.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="section-label">Columns</span>
            <span className="text-xs tabular-nums text-zinc-600">
              {columns.length} of {data.availableColumns.length}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setColumns(data.defaultColumns)}>Defaults</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setColumns([])}>Clear</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.availableColumns.map((c) => {
              const selected = columns.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setColumns(selected ? columns.filter((k) => k !== c.key) : [...columns, c.key])
                  }
                  className={`chip cursor-pointer ${selected ? "chip-accent" : "hover:border-zinc-600 hover:text-zinc-100"}`}
                >
                  <span className={`dot ${selected ? "bg-emerald-400" : "bg-zinc-600"}`} aria-hidden />
                  {c.header}
                </button>
              );
            })}
          </div>
          {noColumns && (
            <p className="text-xs text-amber-300">Select at least one column — Export is disabled until you do.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={toDrive} onChange={(e) => setToDrive(e.target.checked)} />
            Push to Google Drive
          </label>
          {toDrive && (
            <input
              className="input w-64"
              aria-label="Drive subfolder"
              placeholder="Drive subfolder (optional, e.g. campaign name)"
              value={driveSubfolder}
              onChange={(e) => setDriveSubfolder(e.target.value)}
            />
          )}
          <label className="flex cursor-pointer items-center gap-2 text-amber-300">
            <input type="checkbox" checked={includeExcluded} onChange={(e) => setIncludeExcluded(e.target.checked)} />
            Include DNC / not-interested (audit-logged)
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" onClick={create} disabled={blocked}>
            {creating ? "Queuing…" : "Export"}
          </button>
          {msg && (
            <span className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`} role="status">
              {msg.text}
            </span>
          )}
        </div>

        <p className="text-[11px] leading-5 text-zinc-500">
          <span className="font-semibold text-zinc-400">DNC-list matches never export.</span> Every export carries an
          attribution &amp; metadata sheet.
        </p>
      </div>

      {data.exports.length === 0 ? (
        <div className="card card-tight">
          <EmptyState
            title="No exports yet"
            hint="Queue your first export above — completed files appear here with a download link, and every file carries the attribution metadata sheet."
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="th">#</th>
                <th className="th">Format</th>
                <th className="th">Status</th>
                <th className="th text-right">Rows</th>
                <th className="th">Campaign</th>
                <th className="th">By</th>
                <th className="th">When</th>
                <th className="th"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.exports.map((e) => (
                <tr key={e.id} className="row-hover">
                  <td className="td tabular-nums text-zinc-500">{e.id}</td>
                  <td className="td font-medium uppercase text-zinc-100">{e.format}</td>
                  <td className="td">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusChip status={e.status} />
                      {e.params.includeExcluded && <span className="chip chip-warn">incl. excluded</span>}
                    </div>
                    {e.error && <div className="mt-1 max-w-64 text-xs text-red-400">{e.error}</div>}
                  </td>
                  <td className="td text-right tabular-nums">{e.rowCount?.toLocaleString() ?? "—"}</td>
                  <td className="td tabular-nums">{e.params.campaignId ?? <span className="text-zinc-500">all</span>}</td>
                  <td className="td text-zinc-500">{e.requestedBy}</td>
                  <td className="td whitespace-nowrap text-zinc-500">{fmtDate(e.createdAt)}</td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1.5">
                      {e.status === "completed" && (
                        <a className="btn btn-sm" href={`/api/exports/${e.id}/download`}>Download</a>
                      )}
                      {e.driveLink && (
                        <a className="btn btn-ghost btn-sm" href={e.driveLink} target="_blank" rel="noreferrer">Drive</a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function ExportsPage() {
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Exports"
        sub="Generate lead files for the CRM or Drive — DNC-list matches never leave the system."
      />
      <Suspense fallback={<LoadingBlocks />}>
        <ExportsInner />
      </Suspense>
    </div>
  );
}
