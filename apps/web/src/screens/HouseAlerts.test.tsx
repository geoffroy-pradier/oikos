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
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
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

  describe('liturgie désignée', () => {
    const liturgy = (extra = {}) => ({
      id: 'l1',
      city_id: 'k',
      season: 4,
      genre: 'trierarchy',
      due: 7500,
      due_at: '2999-01-01T04:00:00+00:00',
      status: 'assigned',
      ...extra,
    });

    it('seule, elle porte le genre, le dû en drachmes et oboles, l’échéance et le lien vers l’accomplissement', async () => {
      views.rows = { my_liturgies: [liturgy()] };
      const html = (await render()).replace(/[\u00a0\u202f]/g, ' ');
      expect(html).toContain('href="/cite/liturgie"');
      expect(html).toContain('Liturgie confiée à votre maison : Triérarchie. Dû : 1 250 drachmes');
      expect(html).toContain('à accomplir avant le ');
      expect(html).toContain('Accomplir ma liturgie');
    });

    it('passe avant les autres alertes et compte dans le total', async () => {
      views.rows = {
        my_liturgies: [liturgy()],
        my_workforce: [{ site_id: 's1', city_id: 'k', unhoused: 3 }],
        labor_market: [day('k', 20001, 2)],
        property_rules: [{ properties: config.properties }],
        my_properties: [],
        my_leases: [],
      };
      const html = await render();
      expect(html.indexOf('Liturgie confiée')).toBeGreaterThan(-1);
      expect(html.indexOf('Liturgie confiée')).toBeLessThan(
        html.indexOf('travailleurs sans logement'),
      );
      expect(html).toContain('>2<');
    });

    it('échue, accomplie ou prélevée : plus d’alerte, la carte se tait', async () => {
      for (const extra of [
        { due_at: '2020-01-01T04:00:00+00:00' },
        { status: 'performed' },
        { status: 'levied' },
      ]) {
        views.rows = { my_liturgies: [liturgy(extra)] };
        expect(await render()).toBe('');
      }
    });
  });

  describe('prêts de la maison (#732)', () => {
    const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    const loan = (extra = {}) => ({
      id: 'p1',
      lender: 'temple',
      principal: 6000,
      rate_bps: 1000,
      term_days: 30,
      interest: 50,
      due_day: 20_400,
      due_at: at(2),
      principal_repaid: 0,
      interest_repaid: 0,
      outstanding: 6050,
      status: 'active',
      ...extra,
    });

    it('échéance dans les trois jours : alerte vers l’écran Finances, avec le reste dû et la date', async () => {
      views.rows = { my_loans: [loan()] };
      const html = await render();
      expect(html).toContain('href="/finances"');
      expect(html.replace(/\p{Zs}/gu, ' ')).toContain(
        'Prêt (Trésor du temple) à rembourser avant le ',
      );
      expect(html.replace(/\p{Zs}/gu, ' ')).toContain('1 008 drachmes 2 oboles restent dus');
      expect(html).toContain('Voir mes finances');
    });

    it('défaut : alerte, quelle que soit l’échéance ; elle compte dans le total', async () => {
      views.rows = {
        my_loans: [loan({ status: 'defaulted', due_at: at(-9) })],
        my_liturgies: [],
      };
      const html = await render();
      expect(html).toContain('en défaut');
      expect(html).toContain('>1<');
    });

    it('échéance passée sans prélèvement : alerte « échu »', async () => {
      views.rows = { my_loans: [loan({ due_at: at(-0.5) })] };
      expect(await render()).toContain('Prêt (Trésor du temple) échu');
    });

    it('échéance lointaine, prêt soldé ou aucun prêt : la carte se tait', async () => {
      for (const rows of [
        [loan({ due_at: at(10) })],
        [loan({ status: 'repaid', outstanding: 0, due_at: at(1) })],
        [],
      ]) {
        views.rows = { my_loans: rows };
        expect(await render()).toBe('');
      }
    });
  });
});
