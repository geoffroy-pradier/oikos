// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { Events, eventStatus, type WorldEventRow } from './Events';

const adminGet = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ adminGet }));

let i18n: Awaited<ReturnType<typeof initI18n>>;
beforeAll(async () => {
  i18n = await initI18n('fr');
});
beforeEach(() => adminGet.mockReset());
afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  await i18n.changeLanguage('fr');
});

const NOW = '2026-11-20T12:00:00.000Z';
const event = (patch: Partial<WorldEventRow>): WorldEventRow => ({
  id: '00000000-0000-7000-8000-000000000001',
  world: 'archipel',
  model: 'drought',
  city: 'kalliste',
  otherCity: null,
  goodId: null,
  startsAt: '2026-11-21T03:00:00.000Z',
  endsAt: '2026-11-23T03:00:00.000Z',
  magnitudeBps: 3_000,
  plannedDay: 20_595,
  ...patch,
});
const EVENTS = [
  // Rendus par l'API des plus tardifs aux plus anciens : à venir, en cours, passé.
  event({ id: 'd', model: 'good_year', city: 'elaia', magnitudeBps: 1_250 }),
  event({ id: 'c' }),
  event({
    id: 'b',
    model: 'storm',
    city: 'elaia',
    otherCity: 'kalliste',
    startsAt: '2026-11-20T03:00:00.000Z',
    endsAt: '2026-11-21T03:00:00.000Z',
  }),
  event({
    id: 'a',
    model: 'caravan',
    goodId: 'wine',
    startsAt: '2026-11-18T03:00:00.000Z',
    endsAt: '2026-11-19T03:00:00.000Z',
    magnitudeBps: 2_500,
  }),
];
const text = (node: Element) => node.textContent?.replace(/\s/g, ' ');

it('état d’un événement : à venir avant son début, en cours jusqu’à sa fin exclue, passé ensuite', () => {
  const span = { startsAt: '2026-11-21T03:00:00.000Z', endsAt: '2026-11-22T03:00:00.000Z' };
  expect(eventStatus(span, new Date('2026-11-21T02:59:59.999Z'))).toBe('upcoming');
  expect(eventStatus(span, new Date('2026-11-21T03:00:00.000Z'))).toBe('ongoing');
  expect(eventStatus(span, new Date('2026-11-22T03:00:00.000Z'))).toBe('past');
});

it('calendrier : modèle, portée, ampleur et état à l’heure du serveur, en français et en anglais', async () => {
  // Horloge du navigateur figée des années après l'heure de l'API : lue par l'écran, tout serait « Passé ».
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2041-01-01T00:00:00.000Z'));
  adminGet.mockResolvedValue({
    ok: true,
    data: { now: NOW, pastDays: 7, events: EVENTS, truncated: false },
  });
  render(<Events accessToken="token" />);
  const table = await screen.findByRole('table', { name: /^Événements du monde planifiés/ });
  expect(adminGet).toHaveBeenCalledWith('events', 'token');
  const rows = within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => Array.from(row.children, text));
  expect(rows.map((row) => [row[0], row[1], row[2], row[5], row[6]])).toEqual([
    ['À venir', 'Bonne année', 'elaia', 'rendement des vergers +12,5 %', 'archipel'],
    ['À venir', 'Sécheresse', 'kalliste', 'rendement des champs −30 %', 'archipel'],
    ['En cours', 'Tempête', 'route elaia – kalliste', 'trajets +30 %', 'archipel'],
    ['Passé', 'Caravane étrangère', 'kalliste, wine', 'demande des PNJ +25 %', 'archipel'],
  ]);
  // La fenêtre du passé vient de l'API, pas d'une valeur de l'écran ; une liste entière n'est pas dite coupée.
  expect(screen.getByText(/finis depuis 7 jours/)).toBeTruthy();
  expect(screen.queryByText(/Liste coupée/)).toBeNull();
  // Le tableau défile au clavier, dans une région nommée.
  const region = screen.getByRole('region', { name: /^Événements du monde planifiés/ });
  expect([region.tabIndex, region.contains(table)]).toEqual([0, true]);
  await i18n.changeLanguage('en');
  expect(await screen.findAllByRole('cell', { name: 'Upcoming' })).toHaveLength(2);
  expect(screen.getByRole('cell', { name: 'field yield −30%' })).toBeTruthy();
  expect(screen.getByRole('cell', { name: 'orchard yield +12.5%' })).toBeTruthy();
});

it('liste coupée à la limite de l’API : l’écran le dit, et le tableau s’y réfère', async () => {
  adminGet.mockResolvedValue({
    ok: true,
    data: { now: NOW, pastDays: 30, events: EVENTS, truncated: true },
  });
  render(<Events accessToken="token" />);
  const table = await screen.findByRole('table');
  const notice = screen.getByText(/^Liste coupée/);
  expect(text(notice)).toBe(
    "Liste coupée : seuls les 4 événements les plus tardifs sont affichés, les plus anciens n'y sont pas.",
  );
  expect(table.getAttribute('aria-describedby')).toBe(notice.id);
  await i18n.changeLanguage('en');
  expect(await screen.findByText(/^List cut short: only the 4 latest events/)).toBeTruthy();
});

it('aucun événement : ni tableau ni légende ; puis une lecture en échec, « Réessayer » et le foyer sur le titre', async () => {
  adminGet.mockResolvedValueOnce({
    ok: true,
    data: { now: NOW, pastDays: 30, events: [], truncated: false },
  });
  render(<Events accessToken="token" />);
  expect(await screen.findByText('Aucun événement planifié.')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('region')).toBeNull();
  cleanup();
  adminGet.mockResolvedValueOnce({ ok: false, code: 'NETWORK' });
  adminGet.mockResolvedValue({
    ok: true,
    data: { now: NOW, pastDays: 30, events: EVENTS, truncated: false },
  });
  render(<Events accessToken="token" />);
  expect((await screen.findByRole('alert')).textContent).toMatch(/^L'API ne répond pas\./);
  // La première lecture ne déplace pas le foyer ; « Réessayer » le rend au titre, le bouton ayant disparu.
  const title = screen.getByRole('heading', { name: 'Calendrier des événements' });
  expect(document.activeElement).not.toBe(title);
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByRole('table')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.activeElement).toBe(title);
});
