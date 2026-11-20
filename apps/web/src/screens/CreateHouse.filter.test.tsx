// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';

vi.mock('../api', () => ({ createHouse: () => Promise.resolve({ ok: true, data: {} }) }));
const identity = (city_id: string, patron_god_id: string, terroir: string[] | null) => ({
  city_id,
  terroir,
  has_port: true,
  patron_god_id,
  starting_recipe_id: terroir?.[0] ?? 'grow_wheat',
});
vi.mock('../data', () => ({
  useRows: () => ({
    rows: [
      identity('k', 'demeter', ['grow_wheat', 'catch_fish']),
      identity('e', 'hermes', ['catch_fish', 'rake_salt']),
      identity('z', 'zeus', ['grow_wheat']),
    ],
    failed: false,
    reload: () => undefined,
  }),
  // Le bien de chaque recette de terroir : celui qui suit le verbe (`catch_fish` : `fish`).
  useSiteRules: () => ({
    rules: { recipe: (id: string) => ({ outputs: [{ goodId: id.split('_')[1] }] }) },
  }),
}));
const { CreateHouse } = await import('./CreateHouse');
afterEach(cleanup);

async function cityStep() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const cities = [
    { id: 'k', worldId: 'w', slug: 'kalliste', name: 'Kallistè' },
    { id: 'e', worldId: 'w', slug: 'emporion', name: 'Emporion' },
    { id: 'z', worldId: 'w', slug: 'dikaia', name: 'Dikaia' },
  ];
  render(
    <I18nextProvider i18n={instance}>
      <CreateHouse cities={cities} accessToken="t" onCreated={() => Promise.resolve()} />
    </I18nextProvider>,
  );
  fireEvent.change(screen.getByLabelText('Nom de la maison'), { target: { value: 'Alcméonides' } });
  while (screen.queryAllByRole('radio').length === 0)
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
}
const shown = () => screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'));

describe('fondation : la liste des cités se filtre par dieu ou par matière première (#707)', () => {
  it('par dieu, par matière première, les deux à la fois ; le compte est annoncé', async () => {
    await cityStep();
    expect(shown()).toEqual(['k', 'e', 'z']);
    expect(screen.getByRole('status').textContent).toBe('3 cités');
    // Les dieux et les matières des cités, nommés et triés ; une matière se nomme par son bien.
    const gods = screen.getByLabelText<HTMLSelectElement>('Dieu protecteur');
    expect([...gods.options].map((option) => option.text)).toEqual([
      'Tous les dieux',
      'Déméter',
      'Hermès',
      'Zeus',
    ]);
    const raws = screen.getByLabelText<HTMLSelectElement>('Matière première');
    expect([...raws.options].map((option) => option.text)).toEqual([
      'Toutes les matières premières',
      'Blé',
      'Poisson',
      'Sel',
    ]);
    fireEvent.change(raws, { target: { value: 'catch_fish' } });
    expect(shown()).toEqual(['k', 'e']);
    expect(screen.getByRole('status').textContent).toBe('2 cités sur 3');
    fireEvent.change(gods, { target: { value: 'hermes' } });
    expect(shown()).toEqual(['e']);
    fireEvent.change(raws, { target: { value: 'grow_wheat' } });
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toBe('Aucune cité ne répond à ces filtres.');
    fireEvent.click(screen.getByRole('button', { name: 'Retirer les filtres' }));
    expect(shown()).toEqual(['k', 'e', 'z']);
  });

  it('la cité choisie le reste quand un filtre la cache', async () => {
    await cityStep();
    fireEvent.click(screen.getByRole('radio', { name: 'Emporion' }));
    fireEvent.change(screen.getByLabelText('Dieu protecteur'), { target: { value: 'zeus' } });
    expect(shown()).toEqual(['z']);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(screen.getByRole('button', { name: 'Fonder la maison' })).toBeTruthy();
    expect(
      screen.getByText("Cité d'accueil", { selector: 'dt' }).nextElementSibling?.textContent,
    ).toContain('Emporion');
  });
});
