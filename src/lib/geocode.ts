/**
 * Géocodage via la Base Adresse Nationale.
 * api-adresse.data.gouv.fr redirige désormais vers le service de la Géoplateforme IGN
 * (data.geopf.fr/geocodage), même format de réponse : on appelle directement ce dernier
 * et on garde l'ancienne adresse en secours. Les deux acceptent les appels navigateur (CORS).
 */
const ENDPOINTS = ["https://data.geopf.fr/geocodage/search", "https://api-adresse.data.gouv.fr/search/"];
export type GeoResult = { label: string; lat: number; lon: number; postcode: string | null; city: string | null; score: number };

export async function geocode(query: string): Promise<GeoResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  let res: Response | null = null;
  for (const endpoint of ENDPOINTS) {
    try {
      res = await fetch(`${endpoint}?q=${encodeURIComponent(q.slice(0, 200))}&limit=5`);
      if (res.ok) break;
    } catch {
      res = null;
    }
  }
  if (!res || !res.ok) throw new Error(`Géocodage indisponible${res ? ` (${res.status})` : ""}`);
  const json = (await res.json()) as {
    features: { geometry: { coordinates: [number, number] }; properties: { label: string; postcode?: string; city?: string; score: number } }[];
  };
  return json.features.map((f) => ({
    label: f.properties.label,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    postcode: f.properties.postcode ?? null,
    city: f.properties.city ?? null,
    score: f.properties.score,
  }));
}
