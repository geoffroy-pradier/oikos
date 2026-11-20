// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';

const sent = vi.hoisted(() => ({ cities: [] as string[], answers: [] as unknown[] }));
vi.mock('../api', () => ({
  createHouse: (input: { cityId: string }) => {
    sent.cities.push(input.cityId);
    return Promise.resolve(sent.answers.shift());
  },
}));
vi.mock('../data', () => ({
  useRows: () => ({ rows: null, failed: false, reload: () => undefined }),
  useSiteRules: () => ({ rules: null }),
}));
const { CreateHouse } = await import('./CreateHouse');

const CITIES = [
  { id: 'k', worldId: 'w', slug: 'kalliste', name: 'Kallistè' },
  { id: 'e', worldId: 'w', slug: 'elaia', name: 'Elaia' },
];
const full = { ok: false, error: { code: 'NO_WORKERS_AVAILABLE', message: '' } };

async function mount() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const onCreated = vi.fn(() => Promise.resolve());
  render(
    <I18nextProvider i18n={instance}>
      <CreateHouse cities={CITIES} accessToken="t" onCreated={onCreated} />
    </I18nextProvider>,
  );
  fireEvent.change(screen.getByLabelText('Nom de la maison'), {
    target: { value: 'Alcméonides' },
  });
  return onCreated;
}
/** Avance d'étape en étape jusqu'à la liste des cités, puis choisit la cité. */
function pick(name: string) {
  while (screen.queryAllByRole('radio').length === 0)
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  fireEvent.click(screen.getByRole('radio', { name }));
}
/** Passe au récapitulatif (les étapes valables s'enchaînent), puis fonde. */
function found() {
  for (let step = 0; step < 3; step++) {
    const next = screen.queryByRole('button', { name: 'Continuer' });
    if (next) fireEvent.click(next);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Fonder la maison' }));
}
afterEach(() => {
  cleanup();
  sent.cities = [];
  sent.answers = [];
});

describe('fondation dans une cité sans travailleurs libres (#258)', () => {
  it('la cité est marquée et décochée, l’écran propose les autres ; la suivante fonde la maison', async () => {
    sent.answers.push(full, { ok: true, data: {} });
    const onCreated = await mount();
    pick('Kallistè');
    found();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        "Cette cité n'a plus de travailleurs libres pour votre premier site : rien n'a été créé. " +
          'Choisissez une autre cité : Elaia.',
      ),
    );
    const kalliste = screen.getByRole<HTMLInputElement>('radio', { name: 'Kallistè' });
    expect(kalliste.checked).toBe(false);
    expect(document.getElementById('city-k')?.textContent).toContain(
      'plus de travailleurs libres pour un premier site',
    );
    expect(kalliste.getAttribute('aria-describedby')).toBe('city-k form-error');
    expect(onCreated).not.toHaveBeenCalled();
    pick('Elaia');
    found();
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(sent.cities).toEqual(['k', 'e']);
  });

  it('aucune cité n’a plus de travailleurs : l’écran le dit', async () => {
    sent.answers.push(full, full);
    await mount();
    for (const name of ['Kallistè', 'Elaia']) {
      pick(name);
      found();
      await waitFor(() => expect(sent.cities).toHaveLength(name === 'Elaia' ? 2 : 1));
    }
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Aucune cité'));
  });
});

describe('nom refusé par la modération (#527)', () => {
  it.each([
    ['MESSAGE_REJECTED', 'Ce nom contient un terme interdit par la charte'],
    ['SILENCED', 'Votre compte est réduit au silence : un nom de maison est un texte public'],
  ])('%s : l’écran dit pourquoi le nom ne passe pas', async (code, text) => {
    sent.answers.push({ ok: false, error: { code, message: '' } });
    await mount();
    pick('Kallistè');
    found();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(text));
  });
});
