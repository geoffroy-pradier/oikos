// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';
import type { Ostracism } from '../ostracism';

// Issue d'un vote d'ostracisme dépouillé (#723).
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/maison">{children}</a>,
}));
const { OstracismOutcome } = await import('./OstracismOutcome');

const vote = (extra: Partial<Ostracism> = {}): Ostracism => ({
  id: 'o1',
  cityId: 'c1',
  openedAt: Date.parse('2026-11-18T04:00:00+00:00'),
  votingClosesAt: Date.parse('2026-11-21T04:00:00+00:00'),
  quorumBps: 2000,
  talliedAt: Date.parse('2026-11-21T05:00:00+00:00'),
  electorate: 7,
  ballots: 5,
  outcome: 'ostracized',
  ostracizedHouseId: 'h2',
  endsAt: Date.parse('2999-02-01T04:00:00+00:00'),
  inForce: true,
  ...extra,
});
const names: Record<string, string> = { h2: 'Alcméonides', h3: 'Philaïdes' };
const plain = (node: HTMLElement | null) => node?.textContent?.replace(/\p{Zs}/gu, ' ');

async function show(entry: Ostracism, results: { houseId: string; votes: number }[] | null = []) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={instance}>
      <OstracismOutcome vote={entry} results={results} nameOf={(id) => names[id] ?? '?'} />
    </I18nextProvider>,
  );
}
afterEach(cleanup);

describe('issue de l’ostracisme (#723)', () => {
  it('la maison ostracisée et jusqu’à quand, les bulletins, le décompte par nom des plus nommées aux moins', async () => {
    await show(vote(), [
      { houseId: 'h3', votes: 1 },
      { houseId: 'h2', votes: 4 },
    ]);
    expect(plain(screen.getByText(/^Alcméonides est ostracisée jusqu'au /))).toMatch(
      /: elle ne se présente à aucune élection et ne propose aucun décret\./,
    );
    expect(plain(screen.getByText('Bulletins').nextElementSibling as HTMLElement)).toBe('5');
    expect(plain(screen.getByText('Citoyens').nextElementSibling as HTMLElement)).toBe('7');
    const rows = screen.getAllByRole('listitem').map((item) => plain(item));
    expect(rows[0]).toContain('Alcméonides');
    expect(rows[0]).toContain('4');
    expect(rows[1]).toContain('Philaïdes');
  });

  it('un ostracisme terminé le dit au passé', async () => {
    await show(vote({ inForce: false, endsAt: Date.parse('2026-11-22T04:00:00+00:00') }));
    expect(
      screen.getByText(/^Alcméonides a été ostracisée ; son ostracisme a pris fin le /),
    ).toBeTruthy();
  });

  it('égalité et quorum manqué n’ostracisent personne, et sans décompte nul tableau', async () => {
    await show(vote({ outcome: 'tie', ostracizedHouseId: null, endsAt: null }));
    expect(screen.getByText("Égalité en tête : personne n'est ostracisé.")).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    await show(vote({ outcome: 'no_quorum', ostracizedHouseId: null, endsAt: null }), null);
    expect(
      screen.getByText("Le quorum n'a pas été atteint : personne n'est ostracisé."),
    ).toBeTruthy();
  });
});
