"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fmtUSD, US_STATES } from "@/lib/format";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const estimateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const refreshEstimate = useCallback(() => {
    if (!codes.length || !states.length) return setEstimate(null);
    if (estimateTimer.current) clearTimeout(estimateTimer.current);
    estimateTimer.current = setTimeout(async () => {
      try {
        setEstimate(await api<EstimateResp>("/api/campaigns/estimate", { method: "POST", body: JSON.stringify(input) }));
      } catch {
        setEstimate(null);
      }
    }, 350);
  }, [codes.length, states.length, input]);

  useEffect(() => {
    refreshEstimate();
  }, [refreshEstimate]);

  async function propose() {
    setError("");
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
    }
  }

  async function confirmMapping() {
    await api("/api/taxonomy/confirm", { method: "POST", body: JSON.stringify({ niche, codes }) });
    setMappingConfirmed(true);
  }

  async function save(run: boolean) {
    setBusy(true);
    setError("");
    try {
      if (!mappingConfirmed) await confirmMapping(); // §3.1 — mapping is confirmed before anything runs
      const { campaign } = await api<{ campaign: { id: number } }>("/api/campaigns", { method: "POST", body: JSON.stringify(input) });
      if (run) await api(`/api/campaigns/${campaign.id}/actions`, { method: "POST", body: JSON.stringify({ action: "run" }) });
      router.push(`/campaigns/${campaign.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const canRun = codes.length > 0 && states.length > 0 && (estimate?.fitsCap ?? false);
  const needsExplicitConfirm = !mappingConfirmed;

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-xl font-bold">New campaign</h1>
      {error && <div className="rounded-md border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</div>}

      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">1 · Niche → categories</h2>
        <div className="flex gap-2">
          <input className="input flex-1" placeholder='Niche, e.g. "roofers"' value={niche} onChange={(e) => { setNiche(e.target.value); setProposal(null); setMappingConfirmed(false); }} />
          <button className="btn" onClick={propose} disabled={niche.trim().length < 2}>Propose categories</button>
        </div>
        <input className="input w-full" placeholder="Campaign name (optional — auto-named from niche + states)" value={name} onChange={(e) => setName(e.target.value)} />
        {proposal && (
          <div className="space-y-2">
            <div className="text-xs text-zinc-500">
              {proposal.autoApply
                ? "Previously confirmed mapping auto-applied — edit if needed."
                : `Proposed from ${proposal.source}${confirmedNiches < 3 ? " · early niche: review carefully before confirming" : ""}`}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {codes.map((c) => (
                <span key={c} className="chip border-emerald-800 bg-emerald-950/60 text-emerald-200">
                  {catalog[c] ?? c}
                  <button className="ml-1.5 text-emerald-400 hover:text-white" onClick={() => { setCodes(codes.filter((x) => x !== c)); setMappingConfirmed(false); }}>×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input list="catalog" className="input flex-1" placeholder="Add category…" value={addCode} onChange={(e) => setAddCode(e.target.value)} />
              <datalist id="catalog">{Object.entries(catalog).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</datalist>
              <button className="btn" onClick={() => { if (addCode && !codes.includes(addCode)) { setCodes([...codes, addCode]); setMappingConfirmed(false); } setAddCode(""); }}>Add</button>
              {needsExplicitConfirm && codes.length > 0 && (
                <button className="btn btn-primary" onClick={confirmMapping}>Confirm mapping</button>
              )}
              {mappingConfirmed && <span className="chip border-emerald-800 text-emerald-300">✓ confirmed</span>}
            </div>
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">2 · Geography</h2>
        <div className="grid grid-cols-10 gap-1">
          {US_STATES.map((s) => (
            <button key={s} onClick={() => setStates(states.includes(s) ? states.filter((x) => x !== s) : [...states, s])}
              className={`rounded px-1.5 py-1 text-xs ${states.includes(s) ? "bg-emerald-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>
              {s}
            </button>
          ))}
        </div>
        <textarea className="input h-16 w-full" placeholder="Optional: limit to specific cities or 5-digit ZIPs (one per line or comma-separated)" value={cityList} onChange={(e) => setCityList(e.target.value)} />
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">3 · Filters</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex items-center justify-between gap-2">Has website
            <select className="input" value={hasWebsite} onChange={(e) => setHasWebsite(e.target.value as "any" | "yes" | "no")}>
              <option value="any">Any</option><option value="yes">Yes (real site)</option><option value="no">No real website</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">Min confidence
            <input type="number" min={0} max={1} step={0.05} className="input w-24" value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={hasPhone} onChange={(e) => setHasPhone(e.target.checked)} /> Must have phone</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={operatingOnly} onChange={(e) => setOperatingOnly(e.target.checked)} /> Exclude confirmed-closed</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={excludeChains} onChange={(e) => setExcludeChains(e.target.checked)} /> Exclude national chains</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeContactless} onChange={(e) => setIncludeContactless(e.target.checked)} /> Include contactless records <span className="text-xs text-zinc-500">(usually noise)</span></label>
        </div>
        <p className="text-[11px] text-zinc-500">No ratings filter exists — the open data carries no ratings or review counts; confidence + verified phone + verified website stand in for “real business”.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">4 · Caps, enrichment & top-up</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex items-center justify-between gap-2">Max records
            <input type="number" min={1} className="input w-28" value={maxRecords} onChange={(e) => setMaxRecords(Number(e.target.value))} />
          </label>
          <label className="flex items-center justify-between gap-2">Hard budget cap (USD)
            <input type="number" min={0} step={0.5} className="input w-28" value={budgetCap} onChange={(e) => setBudgetCap(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={smoke} onChange={(e) => setSmoke(e.target.checked)} /> Smoke test — first 200 records only</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} disabled={estimate ? !estimate.aiAvailable : false} />
            Haiku owner extraction {estimate && !estimate.aiAvailable ? <span className="text-xs text-zinc-500">(no key)</span> : <span className="text-xs text-zinc-500">(~{fmtUSD(estimate?.aiRateUSD ?? 0.001)}/site)</span>}
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={topUpEnabled} onChange={(e) => setTopUpEnabled(e.target.checked)} disabled={estimate ? !estimate.topUpAvailable : false} />
            Paid coverage top-up (Outscraper) {estimate && !estimate.topUpAvailable && <span className="text-xs text-zinc-500">(no key)</span>}
          </label>
          {topUpEnabled && (
            <label className="flex items-center justify-between gap-2">Top-up cap (USD)
              <input type="number" min={0} step={0.5} className="input w-28" value={topUpCap} onChange={(e) => setTopUpCap(Number(e.target.value))} />
            </label>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-zinc-300">Estimate</h2>
        {estimate ? (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span><b>{estimate.estimate.plannedRecords.toLocaleString()}</b> records planned</span>
            <span>base <b>$0</b></span>
            {ai && <span>Haiku <b>{fmtUSD(estimate.estimate.aiUSD)}</b></span>}
            {topUpEnabled && <span>top-up <b>{fmtUSD(estimate.estimate.topUpUSD)}</b>{estimate.estimate.citiesFannedOut != null && <span className="text-zinc-500"> · {estimate.estimate.citiesFannedOut} cities fanned out</span>}</span>}
            <span className={estimate.fitsCap ? "text-emerald-400" : "text-red-400"}>
              total <b>{fmtUSD(estimate.estimate.totalUSD)}</b> {estimate.fitsCap ? "≤" : ">"} cap {fmtUSD(budgetCap)}
            </span>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Pick categories and at least one state.</p>
        )}
      </section>

      <div className="flex gap-2">
        <button className="btn" disabled={busy || codes.length === 0 || states.length === 0} onClick={() => save(false)}>Save draft</button>
        <button className="btn btn-primary" disabled={busy || !canRun} onClick={() => save(true)}>
          {smoke ? "Run smoke test" : "Run campaign"}
        </button>
        {!canRun && estimate && !estimate.fitsCap && <span className="self-center text-xs text-red-400">Run disabled: estimate exceeds the hard budget cap.</span>}
      </div>
    </div>
  );
}
