import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import { houseAlerts, parseUnhoused } from '../property-alerts';
import { parseCityLabor } from '../labor';
import { parseLeases, parsePropertyRules } from '../property';

// Alertes du tableau de bord (#259) : lectures simulées par vue.
const config = INITIAL_CONFIG as GameConfig;
const views = vi.hoisted(() => ({ rows: {} as Record<string, object[]> }));
vi.mock('../data', () => ({
  // Le filtre par cité est appliqué comme par la base : seules les lignes des cités demandées.
  useRows: (view: string, _columns: string, _order: string, filters?: { city_id?: string[] }) => ({
    rows: (views.rows[view] ?? []).filter(
      (row) => !filters?.city_id || filters.city_id.includes((row as { city_id: string }).city_id),
    ),
    failed: false,
    reload: () => null,
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
const { HouseAlerts } = await import('./HouseAlerts');

const day = (city_id: string, game_day: number, lodging_oboles: number) => ({
  city_id,
  game_day,
  supply: 0,
  employed: 0,
  unhoused: 0,
  wage_oboles: 5,
  lodging_oboles,
});
const townhouse = config.properties.sizes.find((size) => size.id === 'townhouse');
const property = {
  id: 'p1',
  city_id: 'k',
  size_id: 'townhouse',
  lot: 4,
  condition: 10_000,
  upkeep_unpaid_since: null,
};
const lease = {
  id: 'l1',
  property_id: 'p7',
  city_id: 'k',
  size_id: 'townhouse',
  lot: 7,
  tenant_house_id: 'h1',
  rent_oboles: 40,
  end_requested_at: null,
  ended_at: '2026-11-16T03:00:00Z',
  ended_day: 20000,
  end_reason: 'unpaid',
};

async function render() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'k', accessToken: 't', cityName: 'Kallistè' };
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: { k: 'Kallistè' }, citizenshipStatus: 'metic' }}>
        <HouseAlerts />
      </HouseProvider>
    </I18nextProvider>,
  );
}

describe('alertes du tableau de bord (#259)', () => {
  it('travailleurs sans logement, bien à rénover, entretien impayé, bail résilié', async () => {
    views.rows = {
      property_rules: [{ properties: config.properties }],
      // Une cité d'un autre monde a déjà clos un jour plus récent : sans effet sur cette maison.
      labor_market: [day('k', 20000, 3), day('x', 20001, 3)],
      my_workforce: [{ site_id: 's1', city_id: 'k', unhoused: 3 }],
      my_properties: [
        { ...property, condition: 0 },
        { ...property, id: 'p2', lot: 5, upkeep_unpaid_since: '2026-11-16T03:00:00Z' },
      ],
      my_leases: [lease],
    };
    const html = await render();
    expect(html).toContain('3 travailleurs sans logement');
    expect(html).toContain('Maison de ville n° 4, Kallistè est à rénover');
    expect(html).toContain('Maison de ville n° 5, Kallistè : entretien impayé');
    expect(html).toContain('Bail résilié pour loyer impayé : Maison de ville n° 7, Kallistè.');
  });

  it('rien à signaler : la carte se tait', async () => {
    views.rows = { my_properties: [property] };
    expect(await render()).toBe('');
  });

  it('hébergement gratuit : pas d’alerte ; bail résilié avant la dernière clôture ou à la demande : non plus', () => {
    const labor = parseCityLabor([day('k', 20001, 0), day('e', 20000, 2)]) ?? new Map();
    const staff = [
      { site_id: 's1', city_id: 'k', unhoused: 3 },
      { site_id: 's2', city_id: 'e', unhoused: 1 },
    ];
    expect(parseUnhoused(staff, labor)).toBe(1);
    expect(parseUnhoused([{ site_id: 's1' }], labor)).toBeNull();
    const leases = parseLeases(
      [lease, { ...lease, id: 'l2', ended_day: 20001, end_reason: 'requested' }],
      'h1',
    );
    const sizes = parsePropertyRules({ properties: config.properties }) ?? new Map();
    const alerts = (lastCloseDay: number) =>
      houseAlerts({ unhoused: 0, properties: [], sizes, leases: leases ?? [], lastCloseDay });
    expect(alerts(20001)).toEqual([]);
    expect(alerts(20000).map((alert) => alert.kind)).toEqual(['leaseTerminated']);
    // Seuil de logement : un bien juste au seuil loge encore.
    const atThreshold = {
      id: 'p1',
      cityId: 'k',
      sizeId: 'townhouse',
      lot: 1,
      condition: townhouse?.minHabitableCondition ?? 0,
      unpaidSince: null,
    };
    expect(
      houseAlerts({ unhoused: 0, properties: [atThreshold], sizes, leases: [], lastCloseDay: 0 }),
    ).toEqual([]);
  });
});
