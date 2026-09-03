# GAP_SWEEP · P4 post (exports + suppression + audit)

C12 checklist:
1. Requirements → owners: XLSX as background job with ExcelJS **streaming** writer (formatted frozen header, hyperlinked websites, score coloring, filename `leadforge_{niche}_{states}_{date}_{id}.xlsx`) · metadata sheet with attribution (Overture/FSQ/SimpleMaps), params, releases, exclusions, CAN-SPAM note · CSV for CRM imports · Drive push via configured folder w/ link back (mock → ./exports/drive-mock) · column picker · exclusions: DNC-list NEVER exports; dnc/not_interested statuses + client-list excluded by default, `includeExcluded` override audit-logged · suppression module + import UI (client vs dnc explained; DNC-registry note rendered §3.6) · per-lead DNC one-click already in workspace (audit-logged) · export audit log (who/when/how many) · emails export in their own column.
2. No TODOs; Drive is the only key-gated piece and mocks cleanly.
3. Contracts: ExportParams matches C1; exports table fields used as specified.
4. Gates: **G7 green** — DB→XLSX→parse identical rows (name/score/phone/evidence per row), DNC-list absent under both default and override, CSV same universe, audit rows asserted. Full suite 199 green, tsc clean.
5. Idempotency: export job re-run guarded by status; orphaned exports (job died outside the handler) reconciled to failed instead of pending forever — found live when the dev server predated the handler, fixed.
6. Compliance: attribution sheet in every export; suppressed data never leaves the system; override path leaves an audit trail.
7. STATUS updated below; BLOCKERS unchanged (B2 Drive consent still parked).

Live verification: POST /api/exports on the dev server → completed with 29 rows; downloaded file is a valid `Microsoft Excel 2007+` workbook with Leads + About sheets.

Known test-fixture nuance (documented, not a bug): mock businesses can share names, so G7 asserts identity by lead id/phone, not display name.
