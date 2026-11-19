import { cityConfigSchema } from '@oikos/config/schema';
import { expect, it } from 'vitest';
import { CITIES_TABLE, CITY_FIELDS, readCities } from './cities-form';

it('le champ du formulaire est celui du schéma ; une cité ne s’ajoute ni ne se retire (#657)', () => {
  const keys = Object.keys(cityConfigSchema.shape);
  for (const field of CITY_FIELDS) expect(keys).toContain(field.key);
  expect(CITIES_TABLE.fixedRows).toBe(true);
  expect(readCities({ cities: [{ id: 'halos' }] })).toEqual([{ id: 'halos' }]);
  for (const config of [null, { cities: {} }, { cities: ['halos'] }])
    expect(readCities(config)).toBeNull();
});
