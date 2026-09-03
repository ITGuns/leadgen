export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "bg-zinc-800 text-zinc-400 border-zinc-700";
  if (score >= 85) return "bg-red-950 text-red-300 border-red-800";
  if (score >= 60) return "bg-orange-950 text-orange-300 border-orange-800";
  if (score >= 40) return "bg-yellow-950 text-yellow-300 border-yellow-800";
  return "bg-emerald-950 text-emerald-300 border-emerald-800";
}

export const CLASS_LABEL: Record<string, string> = {
  none: "No website",
  social_only: "Social only",
  aggregator: "Aggregator",
  parked: "Parked",
  dead: "Dead",
  real_site: "Has website",
  unknown: "Unchecked",
};

export const STATUS_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  not_interested: "Not interested",
  dnc: "DNC",
};

export const STATUS_COLOR: Record<string, string> = {
  new: "bg-zinc-800 text-zinc-300 border-zinc-700",
  contacted: "bg-sky-950 text-sky-300 border-sky-800",
  interested: "bg-emerald-950 text-emerald-300 border-emerald-800",
  not_interested: "bg-zinc-900 text-zinc-500 border-zinc-800",
  dnc: "bg-red-950 text-red-300 border-red-800",
};

export function fmtUSD(n: number | null | undefined): string {
  return `$${(n ?? 0).toFixed(2)}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI",
  "MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${res.status}`);
  return data as T;
}
