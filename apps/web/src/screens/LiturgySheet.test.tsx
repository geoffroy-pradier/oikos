// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import type { LiturgyRules, MyLiturgy } from '../liturgies';
import fr from '../locales/fr.json';

// Feuille d'accomplissement d'une liturgie (#723) : commande espionnée, rendue seule.
const api = vi.hoisted(() => ({ performLiturgy: vi.fn() }));
vi.mock('../api', () => ({ performLiturgy: api.performLiturgy }));
const { LiturgySheet } = await import('./LiturgySheet');

const liturgy: MyLiturgy = {
  id: 'l1',
  cityId: 'c1',
  season: 3,
  genre: 'choregia',
  due: 7500,
  dueAt: Date.parse('2999-01-01T04:00:00+00:00'),
  status: 'assigned',
};
const rules: LiturgyRules = {
  honorGain: 40,
  charisGain: 25,
  evasionHonorLoss: 90,
  maxSplendorBps: 10_000,
};
const plain = (node: HTMLElement | null) => node?.textContent?.replace(/\p{Zs}/gu, ' ');
const callbacks = {
  onClose: vi.fn(),
  onPerformed: vi.fn((_message: string) => Promise.resolve()),
  onRefused: vi.fn(() => Promise.resolve()),
};

async function show(props: { rules?: LiturgyRules; godName?: string | null } = {}) {
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
  render(
    <I18nextProvider i18n={instance}>
      <HouseProvider
        value={{ ...house, cityNames: { c1: 'Kallistè' }, citizenshipStatus: 'citizen' }}
      >
        <LiturgySheet
          liturgy={liturgy}
          rules={props.rules ?? rules}
          godName={props.godName === undefined ? 'Athéna' : props.godName}
          open
          {...callbacks}
        />
      </HouseProvider>
    </I18nextProvider>,
  );
  return within(screen.getByRole('dialog', { name: 'Accomplir ma liturgie' }));
}
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));

beforeEach(() => {
  api.performLiturgy.mockReset();
  api.performLiturgy.mockResolvedValue({
    ok: true,
    replayed: false,
    data: { due: 7500, splendor: 1000, honorGained: 45, charisGained: 28 },
  });
  for (const callback of Object.values(callbacks)) callback.mockClear();
});
afterEach(cleanup);

describe('feuille d’accomplissement (#723)', () => {
  it('dû, faste borné avec Timè et Charis annoncées, récapitulatif, puis dû vu envoyé', async () => {
    const sheet = await show();
    expect(plain(sheet.getByText('Dû', { selector: 'dt' }).closest('div'))).toContain(
      '1 250 drachmes',
    );
    next();

    const field = sheet.getByLabelText(/^Faste/);
    expect(plain(sheet.getByText(/^De 0 à /))).toContain('De 0 à 7 500 oboles');
    // Sans faste : le gain de la configuration ; avec 1 000 oboles de faste, ⌊40 × 8 500 ÷ 7 500⌋.
    expect(
      sheet.getByText(/Vous gagneriez 40 de Timè et 25 de Charis envers Athéna\./),
    ).toBeTruthy();
    fireEvent.change(field, { target: { value: '1000' } });
    expect(
      sheet.getByText(/Vous gagneriez 45 de Timè et 28 de Charis envers Athéna\./),
    ).toBeTruthy();
    // Hors de la borne : rien n'avance, l'erreur est dite.
    fireEvent.change(field, { target: { value: '7501' } });
    expect(sheet.getByRole('alert').textContent).toContain('de 0 à 7');
    expect((sheet.getByRole('button', { name: 'Continuer' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(field, { target: { value: '1000' } });
    next();

    expect([...sheet.getAllByRole('definition')].map((dd) => plain(dd))).toEqual([
      '1 250 drachmes',
      '166 drachmes 4 oboles',
      '1 416 drachmes 4 oboles',
      '+45',
      '+28',
    ]);
    fireEvent.click(sheet.getByRole('button', { name: /^Payer 1.416 drachmes 4 oboles$/ }));
    await waitFor(() => expect(callbacks.onPerformed).toHaveBeenCalledTimes(1));
    expect(api.performLiturgy.mock.calls[0]?.slice(0, 2)).toEqual([
      { liturgyId: 'l1', expectedDue: 7500, splendor: 1000 },
      'jeton',
    ]);
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    const message = plain({
      textContent: String(callbacks.onPerformed.mock.calls[0]?.[0]),
    } as HTMLElement);
    expect(message).toBe(
      'Liturgie accomplie : 1 416 drachmes 4 oboles payés, Timè +45, Charis +28.',
    );
  });
});
