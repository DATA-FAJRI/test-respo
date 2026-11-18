/**
 * Moteur partagé, empaqueté pour la version Artifact (claude.ai) :
 * mêmes schéma, adaptateurs, prompt et calcul que l'app Next.js.
 * Build : npm run build:artifact  →  artifact/dist/loccompare.html
 */
export { ListingDataSchema, emptyListingData } from "@/lib/schema";
export { computeCost, haversineKm, estimateTransitMinutes } from "@/lib/cost";
export { DEFAULT_SETTINGS } from "@/lib/settings";
export { SYSTEM_PROMPT, buildUserPrompt, parseJsonObject } from "@/lib/llm/prompt";
export { mergeResults } from "@/lib/merge";
export { pickAdapter } from "@/lib/scrape/adapters";
export { sourceName } from "@/lib/scrape/adapters/types";
