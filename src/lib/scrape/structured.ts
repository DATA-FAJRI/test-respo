/**
 * Extraction des données structurées d'une page : JSON-LD, balises meta,
 * __NEXT_DATA__ / __NUXT__ et autres états initiaux.
 */
export type StructuredData = {
  jsonLd: unknown[];
  meta: Record<string, string>;
  nextData: unknown | null;
};

/** JSON.parse tolérant : beaucoup de sites laissent des retours à la ligne bruts dans les chaînes. */
export function lenientJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    /* on tente une réparation */
  }
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of raw) {
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        out += ch;
        continue;
      }
      if (ch === '"') inString = false;
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  out = out.replace(/,\s*([}\]])/g, "$1"); // virgules finales
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function decodeEntities(s: string) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

export function extractStructured(html: string): StructuredData {
  const jsonLd: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const parsed = lenientJsonParse(m[1].trim());
    if (parsed === null) continue;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const it of items) {
      if (it && typeof it === "object" && "@graph" in it && Array.isArray((it as { "@graph": unknown[] })["@graph"])) {
        jsonLd.push(...(it as { "@graph": unknown[] })["@graph"]);
      } else jsonLd.push(it);
    }
  }

  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:property|name|itemprop)=["']([^"']+)["']/i.exec(tag)?.[1];
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content && !meta[key]) meta[key] = decodeEntities(content);
  }

  let nextData: unknown | null = null;
  const nd = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (nd) nextData = lenientJsonParse(nd[1]);

  return { jsonLd, meta, nextData };
}

/** Réduit une structure JSON volumineuse aux parties utiles pour le LLM. */
export function compactJson(value: unknown, maxChars = 20_000): string {
  const seen = new WeakSet();
  const json = JSON.stringify(
    value,
    (key, v) => {
      if (typeof v === "string" && v.length > 2000) return v.slice(0, 2000) + "…";
      if (typeof v === "string" && /^(https?:)?\/\/.*\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(v)) return undefined;
      if (v && typeof v === "object") {
        if (seen.has(v)) return undefined;
        seen.add(v);
      }
      if (/^(images?|photos?|pictures?|thumbnails?|media|tracking|i18n|translations|_sentry.*)$/i.test(key)) return undefined;
      return v;
    },
    0,
  );
  return json && json.length > maxChars ? json.slice(0, maxChars) + "…[tronqué]" : json ?? "";
}
