import { readRows, type NestedTable, type Row } from './goods-form';

/**
 * Champs d'une cité que le formulaire édite (#657) : sa ligne est nommée par son identifiant, et le reste
 * (population, terroir, port, dieu, recette de départ) ne s'édite que dans le texte JSON. Un test les
 * compare au schéma.
 */
export const CITY_FIELDS = [{ key: 'npcPublicIncomeBps', kind: 'integer' }] as const;

/** Formulaire des cités : ni ajout ni retrait, qui se font dans le texte avec la population et l'identité. */
export const CITIES_TABLE: NestedTable = {
  table: 'cities',
  texts: 'citiesForm',
  fields: CITY_FIELDS,
  lists: [],
  choices: {},
  fixedRows: true,
};

/** Cités d'une configuration (`readRows`). */
export const readCities = (config: unknown): Row[] | null => readRows(config, 'cities');
