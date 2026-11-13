import { describe, expect, it } from 'vitest';
import { houseCreateInputSchema, houseNameSchema, normalizeHouseName } from './index';

describe('houseNameSchema', () => {
  it.each(['Alcméonides', "Fils d'Atrée", 'Les Trois-Îles', 'Abc', 'a'.repeat(24)])(
    'accepte « %s »',
    (name) => {
      expect(houseNameSchema.safeParse(name).success).toBe(true);
    },
  );

  it.each(['Ab', ' Espace', 'Espace ', 'Chiffre1', 'Nom<script>', '-Tiret', 'a'.repeat(25), ''])(
    'refuse « %s »',
    (name) => {
      expect(houseNameSchema.safeParse(name).success).toBe(false);
    },
  );
});

describe('houseCreateInputSchema', () => {
  const valid = {
    cityId: '01900000-0000-7000-8000-000000000101',
    name: 'Alcméonides',
    blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
  };

  it('accepte une entrée complète', () => {
    expect(houseCreateInputSchema.parse(valid)).toEqual(valid);
  });

  it('refuse un champ inconnu, pour qu’aucune donnée non prévue n’atteigne la base', () => {
    expect(houseCreateInputSchema.safeParse({ ...valid, userId: 'x' }).success).toBe(false);
    expect(
      houseCreateInputSchema.safeParse({ ...valid, blazon: { ...valid.blazon, extra: 1 } }).success,
    ).toBe(false);
  });

  it('refuse un emblème hors catalogue', () => {
    expect(
      houseCreateInputSchema.safeParse({ ...valid, blazon: { ...valid.blazon, emblem: 'skull' } })
        .success,
    ).toBe(false);
  });
});

describe('normalizeHouseName', () => {
  it('rend acceptable une saisie de clavier mobile', () => {
    const raw = '  Fils d\u2019Atre\u0301e ';
    expect(houseNameSchema.safeParse(raw).success).toBe(false);
    const name = normalizeHouseName(raw);
    expect(name).toBe("Fils d'Atrée");
    expect(houseNameSchema.safeParse(name).success).toBe(true);
  });
});
