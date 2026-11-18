import type { Listing, ListingData } from "./schema";
import type { Settings } from "./settings";
import { ALUR_CAPS, estimateZone, marketRentPerM2, normalize } from "./zones";

export type CostLine = {
  key: string;
  label: string;
  amount: number;
  /** true = supposé (non lu dans l'annonce) */
  estimated: boolean;
  note?: string;
};

export type Alert = { level: "danger" | "warning" | "info"; code: string; message: string };

export type CostResult = {
  complete: boolean;
  /** Loyer charges comprises affiché (ou HC + charges). */
  loyerAffiche: number | null;
  recurring: CostLine[];
  oneOff: CostLine[];
  coutMensuelRecurrent: number;
  fraisUniques: number;
  coutMensuelReel: number;
  coutTotalSejour: number;
  prixM2Reel: number | null;
  tresorerieEntree: number;
  tresorerieLines: CostLine[];
  coutApresApl: number | null;
  /** Le coût mensuel réel contient au moins une estimation. */
  hasEstimates: boolean;
  alerts: Alert[];
  zone: { zone: keyof typeof ALUR_CAPS; approx: boolean; forced: boolean };
};

type Poste = "eau" | "electricite" | "internet" | "chauffage" | "assurance";

const KEYWORDS: Record<Poste, RegExp> = {
  eau: /\beau\b|eau (froide|chaude)/,
  electricite: /electric|electricite|elec\b|energie/,
  internet: /internet|wifi|wi-fi|fibre|box/,
  chauffage: /chauffage|chauffe/,
  assurance: /assurance/,
};

const DPE_HEATING_KWH: Record<string, number> = { a: 40, b: 70, c: 110, d: 170, e: 240, f: 320, g: 400 };
const ENERGY_PRICE: Record<string, number> = { electrique: 0.25, gaz: 0.13, reseau_urbain: 0.12, fioul: 0.14, bois: 0.09, pompe_a_chaleur: 0.1 };

