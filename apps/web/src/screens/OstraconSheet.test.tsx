// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import fr from '../locales/fr.json';

// Feuille du vote d'ostracisme (#723) : commande espionnée, rendue seule.
const api = vi.hoisted(() => ({ cityCommand: vi.fn() }));
vi.mock('../api', () => ({ cityCommand: api.cityCommand }));
const { OstraconSheet } = await import('./OstraconSheet');

const citizens = [
  { id: 'h1', name: 'Maison Test' },
  { id: 'h2', name: 'Alcméonides' },
  { id: 'h3', name: 'Étéoboutades' },
];
const callbacks = {
  onClose: vi.fn(),
  onCast: vi.fn((_message: string) => Promise.resolve()),
  onRefused: vi.fn(() => Promise.resolve()),
};

let rerender: (list: readonly { id: string; name: string }[]) => void = () => undefined;

async function show(list: readonly { id: string; name: string }[] = citizens) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = {
    id: 'h1',
    name: 'Test',
    cityId: 'c1',
    accessToken: 'jeton',
    cityName: 'Kallistè',
  };
  const tree = (citizensList: readonly { id: string; name: string }[]) => (
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'citizen' }}
      >
        <OstraconSheet ostracismId="o1" citizens={citizensList} open {...callbacks} />
      </HouseProvider>
    </I18nextProvider>
  );
  const view = render(tree(list));
  rerender = (next) => view.rerender(tree(next));
  return within(screen.getByRole('dialog', { name: 'Inscrire un nom' }));
}
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));

beforeEach(() => {
  api.cityCommand.mockReset();
  api.cityCommand.mockResolvedValue({ ok: true, replayed: false, data: {} });
  for (const callback of Object.values(callbacks)) callback.mockClear();
});
afterEach(cleanup);

describe('feuille du vote d’ostracisme (#723)', () => {
  it('liste filtrable sans accent ni casse, rangée par nom, avec sa propre maison parmi les choix', async () => {
    const sheet = await show();
    expect(sheet.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual(
      ['Alcméonides', 'Étéoboutades', 'Maison Test (votre maison)'],
    );
    fireEvent.change(sheet.getByLabelText('Rechercher un citoyen'), { target: { value: 'ETEO' } });
    expect(sheet.getAllByRole('radio')).toHaveLength(1);
    expect(sheet.getByText('1 citoyen')).toBeTruthy();
    fireEvent.change(sheet.getByLabelText('Rechercher un citoyen'), { target: { value: 'zzz' } });
    expect(sheet.getByText('Aucun citoyen ne correspond.')).toBeTruthy();
  });

  it('rien n’avance sans citoyen choisi ; choisi, le récapitulatif nomme la maison et le bulletin part', async () => {
    const sheet = await show();
    expect((sheet.getByRole('button', { name: 'Continuer' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(sheet.getByRole('radio', { name: 'Étéoboutades' }));
    next();
    expect(sheet.getByText('Vous inscrivez le nom de Étéoboutades.')).toBeTruthy();
    fireEvent.click(sheet.getByRole('button', { name: 'Inscrire ce nom' }));
    await waitFor(() => expect(callbacks.onCast).toHaveBeenCalledTimes(1));
    expect(api.cityCommand.mock.calls[0]?.slice(0, 3)).toEqual([
      'city.castOstracon',
      { ostracismId: 'o1', houseId: 'h3' },
      'jeton',
    ]);
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    expect(callbacks.onCast.mock.calls[0]?.[0]).toBe(
      'Votre bulletin est déposé. Le vote est secret.',
    );
  });

  it('un refus reste dans la feuille, ouverte, et l’écran relit', async () => {
    api.cityCommand.mockResolvedValue({
      ok: false,
      error: { code: 'ALREADY_VOTED', message: 'x' },
    });
    const sheet = await show();
    fireEvent.click(sheet.getByRole('radio', { name: 'Alcméonides' }));
    next();
    fireEvent.click(sheet.getByRole('button', { name: 'Inscrire ce nom' }));
    await waitFor(() =>
      expect(sheet.getByRole('alert').textContent).toBe('Votre maison a déjà voté.'),
    );
    expect(callbacks.onRefused).toHaveBeenCalledTimes(1);
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });

  it('au-delà de la liste montrée, la recherche invite à préciser', async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      id: `x${index}`,
      name: `Maison ${String(index).padStart(2, '0')}`,
    }));
    const sheet = await show(many);
    expect(sheet.getAllByRole('radio')).toHaveLength(50);
    expect(sheet.getByText(/^50 citoyens montrés sur 60/)).toBeTruthy();
  });
  it('le citoyen choisi disparu de la liste relue après un refus : retour au choix, pas de récapitulatif vide', async () => {
    api.cityCommand.mockResolvedValue({
      ok: false,
      error: { code: 'ALREADY_VOTED', message: 'x' },
    });
    const sheet = await show();
    fireEvent.click(sheet.getByRole('radio', { name: 'Alcméonides' }));
    next();
    fireEvent.click(sheet.getByRole('button', { name: 'Inscrire ce nom' }));
    await waitFor(() => expect(callbacks.onRefused).toHaveBeenCalledTimes(1));
    rerender(citizens.filter((citizen) => citizen.id !== 'h2'));
    await waitFor(() => expect(sheet.getAllByRole('radio')).toHaveLength(2));
    expect(sheet.getByText(/Ce citoyen ne figure plus dans la liste/)).toBeTruthy();
    const note = screen.getByRole('status');
    expect(note.textContent).toContain('Ce citoyen ne figure plus dans la liste');
    expect(document.activeElement).toBe(note);
    expect(sheet.getByText('Étape 1 sur 2')).toBeTruthy();
    expect(sheet.queryByText(/Vous inscrivez le nom/)).toBeNull();
    expect((sheet.getByRole('button', { name: 'Continuer' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
