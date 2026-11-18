import { ListingDataSchema, emptyListingData, type ListingData } from "@/lib/schema";
import type { AdapterResult } from "@/lib/scrape/adapters/types";

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

