import type { ListingData, Variant } from "@/lib/schema";
import { euro, frenchDate, type AdapterResult, type SiteAdapter } from "./types";
import { genericAdapter } from "./generic";

/**
 * Adaptateur Studapart (résidences et logements).
 * La page est rendue en JavaScript ; on lit le texte rendu et le JSON-LD
 * (type Accommodation : nom, adresse, coordonnées GPS).
 * Une résidence propose plusieurs types de logements (Studio S / M / XL…) :
 * chacun devient une "variante" avec son propre bloc "Détails du prix".
 */
export const studapartAdapter: SiteAdapter = {
  id: "studapart",
  name: "Studapart",
  match: (u) => /(^|\.)studapart\.com$/i.test(u.host),
  extract(page, structured) {
    const base = genericAdapter.extract(page, structured);
    const text = page.text.replace(/ | /g, " ");
    const data: Partial<ListingData> = { ...base.data, source: "Studapart" };
    const confidence: Record<string, number> = { ...base.confidence };
    // le prix JSON-LD générique est remplacé par la lecture des blocs "Détails du prix"
    const notes: string[] = base.notes.filter((n) => !/données structurées/.test(n));
    const set = <K extends keyof ListingData>(k: K, v: ListingData[K] | null | undefined, c = 0.95) => {
      if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return;
      data[k] = v as ListingData[K];
      confidence[k as string] = c;
    };

    const isResidence = /\/residence\//.test(page.url) || /Logement en résidence/i.test(text);
    if (isResidence) set("type_offre", "residence_etudiante", 0.9);
    else if (/\bColocation\b/.test(text.split("\n").slice(0, 120).join("\n")) && /coloc/i.test(page.url)) set("type_offre", "colocation", 0.7);

    const loueur = /Envoyer un message à ([^\n]+)/.exec(text)?.[1]?.trim();
    if (isResidence && data.titre) set("nom_residence_agence", data.titre.replace(/\s*-\s*[^-]+$/, "") as string, 0.9);
    else if (loueur) set("nom_residence_agence", loueur, 0.9);
    if (loueur) notes.push(`Loueur / gestionnaire affiché : ${loueur}.`);

    // En-tête : "Meublé • Studio • de 17m² à 25m²"
    const header = /^(Meublé|Non meublé|Vide)[^\n]*•[^\n]*$/m.exec(text)?.[0];
    if (header) {
      set("meuble", /^Meublé/.test(header));
      const parts = header.split("•").map((s) => s.trim());
      if (parts[1]) set("type_logement", parts[1], 0.9);
    }
    if (/Éligible aux aides \(APL|Eligible aux aides|APL, ALS/i.test(text)) set("eligible_apl", true, 0.9);
    const dureeMin = /Durée de location min\.?\s*(\d+)\s*mois/i.exec(text);
    if (dureeMin) set("duree_min_mois", Number(dureeMin[1]));
    const dureeMax = /Durée de location max\.?\s*(\d+)\s*mois/i.exec(text);
    if (dureeMax) set("duree_max_mois", Number(dureeMax[1]));
    if (/Garantie Studapart|Garant résidant/i.test(text)) {
      set("garant_requis", true, 0.7);
      notes.push("Garant demandé par le loueur ; la « Garantie Studapart » (payante) est proposée à défaut de garant en France.");
    }
    if (/Visale/i.test(text)) set("visale_accepte", true, 0.6);

    const equip = listAfter(text, /Voir les \d+ équipements\s*\n+\s*Equipements \(\d+\)\s*\n/i) ?? listAfter(text, /Equipements \(\d+\)\s*\n/i);
    const servicesList = listAfter(text, /Voir les \d+ services\s*\n+\s*Services \(\d+\)\s*\n/i) ?? listAfter(text, /Services \(\d+\)\s*\n/i);
    const equipements = [...(equip ?? []), ...(servicesList ?? []).map((s) => `Service : ${s}`)];
    if (equipements.length) set("equipements", unique(equipements), 0.9);
    if (servicesList?.some((s) => /assurance/i.test(s))) {
      notes.push("« Assurance locative » listée parmi les services de la résidence : son prix et son caractère obligatoire ne sont pas précisés.");
    }

    // Variantes
    const variants = parseVariants(text);
    if (variants.length) {
      data.variantes = variants;
      confidence.variantes = 0.95;
      const chosen = variants.find((v) => v.disponible) ?? [...variants].sort((a, b) => (a.loyer_cc ?? 1e9) - (b.loyer_cc ?? 1e9))[0];
      notes.push(
        `${variants.length} type(s) de logement dans l'annonce. Valeurs principales = « ${chosen.nom} »${chosen.disponible ? " (disponible)" : ""}. Vous pouvez ajouter chaque variante séparément.`,
      );
      applyVariant(data, confidence, chosen);
      if (variants.some((v) => v.surface_max_m2 && v.surface_max_m2 !== v.surface_m2)) {
        notes.push("Surface donnée en fourchette (ex. 19 à 20 m²) : la surface minimale est retenue, le loyer final dépend du logement attribué.");
      }
    } else {
      // Logement individuel : "Loyer mensuel" / "Charges"
      const loyer = /Loyer mensuel\s*\n+\s*([\d\s]+)\s?€/i.exec(text);
      const cc = /Charges comprises/i.test(text);
      if (loyer) set(cc ? "loyer_cc" : "loyer_hc", euro(loyer[1]));
      const frais = /Frais de réservation\s*\n+\s*([\d\s]+)\s?€/i.exec(text);
      if (frais) set("frais_dossier", euro(frais[1]));
      const depot = /Dépôt de garantie\s*\n+\s*([\d\s]+)\s?€/i.exec(text);
      if (depot) set("depot_garantie", euro(depot[1]));
      const incl = listAfter(text, /Charges comprises dans le loyer\s*\n/i);
      if (incl) set("charges_incluses", incl);
    }
    if (data.frais_dossier != null) {
      notes.push("« Frais de réservation » Studapart comptés comme frais de plateforme (paiement unique).");
    }
    if (data.loyer_cc != null && data.charges_mensuelles == null) {
      notes.push("Loyer affiché « charges comprises » sans détail du montant des charges : loyer HC et charges non séparés.");
    }

    return { data, confidence, notes } satisfies AdapterResult;
  },
};

function applyVariant(data: Partial<ListingData>, confidence: Record<string, number>, v: Variant) {
  const fields: [keyof Variant, keyof ListingData][] = [
    ["type_logement", "type_logement"],
    ["surface_m2", "surface_m2"],
    ["loyer_hc", "loyer_hc"],
    ["charges_mensuelles", "charges_mensuelles"],
    ["loyer_cc", "loyer_cc"],
    ["depot_garantie", "depot_garantie"],
    ["frais_dossier", "frais_dossier"],
    ["disponibilite", "disponibilite"],
    ["charges_incluses", "charges_incluses"],
  ];
  for (const [from, to] of fields) {
    const val = v[from];
    if (val === null || val === undefined || (Array.isArray(val) && !val.length)) continue;
    (data as Record<string, unknown>)[to] = val;
    confidence[to] = from === "surface_m2" && v.surface_max_m2 && v.surface_max_m2 !== v.surface_m2 ? 0.8 : 0.95;
  }
  if (v.nom && data.titre && !data.titre.includes(v.nom)) data.titre = `${data.titre} — ${v.nom}`;
}

export function parseVariants(text: string): Variant[] {
  const markers = [...text.matchAll(/Détails du prix/g)].map((m) => m.index ?? 0);
  const out: Variant[] = [];
  let prev = 0;
  markers.forEach((idx, k) => {
    const before = text.slice(prev, idx);
    const after = text.slice(idx, markers[k + 1] ?? Math.min(text.length, idx + 4000));
    prev = idx + 1;
    const titles = [...before.matchAll(/^([^\n]*\d+\s?m²[^\n]*)\n\s*([\d\s]+)\s?€\s*\n\s*\/\s*mois/gm)];
    const t = titles.at(-1);
    if (!t) return;
    const nom = t[1].trim();
    const surf = /de\s*(\d+(?:[.,]\d+)?)\s?m²\s*à\s*(\d+(?:[.,]\d+)?)\s?m²/i.exec(nom) ?? /(\d+(?:[.,]\d+)?)\s?m²/.exec(nom);
    const tail = before.slice(t.index ?? 0);
    const dispo = /Disponible à partir du ([^\n]+)|Disponible immédiatement|Aucune disponibilité/i.exec(tail)?.[0] ??
      /Disponible à partir du ([^\n]+)|Disponible immédiatement|Aucune disponibilité/i.exec(before.slice(-1500))?.[0] ?? null;
    const cc = /Charges comprises/i.test(tail) || /Charges comprises dans le loyer/i.test(after);
    const loyer = euro(/Loyer mensuel\s*\n+\s*([\d\s]+)\s?€/i.exec(after)?.[1]) ?? euro(t[2]);
    const charges = euro(/\nCharges\s*\n+\s*([\d\s]+)\s?€/i.exec(after)?.[1]);
    out.push({
      nom: nom.replace(/\s+de\s+\d.*$/, "").trim() || nom,
      type_logement: /^(Studio|T\d|Chambre|Appartement|Colocation|F\d)/i.exec(nom)?.[1] ?? null,
      surface_m2: surf ? Number(surf[1].replace(",", ".")) : null,
      surface_max_m2: surf && surf[2] ? Number(surf[2].replace(",", ".")) : null,
      loyer_hc: cc ? null : loyer,
      charges_mensuelles: charges,
      loyer_cc: cc ? loyer : null,
      depot_garantie: euro(/Dépôt de garantie\s*\n+\s*([\d\s]+)\s?€/i.exec(after)?.[1]),
      frais_dossier: euro(/Frais de réservation\s*\n+\s*([\d\s]+)\s?€/i.exec(after)?.[1]),
      disponibilite: dispo ? (/Aucune/i.test(dispo) ? "complet (aucune disponibilité)" : frenchDate(dispo) ?? (/immédiatement/i.test(dispo) ? "immédiate" : dispo)) : null,
      disponible: dispo ? !/Aucune disponibilité/i.test(dispo) : null,
      charges_incluses: listAfter(after, /Charges comprises dans le loyer\s*\n/i) ?? [],
    });
  });
  // dédoublonnage (la carte et la modale répètent parfois les mêmes infos)
  const seen = new Set<string>();
  return out.filter((v) => {
    const key = `${v.nom}|${v.loyer_cc ?? v.loyer_hc}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Lit une liste de lignes courtes juste après un titre, jusqu'à la première ligne vide. */
function listAfter(text: string, heading: RegExp): string[] | null {
  const m = heading.exec(text);
  if (!m) return null;
  const lines = text.slice((m.index ?? 0) + m[0].length).split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (out.length) break;
      continue;
    }
    if (/^\+\d|€|m²|^Voir |^(Services|Equipements|Équipements) \(\d+\)|^Localisation$/.test(line) || line.length > 60) break;
    out.push(line);
  }
  return out.length ? out : null;
}

function unique(a: string[]) {
  return [...new Set(a)];
}
