/** Shared UI primitives — server-safe (no hooks). Pair with the class vocabulary in globals.css. */

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** Full-card loading placeholder: a few shimmering lines. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card space-y-3" aria-busy>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3 ${i % 2 ? "w-2/3" : "w-5/6"}`} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        {icon ?? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            <path d="M8 12h8" />
          </svg>
        )}
      </div>
      <div className="empty-title">{title}</div>
      {hint ? <p className="empty-hint">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-error" role="alert">
      <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
      <div className="flex-1">{message}</div>
      {onRetry ? (
        <button className="btn btn-sm shrink-0" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Opportunity score pill — the product's core signal (0–100, high = hot lead). */
export function ScorePill({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="score score-none">—</span>;
  const cls = score >= 85 ? "score-hot" : score >= 60 ? "score-warm" : score >= 40 ? "score-mild" : "score-cool";
  return <span className={`score ${cls}`}>{score}</span>;
}

const STATUS_CHIP: Record<string, { cls: string; label: string }> = {
  new: { cls: "chip-info", label: "New" },
  contacted: { cls: "chip-accent", label: "Contacted" },
  interested: { cls: "chip-warn", label: "Interested" },
  not_interested: { cls: "chip-muted", label: "Not interested" },
  dnc: { cls: "chip-danger", label: "DNC" },
  running: { cls: "chip-info", label: "Running" },
  completed: { cls: "chip-accent", label: "Completed" },
  paused: { cls: "chip-warn", label: "Paused" },
  failed: { cls: "chip-danger", label: "Failed" },
  canceled: { cls: "chip-muted", label: "Canceled" },
  draft: { cls: "chip-muted", label: "Draft" },
  pending: { cls: "chip-warn", label: "Pending" },
  active: { cls: "chip-accent", label: "Active" },
};

export function StatusChip({ status }: { status: string | null | undefined }) {
  const s = STATUS_CHIP[status ?? ""] ?? { cls: "chip-muted", label: status ?? "—" };
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}
