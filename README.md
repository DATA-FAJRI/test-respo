# LocCompare

Web app qui analyse des annonces de location à partir d'un lien et calcule le **coût réel** de chaque logement pour les comparer équitablement.

## Fonctionnement (V1)

1. Collez l'URL d'une annonce (Studapart, Leboncoin, SeLoger, PAP, Bien'ici, résidences étudiantes…), ou collez son texte si le site bloque la lecture.
2. Le serveur ouvre la page dans un **Chromium headless** (Playwright), après avoir vérifié **robots.txt**. Il extrait ensuite le texte rendu, le JSON-LD, les balises meta et `__NEXT_DATA__`.
3. Un **adaptateur par site** lit les valeurs fiables de façon déterministe (Studapart, Leboncoin ; un extracteur générique JSON-LD/meta pour les autres sites). Si une clé API est configurée, **Claude** lit ensuite toute la page et renvoie un JSON strict, validé avec **Zod** (absent = `null`, rien d'inventé). Quand les deux sources divergent, la valeur de l'adaptateur est retenue et la divergence est signalée.
4. La fiche est **éditable** : chaque champ a une pastille de confiance, et un champ corrigé à la main est marqué. Les ambiguïtés repérées sont listées dans les notes.
5. Le coût est calculé, puis l'annonce est ajoutée au **tableau comparatif**.

### Calcul

| Indicateur | Formule |
|---|---|
| Coût mensuel récurrent | loyer HC + charges (ou loyer CC) + estimation de chaque poste **non inclus** (électricité, internet, eau, chauffage individuel, assurance) + services obligatoires |
| Frais uniques | honoraires d'agence + état des lieux + frais de dossier/plateforme + services obligatoires à paiement unique |
| **Coût mensuel réel** | récurrent + frais uniques ÷ durée de séjour |
| Coût total du séjour | coût mensuel réel × durée |
| €/m² réel | coût mensuel réel ÷ surface |
| Trésorerie à l'entrée | 1er loyer + dépôt de garantie + frais uniques (affichée à part, car le dépôt est remboursable) |
| Après APL | coût mensuel réel − APL saisie |

Chauffage individuel non inclus : l'app utilise l'estimation DPE de l'annonce (€/an) si elle existe. Sinon, elle calcule surface × consommation type de la classe DPE (classe D si elle est inconnue) × prix du kWh. Tout montant **estimé** est affiché *en italique* avec le badge « ≈ estimé ».

### Comparateur

- Tri par coût mensuel réel, €/m², surface, total, trésorerie, et distance à une adresse de référence (géocodage Base Adresse Nationale, temps de trajet en transports estimé).
- Code couleur du vert au rouge, avec la meilleure offre disponible mise en évidence.
- Alertes :
  - charges floues ou mode de charges non précisé ;
  - honoraires au-dessus du plafond **ALUR** (zone estimée selon le code postal, modifiable) ;
  - **DPE F/G** ;
  - loyer suspect par rapport à un ordre de grandeur du marché ;
  - dépôt de garantie au-dessus du maximum légal ;
  - durée minimale trop longue pour le séjour prévu ;
  - logement complet.
- Export **CSV** (séparateur `;`, BOM, pour Excel en français), **Excel (.xlsx)**, et sauvegarde/import JSON. Les données restent dans le `localStorage` du navigateur.

## Lancer

```bash
npm install
cp .env.example .env.local   # puis renseignez ANTHROPIC_API_KEY
npx playwright-core install chromium   # si aucun Chromium n'est installé
npm run dev                  # http://localhost:3000
npm test                     # tests du calcul, des alertes, de robots.txt et du parseur Studapart
```

Sans clé API, l'app fonctionne avec les adaptateurs seuls. Il faut alors compléter la fiche à la main.

## Respect des sites

Usage personnel uniquement. L'app respecte robots.txt, envoie au plus 1 requête toutes les 5 s par site, ne charge ni images ni médias, et met en cache 24 h les pages et les extractions (`.cache/`). En cas de captcha, l'app propose l'ajout par copier-coller.

## Structure

```
src/lib/schema.ts               schéma Zod des données d'annonce
src/lib/scrape/fetchPage.ts     navigateur headless, cache, limitation de débit
src/lib/scrape/robots.ts        parseur robots.txt
src/lib/scrape/structured.ts    JSON-LD / meta / __NEXT_DATA__
src/lib/scrape/adapters/        un adaptateur par site (+ générique)
src/lib/llm/extract.ts          extraction par Claude
src/lib/extractListing.ts       pipeline + fusion adaptateur/LLM
src/lib/cost.ts                 calcul du coût réel et des alertes
src/lib/zones.ts                zones ALUR et loyers de référence (approximations)
src/components/                 interface (fiche éditable, comparatif, paramètres)
```
