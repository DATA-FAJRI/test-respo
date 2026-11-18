"use client";
import { useMemo, useState } from "react";
import {
  CHARGES_MODES,
  DPE_CLASSES,
  HEATING_ENERGIES,
  HEATING_TYPES,
  OFFER_TYPES,
  type Listing,
  type ListingData,
  type Service,
  type Variant,
} from "@/lib/schema";
import type { Settings } from "@/lib/settings";
import { computeCost } from "@/lib/cost";
import { geocode } from "@/lib/geocode";
import { CostBreakdown } from "./CostBreakdown";
import { Button, Card, ConfidenceDot, inputCls } from "./ui";

type FieldType = "text" | "number" | "bool" | "list" | "longtext" | { enum: readonly string[]; labels?: Record<string, string> };
type FieldDef = { key: keyof ListingData; label: string; type: FieldType; unit?: string; wide?: boolean };

const OFFER_LABELS: Record<string, string> = { particulier: "Particulier", agence: "Agence", residence_etudiante: "Résidence étudiante", colocation: "Colocation" };

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Identification",
    fields: [
      { key: "titre", label: "Titre", type: "text", wide: true },
      { key: "url", label: "URL", type: "text", wide: true },
      { key: "source", label: "Site", type: "text" },
      { key: "nom_residence_agence", label: "Résidence / agence / loueur", type: "text" },
      { key: "date_publication", label: "Date de publication", type: "text" },
      { key: "type_offre", label: "Type d'offre", type: { enum: OFFER_TYPES, labels: OFFER_LABELS } },
    ],
  },
  {
    title: "Localisation",
    fields: [
      { key: "adresse", label: "Adresse", type: "text", wide: true },
      { key: "code_postal", label: "Code postal", type: "text" },
      { key: "ville", label: "Ville", type: "text" },
      { key: "quartier", label: "Quartier", type: "text" },
      { key: "latitude", label: "Latitude", type: "number" },
      { key: "longitude", label: "Longitude", type: "number" },
      { key: "transports", label: "Transports à proximité", type: "list", wide: true },
    ],
  },
  {
    title: "Logement",
    fields: [
      { key: "type_logement", label: "Type (chambre, studio, T1…)", type: "text" },
      { key: "surface_m2", label: "Surface", type: "number", unit: "m²" },
      { key: "nb_pieces", label: "Pièces", type: "number" },
      { key: "etage", label: "Étage", type: "number" },
      { key: "nb_etages", label: "Nombre d'étages", type: "number" },
      { key: "ascenseur", label: "Ascenseur", type: "bool" },
      { key: "meuble", label: "Meublé", type: "bool" },
      { key: "chauffage_type", label: "Chauffage", type: { enum: HEATING_TYPES } },
      { key: "chauffage_energie", label: "Énergie de chauffage", type: { enum: HEATING_ENERGIES } },
      { key: "dpe", label: "DPE", type: { enum: DPE_CLASSES } },
      { key: "ges", label: "GES", type: { enum: DPE_CLASSES } },
      { key: "depenses_energie_min", label: "Dépenses énergie min", type: "number", unit: "€/an" },
      { key: "depenses_energie_max", label: "Dépenses énergie max", type: "number", unit: "€/an" },
      { key: "disponibilite", label: "Disponibilité", type: "text" },
      { key: "duree_min_mois", label: "Durée min. du bail", type: "number", unit: "mois" },
      { key: "duree_max_mois", label: "Durée max. du bail", type: "number", unit: "mois" },
      { key: "type_bail", label: "Type de bail", type: "text" },
      { key: "equipements", label: "Équipements", type: "list", wide: true },
    ],
  },
  {
    title: "Prix",
    fields: [
      { key: "loyer_hc", label: "Loyer hors charges", type: "number", unit: "€/mois" },
      { key: "charges_mensuelles", label: "Charges", type: "number", unit: "€/mois" },
      { key: "charges_mode", label: "Mode des charges", type: { enum: CHARGES_MODES } },
      { key: "loyer_cc", label: "Loyer charges comprises (affiché)", type: "number", unit: "€/mois" },
      { key: "charges_incluses", label: "Charges incluses", type: "list", wide: true },
      { key: "charges_non_incluses", label: "Charges NON incluses", type: "list", wide: true },
      { key: "frais_agence", label: "Honoraires d'agence", type: "number", unit: "€" },
      { key: "frais_etat_des_lieux", label: "État des lieux", type: "number", unit: "€" },
      { key: "frais_dossier", label: "Frais de dossier / plateforme", type: "number", unit: "€" },
      { key: "depot_garantie", label: "Dépôt de garantie", type: "number", unit: "€" },
      { key: "assurance_obligatoire", label: "Assurance obligatoire", type: "bool" },
      { key: "garant_requis", label: "Garant requis", type: "bool" },
      { key: "visale_accepte", label: "Visale accepté", type: "bool" },
      { key: "eligible_apl", label: "Éligible APL/ALS", type: "bool" },
    ],
  },
];

