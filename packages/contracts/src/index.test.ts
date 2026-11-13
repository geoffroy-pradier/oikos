import { describe, expect, it } from 'vitest';
import {
  domainEventSchema,
  houseCreateInputSchema,
  houseNameSchema,
  houseRenameInputSchema,
  idempotencyKeySchema,
  normalizeHouseName,
} from './index';

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

describe('idempotencyKeySchema', () => {
  it('accepte un UUID et refuse une clé trop courte, trop longue ou à caractères interdits', () => {
    expect(idempotencyKeySchema.safeParse('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b').success).toBe(
      true,
    );
    for (const bad of ['court', 'a'.repeat(129), 'clé avec espace', 'drop;table--x']) {
      expect(idempotencyKeySchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('houseRenameInputSchema', () => {
  it('applique la règle de nom et refuse tout champ en plus', () => {
    expect(houseRenameInputSchema.safeParse({ name: 'Philaïdes' }).success).toBe(true);
    expect(houseRenameInputSchema.safeParse({ name: 'X1' }).success).toBe(false);
    expect(houseRenameInputSchema.safeParse({ name: 'Philaïdes', houseId: 'x' }).success).toBe(
      false,
    );
  });
});

describe('domainEventSchema', () => {
  const id = '01900000-0000-7000-8000-000000000101';

  it('reconnaît un événement par son type et valide son contenu', () => {
    const event = {
      type: 'HouseRenamed',
      payload: { houseId: id, previousName: 'Avant', name: 'Après' },
    };
    expect(domainEventSchema.parse(event)).toEqual(event);
  });

  it('accepte HouseFounded complet et refuse un champ manquant ou en trop', () => {
    const founded = {
      type: 'HouseFounded',
      payload: { houseId: id, worldId: id, cityId: id, name: 'Abc' },
    };
    expect(domainEventSchema.parse(founded)).toEqual(founded);
    const withoutWorld: Record<string, string> = { ...founded.payload };
    delete withoutWorld['worldId'];
    expect(domainEventSchema.safeParse({ ...founded, payload: withoutWorld }).success).toBe(false);
    expect(
      domainEventSchema.safeParse({ ...founded, payload: { ...founded.payload, extra: 1 } })
        .success,
    ).toBe(false);
    expect(domainEventSchema.safeParse({ ...founded, extra: 1 }).success).toBe(false);
  });

  it('refuse un type inconnu ou un contenu d’un autre événement', () => {
    expect(domainEventSchema.safeParse({ type: 'HouseBurned', payload: {} }).success).toBe(false);
    const mixed = { type: 'HouseFounded', payload: { houseId: id, previousName: 'a', name: 'b' } };
    expect(domainEventSchema.safeParse(mixed).success).toBe(false);
  });
});
