import { genericAdapter } from "./generic";
import { leboncoinAdapter } from "./leboncoin";
import { studapartAdapter } from "./studapart";
import type { SiteAdapter } from "./types";

/**
 * Un adaptateur par site. Pour en ajouter un (SeLoger, PAP, Bien'ici…),
 * créez un fichier qui exporte un SiteAdapter et ajoutez-le ici, avant le générique.
 * Les sites sans adaptateur passent par l'extracteur générique + le LLM.
 */
export const ADAPTERS: SiteAdapter[] = [studapartAdapter, leboncoinAdapter];

export function pickAdapter(url: string): SiteAdapter {
  try {
    const u = new URL(url);
    return ADAPTERS.find((a) => a.match(u)) ?? genericAdapter;
  } catch {
    return genericAdapter;
  }
}
