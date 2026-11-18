import type { Zone } from "./settings";

/**
 * Zonage approximatif pour le plafonnement des honoraires (loi ALUR, décret 2014-890) :
 *  - zone très tendue : 12 €/m² (visite, dossier, bail) + 3 €/m² (état des lieux)
 *  - zone tendue      : 10 €/m² + 3 €/m²
 *  - reste du pays    :  8 €/m² + 3 €/m²
 * Le zonage officiel se fait commune par commune : ici on l'estime par département
 * et par grande agglomération. Il peut être forcé dans les paramètres.
 */
export const ALUR_CAPS: Record<Exclude<Zone, "auto">, { honoraires: number; edl: number; label: string }> = {
  tres_tendue: { honoraires: 12, edl: 3, label: "zone très tendue" },
  tendue: { honoraires: 10, edl: 3, label: "zone tendue" },
  non_tendue: { honoraires: 8, edl: 3, label: "zone non tendue" },
};

const TENSE_CITIES = [
  "lyon", "villeurbanne", "marseille", "aix-en-provence", "lille", "roubaix", "tourcoing", "villeneuve-d'ascq",
  "toulouse", "bordeaux", "pessac", "talence", "merignac", "nice", "cannes", "antibes", "grasse", "menton",
  "montpellier", "nantes", "strasbourg", "grenoble", "rennes", "toulon", "annecy", "ajaccio", "bastia",
  "bayonne", "biarritz", "anglet", "la rochelle", "arles", "frejus", "saint-raphael", "sete", "thonon-les-bains",
  "annemasse", "saint-nazaire", "la baule-escoublac", "vannes", "saint-malo", "caen", "dijon", "tours",
  "orleans", "rouen", "reims", "angers", "le havre", "brest", "clermont-ferrand", "metz", "nancy", "avignon",
];

export function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function estimateZone(codePostal: string | null, ville: string | null): { zone: Exclude<Zone, "auto">; approx: boolean } {
  const dep = codePostal?.slice(0, 2);
  if (dep === "75") return { zone: "tres_tendue", approx: false };
  if (dep === "92" || dep === "94" || dep === "93") return { zone: "tres_tendue", approx: true };
  if (dep && ["77", "78", "91", "95"].includes(dep)) return { zone: "tendue", approx: true };
  if (ville && TENSE_CITIES.includes(normalize(ville).replace(/ (cedex|\d+e?r?)$/i, ""))) return { zone: "tendue", approx: true };
  return { zone: "non_tendue", approx: true };
}

/**
 * Loyer de marché indicatif (charges comprises, logement meublé de petite surface), en €/m².
 * Ordre de grandeur seulement : sert à repérer un loyer anormalement bas (arnaque possible)
 * ou très élevé.
 */
export function marketRentPerM2(codePostal: string | null, ville: string | null, surface: number | null): number {
  const dep = codePostal?.slice(0, 2);
  let ref: number;
  if (dep === "75") ref = 34;
  else if (dep === "92") ref = 27;
  else if (dep === "93" || dep === "94") ref = 23;
  else if (dep && ["77", "78", "91", "95"].includes(dep)) ref = 19;
  else if (ville && TENSE_CITIES.includes(normalize(ville))) ref = 17;
  else ref = 13;
  // les petites surfaces sont plus chères au m²
  if (surface != null) {
    if (surface < 15) ref *= 1.35;
    else if (surface < 22) ref *= 1.2;
    else if (surface < 30) ref *= 1.08;
    else if (surface > 60) ref *= 0.85;
  }
  return ref;
}
