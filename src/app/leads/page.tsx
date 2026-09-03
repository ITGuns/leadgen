"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, CLASS_LABEL, fmtDate, scoreColor, STATUS_COLOR, STATUS_LABEL, US_STATES } from "@/lib/format";

type Row = {
  lead: {
    id: number; score: number | null; scoreReasons: { chip: string }[] | null; status: string;
    ownerName: string | null; ownerRole: string | null; assignee: string | null; tags: string[] | null;
    pagespeed: { mobileScore: number } | null; updatedAt: string;
  };
  business: {
    id: number; name: string; city: string | null; region: string | null; phone: string | null;
    websiteRaw: string | null; websiteClass: string; taxonomyPrimary: string | null; emails: string[] | null;
  };
  dncSuppressed: boolean;
  clientSuppressed: boolean;
};
type ListResp = { rows: Row[]; total: number; page: number; pageSize: number };

type Detail = Row & {
  lead: Row["lead"] & { ownerEvidence: string | null; ownerConfidence: string | null; ownerSource: string | null; websiteCheck: Record<string, unknown> | null; lastVerifiedAt: string | null };
  business: Row["business"] & { street: string | null; postal: string | null; socials: string[] | null; sources: Record<string, unknown> | null; confidence: number | null; operatingStatus: string | null; chain: boolean };
  notes: { id: number; author: string; body: string; createdAt: string }[];
  campaigns: { id: number; name: string; addedAt: string; status: string }[];
};

