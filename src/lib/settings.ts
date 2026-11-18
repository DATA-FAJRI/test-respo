export type Zone = "auto" | "tres_tendue" | "tendue" | "non_tendue";

export type Settings = {
  dureeMois: number;
  estimations: {
    electricite: number;
    internet: number;
    assurance: number;
    eau: number;
    /** Prix moyen du kWh de chauffage (€/kWh), utilisé si l'annonce ne donne pas l'estimation DPE. */
    prixKwhChauffage: number;
  };
  reference: { label: string; lat: number; lon: number } | null;
  zone: Zone;
};

export const DEFAULT_SETTINGS: Settings = {
  dureeMois: 12,
  estimations: { electricite: 35, internet: 30, assurance: 10, eau: 15, prixKwhChauffage: 0.22 },
  reference: null,
  zone: "auto",
};
