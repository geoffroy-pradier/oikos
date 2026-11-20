// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import fr from '../locales/fr.json';
import { TreasuryChart } from './TreasuryChart';

// Trois jours de jeu (20 600 à 20 602, du 27 au 29 mai 2026) : 600 oboles, un achat de 150, une vente de 30.
const points = [
  { day: 20600, balance: 600, net: 0 },
  { day: 20601, balance: 450, net: -150 },
  { day: 20602, balance: 480, net: 30 },
];
afterEach(cleanup);

describe('trésorerie des derniers jours', () => {
  it('une image décrite, doublée d’un tableau des mêmes valeurs, le jour le plus récent d’abord', async () => {
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    render(
      <I18nextProvider i18n={instance}>
        <TreasuryChart points={points} />
      </I18nextProvider>,
    );
    expect(screen.getByRole('region', { name: 'Trésorerie, 3 derniers jours' })).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Trésorerie en fin de jour, sur 3 jours de jeu : de 100 drachmes à 80 drachmes ; au plus haut 100 drachmes, au plus bas 75 drachmes.',
    );
    // Fermé, le tableau n'est pas rendu : ses montants ne doublent pas ceux de l'écran.
    expect(screen.queryByRole('table')).toBeNull();
    const details = screen.getByText(fr.home.chart.table).closest('details');
    if (!details) throw new Error('details');
    details.open = true;
    fireEvent(details, new Event('toggle'));
    const table = screen.getByRole('table', { name: 'Trésorerie, 3 derniers jours' });
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent);
    expect(rows).toEqual([
      '29 mai80 drachmes+5 drachmes',
      '28 mai75 drachmes−25 drachmes',
      '27 mai100 drachmes—',
    ]);
  });
});
