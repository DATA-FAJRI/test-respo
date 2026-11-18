import type { ListingData } from "@/lib/schema";
import { euro, sourceName, splitAddress, type AdapterResult, type SiteAdapter } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const types = (o: Obj) => ([] as unknown[]).concat(o["@type"] ?? []).map(String);

const LISTING_TYPES = /Accommodation|Apartment|House|SingleFamilyResidence|Residence|Room|Product|Offer|RealEstateListing|Place|LodgingBusiness/i;

/**
 * Extracteur générique : JSON-LD (schema.org), balises meta OpenGraph, et
 * quelques motifs de texte très fiables (DPE, surface). Le reste est confié au LLM.
 */
export const genericAdapter: SiteAdapter = {
  id: "generic",
  name: "Générique (JSON-LD / meta)",
  match: () => true,
  extract(page, structured) {
    const data: Partial<ListingData> = {};
    const confidence: Record<string, number> = {};
    const notes: string[] = [];
    const set = <K extends keyof ListingData>(k: K, v: ListingData[K] | null | undefined, c = 0.9) => {
      if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return;
      if (data[k] !== undefined) return;
      data[k] = v as ListingData[K];
      confidence[k as string] = c;
    };

    set("url", page.url, 1);
    set("source", sourceName(page.url), 1);

    const nodes = structured.jsonLd.filter(isObj).filter((o) => types(o).some((t) => LISTING_TYPES.test(t)));
    for (const node of nodes) {
      set("titre", typeof node.name === "string" ? node.name : null);
      const addr = node.address;
      if (typeof addr === "string") {
        set("adresse", addr);
        const { code_postal, ville } = splitAddress(addr);
        set("code_postal", code_postal);
        set("ville", ville);
      } else if (isObj(addr)) {
        const full = [addr.streetAddress, [addr.postalCode, addr.addressLocality].filter(Boolean).join(" ")].filter(Boolean).join(", ");
        set("adresse", full || null);
        set("code_postal", typeof addr.postalCode === "string" ? addr.postalCode : null);
        set("ville", typeof addr.addressLocality === "string" ? addr.addressLocality : null);
      }
      const geo = isObj(node.geo) ? node.geo : node;
      const lat = Number(geo.latitude);
      const lng = Number(geo.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) {
        set("latitude", lat, 0.95);
        set("longitude", lng, 0.95);
      }
      const floor = isObj(node.floorSize) ? Number(node.floorSize.value) : NaN;
      if (Number.isFinite(floor)) set("surface_m2", floor, 0.85);
      const rooms = Number(node.numberOfRooms);
      if (Number.isFinite(rooms) && rooms > 0) set("nb_pieces", rooms, 0.85);
      const offers = ([] as unknown[]).concat(node.offers ?? []).filter(isObj);
      const price = offers.map((o) => euro(String(o.price ?? (isObj(o.priceSpecification) ? o.priceSpecification.price : "") ?? ""))).find((p) => p);
      if (price) {
        set("loyer_cc", price, 0.5);
        notes.push(`Prix ${price} € lu dans les données structurées : charges comprises ou non à confirmer.`);
      }
    }

    set("titre", structured.meta["og:title"] ?? page.title, 0.7);

    // Motifs textuels non ambigus
    const text = page.text;
    const dpe = /(?:classe (?:énergie|energie)|DPE)\s*[:\-]?\s*([A-G])\b/i.exec(text);
    if (dpe) set("dpe", dpe[1].toLowerCase() as ListingData["dpe"], 0.7);
    const ges = /(?:GES|gaz à effet de serre)\s*[:\-]?\s*([A-G])\b/i.exec(text);
    if (ges) set("ges", ges[1].toLowerCase() as ListingData["ges"], 0.7);
    const dep = /entre\s*([\d\s]+)\s*€\s*et\s*([\d\s]+)\s*€\s*par an/i.exec(text);
    if (dep) {
      set("depenses_energie_min", euro(dep[1]), 0.85);
      set("depenses_energie_max", euro(dep[2]), 0.85);
    }
    return { data, confidence, notes } satisfies AdapterResult;
  },
};
