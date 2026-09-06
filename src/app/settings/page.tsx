"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, fmtDate, fmtUSD } from "@/lib/format";

type SettingsResp = {
  mockMode: boolean;
  keys: Record<string, boolean>;
  drive: { connected: boolean; folderId: string };
  ops: {
    monthlySpendCeilingUSD: number; monthSpendUSD: number; pagespeedDailyQuota: number;
    pagespeedQuotaRemaining: number; cityPopulationFloor: number; lastBackupAt: string | null; lastBackupFile: string | null;
  };
  env: { overtureRelease: string; fsqRelease: string; appUrl: string; cfAccessConfigured: boolean };
  compliance: { userAgent: string; dncProcess: string; canSpamChecklist: string[]; dataHygiene: string };
  attribution: string;
};
type IngestResp = {
  releases: { id: number; source: string; releaseId: string; status: string; rowCounts: Record<string, number> | null; finishedAt: string | null; error: string | null }[];
  recentJobs: { id: number; type: string; status: string; lastError: string | null; createdAt: string }[];
};
type Mapping = { niche: string; taxonomySet: string[]; confirmedBy: string; confirmedAt: string; timesUsed: number };

const KEY_FIELDS: { k: string; label: string; blocker: string }[] = [
  { k: "pagespeed", label: "PageSpeed API key", blocker: "B1" },
  { k: "anthropic", label: "Anthropic API key (optional)", blocker: "B7" },
  { k: "outscraper", label: "Outscraper API key (optional)", blocker: "B8" },
  { k: "googleClientId", label: "Google OAuth client ID", blocker: "B2" },
  { k: "googleClientSecret", label: "Google OAuth client secret", blocker: "B2" },
];

