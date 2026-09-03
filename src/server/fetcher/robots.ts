/** Minimal robots.txt evaluation (C6): User-agent groups, Disallow/Allow prefixes.
 * We match our UA token and `*`; longest-path rule wins, Allow beats Disallow on ties. */

export type RobotsRules = { disallow: string[]; allow: string[] };

export function parseRobots(body: string, uaToken: string): RobotsRules {
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (current && (key === "disallow" || key === "allow")) {
      (key === "disallow" ? current.disallow : current.allow).push(value);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const ua = uaToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules: RobotsRules = { disallow: [], allow: [] };
  for (const g of applicable) {
    rules.disallow.push(...g.disallow);
    rules.allow.push(...g.allow);
  }
  return rules;
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const match = (patterns: string[]): number => {
    let best = -1;
    for (const p of patterns) {
      if (p === "") continue;
      if (path.startsWith(p) && p.length > best) best = p.length;
    }
    return best;
  };
  const dis = match(rules.disallow);
  if (dis < 0) return true;
  const allow = match(rules.allow);
  return allow >= dis;
}
