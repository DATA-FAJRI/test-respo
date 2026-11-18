/**
 * Mini-parseur robots.txt (groupes User-agent, Allow/Disallow, jokers * et $).
 * La règle la plus longue l'emporte ; à longueur égale, Allow l'emporte.
 */
export type RobotsResult = { allowed: boolean; rule: string | null };

const robotsCache = new Map<string, { body: string | null; at: number }>();

export function parseRobots(body: string, userAgent: string, pathWithQuery: string): RobotsResult {
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const ua = userAgent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; pattern: string } | null = null;
  for (const g of applicable) {
    for (const r of g.rules) {
      if (matches(r.pattern, pathWithQuery)) {
        if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
      }
    }
  }
  return { allowed: !best || best.allow, rule: best ? `${best.allow ? "Allow" : "Disallow"}: ${best.pattern}` : null };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const p = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp("^" + p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return regex.test(path);
}

export async function isAllowedByRobots(
  url: string,
  userAgent: string,
  fetchText: (robotsUrl: string) => Promise<string | null>,
): Promise<RobotsResult> {
  const u = new URL(url);
  const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
  let entry = robotsCache.get(robotsUrl);
  if (!entry || Date.now() - entry.at > 6 * 3600_000) {
    entry = { body: await fetchText(robotsUrl), at: Date.now() };
    robotsCache.set(robotsUrl, entry);
  }
  if (!entry.body) return { allowed: true, rule: null };
  return parseRobots(entry.body, userAgent, u.pathname + u.search);
}
