import { getSetting, setSetting } from "../settings";
import { now } from "../config";
import { enqueueJob } from "./worker";

/**
 * ARCHITECTURE A4 — 1-minute ticker that inserts jobs, so scheduled work is
 * visible/resumable like everything else. Schedules (server-local time):
 *   backup    · nightly 03:15
 *   freshness · weekly Sunday 04:00
 */

type CronDef = { name: string; jobType: string; due: (d: Date) => boolean };

const CRONS: CronDef[] = [
  { name: "backup", jobType: "backup", due: (d) => d.getHours() === 3 && d.getMinutes() >= 15 },
  { name: "freshness", jobType: "freshness", due: (d) => d.getDay() === 0 && d.getHours() === 4 },
];

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function cronTick(at = now()): Promise<void> {
  for (const c of CRONS) {
    if (!c.due(at)) continue;
    const markerKey = `cron:last:${c.name}`;
    const last = await getSetting<string>(markerKey, "");
    if (last === dayKey(at)) continue;
    await setSetting(markerKey, dayKey(at));
    await enqueueJob(c.jobType, {}, { dedupe: true });
  }
}

type G = typeof globalThis & { __leadforgeCron?: ReturnType<typeof setInterval> };
const g = globalThis as G;

export function startCron(): void {
  if (g.__leadforgeCron) return;
  g.__leadforgeCron = setInterval(() => void cronTick(), 60_000);
  g.__leadforgeCron.unref?.();
}
