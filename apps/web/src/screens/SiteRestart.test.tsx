// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';
import { SiteRestart } from './SiteRestart';

afterEach(cleanup);

describe('relance en feuille', () => {
  it('le prix d’un jour détaillé, puis la relance au prix vu ; pendant une commande, rien ne s’ouvre', async () => {
    const onConfirm = vi.fn();
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    const show = (busy: boolean) =>
      render(
        <I18nextProvider i18n={instance}>
          <SiteRestart
            siteName="Champ de blé"
            cost={54}
            upkeep={30}
            busy={busy}
            onConfirm={onConfirm}
          />
        </I18nextProvider>,
      );
    show(false);
    const trigger = screen.getByRole('button', {
      name: 'Relancer : Champ de blé, pour 9 drachmes',
    });
    expect(trigger.textContent).toBe('Relancer (9 drachmes)');
    fireEvent.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'Relancer : Champ de blé' });
    const lines = within(sheet)
      .getAllByRole('definition')
      .map((line) => line.textContent);
    expect(lines).toEqual(['5 drachmes', '4 drachmes', '9 drachmes']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Relancer pour 9 drachmes' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    show(true);
    fireEvent.click(screen.getByRole('button', { name: /^Relancer : / }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
