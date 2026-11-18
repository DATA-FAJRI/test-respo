"use client";
import type { ReactNode } from "react";
import type { Alert } from "@/lib/cost";

const fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

export function euros(n: number | null | undefined, decimals = false) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(decimals ? fmt2 : fmt).format(n)} €`;
}

/** Montant ; en italique avec l'icône « estimé » s'il n'est pas lu dans l'annonce. */
export function Money({ value, estimated, decimals, className = "" }: { value: number | null | undefined; estimated?: boolean; decimals?: boolean; className?: string }) {
  if (!estimated) return <span className={`tabular-nums ${className}`}>{euros(value, decimals)}</span>;
  return (
    <span className={`tabular-nums italic text-amber-800 ${className}`} title="Montant estimé (non lu dans l'annonce)">
      {euros(value, decimals)}
      <EstimatedIcon />
    </span>
  );
}

export function EstimatedIcon() {
  return (
    <span
      aria-label="estimé"
      title="Montant estimé (non lu dans l'annonce)"
      className="ml-1 inline-flex h-4 items-center rounded bg-amber-100 px-1 align-middle text-[10px] font-semibold not-italic leading-none text-amber-800 ring-1 ring-amber-300"
    >
      ≈ estimé
    </span>
  );
}

export function ConfidenceDot({ value, edited }: { value: number | null | undefined; edited?: boolean }) {
  if (edited)
    return <span title="Corrigé à la main" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500" />;
  if (value === null || value === undefined) return <span title="Pas d'information de confiance" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-slate-200" />;
  const color = value >= 0.85 ? "bg-emerald-500" : value >= 0.6 ? "bg-amber-400" : "bg-rose-500";
  return <span title={`Confiance ${Math.round(value * 100)} %`} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />;
}

export function AlertList({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return <p className="text-sm text-emerald-700">Aucune alerte.</p>;
  return (
    <ul className="space-y-1.5">
      {alerts.map((a, i) => (
        <li
          key={i}
          className={`rounded-md px-2.5 py-1.5 text-sm ${
            a.level === "danger" ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200" : a.level === "warning" ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "bg-slate-50 text-slate-700 ring-1 ring-slate-200"
          }`}
        >
          {a.level === "danger" ? "⛔ " : a.level === "warning" ? "⚠️ " : "ℹ️ "}
          {a.message}
        </li>
      ))}
    </ul>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
    secondary: "bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-white text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50",
  }[variant];
  return (
    <button {...props} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles} ${className}`}>
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200";
