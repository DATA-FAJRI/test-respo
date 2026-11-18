import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCost } from "../src/lib/cost";
import { ListingDataSchema, type Listing } from "../src/lib/schema";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { parseRobots } from "../src/lib/scrape/robots";
import { parseVariants } from "../src/lib/scrape/adapters/studapart";
import { lenientJsonParse } from "../src/lib/scrape/structured";

const listing = (data: Record<string, unknown>): Listing => ({
  id: "t", createdAt: "", updatedAt: "", data: ListingDataSchema.parse(data), editedFields: [], aplMensuelle: null,
  extraction: { method: "test", adapter: null, llm: false, fetchedAt: null }, commentaire: "",
});

test("coût réel : résidence tout compris + frais de plateforme lissés", () => {
  const c = computeCost(listing({ loyer_cc: 740, surface_m2: 19, frais_dossier: 589, depot_garantie: 680,
    charges_incluses: ["Eau froide", "Internet", "Électricité", "Chauffage"] }), DEFAULT_SETTINGS);
  assert.equal(c.coutMensuelRecurrent, 750); // 740 + assurance estimée 10
  assert.equal(c.coutMensuelReel, 799.08); // + 589 / 12
  assert.equal(c.tresorerieEntree, 740 + 680 + 589);
  assert.ok(c.hasEstimates);
  assert.deepEqual(c.recurring.filter((l) => l.estimated).map((l) => l.key), ["assurance"]);
});

test("coût réel : loyer HC + charges, postes non inclus estimés, chauffage DPE", () => {
  const c = computeCost(listing({ loyer_hc: 600, charges_mensuelles: 50, charges_mode: "provision", surface_m2: 20, dpe: "e",
    chauffage_type: "individuel", chauffage_energie: "electrique", charges_incluses: ["eau"] }), DEFAULT_SETTINGS);
  const keys = c.recurring.map((l) => l.key);
  assert.ok(keys.includes("electricite") && keys.includes("internet") && keys.includes("chauffage") && !keys.includes("eau"));
  const chauffage = c.recurring.find((l) => l.key === "chauffage")!;
  assert.equal(chauffage.amount, Math.round(((20 * 240 * 0.25) / 12) * 100) / 100);
});

test("alertes : honoraires au-dessus du plafond ALUR et DPE G", () => {
  const c = computeCost(listing({ loyer_hc: 900, charges_mensuelles: 50, surface_m2: 25, code_postal: "75011", frais_agence: 500, type_offre: "agence", dpe: "g" }), DEFAULT_SETTINGS);
  const codes = c.alerts.map((a) => a.code);
  assert.ok(codes.includes("alur")); // plafond Paris : 25 × (12 + 3) = 375 €
  assert.ok(codes.includes("dpe"));
});

test("robots.txt : règles Disallow avec jokers", () => {
  const body = "User-agent: *\nDisallow: /*/admin/\nDisallow: *?minPrice=*\n";
  assert.equal(parseRobots(body, "LocCompare", "/fr/residence/4337").allowed, true);
  assert.equal(parseRobots(body, "LocCompare", "/fr/admin/x").allowed, false);
  assert.equal(parseRobots(body, "LocCompare", "/s/?minPrice=3").allowed, false);
});

test("JSON-LD avec retours à la ligne bruts", () => {
  const v = lenientJsonParse('{"name": "a\nb", "x": 1,}') as { name: string };
  assert.equal(v.name, "a\nb");
});

test("Studapart : variantes lues dans les blocs « Détails du prix »", () => {
  const text = `Studio M de 19m² à 20m²\n740€\n/ mois\nCharges comprises\n\n Disponible à partir du 18 novembre 2026\n\nContacter le loueur\nDescription\nDétails du prix\n\nFrais de réservation \n\n589€\n\nDépôt de garantie \n\n680€\n\nLoyer mensuel \n\n740€ / mois\n\nCharges comprises dans le loyer\n\n Eau froide\n Internet\n+2\nStudio S de 17m² à 18m²\n690€\n/ mois\nCharges comprises\nAucune disponibilité\nDescription\nDétails du prix\n\nFrais de réservation \n\n589€\n\nDépôt de garantie \n\n630€\n\nLoyer mensuel \n\n690€ / mois\n\nCharges comprises dans le loyer\n\n Eau froide\n\nFin`;
  const v = parseVariants(text);
  assert.equal(v.length, 2);
  assert.deepEqual([v[0].nom, v[0].surface_m2, v[0].loyer_cc, v[0].depot_garantie, v[0].frais_dossier, v[0].disponibilite], ["Studio M", 19, 740, 680, 589, "2026-11-18"]);
  assert.deepEqual(v[0].charges_incluses, ["Eau froide", "Internet"]);
  assert.equal(v[1].disponible, false);
});
