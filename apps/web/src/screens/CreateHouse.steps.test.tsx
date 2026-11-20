// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';

vi.mock('../api', () => ({ createHouse: () => Promise.resolve({ ok: true, data: {} }) }));
vi.mock('../data', () => ({
  useRows: () => ({
    rows: [
      {
        city_id: 'k',
        terroir: ['grow_wheat'],
        has_port: true,
        patron_god_id: 'demeter',
        starting_recipe_id: 'grow_wheat',
      },
    ],
    failed: false,
    reload: () => undefined,
  }),
  useSiteRules: () => ({ rules: null }),
}));
const { CreateHouse } = await import('./CreateHouse');

async function mount() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const cities = [{ id: 'k', worldId: 'w', slug: 'kalliste', name: 'Kallistè' }];
  render(
    <I18nextProvider i18n={instance}>
      <CreateHouse cities={cities} accessToken="t" onCreated={() => Promise.resolve()} />
    </I18nextProvider>,
  );
}
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
afterEach(cleanup);

describe('création de maison par étapes', () => {
  it('un nom invalide garde l’étape et se dit près du champ ; Entrée avance quand il est valable', async () => {
    await mount();
    const field = screen.getByLabelText('Nom de la maison');
    fireEvent.change(field, { target: { value: 'X1' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toContain('ne sont pas valides');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(field, { target: { value: 'Alcméonides' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByRole('heading', { name: /Étape 2 sur 4/ })).toBeTruthy();
  });

  it('la carte de cité garde son nom court et sa description complète ; le récapitulatif la reprend', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Nom de la maison'), {
      target: { value: 'Alcméonides' },
    });
    next();
    next();
    const radio = screen.getByRole('radio', { name: 'Kallistè' });
    // Vignette et emblème sont décoratifs : seul le texte de la description est lu.
    expect(document.querySelectorAll('label svg[role="img"]')).toHaveLength(0);
    expect(document.getElementById('city-k')?.textContent).toContain('Protégée par Déméter');
    expect(radio.getAttribute('aria-describedby')).toBe('city-k');
    fireEvent.click(radio);
    next();
    const summary = screen.getByRole('list', { name: 'Étapes' }).parentElement;
    expect(summary?.textContent).toContain('Alcméonides');
    expect(summary?.textContent).toContain('Kallistè');
    expect(summary?.textContent).toContain('Protégée par Déméter');
    expect(summary?.textContent).toContain('Hoplon rond · Terre cuite · Chouette');
  });
});
