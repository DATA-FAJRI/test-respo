"use client";
import { useState } from "react";
import type { Settings, Zone } from "@/lib/settings";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { geocode, type GeoResult } from "@/lib/geocode";
import { Button, Card, inputCls } from "./ui";

export function SettingsPanel({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [geoError, setGeoError] = useState<string | null>(null);
  const est = settings.estimations;
  const setEst = (k: keyof Settings["estimations"], v: string) => onChange({ ...settings, estimations: { ...est, [k]: v === "" ? 0 : Number(v) } });

  const search = async () => {
    setGeoError(null);
    try {
      const r = await geocode(query);
      setResults(r);
      if (!r.length) setGeoError("Aucune adresse trouvée.");
    } catch (e) {
      setGeoError(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <Card
      title="Paramètres du calcul"
      actions={
        <Button variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Masquer" : "Modifier"}
        </Button>
      }
    >
      <p className="text-sm text-slate-600">
        Séjour de <strong>{settings.dureeMois} mois</strong> · électricité {est.electricite} € · internet {est.internet} € · assurance {est.assurance} € · eau {est.eau} € / mois
        {settings.reference ? (
          <>
            {" "}· distances depuis <strong>{settings.reference.label}</strong>
          </>
        ) : (
          " · aucune adresse de référence"
        )}
      </p>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Num label="Durée de séjour (mois)" value={settings.dureeMois} onChange={(v) => onChange({ ...settings, dureeMois: Math.max(1, Number(v) || 1) })} />
            <Num label="Électricité (€/mois)" value={est.electricite} onChange={(v) => setEst("electricite", v)} />
            <Num label="Internet (€/mois)" value={est.internet} onChange={(v) => setEst("internet", v)} />
            <Num label="Assurance (€/mois)" value={est.assurance} onChange={(v) => setEst("assurance", v)} />
            <Num label="Eau (€/mois)" value={est.eau} onChange={(v) => setEst("eau", v)} />
            <Num label="Chauffage (€/kWh)" value={est.prixKwhChauffage} step="0.01" onChange={(v) => setEst("prixKwhChauffage", v)} />
          </div>
          <p className="text-xs text-slate-500">
            Chauffage individuel non inclus : estimation DPE de l&apos;annonce si elle existe, sinon surface × consommation type selon la classe DPE (D si inconnue) × prix du kWh.
          </p>
          <label className="block max-w-xs text-sm">
            <span className="text-slate-600">Zone (plafonds d&apos;honoraires ALUR)</span>
            <select className={inputCls} value={settings.zone} onChange={(e) => onChange({ ...settings, zone: e.target.value as Zone })}>
              <option value="auto">Automatique (estimée selon le code postal)</option>
              <option value="tres_tendue">Très tendue (12 €/m² + 3 €/m²)</option>
              <option value="tendue">Tendue (10 €/m² + 3 €/m²)</option>
              <option value="non_tendue">Non tendue (8 €/m² + 3 €/m²)</option>
            </select>
          </label>
          <div>
            <span className="text-sm text-slate-600">Adresse de référence (école, travail)</span>
            <form
              className="mt-1 flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                search();
              }}
            >
              <input className={inputCls} placeholder="ex. 12 rue de l'École de Médecine, Paris" value={query} onChange={(e) => setQuery(e.target.value)} />
              <Button type="submit">Rechercher</Button>
              {settings.reference && (
                <Button type="button" variant="ghost" onClick={() => onChange({ ...settings, reference: null })}>
                  Retirer
                </Button>
              )}
            </form>
            {geoError && <p className="mt-1 text-sm text-rose-700">{geoError}</p>}
            {results.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-100 rounded-md ring-1 ring-slate-200">
                {results.map((r) => (
                  <li key={`${r.lat},${r.lon}`}>
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:bg-emerald-50"
                      onClick={() => {
                        onChange({ ...settings, reference: { label: r.label, lat: r.lat, lon: r.lon } });
                        setResults([]);
                        setQuery("");
                      }}
                    >
                      {r.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button variant="ghost" onClick={() => onChange({ ...DEFAULT_SETTINGS, reference: settings.reference })}>
            Rétablir les valeurs par défaut
          </Button>
        </div>
      )}
    </Card>
  );
}

function Num({ label, value, onChange, step = "1" }: { label: string; value: number; onChange: (v: string) => void; step?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-slate-600">{label}</span>
      <input type="number" inputMode="decimal" min={0} step={step} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
