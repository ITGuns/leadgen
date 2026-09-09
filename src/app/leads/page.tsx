"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, CLASS_LABEL, fmtDate, STATUS_LABEL, US_STATES } from "@/lib/format";
import { EmptyState, ErrorState, PageHeader, ScorePill, Skeleton, StatusChip } from "@/components/ui";

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

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** External links from scraped data are often scheme-less — make them clickable. */
function websiteHref(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const SKELETON_ROWS = 8;
const BULK_TAG_CONCURRENCY = 6;

function DefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 py-1.5 text-sm last:border-b-0">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className="min-w-0 text-right text-zinc-200 break-words">{children}</span>
    </div>
  );
}

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
  const [listError, setListError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [mutError, setMutError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  const campaignId = search.get("campaignId") ?? "";

  // Sequence guards: only the latest in-flight request may write state.
  const listSeq = useRef(0);
  const detailIdRef = useRef<number | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    const seq = ++listSeq.current;
    setFetching(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (status) p.append("status", status);
      if (state) p.append("state", state);
      if (hasWebsite) p.set("hasWebsite", hasWebsite);
      if (minScore) p.set("minScore", minScore);
      if (ownerFound) p.set("ownerFound", ownerFound);
      if (campaignId) p.set("campaignId", campaignId);
      p.set("page", String(page));
      const resp = await api<ListResp>(`/api/leads?${p}`);
      if (seq !== listSeq.current) return; // stale response — a newer request superseded this one
      setData(resp);
      setListError(null);
    } catch (e) {
      if (seq !== listSeq.current) return;
      setListError(errMsg(e, "Failed to load leads."));
    } finally {
      if (seq === listSeq.current) setFetching(false);
    }
  }, [q, status, state, hasWebsite, minScore, ownerFound, campaignId, page]);

  // Debounced fetch; also clears selection whenever the visible set changes (filters or page).
  useEffect(() => {
    setSelected(new Set());
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  const openDetail = useCallback(async (id: number) => {
    detailIdRef.current = id;
    setDetailId(id);
    setDetail((d) => (d && d.lead.id === id ? d : null)); // drop stale detail when switching leads
    setDetailError(null);
    setMutError(null);
    setDetailLoading(true);
    try {
      const d = await api<Detail>(`/api/leads/${id}`);
      if (detailIdRef.current !== id) return;
      setDetail(d);
    } catch (e) {
      if (detailIdRef.current !== id) return;
      setDetailError(errMsg(e, "Failed to load lead."));
    } finally {
      if (detailIdRef.current === id) setDetailLoading(false);
    }
  }, []);

  const closeDrawer = useCallback(() => {
    detailIdRef.current = null;
    setDetailId(null);
    setDetail(null);
    setDetailError(null);
    setMutError(null);
    setNoteDraft("");
  }, []);

  useEffect(() => {
    if (detailId == null) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailId, closeDrawer]);

  async function patchDetail(patch: Record<string, unknown>) {
    if (!detail) return;
    const id = detail.lead.id;
    setMutError(null);
    try {
      const d = await api<Detail>(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (detailIdRef.current === id) setDetail(d);
      refresh();
    } catch (e) {
      if (detailIdRef.current === id) setMutError(errMsg(e, "Update failed — nothing was saved."));
    }
  }

  async function addNote() {
    if (!detail || !noteDraft.trim() || noteBusy) return;
    const id = detail.lead.id;
    setNoteBusy(true);
    setMutError(null);
    try {
      await api(`/api/leads/${id}/notes`, { method: "POST", body: JSON.stringify({ body: noteDraft }) });
      const d = await api<Detail>(`/api/leads/${id}`);
      if (detailIdRef.current === id) {
        setNoteDraft("");
        setDetail(d);
      }
    } catch (e) {
      if (detailIdRef.current === id) setMutError(errMsg(e, "Failed to add note."));
    } finally {
      if (detailIdRef.current === id) setNoteBusy(false);
    }
  }

  async function bulk(patch: Record<string, unknown>) {
    if (!selected.size || bulkBusy) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      await api("/api/leads/bulk", { method: "POST", body: JSON.stringify({ ids: [...selected], patch }) });
      setSelected(new Set());
      await refresh();
    } catch (e) {
      setBulkError(errMsg(e, "Bulk update failed."));
    } finally {
      setBulkBusy(false);
    }
  }

  /** Appends one tag per lead by merging with each row's existing tags — the bulk
   *  endpoint replaces the whole tags array, which would wipe existing tags. */
  async function bulkAddTag() {
    if (!selected.size || bulkBusy) return;
    const t = window.prompt("Tag to add to selected leads:")?.trim();
    if (!t) return;
    const rows = (data?.rows ?? []).filter((r) => selected.has(r.lead.id));
    setBulkBusy(true);
    setBulkError(null);
    try {
      for (let i = 0; i < rows.length; i += BULK_TAG_CONCURRENCY) {
        await Promise.all(
          rows.slice(i, i + BULK_TAG_CONCURRENCY).map((r) =>
            api(`/api/leads/${r.lead.id}`, {
              method: "PATCH",
              body: JSON.stringify({ tags: Array.from(new Set([...(r.lead.tags ?? []), t])) }),
            }),
          ),
        );
      }
      setSelected(new Set());
      await refresh();
    } catch (e) {
      setBulkError(errMsg(e, "Tagging failed — some leads may not have been tagged."));
    } finally {
      setBulkBusy(false);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const visibleIds = data?.rows.map((r) => r.lead.id) ?? [];
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const hasFilters = Boolean(q || status || state || hasWebsite || minScore || ownerFound || campaignId);
  const initialLoading = !data && !listError;

  function clearFilters() {
    setQ(""); setStatus(""); setState(""); setHasWebsite(""); setMinScore(""); setOwnerFound("");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        sub={data ? `${data.total.toLocaleString()} lead${data.total === 1 ? "" : "s"}${hasFilters ? " matching filters" : ""}` : "Scored businesses ready to work"}
        actions={campaignId ? (
          <span className="chip chip-info">Campaign #{campaignId}</span>
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input w-full sm:w-64"
          placeholder="Search name, city, phone, owner…"
          aria-label="Search leads"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <select className="input" aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" aria-label="Filter by state" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}>
          <option value="">Any state</option>
          {US_STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="input" aria-label="Filter by website presence" value={hasWebsite} onChange={(e) => { setHasWebsite(e.target.value); setPage(1); }}>
          <option value="">Website: any</option><option value="yes">Has real site</option><option value="no">No real site</option>
        </select>
        <select className="input" aria-label="Filter by owner found" value={ownerFound} onChange={(e) => { setOwnerFound(e.target.value); setPage(1); }}>
          <option value="">Owner: any</option><option value="1">Owner found</option><option value="0">No owner</option>
        </select>
        <input
          className="input w-28"
          type="number"
          min={0}
          max={100}
          placeholder="Min score"
          aria-label="Minimum score"
          value={minScore}
          onChange={(e) => { setMinScore(e.target.value); setPage(1); }}
        />
        {hasFilters && !campaignId && (
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      {listError && (
        <ErrorState message={data ? `Refresh failed — showing last loaded results. ${listError}` : listError} onRetry={refresh} />
      )}

      {listError && !data ? null : data && data.rows.length === 0 && !hasFilters ? (
        <div className="table-wrap">
          <EmptyState
            title="No leads yet"
            hint="Leads appear here once a campaign has discovered and scored businesses. Start by creating a campaign."
            action={<Link href="/campaigns" className="btn btn-primary">Go to campaigns</Link>}
          />
        </div>
      ) : data && data.rows.length === 0 ? (
        <div className="table-wrap">
          <EmptyState
            title="No leads match these filters"
            hint={campaignId ? "This campaign has no leads matching the current filters." : "Try loosening or clearing the filters above."}
            action={!campaignId ? <button className="btn" onClick={clearFilters}>Clear filters</button> : undefined}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="th w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all visible leads"
                    checked={allVisibleSelected}
                    onChange={(e) => {
                      const s = new Set(selected);
                      if (e.target.checked) visibleIds.forEach((id) => s.add(id));
                      else visibleIds.forEach((id) => s.delete(id));
                      setSelected(s);
                    }}
                  />
                </th>
                <th className="th">Score</th><th className="th">Business</th><th className="th">Location</th><th className="th">Website</th>
                <th className="th">Phone</th><th className="th">Owner</th><th className="th">Status</th><th className="th">Assignee</th>
              </tr>
            </thead>
            <tbody>
              {initialLoading &&
                Array.from({ length: SKELETON_ROWS }, (_, i) => (
                  <tr key={`sk-${i}`} aria-hidden>
                    <td className="td"><Skeleton className="h-4 w-4" /></td>
                    <td className="td"><Skeleton className="h-6 w-11" /></td>
                    <td className="td"><Skeleton className="h-4 w-40" /></td>
                    <td className="td"><Skeleton className="h-4 w-24" /></td>
                    <td className="td"><Skeleton className="h-4 w-20" /></td>
                    <td className="td"><Skeleton className="h-4 w-24" /></td>
                    <td className="td"><Skeleton className="h-4 w-20" /></td>
                    <td className="td"><Skeleton className="h-5 w-16" /></td>
                    <td className="td"><Skeleton className="h-4 w-16" /></td>
                  </tr>
                ))}
              {data?.rows.map((r) => (
                <tr key={r.lead.id} className="row-hover row-click" onClick={() => openDetail(r.lead.id)}>
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.business.name}`}
                      checked={selected.has(r.lead.id)}
                      onChange={(e) => {
                        const s = new Set(selected);
                        if (e.target.checked) s.add(r.lead.id); else s.delete(r.lead.id);
                        setSelected(s);
                      }}
                    />
                  </td>
                  <td className="td"><ScorePill score={r.lead.score} /></td>
                  <td className="td">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        className="cursor-pointer text-left font-medium text-zinc-100 outline-none hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                        onClick={(e) => { e.stopPropagation(); openDetail(r.lead.id); }}
                      >
                        {r.business.name}
                      </button>
                      {r.dncSuppressed && <span className="chip chip-danger">DNC list</span>}
                      {r.clientSuppressed && <span className="chip chip-warn">Client list</span>}
                    </div>
                    {(r.lead.scoreReasons ?? []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(r.lead.scoreReasons ?? []).slice(0, 2).map((c, i) => <span key={i} className="chip chip-muted">{c.chip}</span>)}
                      </div>
                    )}
                  </td>
                  <td className="td whitespace-nowrap text-zinc-400">{[r.business.city, r.business.region].filter(Boolean).join(", ") || "—"}</td>
                  <td className="td whitespace-nowrap text-zinc-400">
                    {CLASS_LABEL[r.business.websiteClass] ?? r.business.websiteClass}
                    {r.lead.pagespeed && r.lead.pagespeed.mobileScore >= 0 ? <span className="tabular-nums"> · m{r.lead.pagespeed.mobileScore}</span> : null}
                  </td>
                  <td className="td whitespace-nowrap text-zinc-400 tabular-nums">{r.business.phone ?? "—"}</td>
                  <td className="td whitespace-nowrap text-zinc-400">{r.lead.ownerName ?? "—"}</td>
                  <td className="td"><StatusChip status={r.lead.status} /></td>
                  <td className="td text-zinc-400">{r.lead.assignee ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
          <button className="btn btn-sm" disabled={page <= 1 || fetching} onClick={() => setPage(page - 1)}>← Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button className="btn btn-sm" disabled={page >= totalPages || fetching} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-5 left-1/2 z-30 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2">
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-line-strong bg-raised/95 px-4 py-2.5 shadow-2xl backdrop-blur">
            <span className="text-sm font-medium text-zinc-100">{selected.size} selected</span>
            <span className="hidden h-4 w-px bg-line-strong sm:block" aria-hidden />
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <button key={k} className="btn btn-sm" disabled={bulkBusy} onClick={() => bulk({ status: k })}>→ {v}</button>
            ))}
            <button
              className="btn btn-sm"
              disabled={bulkBusy}
              onClick={() => { const a = window.prompt("Assign to (email):"); if (a !== null) bulk({ assignee: a }); }}
            >
              Assign…
            </button>
            <button className="btn btn-sm" disabled={bulkBusy} onClick={bulkAddTag}>Add tag…</button>
            <button className="btn btn-ghost btn-sm" disabled={bulkBusy} aria-label="Clear selection" onClick={() => { setSelected(new Set()); setBulkError(null); }}>✕</button>
            {bulkBusy && <span className="text-xs text-zinc-500">Working…</span>}
            {bulkError && <span className="w-full text-center text-xs text-red-300" role="alert">{bulkError}</span>}
          </div>
        </div>
      )}

      {detailId != null && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-[2px]" onClick={closeDrawer}>
          <div
            role="dialog"
            aria-modal="true"
            aria-busy={detailLoading}
            aria-label={detail?.business.name ?? "Lead detail"}
            className="h-full w-full max-w-[540px] overflow-y-auto border-l border-line bg-panel p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {detail ? (
                  <>
                    <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-white">
                      {detail.business.name}
                      {detail.dncSuppressed && <span className="chip chip-danger">DNC list</span>}
                      {detail.clientSuppressed && <span className="chip chip-warn">Client list</span>}
                    </h2>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {[detail.business.street, [detail.business.city, detail.business.region].filter(Boolean).join(", "), detail.business.postal].filter(Boolean).join(" · ") || "No address on record"}
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                )}
              </div>
              <button ref={closeBtnRef} className="btn btn-ghost btn-sm shrink-0" aria-label="Close lead detail" onClick={closeDrawer}>✕</button>
            </div>

            {mutError && (
              <div className="alert alert-error mt-4" role="alert">{mutError}</div>
            )}

            {detailError ? (
              <div className="mt-6">
                <ErrorState message={detailError} onRetry={() => openDetail(detailId)} />
              </div>
            ) : !detail ? (
              <div className="mt-6 space-y-3" aria-busy>
                <Skeleton className="h-7 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (
              <div className="mt-4 space-y-6" key={detail.lead.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <ScorePill score={detail.lead.score} />
                  {(detail.lead.scoreReasons ?? []).map((c, i) => <span key={i} className="chip chip-muted">{c.chip}</span>)}
                </div>

                <section>
                  <div className="section-label mb-2">Details</div>
                  <DefRow label="Category">{detail.business.taxonomyPrimary ?? "—"}</DefRow>
                  <DefRow label="Confidence">{detail.business.confidence ?? "—"}</DefRow>
                  <DefRow label="Operating status">
                    {detail.business.operatingStatus ?? "—"}
                    {detail.business.chain && <span className="chip chip-muted ml-1.5">chain</span>}
                  </DefRow>
                  <DefRow label="Phone">{detail.business.phone ?? "—"}</DefRow>
                  <DefRow label="Website">
                    {detail.business.websiteRaw ? (
                      <a className="text-emerald-400 hover:underline" href={websiteHref(detail.business.websiteRaw)} target="_blank" rel="noreferrer">
                        {detail.business.websiteRaw}
                      </a>
                    ) : "—"}
                    <span className="chip chip-muted ml-1.5">{CLASS_LABEL[detail.business.websiteClass] ?? detail.business.websiteClass}</span>
                  </DefRow>
                  {(detail.business.emails ?? []).length > 0 && (
                    <DefRow label="Email">{(detail.business.emails ?? []).join(", ")}</DefRow>
                  )}
                  {(detail.business.socials ?? []).length > 0 && (
                    <DefRow label="Socials">{(detail.business.socials ?? []).join(" · ")}</DefRow>
                  )}
                  <DefRow label="Last verified">{fmtDate(detail.lead.lastVerifiedAt)}</DefRow>
                </section>

                {detail.lead.ownerName && (
                  <section className="rounded-xl border border-emerald-900/70 bg-emerald-950/20 p-4">
                    <div className="section-label mb-1.5 text-emerald-500">Owner</div>
                    <div className="text-sm font-semibold text-zinc-100">
                      {detail.lead.ownerName}
                      <span className="ml-2 text-xs font-normal text-zinc-400">
                        {[detail.lead.ownerRole, detail.lead.ownerConfidence && `${detail.lead.ownerConfidence} confidence`, detail.lead.ownerSource && `via ${detail.lead.ownerSource}`].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    {detail.lead.ownerEvidence && (
                      <blockquote className="mt-2 border-l-2 border-emerald-700 pl-2.5 text-xs leading-5 text-zinc-400">
                        “{detail.lead.ownerEvidence}”
                      </blockquote>
                    )}
                  </section>
                )}

                <section>
                  <div className="section-label mb-2">Status</div>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lead status">
                    {Object.entries(STATUS_LABEL).map(([k, v]) => (
                      <button
                        key={k}
                        aria-pressed={detail.lead.status === k}
                        onClick={() => patchDetail({ status: k })}
                        className={detail.lead.status === k ? "cursor-default" : "cursor-pointer rounded-full opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"}
                      >
                        {detail.lead.status === k ? <StatusChip status={k} /> : <span className="chip hover:border-zinc-600 hover:bg-zinc-800">{v}</span>}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="section-label">Assignee</span>
                    <input
                      className="input mt-1.5 w-full"
                      placeholder="email@…"
                      defaultValue={detail.lead.assignee ?? ""}
                      onBlur={(e) => { if (e.target.value !== (detail.lead.assignee ?? "")) patchDetail({ assignee: e.target.value }); }}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="section-label">Tags (comma-separated)</span>
                    <input
                      className="input mt-1.5 w-full"
                      placeholder="hot, callback…"
                      defaultValue={(detail.lead.tags ?? []).join(", ")}
                      onBlur={(e) => {
                        const tags = e.target.value.split(",").map((t) => t.trim()).filter(Boolean);
                        if (tags.join("\u0000") !== (detail.lead.tags ?? []).join("\u0000")) patchDetail({ tags });
                      }}
                    />
                  </label>
                </section>

                <section>
                  <div className="section-label mb-2">Campaigns</div>
                  <ul className="space-y-1.5 text-xs text-zinc-400">
                    {detail.campaigns.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-2">
                        <span className="text-zinc-300">#{c.id} {c.name}</span>
                        <StatusChip status={c.status} />
                        <span className="text-zinc-600">added {fmtDate(c.addedAt)}</span>
                      </li>
                    ))}
                    {detail.campaigns.length === 0 && <li className="text-zinc-600">Not in any campaign.</li>}
                  </ul>
                </section>

                <section>
                  <div className="section-label mb-2">Notes</div>
                  <div className="flex gap-2">
                    <input
                      className="input min-w-0 flex-1"
                      placeholder="Add a note…"
                      aria-label="New note"
                      value={noteDraft}
                      disabled={noteBusy}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addNote()}
                    />
                    <button className="btn" disabled={noteBusy || !noteDraft.trim()} onClick={addNote}>
                      {noteBusy ? "Adding…" : "Add"}
                    </button>
                  </div>
                  <ul className="mt-2.5 space-y-2">
                    {detail.notes.map((n) => (
                      <li key={n.id} className="rounded-lg border border-line bg-raised/60 p-2.5 text-xs">
                        <div className="text-zinc-500">{n.author} · {fmtDate(n.createdAt)}</div>
                        <div className="mt-1 whitespace-pre-wrap text-zinc-300">{n.body}</div>
                      </li>
                    ))}
                  </ul>
                </section>

                <details>
                  <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">Raw source data & website check</summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-raised/60 p-2.5 text-[10px] leading-4 text-zinc-400">
                    {JSON.stringify({ sources: detail.business.sources, websiteCheck: detail.lead.websiteCheck }, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6" aria-busy>
          <div className="space-y-2">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-28" />
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      }
    >
      <LeadsWorkspace />
    </Suspense>
  );
}
