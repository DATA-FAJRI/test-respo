"use client";
import type { Listing } from "./schema";
import type { Settings } from "./settings";
import { computeCost, estimateTransitMinutes, haversineKm } from "./cost";

type Row = { header: string; value: (l: Listing) => string | number | null; estimated?: (l: Listing) => boolean };

function rows(settings: Settings): Row[] {
  const c = (l: Listing) => computeCost(l, settings);
  const dist = (l: Listing) =>
    settings.reference && l.data.latitude != null && l.data.longitude != null
      ? Math.round(haversineKm(settings.reference, { lat: l.data.latitude, lon: l.data.longitude }) * 10) / 10
      : null;
  return [
    { header: "Titre", value: (l) => l.data.titre },
    { header: "Source", value: (l) => l.data.source },
    { header: "URL", value: (l) => l.data.url },
    { header: "Type d'offre", value: (l) => l.data.type_offre },
    { header: "Résidence / agence", value: (l) => l.data.nom_residence_agence },
    { header: "Adresse", value: (l) => l.data.adresse },
    { header: "Code postal", value: (l) => l.data.code_postal },
    { header: "Ville", value: (l) => l.data.ville },
    { header: "Type", value: (l) => l.data.type_logement },
    { header: "Surface (m²)", value: (l) => l.data.surface_m2 },
    { header: "Meublé", value: (l) => (l.data.meuble == null ? null : l.data.meuble ? "oui" : "non") },
    { header: "DPE", value: (l) => l.data.dpe?.toUpperCase() ?? null },
    { header: "Loyer HC", value: (l) => l.data.loyer_hc },
    { header: "Charges", value: (l) => l.data.charges_mensuelles },
    { header: "Loyer CC affiché", value: (l) => l.data.loyer_cc },
    { header: "Charges incluses", value: (l) => l.data.charges_incluses.join(", ") },
    { header: "Frais d'agence", value: (l) => l.data.frais_agence },
    { header: "Frais état des lieux", value: (l) => l.data.frais_etat_des_lieux },
    { header: "Frais dossier/plateforme", value: (l) => l.data.frais_dossier },
    { header: "Dépôt de garantie", value: (l) => l.data.depot_garantie },
    { header: "Coût mensuel récurrent", value: (l) => c(l).coutMensuelRecurrent, estimated: (l) => c(l).hasEstimates },
    { header: "Frais uniques", value: (l) => c(l).fraisUniques },
    { header: `Coût mensuel réel (${settings.dureeMois} mois)`, value: (l) => c(l).coutMensuelReel, estimated: (l) => c(l).hasEstimates },
    { header: "Dont estimations", value: (l) => c(l).recurring.filter((x) => x.estimated).map((x) => `${x.label} ${x.amount}€`).join(" ; ") },
    { header: "Coût total séjour", value: (l) => c(l).coutTotalSejour, estimated: (l) => c(l).hasEstimates },
    { header: "€/m² réel", value: (l) => c(l).prixM2Reel },
    { header: "Trésorerie à l'entrée", value: (l) => c(l).tresorerieEntree },
    { header: "APL saisie", value: (l) => l.aplMensuelle },
    { header: "Coût après APL", value: (l) => c(l).coutApresApl },
    { header: "Distance (km, vol d'oiseau)", value: dist },
    { header: "Trajet TC estimé (min)", value: (l) => (dist(l) != null ? estimateTransitMinutes(dist(l)!) : null) },
    { header: "Alertes", value: (l) => c(l).alerts.map((a) => a.message).join(" | ") },
    { header: "Notes d'extraction", value: (l) => l.data.notes.join(" | ") },
    { header: "Commentaire", value: (l) => l.commentaire },
  ];
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportCsv(listings: Listing[], settings: Settings) {
  const cols = rows(settings);
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => esc(c.header)).join(";"), ...listings.map((l) => cols.map((c) => esc(c.value(l))).join(";"))];
  // BOM + séparateur ";" : s'ouvre correctement dans Excel en français
  download(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `loccompare-${stamp()}.csv`);
}

export async function exportXlsx(listings: Listing[], settings: Settings) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const cols = rows(settings);
  const header = cols.map((c) => ({ value: c.header, fontWeight: "bold" as const }));
  const body = listings.map((l) =>
    cols.map((c) => {
      const v = c.value(l);
      const italic = c.estimated?.(l) ?? false;
      return v === null || v === "" ? null : { value: v, ...(italic ? { fontStyle: "italic" as const } : {}) };
    }),
  );
  const blob = await writeXlsxFile([header, ...body], { columns: cols.map((c) => ({ width: Math.min(40, Math.max(10, c.header.length + 2)) })) }).toBlob();
  download(blob, `loccompare-${stamp()}.xlsx`);
}

export function exportJson(listings: Listing[], settings: Settings) {
  download(new Blob([JSON.stringify({ version: 1, settings, listings }, null, 2)], { type: "application/json" }), `loccompare-sauvegarde-${stamp()}.json`);
}
