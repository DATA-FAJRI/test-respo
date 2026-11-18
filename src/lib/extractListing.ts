import "server-only";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ListingDataSchema, emptyListingData, type ExtractResponse, type ListingData } from "@/lib/schema";
import { fetchPage, normalizeUrl } from "@/lib/scrape/fetchPage";
import { compactJson, extractStructured, type StructuredData } from "@/lib/scrape/structured";
import { pickAdapter } from "@/lib/scrape/adapters";
import { genericAdapter } from "@/lib/scrape/adapters/generic";
import type { AdapterResult } from "@/lib/scrape/adapters/types";
import { extractWithLlm, llmAvailable } from "@/lib/llm/extract";

const EXTRACT_CACHE_DIR = path.join(process.cwd(), ".cache", "extractions");

async function cached<T>(key: string, fn: () => Promise<T>, force = false): Promise<{ value: T; hit: boolean }> {
  const file = path.join(EXTRACT_CACHE_DIR, `${key}.json`);
  if (!force) {
    try {
      return { value: JSON.parse(await fs.readFile(file, "utf8")) as T, hit: true };
    } catch {
      /* miss */
    }
  }
  const value = await fn();
  await fs.mkdir(EXTRACT_CACHE_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
  return { value, hit: false };
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Fusionne le résultat déterministe de l'adaptateur et celui du LLM.
 * L'adaptateur l'emporte (lecture exacte) ; les divergences sont signalées.
 */
export function mergeResults(adapter: AdapterResult, llm: ListingData | null): ListingData {
  const base: ListingData = llm ? structuredClone(llm) : emptyListingData();
  const confiance: Record<string, number | null> = { ...(llm?.confiance ?? {}) };
  const notes = [...(llm?.notes ?? [])];
  for (const [k, v] of Object.entries(adapter.data)) {
    if (isEmpty(v) || k === "notes" || k === "confiance") continue;
    const current = (base as Record<string, unknown>)[k];
    if (llm && !isEmpty(current) && typeof v !== "object" && String(current).toLowerCase() !== String(v).toLowerCase()) {
      notes.push(`« ${k} » : le parseur lit ${v}, le LLM proposait ${current}. Valeur du parseur retenue.`);
    }
    (base as Record<string, unknown>)[k] = v;
    confiance[k] = adapter.confidence[k] ?? 0.9;
  }
  notes.unshift(...adapter.notes.filter((n) => !notes.includes(n)));
  return ListingDataSchema.parse({ ...base, confiance, notes });
}

export async function extractFromUrl(rawUrl: string, opts: { force?: boolean } = {}): Promise<ExtractResponse> {
  const url = normalizeUrl(rawUrl);
  const { page, cached: pageCached } = await fetchPage(url, opts);
  const structured = extractStructured(page.html);
  const adapter = pickAdapter(url);
  const adapterResult = adapter.extract(page, structured);
  return finish({ url, text: page.text, structured, adapterResult, adapterName: adapter.id, fetchedAt: page.fetchedAt, pageCached, force: opts.force });
}

export async function extractFromText(text: string, url: string | null, opts: { force?: boolean } = {}): Promise<ExtractResponse> {
  const structured: StructuredData = { jsonLd: [], meta: {}, nextData: null };
  const fakePage = { url: url ?? "", finalUrl: url ?? "", title: "", text };
  const adapter = url ? pickAdapter(url) : genericAdapter;
  const adapterResult = adapter.extract(fakePage, structured);
  if (!url) {
    delete adapterResult.data.url;
    delete adapterResult.data.source;
  }
  return finish({ url, text, structured, adapterResult, adapterName: adapter.id, fetchedAt: null, pageCached: false, force: opts.force });
}

async function finish(args: {
  url: string | null;
  text: string;
  structured: StructuredData;
  adapterResult: AdapterResult;
  adapterName: string;
  fetchedAt: string | null;
  pageCached: boolean;
  force?: boolean;
}): Promise<ExtractResponse> {
  const warnings: string[] = [];
  let llmData: ListingData | null = null;
  let llmUsed = false;
  let llmHit = false;

  if (llmAvailable()) {
    const structuredStr = compactJson({ jsonLd: args.structured.jsonLd, meta: args.structured.meta, nextData: args.structured.nextData });
    const key = createHash("sha256").update(JSON.stringify([args.url, args.text, structuredStr])).digest("hex").slice(0, 32);
    try {
      const { value, hit } = await cached(
        key,
        () => extractWithLlm({ url: args.url, pageText: args.text, structured: structuredStr, preExtracted: args.adapterResult.data }),
        args.force,
      );
      llmData = ListingDataSchema.parse(value.data);
      llmData.notes = [...value.notes, ...llmData.notes];
      llmUsed = true;
      llmHit = hit;
    } catch (e) {
      warnings.push(`Extraction LLM impossible : ${e instanceof Error ? e.message : String(e)}. Résultat partiel (parseur seul).`);
    }
  } else {
    warnings.push("Aucune clé ANTHROPIC_API_KEY configurée : seules les données lues par l'adaptateur/parseur sont remplies. Complétez la fiche à la main.");
  }

  const data = mergeResults(args.adapterResult, llmData);
  if (args.url) {
    data.url = data.url ?? args.url;
  }
  const method = llmUsed ? (args.adapterName === "generic" ? "llm" : "adaptateur+llm") : args.adapterName === "generic" ? "generique" : "adaptateur";
  return {
    ok: true,
    data,
    method,
    adapter: args.adapterName,
    llm: llmUsed,
    fetchedAt: args.fetchedAt,
    cached: args.pageCached || llmHit,
    warnings,
  };
}
