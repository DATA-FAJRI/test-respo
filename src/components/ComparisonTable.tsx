"use client";
import { useMemo, useState } from "react";
import type { Listing } from "@/lib/schema";
import type { Settings } from "@/lib/settings";
import { computeCost, estimateTransitMinutes, haversineKm, type CostResult } from "@/lib/cost";
import { Money } from "./ui";

type SortKey = "cout" | "m2" | "surface" | "distance" | "loyer" | "tresorerie" | "total";
type Row = { listing: Listing; cost: CostResult; distanceKm: number | null; minutes: number | null };

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "loyer", label: "Loyer affiché" },
  { key: "cout", label: "Coût mensuel réel" },
  { key: "m2", label: "€/m² réel" },
  { key: "surface", label: "Surface" },
  { key: "total", label: "Total séjour" },
  { key: "tresorerie", label: "Trésorerie entrée" },
  { key: "distance", label: "Distance" },
];

function value(r: Row, k: SortKey): number | null {
  switch (k) {
    case "cout":
      return r.cost.complete ? r.cost.coutMensuelReel : null;
    case "m2":
      return r.cost.complete ? r.cost.prixM2Reel : null;
    case "surface":
      return r.listing.data.surface_m2;
    case "distance":
      return r.distanceKm;
    case "loyer":
      return r.cost.loyerAffiche;
    case "tresorerie":
      return r.cost.tresorerieEntree;
    case "total":
      return r.cost.complete ? r.cost.coutTotalSejour : null;
  }
}

/** Vert (moins cher) → rouge (plus cher), sur une échelle de rang. */
function heat(rank: number, n: number) {
  if (n <= 1) return "hsl(142 70% 92%)";
  const t = rank / (n - 1);
  const hue = 142 - t * 142; // 142 = vert, 0 = rouge
  return `hsl(${hue} 75% 91%)`;
}

