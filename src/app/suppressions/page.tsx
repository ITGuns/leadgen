"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/format";
import { CardSkeleton, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";

type Resp = {
  rows: { id: number; kind: string; phone: string | null; domain: string | null; source: string | null; createdAt: string }[];
  counts: { client: number; dnc: number };
};

const KINDS = [
  {
    value: "client",
    title: "Client roster (do-not-prospect)",
    desc: "Existing Gemfield customers — excluded from campaign pulls and exports by default.",
  },
  {
    value: "dnc",
    title: "DNC list",
    desc: "Scrubbed numbers and domains. Never export — the badge shows on leads.",
  },
] as const;

function LoadingBlocks() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-busy>
        {[0, 1].map((i) => (
          <div key={i} className="stat space-y-3">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        ))}
      </div>
      <CardSkeleton lines={4} />
      <div className="table-wrap space-y-3 p-5" aria-busy>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </>
  );
}

export default function SuppressionsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<"client" | "dnc">("client");
  const [entries, setEntries] = useState("");
  const [source, setSource] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api<Resp>("/api/suppressions"));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || "Failed to load suppressions");
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const parsed = entries.split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean);

  async function importNow() {
    if (importing || parsed.length === 0) return;
    setResult(null);
    setImporting(true);
    try {
      const res = await api<{ added: number; invalid: number; duplicates: number }>("/api/suppressions", {
        method: "POST",
        body: JSON.stringify({ kind, entries: parsed, source: source || undefined }),
      });
      setResult({ ok: true, text: `Added ${res.added} · duplicates ${res.duplicates} · invalid ${res.invalid}` });
      setEntries("");
      await refresh();
    } catch (e) {
      setResult({ ok: false, text: `Import failed — nothing was added. ${(e as Error).message}` });
    } finally {
      setImporting(false);
    }
  }

  if (!data) {
    return (
      <div className="max-w-4xl space-y-6">
        <PageHeader
          title="Suppressions"
          sub="Client roster and DNC scrubs — enforced structurally at pull and export time."
        />
        {loadError ? <ErrorState message={loadError} onRetry={refresh} /> : <LoadingBlocks />}
      </div>
    );
  }

  const total = data.counts.client + data.counts.dnc;
  const capped = data.rows.length < total;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Suppressions"
        sub="Client roster and DNC scrubs — enforced structurally at pull and export time."
      />

      {loadError && (
        <div className="alert alert-warn py-2 text-xs" role="status">
          <span className="dot mt-1 bg-amber-400" aria-hidden />
          <span className="flex-1">Refresh failed — showing last loaded data.</span>
          <button className="btn btn-sm shrink-0" onClick={refresh}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="stat">
          <div className="stat-label">Do-not-prospect (existing clients)</div>
          <div className="stat-value">{data.counts.client.toLocaleString()}</div>
          <p className="stat-foot">
            Excluded from campaign pulls and exports by default. Cold-calling a current customer is prevented
            structurally, not by memory.
          </p>
        </div>
        <div className="stat">
          <div className="stat-label">DNC / scrubbed numbers &amp; domains</div>
          <div className="stat-value">{data.counts.dnc.toLocaleString()}</div>
          <p className="stat-foot">
            <span className="font-semibold text-red-300">Never export</span> — the badge shows on leads. The National
            DNC registry applies to some sole-proprietor/cell numbers — put your scrub results here.
          </p>
        </div>
      </div>

      <div className="card space-y-4">
        <div>
          <h2 className="card-title">Import a list</h2>
          <p className="card-sub mt-0.5">Paste phones or domains — one per line, commas ok.</p>
        </div>

        <div role="radiogroup" aria-label="List kind" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KINDS.map((k) => {
            const active = kind === k.value;
            return (
              <label
                key={k.value}
                className={`cursor-pointer rounded-lg border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500/40 ${
                  active
                    ? "border-emerald-600/70 bg-emerald-500/5"
                    : "border-line-strong bg-raised hover:border-zinc-600"
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="suppression-kind"
                    className="sr-only"
                    checked={active}
                    onChange={() => setKind(k.value)}
                  />
                  <span className={`dot ${active ? "bg-emerald-400" : "bg-zinc-600"}`} aria-hidden />
                  <span className="text-sm font-medium text-zinc-100">{k.title}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{k.desc}</p>
              </label>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <label className="section-label block" htmlFor="suppression-entries">Entries</label>
          <textarea
            id="suppression-entries"
            className="input h-36 w-full font-mono text-xs"
            placeholder={"One phone or domain per line:\n(512) 555-0134\nacmeclient.com"}
            value={entries}
            onChange={(e) => setEntries(e.target.value)}
          />
          {parsed.length > 0 && (
            <p className="text-xs tabular-nums text-zinc-500">{parsed.length} entr{parsed.length === 1 ? "y" : "ies"} ready to import.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input w-64 max-w-full"
            aria-label="Source note"
            placeholder="Source note (e.g. 'client roster Sep 2026')"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <button className="btn btn-primary" onClick={importNow} disabled={importing || parsed.length === 0}>
            {importing ? "Importing…" : "Import"}
          </button>
        </div>

        {result &&
          (result.ok ? (
            <div className="alert alert-info" role="status">{result.text}</div>
          ) : (
            <div className="alert alert-error" role="alert">{result.text}</div>
          ))}
      </div>

      {data.rows.length === 0 ? (
        <div className="card card-tight">
          <EmptyState
            title="Nothing suppressed yet"
            hint="Import the Gemfield client roster first (BLOCKERS B12) — suppression is enforced at pull and export time, so load it before running a campaign."
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="section-label">Suppressed entries</span>
            {capped && (
              <span className="text-xs tabular-nums text-zinc-500">
                Showing latest {data.rows.length.toLocaleString()} of {total.toLocaleString()}
              </span>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="th">Kind</th>
                  <th className="th">Phone</th>
                  <th className="th">Domain</th>
                  <th className="th">Source</th>
                  <th className="th">Added</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="row-hover">
                    <td className="td">
                      <span className={`chip ${r.kind === "client" ? "chip-info" : "chip-danger"}`}>
                        {r.kind === "client" ? "Client" : "DNC"}
                      </span>
                    </td>
                    <td className="td font-medium tabular-nums text-zinc-100">{r.phone ?? <span className="font-normal text-zinc-600">—</span>}</td>
                    <td className="td font-medium text-zinc-100">{r.domain ?? <span className="font-normal text-zinc-600">—</span>}</td>
                    <td className="td text-zinc-500">{r.source ?? "—"}</td>
                    <td className="td whitespace-nowrap text-zinc-500">{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