export type EditorProps = {
  listing: Listing;
  settings: Settings;
  isNew: boolean;
  onSave: (listings: Listing[]) => void;
  onCancel: () => void;
  onDelete?: () => void;
  warnings?: string[];
};

export function ListingEditor({ listing, settings, isNew, onSave, onCancel, onDelete, warnings = [] }: EditorProps) {
  const [draft, setDraft] = useState<Listing>(listing);
  const [selectedVariants, setSelectedVariants] = useState<number[]>(() => {
    const v = listing.data.variantes;
    if (!isNew || v.length < 2) return [];
    const idx = v.findIndex((x) => x.disponible);
    return [idx >= 0 ? idx : 0];
  });
  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const cost = useMemo(() => computeCost(draft, settings), [draft, settings]);
  const d = draft.data;

  const update = (key: keyof ListingData, value: unknown) => {
    setDraft((prev) => ({
      ...prev,
      data: { ...prev.data, [key]: value },
      editedFields: prev.editedFields.includes(key) ? prev.editedFields : [...prev.editedFields, key],
    }));
  };

  const applyVariant = (v: Variant) => {
    setDraft((prev) => ({ ...prev, data: variantData(prev.data, v) }));
  };

  const doGeocode = async () => {
    const q = d.adresse ?? [d.code_postal, d.ville].filter(Boolean).join(" ");
    if (!q) return setGeoStatus("Saisissez une adresse ou une ville.");
    setGeoStatus("Géocodage…");
    try {
      const [r] = await geocode(q);
      if (!r) return setGeoStatus("Adresse introuvable.");
      setDraft((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          latitude: r.lat,
          longitude: r.lon,
          code_postal: prev.data.code_postal ?? r.postcode,
          ville: prev.data.ville ?? r.city,
          confiance: { ...prev.data.confiance, latitude: Math.min(0.95, r.score), longitude: Math.min(0.95, r.score) },
        },
      }));
      setGeoStatus(`Trouvé : ${r.label} (score ${Math.round(r.score * 100)} %)`);
    } catch (e) {
      setGeoStatus(e instanceof Error ? e.message : "Erreur de géocodage");
    }
  };

  const save = () => {
    const now = new Date().toISOString();
    const base = { ...draft, updatedAt: now };
    if (isNew && selectedVariants.length > 1) {
      // une annonce par variante cochée
      onSave(
        selectedVariants.map((i, k) => ({
          ...base,
          id: k === 0 ? base.id : `${base.id}-${i}`,
          data: variantData(base.data, d.variantes[i]),
        })),
      );
    } else onSave([base]);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        {warnings.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            {warnings.map((w, i) => (
              <p key={i}>⚠️ {w}</p>
            ))}
          </div>
        )}

        {d.variantes.length > 1 && (
          <Card title={`Types de logement dans l'annonce (${d.variantes.length})`}>
            <p className="mb-2 text-sm text-slate-600">
              {isNew
                ? "Cochez les logements à ajouter au comparatif (une ligne par logement). Cliquez sur « Afficher » pour remplir la fiche avec un type."
                : "Cliquez sur « Afficher » pour remplacer les valeurs de la fiche par celles d'un type."}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    {isNew && <th className="w-8" />}
                    <th>Type</th>
                    <th>Surface</th>
                    <th>Loyer</th>
                    <th>Dépôt</th>
                    <th>Frais</th>
                    <th>Dispo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.variantes.map((v, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {isNew && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Ajouter ${v.nom ?? "ce logement"}`}
                            checked={selectedVariants.includes(i)}
                            onChange={(e) => setSelectedVariants((s) => (e.target.checked ? [...s, i].sort() : s.filter((x) => x !== i)))}
                          />
                        </td>
                      )}
                      <td className="py-1.5 font-medium">{v.nom ?? `Type ${i + 1}`}</td>
                      <td>
                        {v.surface_m2 ?? "—"}
                        {v.surface_max_m2 && v.surface_max_m2 !== v.surface_m2 ? `–${v.surface_max_m2}` : ""} m²
                      </td>
                      <td>
                        {v.loyer_cc ?? v.loyer_hc ?? "—"} € {v.loyer_cc != null ? "CC" : v.loyer_hc != null ? "HC" : ""}
                      </td>
                      <td>{v.depot_garantie ?? "—"} €</td>
                      <td>{v.frais_dossier ?? "—"} €</td>
                      <td className={v.disponible === false ? "text-slate-400" : "text-emerald-700"}>
                        {v.disponible === false ? "complet" : v.disponibilite ?? "?"}
                      </td>
                      <td className="text-right">
                        <button type="button" className="text-emerald-700 underline" onClick={() => applyVariant(v)}>
                          Afficher
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {SECTIONS.map((section) => (
          <Card key={section.title} title={section.title}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {section.fields.map((f) => (
                <Field key={f.key} def={f} value={d[f.key]} confidence={d.confiance[f.key]} edited={draft.editedFields.includes(f.key)} onChange={(v) => update(f.key, v)} />
              ))}
              {section.title === "Localisation" && (
                <div className="sm:col-span-2">
                  <Button type="button" onClick={doGeocode}>
                    📍 Géocoder l&apos;adresse (Base Adresse Nationale)
                  </Button>
                  {geoStatus && <span className="ml-2 text-sm text-slate-600">{geoStatus}</span>}
                </div>
              )}
              {section.title === "Prix" && <ServicesEditor services={d.services} onChange={(s) => update("services", s)} />}
            </div>
          </Card>
        ))}

        <Card title="Qualité de l'extraction">
          <p className="mb-2 text-xs text-slate-500">
            Méthode : {draft.extraction.method}
            {draft.extraction.adapter ? ` · adaptateur ${draft.extraction.adapter}` : ""}
            {draft.extraction.llm ? " · LLM" : ""}
            {draft.extraction.fetchedAt ? ` · page lue le ${new Date(draft.extraction.fetchedAt).toLocaleString("fr-FR")}` : ""}
          </p>
          <p className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><ConfidenceDot value={0.9} /> sûr</span>
            <span className="flex items-center gap-1"><ConfidenceDot value={0.7} /> à vérifier</span>
            <span className="flex items-center gap-1"><ConfidenceDot value={0.3} /> douteux</span>
            <span className="flex items-center gap-1"><ConfidenceDot value={null} /> non renseigné</span>
            <span className="flex items-center gap-1"><ConfidenceDot value={1} edited /> corrigé à la main</span>
          </p>
          {d.notes.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {d.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Aucune ambiguïté signalée.</p>
          )}
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card title="Coût réel">
          <CostBreakdown cost={cost} duree={settings.dureeMois} />
          <label className="mt-4 block text-sm">
            <span className="text-slate-600">APL estimée (€/mois, optionnel)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              className={inputCls}
              value={draft.aplMensuelle ?? ""}
              onChange={(e) => setDraft((p) => ({ ...p, aplMensuelle: e.target.value === "" ? null : Number(e.target.value) }))}
            />
          </label>
          <label className="mt-3 block text-sm">
            <span className="text-slate-600">Commentaire</span>
            <textarea className={inputCls} rows={2} value={draft.commentaire} onChange={(e) => setDraft((p) => ({ ...p, commentaire: e.target.value }))} />
          </label>
        </Card>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={save} disabled={isNew && d.variantes.length > 1 && selectedVariants.length === 0}>
            {isNew ? (selectedVariants.length > 1 ? `Ajouter ${selectedVariants.length} logements au comparatif` : "Ajouter au comparatif") : "Enregistrer"}
          </Button>
          <Button onClick={onCancel}>Annuler</Button>
          {onDelete && (
            <Button variant="danger" onClick={onDelete}>
              Supprimer
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Remplace les champs principaux par ceux d'une variante. */
export function variantData(data: ListingData, v: Variant): ListingData {
  const baseTitle = (data.titre ?? "").replace(/\s+—\s+.*$/, "");
  const conf = { ...data.confiance };
  const out: ListingData = { ...data };
  const map: [keyof Variant, keyof ListingData][] = [
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
  for (const [from, to] of map) {
    (out as Record<string, unknown>)[to] = v[from] ?? (Array.isArray(data[to]) ? [] : null);
    conf[to] = v[from] != null ? (from === "surface_m2" && v.surface_max_m2 && v.surface_max_m2 !== v.surface_m2 ? 0.8 : 0.95) : null;
  }
  out.titre = v.nom ? `${baseTitle} — ${v.nom}` : baseTitle;
  out.confiance = conf;
  return out;
}

function Field({ def, value, confidence, edited, onChange }: { def: FieldDef; value: unknown; confidence: number | null | undefined; edited: boolean; onChange: (v: unknown) => void }) {
  const id = `f-${def.key}`;
  const shown = value === null || value === undefined || (Array.isArray(value) && value.length === 0) ? null : confidence;
  let input: React.ReactNode;
  if (def.type === "number") {
    input = (
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        className={inputCls}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    );
  } else if (def.type === "bool") {
    input = (
      <select id={id} className={inputCls} value={value === true ? "oui" : value === false ? "non" : ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "oui")}>
        <option value="">— inconnu —</option>
        <option value="oui">Oui</option>
        <option value="non">Non</option>
      </select>
    );
  } else if (def.type === "list") {
    input = <ListInput id={id} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />;
  } else if (typeof def.type === "object") {
    const t = def.type;
    input = (
      <select id={id} className={inputCls} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— inconnu —</option>
        {t.enum.map((o) => (
          <option key={o} value={o}>
            {t.labels?.[o] ?? (o.length === 1 ? o.toUpperCase() : o.replace(/_/g, " "))}
          </option>
        ))}
      </select>
    );
  } else {
    input = <input id={id} type="text" className={inputCls} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />;
  }
  return (
    <div className={def.wide || def.type === "list" ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <ConfidenceDot value={shown} edited={edited} />
        {def.label}
        {def.unit && <span className="text-slate-400">({def.unit})</span>}
      </label>
      {input}
    </div>
  );
}

function ServicesEditor({ services, onChange }: { services: Service[]; onChange: (s: Service[]) => void }) {
  const set = (i: number, patch: Partial<Service>) => onChange(services.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const num = (v: string) => (v === "" ? null : Number(v));
  return (
    <div className="sm:col-span-2">
      <div className="mb-1 text-xs font-medium text-slate-600">Services payants de la résidence (ménage, linge, parking, laverie…)</div>
      {services.length === 0 && <p className="text-sm text-slate-400">Aucun service payant.</p>}
      <div className="space-y-2">
        {services.map((s, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-[1fr_110px_110px_auto_auto]">
            <input aria-label="Nom du service" className={`${inputCls} col-span-2 sm:col-span-1`} value={s.nom} onChange={(e) => set(i, { nom: e.target.value })} />
            <input aria-label="Prix mensuel" placeholder="€/mois" type="number" className={inputCls} value={s.prix_mensuel ?? ""} onChange={(e) => set(i, { prix_mensuel: num(e.target.value) })} />
            <input aria-label="Prix unique" placeholder="€ unique" type="number" className={inputCls} value={s.prix_unique ?? ""} onChange={(e) => set(i, { prix_unique: num(e.target.value) })} />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={!!s.obligatoire} onChange={(e) => set(i, { obligatoire: e.target.checked })} /> obligatoire
            </label>
            <button type="button" className="text-xs text-rose-700" onClick={() => onChange(services.filter((_, k) => k !== i))}>
              Retirer
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="mt-2 text-sm text-emerald-700 underline" onClick={() => onChange([...services, { nom: "Service", prix_mensuel: null, prix_unique: null, obligatoire: false }])}>
        + Ajouter un service
      </button>
    </div>
  );
}

const splitLines = (t: string) => t.split("\n").map((s) => s.trim()).filter(Boolean);

/** Liste éditable (un élément par ligne) : garde le texte brut pendant la saisie. */
function ListInput({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join("\n"));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    if (JSON.stringify(value) !== JSON.stringify(splitLines(text))) setText(value.join("\n"));
  }
  return (
    <textarea
      id={id}
      rows={Math.min(6, Math.max(2, value.length))}
      className={inputCls}
      placeholder="Un élément par ligne"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(splitLines(e.target.value));
      }}
    />
  );
}
