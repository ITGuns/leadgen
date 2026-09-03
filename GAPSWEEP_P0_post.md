# GAP_SWEEP · P0 post

Every pre-sweep line now has an owner:

| area | owner |
|---|---|
| Free-first ingestion / releases / gate / 4GB+workstation alt | ARCH A3.1, CONTRACTS C11-G1, scripts/workstation-extract (P2) |
| Taxonomy + mapping confirmation + persistence | CONTRACTS C1 (`taxonomy_mappings`), ARCH A3.2, G2 |
| Conflation rules | CONTRACTS C4 |
| Normalization / identity / dedupe determinism | CONTRACTS C2–C3, G3 |
| Campaign builder semantics (filters, caps, contact rule, smoke, release recording) | CONTRACTS C1 campaigns, C7 plan/pull |
| Pipeline stages, resumability, global scheduler | CONTRACTS C7, ARCH A4 |
| URL classification | CONTRACTS C5 |
| Website check + polite fetcher | CONTRACTS C6 |
| PageSpeed quota/cache | ARCH A4, C7 |
| Owner extraction + anti-hallucination invariant | CONTRACTS C1 leads invariant, C9 AIProvider, G5 |
| Score rubric config + bands | CONTRACTS C8, G4 |
| Leads workspace | CONTRACTS C1 leads/campaign_leads/notes, ARCH A3.4 (UI in P3) |
| Exports (streaming XLSX job, Drive, CSV, exclusions) | ARCH A3.5, C1 exports, G7 (P4) |
| Suppression (client vs DNC), audit, CAN-SPAM note | CONTRACTS C1 suppressions/audit_log, ARCH A5 (P4) |
| Top-up: Outscraper async + intents + fan-out | CONTRACTS C9–C10, ARCH A3.2 (P2 last) |
| Cost safety: intents, per-call guard, ledger, ceiling | CONTRACTS C10, G6 |
| Freshness weekly job | ARCH A3.6 |
| Chain exclusion | CONTRACTS C1 chain, DECISIONS, ingest/chains.ts (P2) |
| CF Access verify + mock identity + 401 gate | ARCH A1/A5, G8 (P5 wiring, P1 module) |
| Docker/volume/backup/attribution/settings/spend | ARCH A1, A3.7, A5 (P5) |
| Mock mode end-to-end keyless | ARCH A3.1, DECISIONS D14, C9 |
| Gates table | CONTRACTS C11 |
| Protocols in autonomous session | DECISIONS D5, STATUS |

Gaps found while sweeping (fixed in the docs before this commit): fetch body cap (2 MB) was unspecified → C6; stalled-intent human resubmit path → C10 + UI note; shortener resolution step → C5; monthly ceiling guarded like campaign caps → C10. No open P0 gaps.
