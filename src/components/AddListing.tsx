"use client";
import { useState } from "react";
import { emptyListingData, type ExtractResponse, type ListingData } from "@/lib/schema";
import { Button, Card, inputCls } from "./ui";

type Tab = "url" | "texte" | "manuel";

export type DraftPayload = {
  data: ListingData;
  extraction: { method: string; adapter: string | null; llm: boolean; fetchedAt: string | null };
  warnings: string[];
};

export function AddListing({ onDraft, llm }: { onDraft: (p: DraftPayload) => void; llm: { available: boolean; model: string | null } | null }) {
  const [tab, setTab] = useState<Tab>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [textUrl, setTextUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (body: object) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as ExtractResponse;
      if (!json.ok || !json.data) throw new Error(json.error ?? `Erreur ${res.status}`);
      onDraft({
        data: json.data,
        extraction: { method: json.method ?? "?", adapter: json.adapter ?? null, llm: !!json.llm, fetchedAt: json.fetchedAt ?? null },
        warnings: [...(json.warnings ?? []), ...(json.cached ? ["Résultat servi depuis le cache (page déjà analysée)."] : [])],
      });
      setUrl("");
      setText("");
      setTextUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "url", label: "Lien" },
    { id: "texte", label: "Copier-coller" },
    { id: "manuel", label: "Saisie manuelle" },
  ];

  return (
    <Card
      title="Ajouter une annonce"
      actions={
        llm && (
          <span className={`rounded-full px-2 py-0.5 text-xs ${llm.available ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"}`}>
            {llm.available ? `LLM actif · ${llm.model}` : "LLM inactif (pas de clé API) : parseurs seuls"}
          </span>
        )
      }
    >
      <div role="tablist" className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "url" && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) call({ url: url.trim() });
          }}
        >
          <input
            type="url"
            required
            className={`${inputCls} py-2`}
            placeholder="https://www.studapart.com/fr/residence/4337"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="URL de l'annonce"
          />
          <Button variant="primary" type="submit" disabled={loading} className="sm:w-40">
            {loading ? "Analyse…" : "Analyser"}
          </Button>
        </form>
      )}

      {tab === "texte" && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            call({ text, url: textUrl.trim() || null });
          }}
        >
          <p className="text-sm text-slate-600">
            Si le site bloque la lecture automatique (captcha, connexion requise), sélectionnez tout le texte de l&apos;annonce (Ctrl+A, Ctrl+C) et collez-le ici.
            {!llm?.available && " Sans clé API, seuls quelques motifs simples seront reconnus : complétez ensuite la fiche."}
          </p>
          <textarea className={inputCls} rows={6} placeholder="Texte de l'annonce…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Texte de l'annonce" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <input type="url" className={inputCls} placeholder="URL de l'annonce (optionnel)" value={textUrl} onChange={(e) => setTextUrl(e.target.value)} aria-label="URL (optionnel)" />
            <Button variant="primary" type="submit" disabled={loading || text.trim().length < 50} className="sm:w-40">
              {loading ? "Analyse…" : "Analyser le texte"}
            </Button>
          </div>
        </form>
      )}

      {tab === "manuel" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">Crée une fiche vide que vous remplissez vous-même.</p>
          <Button
            variant="primary"
            onClick={() =>
              onDraft({ data: { ...emptyListingData(), titre: "Nouvelle annonce" }, extraction: { method: "manuel", adapter: null, llm: false, fetchedAt: null }, warnings: [] })
            }
          >
            Créer une fiche vide
          </Button>
        </div>
      )}

      {loading && (
        <p className="mt-3 text-sm text-slate-600" aria-live="polite">
          <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent align-middle" />
          Ouverture de la page dans un navigateur headless, lecture des données{llm?.available ? " puis analyse par le LLM" : ""}… (10 à 60 s)
        </p>
      )}
      {error && (
        <div className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-rose-800 ring-1 ring-rose-200">
          {error}
          {tab === "url" && (
            <button className="ml-2 underline" onClick={() => setTab("texte")}>
              Passer au copier-coller
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