function LeadsWorkspace() {
  const search = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [state, setState] = useState("");
  const [hasWebsite, setHasWebsite] = useState("");
  const [minScore, setMinScore] = useState("");
  const [ownerFound, setOwnerFound] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResp | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<Detail | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const campaignId = search.get("campaignId") ?? "";

  const refresh = useCallback(async () => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (status) p.append("status", status);
    if (state) p.append("state", state);
    if (hasWebsite) p.set("hasWebsite", hasWebsite);
    if (minScore) p.set("minScore", minScore);
    if (ownerFound) p.set("ownerFound", ownerFound);
    if (campaignId) p.set("campaignId", campaignId);
    p.set("page", String(page));
    setData(await api<ListResp>(`/api/leads?${p}`));
  }, [q, status, state, hasWebsite, minScore, ownerFound, campaignId, page]);

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  async function openDetail(id: number) {
    setDetail(await api<Detail>(`/api/leads/${id}`));
  }
  async function patchDetail(patch: Record<string, unknown>) {
    if (!detail) return;
    setDetail(await api<Detail>(`/api/leads/${detail.lead.id}`, { method: "PATCH", body: JSON.stringify(patch) }));
    refresh();
  }
  async function bulk(patch: Record<string, unknown>) {
    if (!selected.size) return;
    await api("/api/leads/bulk", { method: "POST", body: JSON.stringify({ ids: [...selected], patch }) });
    setSelected(new Set());
    refresh();
  }
  async function addNote() {
    if (!detail || !noteDraft.trim()) return;
    await api(`/api/leads/${detail.lead.id}/notes`, { method: "POST", body: JSON.stringify({ body: noteDraft }) });
    setNoteDraft("");
    openDetail(detail.lead.id);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Leads {campaignId && <span className="chip ml-2 align-middle">campaign #{campaignId}</span>}</h1>
        <div className="text-sm text-zinc-500">{data?.total.toLocaleString() ?? "…"} leads</div>
      </div>

      <div className="card flex flex-wrap items-center gap-2 py-3">
        <input className="input w-56" placeholder="Search name, city, phone, owner…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}>
          <option value="">Any state</option>
          {US_STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="input" value={hasWebsite} onChange={(e) => { setHasWebsite(e.target.value); setPage(1); }}>
          <option value="">Website: any</option><option value="yes">Has real site</option><option value="no">No real site</option>
        </select>
        <select className="input" value={ownerFound} onChange={(e) => { setOwnerFound(e.target.value); setPage(1); }}>
          <option value="">Owner: any</option><option value="1">Owner found</option><option value="0">No owner</option>
        </select>
        <input className="input w-24" type="number" placeholder="Min score" value={minScore} onChange={(e) => { setMinScore(e.target.value); setPage(1); }} />
      </div>

      {selected.size > 0 && (
        <div className="card flex items-center gap-2 border-emerald-800 py-2">
          <span className="text-sm">{selected.size} selected</span>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <button key={k} className="btn py-1 text-xs" onClick={() => bulk({ status: k })}>→ {v}</button>
          ))}
          <button className="btn py-1 text-xs" onClick={() => { const a = prompt("Assign to (email):"); if (a !== null) bulk({ assignee: a }); }}>Assign…</button>
          <button className="btn py-1 text-xs" onClick={() => { const t = prompt("Add tag:"); if (t) bulk({ tags: [t] }); }}>Tag…</button>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead><tr className="border-b border-zinc-800">
            <th className="th w-8"><input type="checkbox" checked={!!data && data.rows.length > 0 && selected.size === data.rows.length} onChange={(e) => setSelected(e.target.checked ? new Set(data?.rows.map((r) => r.lead.id)) : new Set())} /></th>
            <th className="th">Score</th><th className="th">Business</th><th className="th">Location</th><th className="th">Website</th>
            <th className="th">Phone</th><th className="th">Owner</th><th className="th">Status</th><th className="th">Assignee</th>
          </tr></thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.lead.id} className="cursor-pointer border-b border-zinc-900 hover:bg-zinc-900/50" onClick={() => openDetail(r.lead.id)}>
                <td className="td" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(r.lead.id)} onChange={(e) => { const s = new Set(selected); if (e.target.checked) s.add(r.lead.id); else s.delete(r.lead.id); setSelected(s); }} />
                </td>
                <td className="td"><span className={`inline-block min-w-9 rounded-md border px-1.5 py-0.5 text-center text-xs font-bold ${scoreColor(r.lead.score)}`}>{r.lead.score ?? "—"}</span></td>
                <td className="td">
                  <div className="font-medium text-zinc-100">{r.business.name}
                    {r.dncSuppressed && <span className="chip ml-1.5 border-red-800 text-red-300">DNC list</span>}
                    {r.clientSuppressed && <span className="chip ml-1.5 border-purple-800 text-purple-300">client</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">{(r.lead.scoreReasons ?? []).slice(0, 2).map((c, i) => <span key={i} className="chip">{c.chip}</span>)}</div>
                </td>
                <td className="td text-zinc-400">{r.business.city}, {r.business.region}</td>
                <td className="td text-zinc-400">{CLASS_LABEL[r.business.websiteClass] ?? r.business.websiteClass}{r.lead.pagespeed && r.lead.pagespeed.mobileScore >= 0 ? ` · m${r.lead.pagespeed.mobileScore}` : ""}</td>
                <td className="td text-zinc-400">{r.business.phone ?? "—"}</td>
                <td className="td text-zinc-400">{r.lead.ownerName ?? "—"}</td>
                <td className="td"><span className={`chip ${STATUS_COLOR[r.lead.status]}`}>{STATUS_LABEL[r.lead.status]}</span></td>
                <td className="td text-zinc-400">{r.lead.assignee ?? "—"}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={9} className="td py-8 text-center text-zinc-500">No leads match.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <button className="btn py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
        <span className="text-zinc-500">page {page} / {totalPages}</span>
        <button className="btn py-1" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
      </div>

      {detail && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={() => setDetail(null)}>
          <div className="h-full w-[520px] overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">{detail.business.name}</h2>
                <div className="text-xs text-zinc-500">{detail.business.street} · {detail.business.city}, {detail.business.region} {detail.business.postal}</div>
              </div>
              <button className="btn py-1" onClick={() => setDetail(null)}>✕</button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className={`rounded-md border px-2 py-1 text-sm font-bold ${scoreColor(detail.lead.score)}`}>{detail.lead.score ?? "—"}</span>
              <div className="flex flex-wrap gap-1">{(detail.lead.scoreReasons ?? []).map((c, i) => <span key={i} className="chip">{c.chip}</span>)}</div>
            </div>

            <div className="mt-4 space-y-1.5 text-sm">
              <div><span className="text-zinc-500">Category:</span> {detail.business.taxonomyPrimary ?? "—"} · <span className="text-zinc-500">confidence</span> {detail.business.confidence ?? "—"} · {detail.business.operatingStatus}{detail.business.chain && <span className="chip ml-1.5">chain</span>}</div>
              <div><span className="text-zinc-500">Phone:</span> {detail.business.phone ?? "—"}</div>
              <div><span className="text-zinc-500">Website:</span> {detail.business.websiteRaw ? <a className="text-emerald-400 hover:underline" href={detail.business.websiteRaw} target="_blank" rel="noreferrer">{detail.business.websiteRaw}</a> : "—"} <span className="chip ml-1">{CLASS_LABEL[detail.business.websiteClass]}</span></div>
              {(detail.business.emails ?? []).length > 0 && <div><span className="text-zinc-500">Email:</span> {(detail.business.emails ?? []).join(", ")}</div>}
              {(detail.business.socials ?? []).length > 0 && <div><span className="text-zinc-500">Socials:</span> {(detail.business.socials ?? []).join(" · ")}</div>}
              <div><span className="text-zinc-500">Last verified:</span> {fmtDate(detail.lead.lastVerifiedAt)}</div>
            </div>

            {detail.lead.ownerName && (
              <div className="card mt-4 border-emerald-900">
                <div className="text-sm font-semibold">{detail.lead.ownerName} <span className="text-xs font-normal text-zinc-400">{detail.lead.ownerRole} · {detail.lead.ownerConfidence} confidence · via {detail.lead.ownerSource}</span></div>
                {detail.lead.ownerEvidence && <blockquote className="mt-2 border-l-2 border-emerald-700 pl-2 text-xs text-zinc-400">“{detail.lead.ownerEvidence}”</blockquote>}
              </div>
            )}

            <div className="mt-4">
              <div className="mb-1 text-xs font-semibold text-zinc-500">STATUS</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <button key={k} onClick={() => patchDetail({ status: k })}
                    className={`chip cursor-pointer ${detail.lead.status === k ? STATUS_COLOR[k] : "hover:bg-zinc-700"}`}>{v}</button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <label className="block"><span className="text-xs text-zinc-500">Assignee</span>
                <input className="input mt-1 w-full" defaultValue={detail.lead.assignee ?? ""} onBlur={(e) => patchDetail({ assignee: e.target.value })} /></label>
              <label className="block"><span className="text-xs text-zinc-500">Tags (comma-sep)</span>
                <input className="input mt-1 w-full" defaultValue={(detail.lead.tags ?? []).join(", ")} onBlur={(e) => patchDetail({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} /></label>
            </div>

            <div className="mt-4">
              <div className="mb-1 text-xs font-semibold text-zinc-500">CAMPAIGNS</div>
              <ul className="space-y-0.5 text-xs text-zinc-400">
                {detail.campaigns.map((c) => <li key={c.id}>#{c.id} {c.name} · added {fmtDate(c.addedAt)}</li>)}
                {detail.campaigns.length === 0 && <li className="text-zinc-600">Not in any campaign.</li>}
              </ul>
            </div>

            <div className="mt-4">
              <div className="mb-1 text-xs font-semibold text-zinc-500">NOTES</div>
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="Add a note…" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} />
                <button className="btn" onClick={addNote}>Add</button>
              </div>
              <ul className="mt-2 space-y-2">
                {detail.notes.map((n) => (
                  <li key={n.id} className="rounded-md bg-zinc-900 p-2 text-xs"><div className="text-zinc-500">{n.author} · {fmtDate(n.createdAt)}</div><div className="mt-0.5 text-zinc-300">{n.body}</div></li>
                ))}
              </ul>
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-zinc-500">Raw source data & website check</summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-900 p-2 text-[10px] text-zinc-400">{JSON.stringify({ sources: detail.business.sources, websiteCheck: detail.lead.websiteCheck }, null, 2)}</pre>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="text-zinc-500">Loading…</div>}>
      <LeadsWorkspace />
    </Suspense>
  );
}
