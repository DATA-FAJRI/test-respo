import type { ListingData } from "@/lib/schema";
import type { FetchedPage } from "../fetchPage";
import type { StructuredData } from "../structured";

export type AdapterResult = {
  data: Partial<ListingData>;
  /** Confiance par champ (0..1) pour les valeurs lues de façon déterministe. */
  confidence: Record<string, number>;
  notes: string[];
};

export type SiteAdapter = {
  id: string;
  name: string;
  match: (url: URL) => boolean;
  extract: (page: Pick<FetchedPage, "url" | "finalUrl" | "title" | "text">, structured: StructuredData) => AdapterResult;
};

export const SOURCES: { pattern: RegExp; name: string }[] = [
  { pattern: /studapart\./i, name: "Studapart" },
  { pattern: /leboncoin\./i, name: "Leboncoin" },
  { pattern: /seloger\./i, name: "SeLoger" },
  { pattern: /pap\.fr/i, name: "PAP" },
  { pattern: /bienici\./i, name: "Bien'ici" },
  { pattern: /locservice\./i, name: "LocService" },
  { pattern: /nexity-studea|studea\./i, name: "Nexity Studéa" },
  { pattern: /estudines\./i, name: "Les Estudines" },
  { pattern: /logic-immo\./i, name: "Logic-Immo" },
  { pattern: /lokaviz\./i, name: "Lokaviz (CROUS)" },
  { pattern: /twenty-campus|twentycampus/i, name: "Twenty Campus" },
  { pattern: /studelites\./i, name: "Studélites" },
  { pattern: /appartager\./i, name: "Appartager" },
  { pattern: /laforet\.|century21\.|orpi\.|foncia\.|guy-hoquet\.|citya\./i, name: "Agence" },
];

export function sourceName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).host;
    return SOURCES.find((s) => s.pattern.test(host))?.name ?? host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "1 269 €" -> 1269 */
export function euro(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = Number.parseFloat(s.replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Découpe "18 Av. Victor Hugo, 93320 Les Pavillons-sous-Bois, France" */
export function splitAddress(address: string | null | undefined): { code_postal: string | null; ville: string | null } {
  if (!address) return { code_postal: null, ville: null };
  const m = /\b(\d{5})\s+([^,\n]+)/.exec(address);
  return m ? { code_postal: m[1], ville: m[2].trim() } : { code_postal: null, ville: null };
}

const MONTHS: Record<string, string> = {
  janvier: "01", fevrier: "02", février: "02", mars: "03", avril: "04", mai: "05", juin: "06",
  juillet: "07", aout: "08", août: "08", septembre: "09", octobre: "10", novembre: "11", decembre: "12", décembre: "12",
};

/** "18 novembre 2026" -> "2026-11-18" ; "01/11/2026" -> "2026-11-01" */
export function frenchDate(s: string | null | undefined): string | null {
  if (!s) return null;
  let m = /(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
