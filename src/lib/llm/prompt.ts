import type { ListingData } from "@/lib/schema";

/** Prompt d'extraction partagé par le serveur Next.js et la version Artifact (claude.ai). */
export const SYSTEM_PROMPT = `Tu es un extracteur de données d'annonces de location immobilière en France.
Tu reçois le texte rendu d'une page d'annonce, ses données structurées (JSON-LD, meta, __NEXT_DATA__) et éventuellement des valeurs déjà lues par un parseur déterministe.
Tu réponds UNIQUEMENT par un objet JSON valide (pas de texte autour, pas de bloc de code) qui suit exactement le schéma fourni.

Règles impératives :
- Une information absente de l'annonce vaut null (ou [] pour une liste). N'invente rien, ne devine pas de montant.
- Ne calcule pas de valeur absente (ex. ne déduis pas le loyer HC en soustrayant des charges supposées). Seule exception : si l'annonce donne loyer CC et charges, tu peux renseigner loyer_hc = loyer_cc - charges, avec une confiance de 0.8 et une note.
- Montants en euros, nombres purs (740, pas "740 €"). Surfaces en m².
- Dates au format AAAA-MM-JJ si la date est précise, sinon texte court ("immédiate", "septembre 2026").
- charges_incluses / charges_non_incluses : postes explicitement cités (eau, eau chaude, chauffage, électricité, internet, entretien des parties communes, taxe d'ordures ménagères, assurance…).
- frais_dossier = frais de dossier ou de service/réservation facturés par la plateforme (paiement unique). frais_agence = honoraires de location hors état des lieux ; frais_etat_des_lieux séparément si indiqué.
- services : services payants de la résidence (ménage, linge, parking, laverie…) avec prix et caractère obligatoire si indiqués.
- Si l'annonce propose plusieurs types de logement (résidence : studio S/M/XL, chambres…), remplis "variantes" (un objet par type) et mets dans les champs principaux le premier type disponible.
- Ignore les annonces "similaires" / suggestions affichées en bas de page : seule l'annonce principale compte.
- type_offre : "particulier", "agence", "residence_etudiante" ou "colocation".
- chauffage_type : "individuel" ou "collectif" ; chauffage_energie : "electrique", "gaz", "reseau_urbain", "fioul", "bois", "pompe_a_chaleur" ou "autre".
- dpe / ges : une lettre minuscule a..g.
- confiance : objet { nom_du_champ: score 0..1 } pour chaque champ non null (1 = lu tel quel sans ambiguïté, 0.5 = interprétation, <0.4 = doute fort).
- notes : liste de phrases courtes signalant les ambiguïtés (charges floues, prix "à partir de", surface en fourchette, frais non détaillés, contradictions entre sources…).
- Si une valeur "pré-extraite" contredit le texte, garde la valeur du texte et signale-le dans notes.`;

export const SCHEMA_TEMPLATE = `{
  "titre": string|null, "url": string|null, "source": string|null, "nom_residence_agence": string|null, "date_publication": string|null,
  "type_offre": "particulier"|"agence"|"residence_etudiante"|"colocation"|null,
  "adresse": string|null, "ville": string|null, "code_postal": string|null, "quartier": string|null,
  "latitude": number|null, "longitude": number|null, "transports": string[],
  "type_logement": string|null, "surface_m2": number|null, "nb_pieces": number|null, "etage": number|null, "nb_etages": number|null,
  "ascenseur": boolean|null, "meuble": boolean|null, "equipements": string[],
  "chauffage_type": "individuel"|"collectif"|null, "chauffage_energie": string|null,
  "dpe": "a".."g"|null, "ges": "a".."g"|null, "depenses_energie_min": number|null, "depenses_energie_max": number|null,
  "disponibilite": string|null, "duree_min_mois": number|null, "duree_max_mois": number|null, "type_bail": string|null,
  "loyer_hc": number|null, "charges_mensuelles": number|null, "charges_mode": "provision"|"forfait"|null,
  "charges_incluses": string[], "charges_non_incluses": string[], "loyer_cc": number|null,
  "frais_agence": number|null, "frais_etat_des_lieux": number|null, "frais_dossier": number|null, "depot_garantie": number|null,
  "services": [{ "nom": string, "prix_mensuel": number|null, "prix_unique": number|null, "obligatoire": boolean|null }],
  "assurance_obligatoire": boolean|null, "garant_requis": boolean|null, "visale_accepte": boolean|null, "eligible_apl": boolean|null,
  "variantes": [{ "nom": string|null, "type_logement": string|null, "surface_m2": number|null, "surface_max_m2": number|null,
    "loyer_hc": number|null, "charges_mensuelles": number|null, "loyer_cc": number|null, "depot_garantie": number|null,
    "frais_dossier": number|null, "disponibilite": string|null, "disponible": boolean|null, "charges_incluses": string[] }],
  "confiance": { "<champ>": number },
  "notes": string[]
}`;

export function buildUserPrompt(input: { url: string | null; pageText: string; structured?: string | null; preExtracted?: Partial<ListingData> | null }) {
  return [
    `URL : ${input.url ?? "(texte collé manuellement)"}`,
    `\n<schema>\n${SCHEMA_TEMPLATE}\n</schema>`,
    input.preExtracted ? `\n<pre_extrait>\n${JSON.stringify(input.preExtracted)}\n</pre_extrait>` : "",
    input.structured ? `\n<donnees_structurees>\n${input.structured}\n</donnees_structurees>` : "",
    `\n<texte_page>\n${input.pageText}\n</texte_page>`,
    "\nRenvoie uniquement l'objet JSON.",
  ].join("\n");
}

/** Extrait le premier objet JSON d'une réponse texte. */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Le LLM n'a pas renvoyé de JSON.");
  return JSON.parse(text.slice(start, end + 1));
}