function postStatus(d: ListingData, poste: Poste): "inclus" | "non_inclus" | "inconnu" {
  const inc = d.charges_incluses.map(normalize);
  const exc = d.charges_non_incluses.map(normalize);
  const re = KEYWORDS[poste];
  if (exc.some((s) => re.test(s))) return "non_inclus";
  if (inc.some((s) => re.test(s))) return "inclus";
  if (poste === "assurance" && d.services.some((s) => /assurance/i.test(s.nom) && s.prix_mensuel != null && s.obligatoire)) return "inclus"; // comptée dans les services
  if (poste === "chauffage") {
    if (d.chauffage_type === "collectif" && (d.charges_mensuelles != null || d.loyer_cc != null)) return "inclus";
    if (d.chauffage_energie === "electrique" && inc.some((s) => KEYWORDS.electricite.test(s))) return "inclus";
  }
  if (poste === "eau" && d.chauffage_type === "collectif" && d.charges_mode === "provision" && (d.charges_mensuelles ?? 0) > 0) return "inclus";
  return "inconnu";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeCost(listing: Listing, settings: Settings): CostResult {
  const d = listing.data;
  const s = settings.estimations;
  const duree = Math.max(1, settings.dureeMois || 12);
  const recurring: CostLine[] = [];
  const oneOff: CostLine[] = [];
  const alerts: Alert[] = [];

  // --- Loyer + charges
  let complete = true;
  let loyerAffiche: number | null = null;
  if (d.loyer_cc != null) {
    loyerAffiche = d.loyer_cc;
    const hc = d.loyer_hc ?? (d.charges_mensuelles != null ? d.loyer_cc - d.charges_mensuelles : null);
    if (hc != null && d.charges_mensuelles != null) {
      recurring.push({ key: "loyer_hc", label: "Loyer hors charges", amount: hc, estimated: false });
      recurring.push({ key: "charges", label: `Charges (${d.charges_mode ?? "mode non précisé"})`, amount: d.charges_mensuelles, estimated: false });
    } else {
      recurring.push({ key: "loyer_cc", label: "Loyer charges comprises", amount: d.loyer_cc, estimated: false });
    }
  } else if (d.loyer_hc != null) {
    recurring.push({ key: "loyer_hc", label: "Loyer hors charges", amount: d.loyer_hc, estimated: false });
    if (d.charges_mensuelles != null) {
      recurring.push({ key: "charges", label: `Charges (${d.charges_mode ?? "mode non précisé"})`, amount: d.charges_mensuelles, estimated: false });
      loyerAffiche = d.loyer_hc + d.charges_mensuelles;
    } else {
      loyerAffiche = d.loyer_hc;
      alerts.push({ level: "warning", code: "charges_inconnues", message: "Loyer hors charges sans montant de charges : le coût réel est sous-estimé." });
    }
  } else {
    complete = false;
    alerts.push({ level: "danger", code: "loyer_absent", message: "Loyer introuvable : complétez la fiche." });
  }

  // --- Postes non inclus (estimations)
  const surface = d.surface_m2;
  const addPoste = (poste: Poste, label: string, amount: number, note?: string, estimated = true) => {
    const st = postStatus(d, poste);
    if (st === "inclus") return;
    recurring.push({ key: poste, label, amount: r2(amount), estimated, note: note ?? (st === "inconnu" ? "non mentionné dans l'annonce" : "non inclus") });
  };
  addPoste("electricite", "Électricité", s.electricite);
  addPoste("internet", "Internet", s.internet);
  addPoste("eau", "Eau", s.eau);

  // chauffage
  if (postStatus(d, "chauffage") !== "inclus" && d.chauffage_type !== "collectif") {
    if (d.depenses_energie_min != null || d.depenses_energie_max != null) {
      const min = d.depenses_energie_min ?? d.depenses_energie_max!;
      const max = d.depenses_energie_max ?? d.depenses_energie_min!;
      addPoste("chauffage", "Chauffage / énergie (estimation DPE)", (min + max) / 2 / 12, `d'après l'estimation DPE de l'annonce (${min}–${max} €/an)`);
    } else if (surface != null) {
      const cls = d.dpe ?? "d";
      const price = d.chauffage_energie ? ENERGY_PRICE[d.chauffage_energie] ?? s.prixKwhChauffage : s.prixKwhChauffage;
      const monthly = (surface * DPE_HEATING_KWH[cls] * price) / 12;
      addPoste("chauffage", "Chauffage", monthly, `${surface} m² × ${DPE_HEATING_KWH[cls]} kWh/m²/an (DPE ${cls.toUpperCase()}${d.dpe ? "" : " supposé"}) × ${price} €/kWh`);
    } else {
      addPoste("chauffage", "Chauffage", 30, "surface inconnue : forfait par défaut");
    }
  }
  // assurance
  addPoste("assurance", "Assurance habitation", s.assurance, d.assurance_obligatoire === false ? "non obligatoire selon l'annonce, mais recommandée" : undefined);

  // services
  for (const sv of d.services) {
    if (sv.obligatoire && sv.prix_mensuel != null) recurring.push({ key: `svc_${sv.nom}`, label: `Service obligatoire : ${sv.nom}`, amount: sv.prix_mensuel, estimated: false });
    if (sv.obligatoire && sv.prix_unique != null) oneOff.push({ key: `svcu_${sv.nom}`, label: `Service obligatoire : ${sv.nom}`, amount: sv.prix_unique, estimated: false });
  }

  // --- Frais uniques
  if (d.frais_agence != null) oneOff.push({ key: "frais_agence", label: "Honoraires d'agence", amount: d.frais_agence, estimated: false });
  if (d.frais_etat_des_lieux != null) oneOff.push({ key: "frais_edl", label: "État des lieux", amount: d.frais_etat_des_lieux, estimated: false });
  if (d.frais_dossier != null) oneOff.push({ key: "frais_dossier", label: "Frais de dossier / plateforme", amount: d.frais_dossier, estimated: false });
  if (d.type_offre === "agence" && d.frais_agence == null) {
    alerts.push({ level: "warning", code: "frais_agence_inconnus", message: "Annonce d'agence sans montant d'honoraires : frais uniques probablement sous-estimés." });
  }

  const coutMensuelRecurrent = r2(recurring.reduce((a, l) => a + l.amount, 0));
  const fraisUniques = r2(oneOff.reduce((a, l) => a + l.amount, 0));
  const coutMensuelReel = r2(coutMensuelRecurrent + fraisUniques / duree);
  const premierLoyer = loyerAffiche ?? 0;
  const tresorerieLines: CostLine[] = [
    { key: "premier_loyer", label: "1er loyer (charges comprises)", amount: premierLoyer, estimated: false },
    { key: "depot", label: "Dépôt de garantie (remboursable)", amount: d.depot_garantie ?? 0, estimated: d.depot_garantie == null, note: d.depot_garantie == null ? "non indiqué" : undefined },
    { key: "frais_uniques", label: "Frais uniques", amount: fraisUniques, estimated: false },
  ];
  const tresorerieEntree = r2(tresorerieLines.reduce((a, l) => a + l.amount, 0));

  // --- Alertes
  const forced = settings.zone !== "auto";
  const est = estimateZone(d.code_postal, d.ville);
  const zone = forced ? { zone: settings.zone as keyof typeof ALUR_CAPS, approx: false, forced } : { ...est, forced };
  const cap = ALUR_CAPS[zone.zone];

  if (d.loyer_cc != null && d.charges_mensuelles == null && !d.charges_incluses.length) {
    alerts.push({ level: "warning", code: "charges_floues", message: "« Charges comprises » sans détail : impossible de savoir ce qui est inclus (eau, chauffage, électricité…)." });
  }
  if (d.charges_mensuelles != null && !d.charges_mode) {
    alerts.push({ level: "info", code: "charges_mode", message: "Mode des charges non précisé (provision avec régularisation annuelle ou forfait ?)." });
  }
  if (d.charges_mode === "provision" && d.charges_mensuelles != null && !d.charges_incluses.length) {
    alerts.push({ level: "info", code: "provision", message: "Provision sur charges : une régularisation (à la hausse ou à la baisse) peut intervenir chaque année." });
  }
  const lowConf = ["loyer_hc", "loyer_cc", "charges_mensuelles", "frais_agence", "frais_dossier"].filter(
    (k) => (d as Record<string, unknown>)[k] != null && !listing.editedFields.includes(k) && (d.confiance[k] ?? 1) < 0.6,
  );
  if (lowConf.length) alerts.push({ level: "warning", code: "confiance", message: `Montants incertains à vérifier : ${lowConf.join(", ")}.` });

  if (surface != null && d.frais_agence != null && d.type_offre !== "residence_etudiante") {
    const capHon = cap.honoraires * surface;
    const capEdl = cap.edl * surface;
    const zoneTxt = `${cap.label}${zone.approx ? " (estimée)" : ""}`;
    if (d.frais_etat_des_lieux != null) {
      if (d.frais_agence > capHon + 0.5)
        alerts.push({ level: "danger", code: "alur", message: `Honoraires ${d.frais_agence} € > plafond ALUR ${Math.round(capHon)} € (${cap.honoraires} €/m², ${zoneTxt}).` });
      if (d.frais_etat_des_lieux > capEdl + 0.5)
        alerts.push({ level: "danger", code: "alur_edl", message: `État des lieux ${d.frais_etat_des_lieux} € > plafond ${Math.round(capEdl)} € (3 €/m²).` });
    } else if (d.frais_agence > capHon + capEdl + 0.5) {
      alerts.push({
        level: "danger",
        code: "alur",
        message: `Frais d'agence ${d.frais_agence} € > plafond ALUR ${Math.round(capHon + capEdl)} € (honoraires ${cap.honoraires} €/m² + EDL 3 €/m², ${zoneTxt}).`,
      });
    }
  }
  if (d.dpe === "g") alerts.push({ level: "danger", code: "dpe", message: "DPE G : logement considéré comme indécent, interdit à la location depuis 2025 (passoire thermique)." });
  else if (d.dpe === "f") alerts.push({ level: "warning", code: "dpe", message: "DPE F : passoire thermique (interdit à la location en 2028), factures de chauffage élevées." });

  if (surface != null && loyerAffiche != null && surface > 0) {
    const ref = marketRentPerM2(d.code_postal, d.ville, surface);
    const m2 = loyerAffiche / surface;
    if (m2 < ref * 0.55)
      alerts.push({ level: "danger", code: "loyer_suspect_bas", message: `Loyer très bas (${m2.toFixed(1)} €/m² contre ~${ref.toFixed(0)} €/m² attendu) : vérifiez qu'il ne s'agit pas d'une arnaque (ne versez rien avant la visite).` });
    else if (m2 > ref * 1.6)
      alerts.push({ level: "warning", code: "loyer_suspect_haut", message: `Loyer élevé pour le secteur (${m2.toFixed(1)} €/m² contre ~${ref.toFixed(0)} €/m² attendu).` });
  } else if (surface == null) {
    alerts.push({ level: "info", code: "surface", message: "Surface inconnue : pas de prix au m²." });
  }

  // dépôt de garantie : 1 mois HC (vide), 2 mois HC (meublé) ; bail mobilité : aucun dépôt
  if (d.depot_garantie != null) {
    const hc = d.loyer_hc ?? (d.loyer_cc != null && d.charges_mensuelles != null ? d.loyer_cc - d.charges_mensuelles : null);
    const months = d.meuble === false ? 1 : 2;
    if (/mobilit/i.test(d.type_bail ?? "") && d.depot_garantie > 0) {
      alerts.push({ level: "danger", code: "depot", message: "Dépôt de garantie demandé alors que le bail mobilité l'interdit." });
    } else if (hc != null && d.depot_garantie > hc * months + 1) {
      alerts.push({ level: "danger", code: "depot", message: `Dépôt de garantie ${d.depot_garantie} € > ${months} mois de loyer HC (${hc * months} €), maximum légal.` });
    } else if (hc == null && d.loyer_cc != null && d.depot_garantie > d.loyer_cc * months) {
      alerts.push({ level: "warning", code: "depot", message: `Dépôt de garantie élevé (${d.depot_garantie} €) par rapport au loyer.` });
    }
  }
  if (d.duree_min_mois != null && d.duree_min_mois > duree) {
    alerts.push({ level: "warning", code: "duree", message: `Durée minimale du bail (${d.duree_min_mois} mois) supérieure à votre séjour prévu (${duree} mois).` });
  }

  if (/complet|aucune disponibilit/i.test(d.disponibilite ?? "")) {
    alerts.push({ level: "warning", code: "complet", message: "Aucune disponibilité actuellement pour ce logement." });
  }

  const coutApresApl = listing.aplMensuelle != null && listing.aplMensuelle > 0 ? r2(coutMensuelReel - listing.aplMensuelle) : null;

  return {
    complete,
    loyerAffiche,
    recurring,
    oneOff,
    coutMensuelRecurrent,
    fraisUniques,
    coutMensuelReel,
    coutTotalSejour: r2(coutMensuelReel * duree),
    prixM2Reel: surface ? r2(coutMensuelReel / surface) : null,
    tresorerieEntree,
    tresorerieLines,
    coutApresApl,
    hasEstimates: recurring.some((l) => l.estimated),
    alerts,
    zone,
  };
}

/** Distance à vol d'oiseau (km). */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Temps de trajet estimé en transports en commun (min) : détour ×1,35, 18 km/h, +8 min d'attente/marche. */
export function estimateTransitMinutes(km: number) {
  return Math.round(((km * 1.35) / 18) * 60 + 8);
}
