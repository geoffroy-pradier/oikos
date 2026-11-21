import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./data', () => ({ useRows: () => ({ rows: null, failed: false, reload: () => null }) }));
import {
  isHouseId,
  parseDishonor,
  parseHonor,
  parseMandates,
  parseProfile,
  PROFILE_VIEWS,
} from './house-profile';

const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';
const row = (id: string, world: string, extra = {}) => ({
  id,
  world_id: world,
  name: `Maison ${id.slice(-1)}`,
  blazon: { shape: 'hoplon', tincture: 'aegean', emblem: 'owl' },
  city_id: 'c1',
  citizenship_status: 'citizen',
  ...extra,
});

describe('vues lues par la fiche (6.6)', () => {
  // Les vues publiques sont celles que les migrations créent dans `public` sans préfixe `my_` : la fiche d'une
  // autre maison ne lit rien de ce qui est propre à la maison du joueur.
  const migrations = join(__dirname, '../../../packages/db/supabase/migrations');
  const created = new Set(
    readdirSync(migrations)
      .flatMap((file) => [
        ...readFileSync(join(migrations, file), 'utf8').matchAll(
          /create (?:or replace )?view public\.([a-z_]+)/g,
        ),
      ])
      .map((match) => match[1] as string),
  );
  it.each(PROFILE_VIEWS)('%s est une vue publique existante', (view) => {
    expect(created.has(view)).toBe(true);
    expect(view.startsWith('my_')).toBe(false);
  });
});

describe('parseProfile', () => {
  it('rend la maison demandée du monde du joueur', () => {
    const profile = parseProfile([row(A, 'w1'), row(B, 'w1')], B, A);
    expect(profile).toMatchObject({ id: B, name: 'Maison b', cityId: 'c1', status: 'citizen' });
    expect(profile).toMatchObject({ blazon: { emblem: 'owl' } });
  });
  it('maison absente ou d’un autre monde : la même issue, sans rien dire de plus', () => {
    expect(parseProfile([row(A, 'w1')], B, A)).toBe('unknown');
    expect(parseProfile([row(A, 'w1'), row(B, 'w2')], B, A)).toBe('unknown');
  });
  it('blason illisible : pas de blason, la fiche reste lue ; ligne illisible : échec', () => {
    expect(parseProfile([row(A, 'w1', { blazon: { emblem: 'x' } })], A, A)).toMatchObject({
      blazon: null,
    });
    expect(parseProfile([{ id: A }], A, A)).toBeNull();
  });
});

describe('parseHonor, parseMandates, isHouseId', () => {
  it('Timè : entière, nulle sans ligne, négative permise, illisible refusée', () => {
    expect(parseHonor([{ honor: 120 }])).toBe(120);
    expect(parseHonor([{ honor: -4 }])).toBe(-4);
    expect(parseHonor([])).toBe(0);
    expect(parseHonor([{ honor: 1.5 }])).toBeNull();
  });
  it('mandats : en cours d’abord, puis les passés du plus récent au plus ancien', () => {
    const at = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();
    const mandate = (start: number, inOffice: boolean) => ({
      office: 'archon',
      city_id: 'c1',
      starts_at: at(start),
      ends_at: at(start + 5),
      in_office: inOffice,
    });
    const sorted = parseMandates([mandate(1, false), mandate(20, true), mandate(10, false)]);
    expect(sorted?.map((m) => [m.startsAt, m.inOffice])).toEqual([
      [Date.UTC(2026, 0, 20), true],
      [Date.UTC(2026, 0, 10), false],
      [Date.UTC(2026, 0, 1), false],
    ]);
    expect(parseMandates([{ office: 'archon' }])).toBeNull();
  });
  it('une adresse qui n’est pas un identifiant ne donne aucune lecture', () => {
    expect(isHouseId(A)).toBe(true);
    for (const bad of [undefined, '', 'x', `${A}'; drop`, '../cite'])
      expect(isHouseId(bad)).toBe(false);
  });
});

describe('parseDishonor (marque de déshonneur, #1005)', () => {
  it('aucune ligne : pas de marque', () => {
    expect(parseDishonor([])).toEqual({ dishonored: false, untilDay: null });
  });
  it('marque avec fin, et marque sans fin', () => {
    expect(parseDishonor([{ dishonored: true, dishonored_until_day: 20_000 }])).toEqual({
      dishonored: true,
      untilDay: 20_000,
    });
    expect(parseDishonor([{ dishonored: true, dishonored_until_day: null }])).toEqual({
      dishonored: true,
      untilDay: null,
    });
  });
  it('colonnes absentes : pas de marque', () => {
    expect(parseDishonor([{ honor: 3 }])).toEqual({ dishonored: false, untilDay: null });
  });
  it('ligne illisible : null', () => {
    expect(parseDishonor([{ dishonored: 'oui' }])).toBeNull();
    expect(parseDishonor([{ dishonored: true, dishonored_until_day: 1.5 }])).toBeNull();
    expect(parseDishonor('x')).toBeNull();
  });
});
