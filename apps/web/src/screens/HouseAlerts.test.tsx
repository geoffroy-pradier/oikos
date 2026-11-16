import { INITIAL_CONFIG, type GameConfig } from '@oikos/config';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';
import { houseAlerts, TERMINATED_LEASE_NOTICE_MS } from '../property-alerts';
import { parseLeases, parsePropertyRules } from '../property';

// Alertes du tableau de bord (#259) : lectures simulées par vue, heure du serveur fixée.
const config = INITIAL_CONFIG as GameConfig;
const NOW = Date.parse('2026-11-16T12:00:00Z');
const views = vi.hoisted(() => ({ rows: {} as Record<string, object[]> }));
vi.mock('../data', () => ({
  useRows: (view: string) => ({ rows: views.rows[view] ?? [], failed: false, reload: () => null }),
}));
vi.mock('../server-clock', () => ({ serverClock: { now: () => new Date(NOW) } }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
const { HouseAlerts } = await import('./HouseAlerts');

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
  ended_at: new Date(NOW - 3_600_000).toISOString(),
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
      my_workforce: [{ site_id: 's1', workers: 4, housed: 1, unhoused: 3 }],
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

  it('un bail résilié depuis plus d’un jour, ou terminé à la demande, n’est plus signalé', () => {
    const leases = parseLeases(
      [
        { ...lease, ended_at: new Date(NOW - TERMINATED_LEASE_NOTICE_MS).toISOString() },
        { ...lease, id: 'l2', end_reason: 'requested' },
        { ...lease, id: 'l3', ended_at: null, end_reason: null },
      ],
      'h1',
    );
    const sizes = parsePropertyRules({ properties: config.properties }) ?? new Map();
    expect(
      houseAlerts({ unhoused: 0, properties: [], sizes, leases: leases ?? [], now: NOW }),
    ).toEqual([]);
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
      houseAlerts({ unhoused: 0, properties: [atThreshold], sizes, leases: [], now: NOW }),
    ).toEqual([]);
  });
});