function SettingsInner() {
  const search = useSearchParams();
  const [data, setData] = useState<SettingsResp | null>(null);
  const [ingest, setIngest] = useState<IngestResp | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [folderDraft, setFolderDraft] = useState("");
  const [ceilingDraft, setCeilingDraft] = useState("");
  const [floorDraft, setFloorDraft] = useState("");
  const [states, setStates] = useState("TX, FL, GA");
  const [msg, setMsg] = useState(search.get("google") === "connected" ? "Google Drive connected ✓" : "");

  const refresh = useCallback(async () => {
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
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save(body: Record<string, unknown>, note: string) {
    await api("/api/settings", { method: "POST", body: JSON.stringify(body) });
    setMsg(note);
    setKeyDrafts({});
    refresh();
  }
  async function connectDrive() {
    const { url } = await api<{ url: string }>("/api/google/connect");
    window.location.href = url;
  }
  async function runIngest() {
    await api("/api/ingest", { method: "POST", body: JSON.stringify({ states: states.split(/[\s,]+/).filter(Boolean) }) });
    setMsg("Ingest chain queued (overture → fsq → conflate).");
    refresh();
  }
  async function runBackupNow() {
    await api("/api/ingest/backup", { method: "POST", body: "{}" });
    setMsg("Backup queued.");
  }
  async function deleteMapping(niche: string) {
    await api("/api/taxonomy/mappings", { method: "DELETE", body: JSON.stringify({ niche }) });
    refresh();
  }

  if (!data) return <div className="text-zinc-500">Loading…</div>;

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Settings</h1>
        {data.mockMode && <span className="chip border-sky-800 text-sky-300">MOCK_MODE — keyless; adapters use deterministic mocks</span>}
      </div>
      {msg && <div className="rounded-md border border-emerald-800 bg-emerald-950/60 px-3 py-2 text-sm text-emerald-300">{msg}</div>}

      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">API keys <span className="font-normal text-zinc-500">— stored encrypted on the volume (AES-256-GCM), never in the DB or git</span></h2>
        {KEY_FIELDS.map((f) => (
          <div key={f.k} className="flex items-center gap-2 text-sm">
            <span className="w-64">{f.label} {data.keys[f.k] ? <span className="text-emerald-400">✓ configured</span> : <span className="text-zinc-500">({f.blocker})</span>}</span>
            <input className="input flex-1" type="password" placeholder={data.keys[f.k] ? "•••••• (enter to replace)" : "paste key…"}
              value={keyDrafts[f.k] ?? ""} onChange={(e) => setKeyDrafts({ ...keyDrafts, [f.k]: e.target.value })} />
          </div>
        ))}
        <button className="btn btn-primary" onClick={() => save({ keys: keyDrafts }, "Keys saved.")}>Save keys</button>
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">Google Drive</h2>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-64">Status</span>
          {data.drive.connected ? <span className="text-emerald-400">✓ connected</span> : <button className="btn" onClick={connectDrive}>Connect (one-time consent)</button>}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="w-64">Export folder ID (Shared Drive recommended)</span>
          <input className="input flex-1" value={folderDraft} onChange={(e) => setFolderDraft(e.target.value)} />
          <button className="btn" onClick={() => save({ driveFolderId: folderDraft }, "Folder saved.")}>Save</button>
        </div>
        <p className="text-[11px] text-zinc-500">User OAuth (Workspace account) or a Shared Drive — never a bare service account: no My Drive quota, uploads fail silently.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">Data & releases</h2>
        <div className="text-xs text-zinc-400">Pinned: Overture <b>{data.env.overtureRelease}</b> · FSQ <b>{data.env.fsqRelease}</b> (bump via .env, then run the extract)</div>
        <div className="flex items-center gap-2">
          <input className="input w-64" value={states} onChange={(e) => setStates(e.target.value)} />
          <button className="btn btn-primary" onClick={runIngest}>Run monthly extract</button>
          <span className="text-[11px] text-zinc-500">host needs ≥4 GB RAM; ~20 GB disk (§4.0)</span>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-zinc-800"><th className="th">Source</th><th className="th">Release</th><th className="th">Status</th><th className="th">Rows</th><th className="th">Finished</th></tr></thead>
          <tbody>
            {ingest?.releases.map((r) => (
              <tr key={r.id} className="border-b border-zinc-900">
                <td className="td">{r.source}</td><td className="td">{r.releaseId}</td>
                <td className="td">{r.status}{r.error && <span className="ml-1 text-xs text-red-400">{r.error}</span>}</td>
                <td className="td text-zinc-400">{r.rowCounts ? Object.entries(r.rowCounts).map(([s, n]) => `${s}:${n}`).join(" ") : "—"}</td>
                <td className="td text-zinc-500">{fmtDate(r.finishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">Spend & quotas</h2>
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>Spend this month: <b>{fmtUSD(data.ops.monthSpendUSD)}</b></div>
          <label className="flex items-center gap-2">Monthly ceiling $<input className="input w-24" value={ceilingDraft} onChange={(e) => setCeilingDraft(e.target.value)} />
            <button className="btn py-1 text-xs" onClick={() => save({ monthlySpendCeilingUSD: Number(ceilingDraft) }, "Ceiling saved.")}>Set</button></label>
          <div>PageSpeed quota left today: <b>{data.ops.pagespeedQuotaRemaining.toLocaleString()}</b></div>
          <label className="flex items-center gap-2">City population floor <input className="input w-24" value={floorDraft} onChange={(e) => setFloorDraft(e.target.value)} />
            <button className="btn py-1 text-xs" onClick={() => save({ cityPopulationFloor: Number(floorDraft) }, "Floor saved.")}>Set</button></label>
          <div>Last backup: <b>{data.ops.lastBackupAt ? fmtDate(data.ops.lastBackupAt) : "never"}</b> <button className="btn ml-2 py-1 text-xs" onClick={runBackupNow}>Backup now</button></div>
          <div>Access JWT gate: {data.mockMode ? <span className="text-sky-300">dev identity (mock)</span> : data.env.cfAccessConfigured ? <span className="text-emerald-400">configured</span> : <span className="text-red-400">NOT configured (B3)</span>}</div>
        </div>
      </section>

      <section className="card space-y-2">
        <h2 className="text-sm font-semibold text-zinc-300">Category catalog — confirmed niche mappings</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-zinc-800"><th className="th">Niche</th><th className="th">Taxonomy set</th><th className="th">By</th><th className="th">Used</th><th className="th"></th></tr></thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.niche} className="border-b border-zinc-900">
                <td className="td">{m.niche}</td>
                <td className="td text-zinc-400">{m.taxonomySet.join(", ")}</td>
                <td className="td text-zinc-500">{m.confirmedBy}</td>
                <td className="td">{m.timesUsed}</td>
                <td className="td"><button className="btn py-0.5 text-xs" onClick={() => deleteMapping(m.niche)}>forget</button></td>
              </tr>
            ))}
            {mappings.length === 0 && <tr><td colSpan={5} className="td text-zinc-500">No confirmed mappings yet — they persist after the first campaign per niche.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card space-y-2">
        <h2 className="text-sm font-semibold text-zinc-300">Compliance & About</h2>
        <div className="text-xs text-zinc-400">Fetch user agent: <code className="text-zinc-300">{data.compliance.userAgent}</code></div>
        <div className="text-xs text-zinc-400">{data.compliance.dncProcess}</div>
        <div className="text-xs text-zinc-400">{data.compliance.dataHygiene}</div>
        <ul className="list-disc pl-5 text-xs text-zinc-500">{data.compliance.canSpamChecklist.map((c, i) => <li key={i}>{c}</li>)}</ul>
        <pre className="whitespace-pre-wrap rounded-md bg-zinc-900 p-3 text-[11px] leading-4 text-zinc-400">{data.attribution}</pre>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="text-zinc-500">Loading…</div>}>
      <SettingsInner />
    </Suspense>
  );
}
