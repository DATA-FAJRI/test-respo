"use client";
import { ListingDataSchema, type Listing } from "./schema";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

const LISTINGS_KEY = "loccompare.listings.v1";
const SETTINGS_KEY = "loccompare.settings.v1";

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible (navigation privée…) */
  }
}

export function loadListings(): Listing[] {
  const raw = safeGet(LISTINGS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as Listing[];
    return arr.map(reviveListing).filter((l): l is Listing => l !== null);
  } catch {
    return [];
  }
}

export function reviveListing(l: Partial<Listing>): Listing | null {
  if (!l || typeof l !== "object" || !l.id) return null;
  return {
    id: l.id,
    createdAt: l.createdAt ?? new Date().toISOString(),
    updatedAt: l.updatedAt ?? new Date().toISOString(),
    data: ListingDataSchema.parse(l.data ?? {}),
    editedFields: Array.isArray(l.editedFields) ? l.editedFields : [],
    aplMensuelle: typeof l.aplMensuelle === "number" ? l.aplMensuelle : null,
    extraction: l.extraction ?? { method: "manuel", adapter: null, llm: false, fetchedAt: null },
    commentaire: l.commentaire ?? "",
  };
}

export function saveListings(listings: Listing[]) {
  safeSet(LISTINGS_KEY, JSON.stringify(listings));
}

export function loadSettings(): Settings {
  const raw = safeGet(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const s = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...s, estimations: { ...DEFAULT_SETTINGS.estimations, ...(s.estimations ?? {}) } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  safeSet(SETTINGS_KEY, JSON.stringify(s));
}

export function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
