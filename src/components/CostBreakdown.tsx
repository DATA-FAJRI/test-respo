"use client";
import type { CostResult } from "@/lib/cost";
import { AlertList, Money } from "./ui";

export function CostBreakdown({ cost, duree }: { cost: CostResult; duree: number }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Coût mensuel réel" main>
          <Money value={cost.coutMensuelReel} estimated={cost.hasEstimates} />
        </Kpi>
        <Kpi label="€/m² réel">
          <Money value={cost.prixM2Reel} estimated={cost.hasEstimates} decimals />
        </Kpi>
        <Kpi label={`Total sur ${duree} mois`}>
          <Money value={cost.coutTotalSejour} estimated={cost.hasEstimates} />
        </Kpi>
        <Kpi label="Trésorerie à l'entrée">
          <Money value={cost.tresorerieEntree} />
        </Kpi>
        {cost.coutApresApl != null && (
          <Kpi label="Après APL">
            <Money value={cost.coutApresApl} estimated={cost.hasEstimates} />
          </Kpi>
        )}
      </div>

      <div>
        <h3 className="mb-1 font-semibold text-slate-800">Coût mensuel récurrent</h3>
        <Lines lines={cost.recurring} total={cost.coutMensuelRecurrent} totalEstimated={cost.hasEstimates} />
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-slate-800">Frais uniques</h3>
        {cost.oneOff.length ? (
          <>
            <Lines lines={cost.oneOff} total={cost.fraisUniques} />
            <p className="mt-1 text-xs text-slate-500">
              Lissés sur {duree} mois : <Money value={cost.fraisUniques / duree} decimals /> / mois
            </p>
          </>
        ) : (
          <p className="text-slate-500">Aucun frais unique indiqué.</p>
        )}
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-slate-800">Trésorerie à l&apos;entrée</h3>
        <Lines lines={cost.tresorerieLines} total={cost.tresorerieEntree} />
        <p className="mt-1 text-xs text-slate-500">Le dépôt de garantie est remboursable en fin de bail : il n&apos;entre pas dans le coût réel.</p>
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-slate-800">Alertes</h3>
        <AlertList alerts={cost.alerts} />
      </div>
    </div>
  );
}

function Kpi({ label, children, main }: { label: string; children: React.ReactNode; main?: boolean }) {
  return (
    <div className={`rounded-lg p-2.5 ${main ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-slate-50 ring-1 ring-slate-200"}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`${main ? "text-xl font-bold text-emerald-900" : "text-lg font-semibold text-slate-900"}`}>{children}</div>
    </div>
  );
}

function Lines({ lines, total, totalEstimated }: { lines: CostResult["recurring"]; total: number; totalEstimated?: boolean }) {
  return (
    <table className="w-full">
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} className="border-b border-slate-100 last:border-0">
            <td className={`py-1 pr-2 ${l.estimated ? "italic text-amber-900" : "text-slate-700"}`}>
              {l.label}
              {l.note && <span className="block text-xs not-italic text-slate-400">{l.note}</span>}
            </td>
            <td className="py-1 text-right align-top">
              <Money value={l.amount} estimated={l.estimated} decimals />
            </td>
          </tr>
        ))}
        <tr className="border-t border-slate-300 font-semibold">
          <td className="pt-1">Total</td>
          <td className="pt-1 text-right">
            <Money value={total} estimated={totalEstimated} decimals />
          </td>
        </tr>
      </tbody>
    </table>
  );
}
