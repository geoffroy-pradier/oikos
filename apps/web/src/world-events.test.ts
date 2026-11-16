import i18next from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import en from './locales/en.json';
import fr from './locales/fr.json';
import type { WorldEvent } from './world-events';

// Le module porte aussi la lecture (`useRows`) : le client Supabase n'est pas créé pour ces calculs.
vi.mock('./data', () => ({ useRows: vi.fn() }));
const { describeWorldEvent, inForce, parseWorldEvents } = await import('./world-events');

const row = {
  id: 'e1',
  model: 'drought',
  city_id: 'c1',
  other_city_id: null,
  good_id: null,
  starts_at: '2026-11-16T08:00:00Z',
  ends_at: '2026-11-18T08:00:00Z',
  magnitude_bps: 4_000,
};

describe('événements du monde lus de la vue `world_events` (#417)', () => {
  it('une ligne lue devient un événement daté', () => {
    expect(parseWorldEvents([row])).toEqual([
      {
        id: 'e1',
        model: 'drought',
        cityId: 'c1',
        otherCityId: null,
        goodId: null,
        magnitudeBps: 4_000,
        startsAt: new Date(row.starts_at),
        endsAt: new Date(row.ends_at),
      },
    ]);
  });

  it('une ligne illisible ou d’un modèle inconnu du client est ignorée, pas les autres', () => {
    const rows = [
      { ...row, id: 'unknown', model: 'plague' },
      { ...row, id: 'date', ends_at: 'demain' },
      { ...row, id: 'big', magnitude_bps: 10_001 },
      { city_id: 'c1', recipe_id: 'grow_wheat' },
      { ...row, id: 'ok' },
    ];
    expect(parseWorldEvents(rows).map((event) => event.id)).toEqual(['ok']);
  });

  it('en cours : le début compris, la fin exclue', () => {
    const [event] = parseWorldEvents([row]) as [WorldEvent];
    const at = (iso: string) => inForce([event], new Date(iso)).length;
    expect(at('2026-11-16T07:59:59.999Z')).toBe(0);
    expect(at('2026-11-16T08:00:00Z')).toBe(1);
    expect(at('2026-11-18T07:59:59.999Z')).toBe(1);
    expect(at('2026-11-18T08:00:00Z')).toBe(0);
  });

  it('chaque modèle se dit en une phrase, en français et en anglais', async () => {
    const t = i18next.createInstance();
    await t.init({
      resources: { fr: { translation: fr }, en: { translation: en } },
      lng: 'fr',
      interpolation: { escapeValue: false },
    });
    const names = { c1: 'Kallistè', c2: 'Elaia' };
    const events = parseWorldEvents([
      row,
      { ...row, id: 'e2', model: 'good_year', magnitude_bps: 2_550 },
      { ...row, id: 'e3', model: 'storm', other_city_id: 'c2', magnitude_bps: 10_000 },
      { ...row, id: 'e4', model: 'caravan', good_id: 'olive_oil', magnitude_bps: 5_000 },
    ]);
    const end = new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(row.ends_at),
    );
    const lines = events.map((event) => describeWorldEvent(event, t.t, 'fr', names));
    expect(lines[0]).toMatch(
      new RegExp(
        `^Sécheresse à Kallistè jusqu'au ${end} : chaque cycle de champ rend 40\\s?% de moins\\.$`,
      ),
    );
    expect(lines[1]).toMatch(/^Bonne année à Kallistè .* rend 25,5\s?% de plus\.$/);
    expect(lines[2]).toMatch(/^Tempête entre Kallistè et Elaia .* durent 100\s?% de plus\.$/);
    expect(lines[3]).toMatch(
      /^Caravane étrangère à Kallistè .* achètent 50\s?% de plus du bien « Huile d'olive »\.$/,
    );
    await t.changeLanguage('en');
    expect(describeWorldEvent(events[0] as WorldEvent, t.t, 'en', {})).toMatch(
      /^Drought in c1 until .*: each field cycle yields 40% less\.$/,
    );
  });
});
