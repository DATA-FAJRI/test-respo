"use client";
import { useEffect, useRef, useState } from "react";
import type { Listing } from "@/lib/schema";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";
import { loadListings, loadSettings, newId, reviveListing, saveListings, saveSettings } from "@/lib/storage";
import { exportCsv, exportJson, exportXlsx } from "@/lib/export";
import { AddListing, type DraftPayload } from "./AddListing";
import { ComparisonTable } from "./ComparisonTable";
import { ListingEditor } from "./ListingEditor";
import { SettingsPanel } from "./SettingsPanel";
import { Button, Card } from "./ui";

type Editing = { listing: Listing; isNew: boolean; warnings: string[] } | null;

export function App() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [llm, setLlm] = useState<{ available: boolean; model: string | null } | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // lecture du stockage local après le montage (pas de rendu serveur de localStorage)
    setListings(loadListings());
    setSettings(loadSettings());
    setLoaded(true);
    fetch("/api/status")
      .then((r) => r.json())
      .then((j: { llm: boolean; model: string | null }) => setLlm({ available: j.llm, model: j.model }))
      .catch(() => setLlm(null));
  }, []);

  useEffect(() => {
    if (loaded) saveListings(listings);
  }, [listings, loaded]);
  useEffect(() => {
    if (loaded) saveSettings(settings);
  }, [settings, loaded]);
  useEffect(() => {
    if (editing) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editing]);

  const onDraft = (p: DraftPayload) => {
    const now = new Date().toISOString();
    setEditing({
      isNew: true,
      warnings: p.warnings,
      listing: { id: newId(), createdAt: now, updatedAt: now, data: p.data, editedFields: [], aplMensuelle: null, extraction: p.extraction, commentaire: "" },
    });
  };

  const onSave = (saved: Listing[]) => {
    setListings((prev) => {
      const byId = new Map(prev.map((l) => [l.id, l]));
      for (const l of saved) byId.set(l.id, l);
      return [...byId.values()];
    });
    setEditing(null);
  };

  const onImport = async (file: File) => {
    try {
      const json = JSON.parse(await file.text()) as { listings?: Partial<Listing>[]; settings?: Settings };
      const imported = (json.listings ?? []).map(reviveListing).filter((l): l is Listing => l !== null);
      setListings((prev) => [...prev.filter((p) => !imported.some((i) => i.id === p.id)), ...imported]);
      if (json.settings) setSettings({ ...DEFAULT_SETTINGS, ...json.settings });
      alert(`${imported.length} annonce(s) importée(s).`);
    } catch {
      alert("Fichier de sauvegarde invalide.");
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Loc<span className="text-emerald-600">Compare</span>
          </h1>
          <p className="text-sm text-slate-600">Le coût réel de chaque location, pour comparer à armes égales.</p>
        </div>
      </header>

      <AddListing onDraft={onDraft} llm={llm} />

      {editing && (
        <div ref={editorRef} className="scroll-mt-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 p-3 sm:p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">{editing.isNew ? "Vérifiez la fiche avant de l'ajouter" : "Modifier l'annonce"}</h2>
          <ListingEditor
            key={editing.listing.id}
            listing={editing.listing}
            settings={settings}
            isNew={editing.isNew}
            warnings={editing.warnings}
            onSave={onSave}
            onCancel={() => setEditing(null)}
            onDelete={
              editing.isNew
                ? undefined
                : () => {
                    if (confirm("Supprimer cette annonce ?")) {
                      setListings((prev) => prev.filter((l) => l.id !== editing.listing.id));
                      setEditing(null);
                    }
                  }
            }
          />
        </div>
      )}

      <SettingsPanel settings={settings} onChange={setSettings} />

      <Card
        title={`Comparatif (${listings.length})`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => exportCsv(listings, settings)} disabled={!listings.length}>
              Export CSV
            </Button>
            <Button onClick={() => exportXlsx(listings, settings)} disabled={!listings.length}>
              Export Excel
            </Button>
            <Button variant="ghost" onClick={() => exportJson(listings, settings)} disabled={!listings.length} title="Sauvegarde complète (réimportable)">
              Sauvegarder
            </Button>
            <Button variant="ghost" onClick={() => importRef.current?.click()}>
              Importer
            </Button>
            <input
              ref={importRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImport(f);
                e.target.value = "";
              }}
            />
          </div>
        }
      >
        <ComparisonTable
          listings={listings}
          settings={settings}
          onOpen={(id) => {
            const l = listings.find((x) => x.id === id);
            if (l) setEditing({ listing: l, isNew: false, warnings: [] });
          }}
        />
      </Card>

      <footer className="pb-6 text-center text-xs text-slate-500">
        Usage personnel. LocCompare respecte robots.txt, limite les requêtes (1 page / 5 s par site) et met les pages en cache 24 h. Les données sont stockées dans ce navigateur.
      </footer>
    </main>
  );
}
