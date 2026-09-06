"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/format";

type Resp = {
  rows: { id: number; kind: string; phone: string | null; domain: string | null; source: string | null; createdAt: string }[];
  counts: { client: number; dnc: number };
};

export default function SuppressionsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [kind, setKind] = useState<"client" | "dnc">("client");
  const [entries, setEntries] = useState("");
  const [source, setSource] = useState("");
  const [result, setResult] = useState("");

  const refresh = useCallback(async () => setData(await api<Resp>("/api/suppressions")), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function importNow() {
    const list = entries.split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean);
    if (!list.length) return;
    const res = await api<{ added: number; invalid: number; duplicates: number }>("/api/suppressions", {
      method: "POST",
      body: JSON.stringify({ kind, entries: list, source: source || undefined }),
    });
    setResult(`Added ${res.added} · duplicates ${res.duplicates} · invalid ${res.invalid}`);
    setEntries("");
    refresh();
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">Suppressions</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card">
          <div className="text-xs text-zinc-500">Do-not-prospect (existing clients)</div>
          <div className="mt-1 text-2xl font-bold">{data?.counts.client ?? "…"}</div>
          <p className="mt-1 text-[11px] text-zinc-500">Excluded from campaign pulls and exports by default. Cold-calling a current customer is prevented structurally, not by memory.</p>
        </div>
        <div className="card">
          <div className="text-xs text-zinc-500">DNC / scrubbed numbers & domains</div>
          <div className="mt-1 text-2xl font-bold">{data?.counts.dnc ?? "…"}</div>
          <p className="mt-1 text-[11px] text-zinc-500">Never export; badge shows on leads. The National DNC registry applies to some sole-proprietor/cell numbers — put your scrub results here.</p>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">Import</h2>
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" checked={kind === "client"} onChange={() => setKind("client")} /> Client roster (do-not-prospect)</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={kind === "dnc"} onChange={() => setKind("dnc")} /> DNC list</label>
        </div>
        <textarea className="input h-36 w-full font-mono text-xs" placeholder={"One phone or domain per line (commas ok):\n(512) 555-0134\nacmeclient.com"} value={entries} onChange={(e) => setEntries(e.target.value)} />
        <div className="flex items-center gap-2">
          <input className="input w-64" placeholder="Source note (e.g. 'client roster Sep 2026')" value={source} onChange={(e) => setSource(e.target.value)} />
          <button className="btn btn-primary" onClick={importNow}>Import</button>
          {result && <span className="text-sm text-emerald-400">{result}</span>}
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead><tr className="border-b border-zinc-800"><th className="th">Kind</th><th className="th">Phone</th><th className="th">Domain</th><th className="th">Source</th><th className="th">Added</th></tr></thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-900">
                <td className="td"><span className={`chip ${r.kind === "client" ? "border-purple-800 text-purple-300" : "border-red-800 text-red-300"}`}>{r.kind}</span></td>
                <td className="td">{r.phone ?? "—"}</td>
                <td className="td">{r.domain ?? "—"}</td>
                <td className="td text-zinc-500">{r.source ?? "—"}</td>
                <td className="td text-zinc-500">{fmtDate(r.createdAt)}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={5} className="td py-6 text-center text-zinc-500">Nothing suppressed yet. Import the Gemfield client roster first (BLOCKERS B12).</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
