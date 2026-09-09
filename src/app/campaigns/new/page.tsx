"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, fmtUSD, US_STATES } from "@/lib/format";
import { PageHeader, Skeleton } from "@/components/ui";

type Proposal = { codes: string[]; source: string; autoApply: boolean };
type EstimateResp = {
  estimate: { plannedRecords: number; aiUSD: number; topUpUSD: number; totalUSD: number; citiesFannedOut?: number };
  topUpAvailable: boolean;
  aiAvailable: boolean;
  aiRateUSD: number;
  fitsCap: boolean;
};

export default function NewCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [catalog, setCatalog] = useState<Record<string, string>>({});
  const [confirmedNiches, setConfirmedNiches] = useState(99);
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [addCode, setAddCode] = useState("");
  const [states, setStates] = useState<string[]>([]);
  const [cityList, setCityList] = useState("");
  const [hasWebsite, setHasWebsite] = useState<"any" | "yes" | "no">("any");
  const [minConfidence, setMinConfidence] = useState(0.6);
  const [hasPhone, setHasPhone] = useState(false);
  const [operatingOnly, setOperatingOnly] = useState(true);
  const [excludeChains, setExcludeChains] = useState(true);
  const [includeContactless, setIncludeContactless] = useState(false);
  const [maxRecords, setMaxRecords] = useState(5000);
  const [budgetCap, setBudgetCap] = useState(0);
  const [smoke, setSmoke] = useState(false);
  const [ai, setAi] = useState(false);
  const [topUpEnabled, setTopUpEnabled] = useState(false);
  const [topUpCap, setTopUpCap] = useState(0);
  const [estimate, setEstimate] = useState<EstimateResp | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState("");
  const [proposing, setProposing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Set when the campaign was created but the follow-up run action failed — the id must not be lost. */
  const [createdId, setCreatedId] = useState<number | null>(null);
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const estimateSeq = useRef(0);

  const input = useMemo(
    () => ({
      name: name || `${niche || "campaign"} · ${states.join("+") || "?"}`,
      niche,
      confirmedTaxonomy: codes,
      states,
      cityList: cityList.trim() ? cityList.split(/[\n,]+/).map((c) => c.trim()).filter(Boolean) : null,
      filters: {
        hasWebsite,
        minConfidence,
        hasPhone,
        operatingOnly,
        sources: ["overture", "fsq", "outscraper"] as ("overture" | "fsq" | "outscraper")[],
        excludeChains,
        includeContactless,
      },
      caps: { maxRecords, budgetCapUSD: budgetCap },
      smoke,
      aiOwnerExtraction: ai,
      topUp: topUpEnabled ? { enabled: true, provider: "outscraper" as const, capUSD: topUpCap } : null,
    }),
    [name, niche, codes, states, cityList, hasWebsite, minConfidence, hasPhone, operatingOnly, excludeChains, includeContactless, maxRecords, budgetCap, smoke, ai, topUpEnabled, topUpCap],
  );
  // Always-current payload for the debounced estimate call — lets the effect below
  // exclude `name` from its deps (typing a name must not re-fire the estimate).
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input; // after every render — the 350ms debounce below always reads fresh
  }, [input]);

  useEffect(() => {
    if (estimateTimer.current) clearTimeout(estimateTimer.current);
    if (!codes.length || !states.length) {
      estimateSeq.current++; // invalidate any in-flight response
      setEstimate(null);
      setEstimateError("");
      setEstimating(false);
      return;
    }
    setEstimating(true);
    estimateTimer.current = setTimeout(async () => {
      const seq = ++estimateSeq.current;
      try {
        const res = await api<EstimateResp>("/api/campaigns/estimate", { method: "POST", body: JSON.stringify(inputRef.current) });
        if (seq !== estimateSeq.current) return; // a newer request superseded this one
        setEstimate(res);
        setEstimateError("");
      } catch (e) {
        if (seq !== estimateSeq.current) return;
        setEstimate(null);
        setEstimateError((e as Error).message);
      } finally {
        if (seq === estimateSeq.current) setEstimating(false);
      }
    }, 350);
    return () => {
      if (estimateTimer.current) clearTimeout(estimateTimer.current);
    };
    // `name` is intentionally excluded: it is sent (via inputRef) but never triggers a re-estimate.
     
  }, [niche, codes, states, cityList, hasWebsite, minConfidence, hasPhone, operatingOnly, excludeChains, includeContactless, maxRecords, budgetCap, smoke, ai, topUpEnabled, topUpCap]);

  /** Editing the niche invalidates everything derived from it — proposal, codes, confirmation, estimate. */
  function onNicheChange(value: string) {
    setNiche(value);
    setProposal(null);
    setCodes([]);
    setCatalog({});
    setMappingConfirmed(false);
    setEstimate(null);
    setEstimateError("");
  }

  async function propose() {
    setError("");
    setCreatedId(null);
    setProposing(true);
    try {
      const res = await api<{ proposal: Proposal; aiCodes: string[]; catalog: Record<string, string>; confirmedNichesSoFar: number }>(
        "/api/taxonomy/propose",
        { method: "POST", body: JSON.stringify({ niche, useAI: ai }) },
      );
      setProposal(res.proposal);
      setCodes([...new Set([...res.proposal.codes, ...res.aiCodes])]);
      setCatalog(res.catalog);
      setConfirmedNiches(res.confirmedNichesSoFar);
      setMappingConfirmed(res.proposal.autoApply);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProposing(false);
    }
  }

  /** Confirms the niche→codes mapping. Returns false (and surfaces the error) on failure. */
  async function confirmMapping(): Promise<boolean> {
    setError("");
    setConfirming(true);
    try {
      await api("/api/taxonomy/confirm", { method: "POST", body: JSON.stringify({ niche, codes }) });
      setMappingConfirmed(true);
      return true;
    } catch (e) {
      setError(`Could not confirm the category mapping: ${(e as Error).message}`);
      return false;
    } finally {
      setConfirming(false);
    }
  }

  async function save(run: boolean) {
    setBusy(true);
    setError("");
    setCreatedId(null);
    try {
      if (!mappingConfirmed) {
        const ok = await confirmMapping(); // §3.1 — mapping is confirmed before anything runs
        if (!ok) {
          setBusy(false);
          return;
        }
      }
      const { campaign } = await api<{ campaign: { id: number } }>("/api/campaigns", { method: "POST", body: JSON.stringify(input) });
      if (run) {
        try {
          await api(`/api/campaigns/${campaign.id}/actions`, { method: "POST", body: JSON.stringify({ action: "run" }) });
        } catch (e) {
          // The campaign exists — never lose its id. Surface the failure with a direct link.
          setCreatedId(campaign.id);
          setError(`Campaign was created as a draft, but starting the run failed: ${(e as Error).message}`);
          setBusy(false);
          return;
        }
      }
      router.push(`/campaigns/${campaign.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const canRun = codes.length > 0 && states.length > 0 && (estimate?.fitsCap ?? false);
  const needsExplicitConfirm = !mappingConfirmed;

  return (
    <div className="space-y-6">
      <PageHeader
        title="New campaign"
        sub="Map a niche to categories, pick geography, set caps — then estimate and run."
        actions={<Link href="/campaigns" className="btn btn-ghost">Cancel</Link>}
      />

      {error && (
        <div className="alert alert-error" role="alert">
          <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          <div className="flex-1">{error}</div>
          {createdId != null && (
            <Link href={`/campaigns/${createdId}`} className="btn btn-sm shrink-0">Open campaign</Link>
          )}
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        {/* ---------- left column: the form ---------- */}
        <div className="min-w-0 space-y-6">
          <section className="card card-tight">
            <div className="card-header">
              <div>
                <h2 className="card-title">Niche &amp; categories</h2>
                <p className="card-sub">Propose taxonomy codes from the niche, then confirm the mapping.</p>
              </div>
              <span className="section-label">Step 1</span>
            </div>
            <div className="space-y-3 p-5">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="input flex-1"
                  aria-label="Niche"
                  placeholder='Niche, e.g. "roofers"'
                  value={niche}
                  onChange={(e) => onNicheChange(e.target.value)}
                />
                <button type="button" className="btn shrink-0" onClick={propose} disabled={proposing || niche.trim().length < 2}>
                  {proposing ? "Proposing…" : "Propose categories"}
                </button>
              </div>
              <input
                className="input w-full"
                aria-label="Campaign name"
                placeholder="Campaign name (optional — auto-named from niche + states)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {proposal && (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-500">
                    {proposal.autoApply
                      ? "Previously confirmed mapping auto-applied — edit if needed."
                      : `Proposed from ${proposal.source}${confirmedNiches < 3 ? " · early niche: review carefully before confirming" : ""}`}
                  </p>
                  {codes.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {codes.map((c) => (
                        <span key={c} className={`chip ${mappingConfirmed ? "chip-accent" : ""}`}>
                          {catalog[c] ?? c}
                          <button
                            type="button"
                            className="ml-1 cursor-pointer text-current opacity-60 hover:opacity-100"
                            aria-label={`Remove ${catalog[c] ?? c}`}
                            onClick={() => { setCodes(codes.filter((x) => x !== c)); setMappingConfirmed(false); }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500">No categories yet — add at least one below.</p>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      list="catalog"
                      className="input flex-1"
                      aria-label="Add category"
                      placeholder="Add category…"
                      value={addCode}
                      onChange={(e) => setAddCode(e.target.value)}
                    />
                    <datalist id="catalog">
                      {Object.entries(catalog).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </datalist>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => { if (addCode && !codes.includes(addCode)) { setCodes([...codes, addCode]); setMappingConfirmed(false); } setAddCode(""); }}
                      >
                        Add
                      </button>
                      {needsExplicitConfirm && codes.length > 0 && (
                        <button type="button" className="btn" onClick={confirmMapping} disabled={confirming}>
                          {confirming ? "Confirming…" : "Confirm mapping"}
                        </button>
                      )}
                      {mappingConfirmed && <span className="chip chip-accent">✓ Confirmed</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="card card-tight">
            <div className="card-header">
              <div>
                <h2 className="card-title">Geography</h2>
                <p className="card-sub">{states.length > 0 ? `${states.length} state${states.length === 1 ? "" : "s"} selected` : "Pick at least one state."}</p>
              </div>
              <div className="flex items-center gap-2">
                {states.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStates([])}>Clear</button>
                )}
                <span className="section-label">Step 2</span>
              </div>
            </div>
            <div className="space-y-3 p-5">
              <div role="group" aria-label="Target states" className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5">
                {US_STATES.map((s) => {
                  const on = states.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setStates(on ? states.filter((x) => x !== s) : [...states, s])}
                      className={`h-10 min-w-10 rounded-lg border text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
                        on
                          ? "border-emerald-600/70 bg-emerald-500/15 text-emerald-300"
                          : "border-line bg-raised text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="city-list" className="block text-xs font-medium text-zinc-400">
                  Limit to specific cities or 5-digit ZIPs <span className="text-zinc-600">(optional — one per line or comma-separated)</span>
                </label>
                <textarea
                  id="city-list"
                  className="input h-20 w-full"
                  placeholder={"Austin\nDallas\n78701"}
                  value={cityList}
                  onChange={(e) => setCityList(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="card card-tight">
            <div className="card-header">
              <div>
                <h2 className="card-title">Filters</h2>
                <p className="card-sub">Narrow to businesses worth calling.</p>
              </div>
              <span className="section-label">Step 3</span>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <label className="flex items-center justify-between gap-2">
                  <span>Has website</span>
                  <select className="input" value={hasWebsite} onChange={(e) => setHasWebsite(e.target.value as "any" | "yes" | "no")}>
                    <option value="any">Any</option>
                    <option value="yes">Yes (real site)</option>
                    <option value="no">No real website</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>Min confidence</span>
                  <input type="number" min={0} max={1} step={0.05} className="input w-24 text-right tabular-nums" value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))} />
                </label>
                <label className="flex min-h-10 items-center gap-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={hasPhone} onChange={(e) => setHasPhone(e.target.checked)} />
                  <span>Must have phone</span>
                </label>
                <label className="flex min-h-10 items-center gap-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={operatingOnly} onChange={(e) => setOperatingOnly(e.target.checked)} />
                  <span>Exclude confirmed-closed</span>
                </label>
                <label className="flex min-h-10 items-center gap-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={excludeChains} onChange={(e) => setExcludeChains(e.target.checked)} />
                  <span>Exclude national chains</span>
                </label>
                <label className="flex min-h-10 items-center gap-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={includeContactless} onChange={(e) => setIncludeContactless(e.target.checked)} />
                  <span>
                    Include contactless records <span className="text-xs text-zinc-500">(usually noise)</span>
                  </span>
                </label>
              </div>
              <p className="text-[11px] leading-4 text-zinc-500">
                No ratings filter exists — the open data carries no ratings or review counts; confidence + verified phone + verified website stand in for &ldquo;real business&rdquo;.
              </p>
            </div>
          </section>

          <section className="card card-tight">
            <div className="card-header">
              <div>
                <h2 className="card-title">Caps, enrichment &amp; top-up</h2>
                <p className="card-sub">Hard limits are enforced before every billable call.</p>
              </div>
              <span className="section-label">Step 4</span>
            </div>
            <div className="grid gap-3 p-5 text-sm sm:grid-cols-2">
              <label className="flex items-center justify-between gap-2">
                <span>Max records</span>
                <input type="number" min={1} className="input w-28 text-right tabular-nums" value={maxRecords} onChange={(e) => setMaxRecords(Number(e.target.value))} />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>Hard budget cap (USD)</span>
                <input type="number" min={0} step={0.5} className="input w-28 text-right tabular-nums" value={budgetCap} onChange={(e) => setBudgetCap(Number(e.target.value))} />
              </label>
              <label className="flex min-h-10 items-center gap-2.5">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={smoke} onChange={(e) => setSmoke(e.target.checked)} />
                <span>Smoke test — first 200 records only</span>
              </label>
              <label className="flex min-h-10 items-center gap-2.5">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={ai} onChange={(e) => setAi(e.target.checked)} disabled={estimate ? !estimate.aiAvailable : false} />
                <span>
                  Haiku owner extraction{" "}
                  {estimate && !estimate.aiAvailable
                    ? <span className="text-xs text-zinc-500">(no key)</span>
                    : <span className="text-xs text-zinc-500">(~{fmtUSD(estimate?.aiRateUSD ?? 0.001)}/site)</span>}
                </span>
              </label>
              <label className="flex min-h-10 items-center gap-2.5">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={topUpEnabled} onChange={(e) => setTopUpEnabled(e.target.checked)} disabled={estimate ? !estimate.topUpAvailable : false} />
                <span>
                  Paid coverage top-up (Outscraper) {estimate && !estimate.topUpAvailable && <span className="text-xs text-zinc-500">(no key)</span>}
                </span>
              </label>
              {topUpEnabled && (
                <label className="flex items-center justify-between gap-2">
                  <span>Top-up cap (USD)</span>
                  <input type="number" min={0} step={0.5} className="input w-28 text-right tabular-nums" value={topUpCap} onChange={(e) => setTopUpCap(Number(e.target.value))} />
                </label>
              )}
            </div>
          </section>
        </div>

        {/* ---------- right column: sticky estimate + actions ---------- */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-8">
          <div className="card card-tight">
            <div className="card-header">
              <div>
                <h2 className="card-title">Estimate</h2>
                <p className="card-sub">
                  {codes.length > 0 || states.length > 0
                    ? `${codes.length} categor${codes.length === 1 ? "y" : "ies"} · ${states.length} state${states.length === 1 ? "" : "s"} · max ${maxRecords.toLocaleString()}`
                    : "Updates live as you build the campaign."}
                </p>
              </div>
              {estimating && estimate && <span className="dot animate-pulse bg-emerald-400" role="status" aria-label="Updating estimate" />}
            </div>
            <div className="space-y-4 p-5">
              {estimate ? (
                <div className={`space-y-4 ${estimating ? "opacity-60" : ""}`}>
                  <div>
                    <div className="stat-label">Planned records</div>
                    <div className="mt-1 text-3xl font-semibold tracking-tight text-white tabular-nums">
                      {estimate.estimate.plannedRecords.toLocaleString()}
                    </div>
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-zinc-500">Base (open data)</dt>
                      <dd className="font-medium text-zinc-200 tabular-nums">$0.00</dd>
                    </div>
                    {ai && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-zinc-500">Haiku extraction</dt>
                        <dd className="font-medium text-zinc-200 tabular-nums">{fmtUSD(estimate.estimate.aiUSD)}</dd>
                      </div>
                    )}
                    {topUpEnabled && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-zinc-500">
                          Top-up
                          {estimate.estimate.citiesFannedOut != null && (
                            <span className="text-zinc-600"> · {estimate.estimate.citiesFannedOut} cities</span>
                          )}
                        </dt>
                        <dd className="font-medium text-zinc-200 tabular-nums">{fmtUSD(estimate.estimate.topUpUSD)}</dd>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5">
                      <dt className="font-medium text-zinc-300">Total</dt>
                      <dd className={`font-semibold tabular-nums ${estimate.fitsCap ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtUSD(estimate.estimate.totalUSD)}
                        <span className="ml-1.5 text-xs font-normal text-zinc-500">
                          {estimate.fitsCap ? "≤" : ">"} cap {fmtUSD(budgetCap)}
                        </span>
                      </dd>
                    </div>
                  </dl>
                  {!estimate.fitsCap && (
                    <div className="alert alert-warn text-xs" role="alert">
                      Estimate exceeds the hard budget cap — raise the cap or reduce scope to enable the run.
                    </div>
                  )}
                </div>
              ) : estimating ? (
                <div className="space-y-3" aria-busy>
                  <Skeleton className="h-8 w-28" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Pick categories and at least one state to see planned records and cost.</p>
              )}
              {estimateError && (
                <div className="alert alert-error text-xs" role="alert">
                  <div className="flex-1">Estimate failed: {estimateError}</div>
                </div>
              )}
            </div>
            <div className="space-y-2 border-t border-line p-5">
              <button type="button" className="btn btn-primary w-full" disabled={busy || !canRun} onClick={() => save(true)}>
                {busy ? "Working…" : smoke ? "Run smoke test" : "Run campaign"}
              </button>
              <button type="button" className="btn w-full" disabled={busy || codes.length === 0 || states.length === 0} onClick={() => save(false)}>
                Save draft
              </button>
              {needsExplicitConfirm && codes.length > 0 && (
                <p className="text-[11px] leading-4 text-zinc-500">The category mapping is confirmed automatically when you save or run.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
