import type { ListingData } from "@/lib/schema";
import { type AdapterResult, type SiteAdapter } from "./types";
import { genericAdapter } from "./generic";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Adaptateur Leboncoin : lit l'objet `ad` de __NEXT_DATA__ (attributs normalisés).
 * Note : Leboncoin protège souvent ses pages (DataDome). En cas de captcha,
 * utilisez l'ajout manuel par copier-coller.
 */
export const leboncoinAdapter: SiteAdapter = {
  id: "leboncoin",
  name: "Leboncoin",
  match: (u) => /(^|\.)leboncoin\.fr$/i.test(u.host),
  extract(page, structured) {
    const base = genericAdapter.extract(page, structured);
    const data: Partial<ListingData> = { ...base.data, source: "Leboncoin" };
    const confidence = { ...base.confidence };
    const notes = [...base.notes];
    const nd = structured.nextData;
    const ad = isObj(nd) && isObj(nd.props) && isObj(nd.props.pageProps) && isObj(nd.props.pageProps.ad) ? nd.props.pageProps.ad : null;
    if (!ad) {
      notes.push("Données Leboncoin (__NEXT_DATA__) introuvables : extraction par le texte uniquement.");
      return { data, confidence, notes };
    }
    const set = <K extends keyof ListingData>(k: K, v: unknown, c = 0.9) => {
      if (v === null || v === undefined || v === "") return;
      (data as Record<string, unknown>)[k] = v;
      confidence[k as string] = c;
    };
    set("titre", ad.subject);
    set("date_publication", typeof ad.first_publication_date === "string" ? ad.first_publication_date.slice(0, 10) : null);
    const price = Array.isArray(ad.price) ? Number(ad.price[0]) : null;
    const loc = isObj(ad.location) ? ad.location : {};
    set("ville", loc.city ?? loc.city_label);
    set("code_postal", loc.zipcode);
    if (Number(loc.lat) && Number(loc.lng)) {
      set("latitude", Number(loc.lat), 0.7);
      set("longitude", Number(loc.lng), 0.7);
      notes.push("Coordonnées Leboncoin approximatives (position floutée).");
    }
    const owner = isObj(ad.owner) ? ad.owner : {};
    if (owner.type === "pro") set("type_offre", "agence", 0.8);
    else if (owner.type === "private") set("type_offre", "particulier", 0.8);
    if (typeof owner.name === "string") set("nom_residence_agence", owner.name, 0.8);

    const attrs = new Map<string, Obj>();
    for (const a of Array.isArray(ad.attributes) ? ad.attributes : []) if (isObj(a) && typeof a.key === "string") attrs.set(a.key, a);
    const v = (k: string) => attrs.get(k)?.value;
    const n = (k: string) => {
      const x = Number(String(v(k) ?? "").replace(",", "."));
      return Number.isFinite(x) && String(v(k) ?? "") !== "" ? x : null;
    };
    set("surface_m2", n("square"));
    set("nb_pieces", n("rooms"));
    if (v("furnished") != null) set("meuble", String(v("furnished")) === "1");
    const dpe = String(v("energy_rate") ?? "").toLowerCase();
    if (/^[a-g]$/.test(dpe)) set("dpe", dpe);
    const ges = String(v("ges") ?? "").toLowerCase();
    if (/^[a-g]$/.test(ges)) set("ges", ges);
    const chargesIncluded = v("charges_included");
    const charges = n("monthly_charges");
    if (price) {
      if (String(chargesIncluded) === "1") set("loyer_cc", price);
      else if (chargesIncluded != null) set("loyer_hc", price);
      else set("loyer_cc", price, 0.6);
    }
    if (charges != null) set("charges_mensuelles", charges);
    const deposit = n("security_deposit");
    if (deposit != null) set("depot_garantie", deposit);
    const fees = n("agency_rent_fees") ?? n("fai_fees");
    if (fees != null) set("frais_agence", fees, 0.7);
    if (n("elevator") != null) set("ascenseur", n("elevator") === 1);
    if (n("floor_number") != null) set("etage", n("floor_number"));
    if (n("nb_floors_building") != null) set("nb_etages", n("nb_floors_building"));
    return { data, confidence, notes } satisfies AdapterResult;
  },
};
