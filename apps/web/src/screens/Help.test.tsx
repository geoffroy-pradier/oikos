// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import fr from '../locales/fr.json';
import { Help } from './Help';

afterEach(cleanup);

describe('aide repliée (#869)', () => {
  it('une ligne, « Comment ça marche ? », qui ouvre l’explication au clavier comme à la souris', async () => {
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    render(
      <I18nextProvider i18n={instance}>
        <Help>{fr.staff.intro}</Help>
      </I18nextProvider>,
    );
    const summary = screen.getByText(fr.app.help);
    const details = summary.closest('details');
    // Le résumé est l'élément natif `summary` : focalisable, Entrée et Espace l'ouvrent.
    expect(summary.tagName).toBe('SUMMARY');
    expect(details?.open).toBe(false);
    // L'explication reste dans la page, repliée.
    expect(details?.textContent).toContain(fr.staff.intro);
    fireEvent.click(summary);
    expect(details?.open).toBe(true);
    // Les icônes sont décoratives.
    expect(summary.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
  });
});