export function ComparisonTable({ listings, settings, onOpen }: { listings: Listing[]; settings: Settings; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "cout", dir: 1 });

  const rows: Row[] = useMemo(
    () =>
      listings.map((l) => {
        const cost = computeCost(l, settings);
        const km =
          settings.reference && l.data.latitude != null && l.data.longitude != null
            ? haversineKm(settings.reference, { lat: l.data.latitude, lon: l.data.longitude })
            : null;
        return { listing: l, cost, distanceKm: km, minutes: km != null ? estimateTransitMinutes(km) : null };
      }),
    [listings, settings],
  );

  const ranked = useMemo(() => {
    const complete = rows.filter((r) => r.cost.complete).sort((a, b) => a.cost.coutMensuelReel - b.cost.coutMensuelReel);
    const rank = new Map(complete.map((r, i) => [r.listing.id, i]));
    // la meilleure offre doit être disponible
    const best = complete.find((r) => !r.cost.alerts.some((a) => a.code === "complet")) ?? null;
    return { rank, n: complete.length, bestId: best?.listing.id ?? null };
  }, [rows]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sort.dir;
    });
  }, [rows, sort]);

  if (!listings.length) {
    return <p className="py-8 text-center text-sm text-slate-500">Aucune annonce pour l&apos;instant. Collez un lien ci-dessus pour commencer.</p>;
  }

  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  const bg = (r: Row) => (ranked.rank.has(r.listing.id) ? heat(ranked.rank.get(r.listing.id)!, ranked.n) : undefined);

  return (
    <>
      {/* Mobile : cartes */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm md:hidden">
        <label htmlFor="sort-mobile" className="text-slate-600">
          Trier par
        </label>
        <select id="sort-mobile" className="rounded-md border border-slate-300 bg-white px-2 py-1" value={`${sort.key}:${sort.dir}`} onChange={(e) => {
          const [key, dir] = e.target.value.split(":");
          setSort({ key: key as SortKey, dir: Number(dir) as 1 | -1 });
        }}>
          {COLUMNS.flatMap((c) => [
            <option key={`${c.key}:1`} value={`${c.key}:1`}>{c.label} ↑</option>,
            <option key={`${c.key}:-1`} value={`${c.key}:-1`}>{c.label} ↓</option>,
          ])}
        </select>
      </div>
      <ul className="space-y-3 md:hidden">
        {sorted.map((r) => (
          <li key={r.listing.id}>
            <button onClick={() => onOpen(r.listing.id)} className="w-full rounded-xl p-3 text-left ring-1 ring-slate-200" style={{ background: bg(r) ?? "white" }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {r.listing.id === ranked.bestId && <BestBadge />}
                  <div className="line-clamp-2 font-semibold text-slate-900">{r.listing.data.titre ?? "Sans titre"}</div>
                  <div className="text-xs text-slate-600">
                    {[r.listing.data.ville, r.listing.data.source, r.listing.data.surface_m2 ? `${r.listing.data.surface_m2} m²` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold">{r.cost.complete ? <Money value={r.cost.coutMensuelReel} estimated={r.cost.hasEstimates} /> : "—"}</div>
                  <div className="text-xs text-slate-600">réel / mois</div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-700">
                <span>Affiché <Money value={r.cost.loyerAffiche} /></span>
                <span>{r.cost.prixM2Reel != null ? <Money value={r.cost.prixM2Reel} estimated={r.cost.hasEstimates} decimals /> : "—"} /m²</span>
                <span>{r.distanceKm != null ? `${r.distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km · ~${r.minutes} min` : ""}</span>
              </div>
              <AlertIcons cost={r.cost} />
            </button>
          </li>
        ))}
      </ul>

      {/* Desktop : tableau */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 bg-white px-3 py-2">Logement</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right" aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button onClick={() => toggle(c.key)} className={`whitespace-nowrap uppercase hover:text-slate-900 ${sort.key === c.key ? "text-slate-900" : ""}`}>
                    {c.label} {sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2">Alertes</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const best = r.listing.id === ranked.bestId;
              return (
                <tr key={r.listing.id} onClick={() => onOpen(r.listing.id)} className={`cursor-pointer ${best ? "outline outline-2 -outline-offset-2 outline-emerald-600" : ""}`} style={{ background: bg(r) }}>
                  <td className="sticky left-0 max-w-[280px] border-b border-white/70 px-3 py-2" style={{ background: bg(r) ?? "white" }}>
                    {best && <BestBadge />}
                    <div className="line-clamp-2 font-medium text-slate-900" title={r.listing.data.titre ?? ""}>
                      {r.listing.data.titre ?? "Sans titre"}
                    </div>
                    <div className="truncate text-xs text-slate-600">
                      {[r.listing.data.ville, r.listing.data.type_logement, r.listing.data.source].filter(Boolean).join(" · ")}
                      {r.listing.data.url && (
                        <a href={r.listing.data.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-1 text-emerald-700 underline">
                          annonce ↗
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="border-b border-white/70 px-3 py-2 text-right"><Money value={r.cost.loyerAffiche} /></td>
                  <td className="border-b border-white/70 px-3 py-2 text-right text-base font-bold">
                    {r.cost.complete ? <Money value={r.cost.coutMensuelReel} estimated={r.cost.hasEstimates} /> : "—"}
                    {r.cost.coutApresApl != null && <div className="text-xs font-normal text-slate-600">après APL <Money value={r.cost.coutApresApl} /></div>}
                  </td>
                  <td className="border-b border-white/70 px-3 py-2 text-right">{r.cost.complete ? <Money value={r.cost.prixM2Reel} estimated={r.cost.hasEstimates} decimals /> : "—"}</td>
                  <td className="border-b border-white/70 px-3 py-2 text-right tabular-nums">{r.listing.data.surface_m2 != null ? `${r.listing.data.surface_m2} m²` : "—"}</td>
                  <td className="border-b border-white/70 px-3 py-2 text-right">{r.cost.complete ? <Money value={r.cost.coutTotalSejour} estimated={r.cost.hasEstimates} /> : "—"}</td>
                  <td className="border-b border-white/70 px-3 py-2 text-right"><Money value={r.cost.tresorerieEntree} /></td>
                  <td className="border-b border-white/70 px-3 py-2 text-right tabular-nums">
                    {r.distanceKm != null ? (
                      <>
                        {r.distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km
                        <div className="text-xs italic text-slate-600" title="Temps estimé en transports en commun (vol d'oiseau × 1,35 à 18 km/h + 8 min)">
                          ≈ {r.minutes} min
                        </div>
                      </>
                    ) : settings.reference ? (
                      <span className="text-xs text-slate-500">pas de coordonnées</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="border-b border-white/70 px-3 py-2"><AlertIcons cost={r.cost} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Couleur : du vert (coût mensuel réel le plus bas) au rouge (le plus haut). Les montants en <span className="italic text-amber-800">italique ≈ estimé</span> contiennent des estimations (postes non inclus dans l&apos;annonce). Cliquez sur une ligne pour voir le détail et corriger la fiche.
      </p>
    </>
  );
}

function BestBadge() {
  return <span className="mb-0.5 inline-block rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">★ Meilleure offre</span>;
}

function AlertIcons({ cost }: { cost: CostResult }) {
  const shown = cost.alerts.filter((a) => a.level !== "info");
  if (!shown.length) return <span className="text-xs text-emerald-700">✓</span>;
  return (
    <ul className="mt-1 space-y-0.5">
      {shown.slice(0, 3).map((a, i) => (
        <li key={i} className={`max-w-[260px] truncate text-xs ${a.level === "danger" ? "text-rose-700" : "text-amber-800"}`} title={a.message}>
          {a.level === "danger" ? "⛔" : "⚠️"} {a.message}
        </li>
      ))}
      {shown.length > 3 && <li className="text-xs text-slate-500">+{shown.length - 3} autre(s)</li>}
    </ul>
  );
}
