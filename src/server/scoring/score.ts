import fs from "node:fs";
import path from "node:path";
import type { ScoreReason, WebsiteCheck } from "@/db/schema";
import type { WebsiteClass } from "../classify";
import { now } from "../config";

/** CONTRACTS C8 — Opportunity Score engine. The rubric lives in config/score-rubric.json;
 * conditions are this fixed enum. Golden set G4 pins the bands. */

type Modifier = { cond: string; arg?: number; add: number; chip: string };
type Rubric = {
  version: number;
  base: Record<string, number>;
  baseChips: Record<string, string>;
  modifiers: Modifier[];
  clamp: [number, number];
};

let rubricCache: Rubric | null = null;
export function loadRubric(): Rubric {
  if (!rubricCache) {
    rubricCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "score-rubric.json"), "utf8"));
  }
  return rubricCache!;
}

export type ScoreInput = {
  websiteClass: WebsiteClass;
  check?: WebsiteCheck | null;
  mobileScore?: number | null;
};

function fill(template: string, input: ScoreInput): string {
  return template
    .replaceAll("{builder}", String(input.check?.builder ?? "builder"))
    .replaceAll("{mobileScore}", String(input.mobileScore ?? "?"))
    .replaceAll("{copyrightYear}", String(input.check?.copyrightYear ?? "?"));
}

function condHolds(m: Modifier, input: ScoreInput): boolean {
  const c = input.check;
  const currentYear = now().getFullYear();
  switch (m.cond) {
    case "builder":
      return !!c?.builder && c.builder !== "custom";
    case "mobile_below":
      return input.mobileScore != null && input.mobileScore < (m.arg ?? 0);
    case "mobile_at_least":
      return input.mobileScore != null && input.mobileScore >= (m.arg ?? 101);
    case "no_ssl":
      return c != null && c.ssl === false;
    case "copyright_older_than":
      return c?.copyrightYear != null && currentYear - c.copyrightYear >= (m.arg ?? 3);
    case "no_viewport":
      return c != null && c.hasViewportMeta === false;
    case "no_contact_form":
      return c != null && c.hasContactForm === false;
    case "custom_recent":
      return (
        c?.builder === "custom" &&
        c.copyrightYear != null &&
        currentYear - c.copyrightYear <= 1 &&
        (input.mobileScore ?? 0) >= 60
      );
    default:
      return false;
  }
}

export function computeScore(input: ScoreInput): { score: number; reasons: ScoreReason[] } {
  const rubric = loadRubric();
  const base = rubric.base[input.websiteClass] ?? rubric.base.unknown;
  const reasons: ScoreReason[] = [];
  const baseChip = rubric.baseChips[input.websiteClass];
  if (baseChip) reasons.push({ chip: baseChip, points: base });
  let score = base;
  if (input.websiteClass === "real_site") {
    for (const m of rubric.modifiers) {
      if (condHolds(m, input)) {
        score += m.add;
        reasons.push({ chip: fill(m.chip, input), points: m.add });
      }
    }
  }
  const [lo, hi] = rubric.clamp;
  score = Math.max(lo, Math.min(hi, Math.round(score)));
  return { score, reasons };
}
