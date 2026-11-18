import { z } from "zod";

/**
 * Schéma des données extraites d'une annonce.
 * Règle : une information absente vaut null. Rien n'est inventé.
 * Le schéma est volontairement tolérant (coercition des nombres "740 €" -> 740,
 * des booléens "oui" -> true) car il valide aussi bien la sortie du LLM que
 * les saisies manuelles.
 */

const toNumber = (v: unknown): unknown => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/\s| |€|eur(os)?|m²|m2/gi, "").replace(",", ".");
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const toBool = (v: unknown): unknown => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["oui", "yes", "true", "vrai", "1"].includes(s)) return true;
    if (["non", "no", "false", "faux", "0"].includes(s)) return false;
  }
  return null;
};

const toStr = (v: unknown): unknown => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};

const toStrArray = (v: unknown): unknown => {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => toStr(x)).filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  return [];
};

export const num = () => z.preprocess(toNumber, z.number().nullable()).catch(null);
export const bool = () => z.preprocess(toBool, z.boolean().nullable()).catch(null);
export const str = () => z.preprocess(toStr, z.string().nullable()).catch(null);
export const strArr = () => z.preprocess(toStrArray, z.array(z.string())).catch([]);
const enumOrNull = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(values).nullable()).catch(null);

export const OFFER_TYPES = ["particulier", "agence", "residence_etudiante", "colocation"] as const;
export const HEATING_TYPES = ["individuel", "collectif"] as const;
export const HEATING_ENERGIES = ["electrique", "gaz", "reseau_urbain", "fioul", "bois", "pompe_a_chaleur", "autre"] as const;
export const CHARGES_MODES = ["provision", "forfait"] as const;
export const DPE_CLASSES = ["a", "b", "c", "d", "e", "f", "g"] as const;

export const ServiceSchema = z.object({
  nom: z.preprocess(toStr, z.string()).catch("Service"),
  prix_mensuel: num(),
  prix_unique: num(),
  obligatoire: bool(),
});
export type Service = z.infer<typeof ServiceSchema>;

/** Une variante de logement dans une même annonce (ex. résidence : Studio S / M / XL). */
export const VariantSchema = z.object({
  nom: str(),
  type_logement: str(),
  surface_m2: num(),
  surface_max_m2: num(),
  loyer_hc: num(),
  charges_mensuelles: num(),
  loyer_cc: num(),
  depot_garantie: num(),
  frais_dossier: num(),
  disponibilite: str(),
  disponible: bool(),
  charges_incluses: strArr(),
});
export type Variant = z.infer<typeof VariantSchema>;

export const ListingDataSchema = z.object({
  // Identification
  titre: str(),
  url: str(),
  source: str(),
  nom_residence_agence: str(),
  date_publication: str(),
  type_offre: enumOrNull([...OFFER_TYPES]),

  // Localisation
  adresse: str(),
  ville: str(),
  code_postal: str(),
  quartier: str(),
  latitude: num(),
  longitude: num(),
  transports: strArr(),

  // Logement
  type_logement: str(),
  surface_m2: num(),
  nb_pieces: num(),
  etage: num(),
  nb_etages: num(),
  ascenseur: bool(),
  meuble: bool(),
  equipements: strArr(),
  chauffage_type: enumOrNull([...HEATING_TYPES]),
  chauffage_energie: enumOrNull([...HEATING_ENERGIES]),
  dpe: enumOrNull([...DPE_CLASSES]),
  ges: enumOrNull([...DPE_CLASSES]),
  depenses_energie_min: num(),
  depenses_energie_max: num(),
  disponibilite: str(),
  duree_min_mois: num(),
  duree_max_mois: num(),
  type_bail: str(),

  // Prix
  loyer_hc: num(),
  charges_mensuelles: num(),
  charges_mode: enumOrNull([...CHARGES_MODES]),
  charges_incluses: strArr(),
  charges_non_incluses: strArr(),
  loyer_cc: num(),
  frais_agence: num(),
  frais_etat_des_lieux: num(),
  frais_dossier: num(),
  depot_garantie: num(),
  services: z.array(ServiceSchema).catch([]),
  assurance_obligatoire: bool(),
  garant_requis: bool(),
  visale_accepte: bool(),
  eligible_apl: bool(),

  // Variantes (résidences avec plusieurs types de logements)
  variantes: z.array(VariantSchema).catch([]),

  // Qualité
  confiance: z
    .preprocess(
      (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}),
      z.record(z.string(), z.preprocess(toNumber, z.number().min(0).max(1).nullable()).catch(null)),
    )
    .catch({}),
  notes: strArr(),
});

export type ListingData = z.infer<typeof ListingDataSchema>;
export type ListingField = Exclude<keyof ListingData, "confiance" | "notes" | "variantes" | "services">;

export function emptyListingData(): ListingData {
  return ListingDataSchema.parse({});
}

/** Annonce stockée côté client. */
export type Listing = {
  id: string;
  createdAt: string;
  updatedAt: string;
  data: ListingData;
  /** Champs corrigés à la main (confiance = 1). */
  editedFields: string[];
  /** Montant d'APL saisi par l'utilisateur (€/mois). */
  aplMensuelle: number | null;
  /** Origine de l'extraction : adaptateur, LLM, saisie. */
  extraction: { method: string; adapter: string | null; llm: boolean; fetchedAt: string | null };
  /** Note libre */
  commentaire: string;
};

/** Réponse de l'API /api/extract */
export type ExtractResponse = {
  ok: boolean;
  data?: ListingData;
  method?: string;
  adapter?: string | null;
  llm?: boolean;
  fetchedAt?: string | null;
  cached?: boolean;
  warnings?: string[];
  error?: string;
};
