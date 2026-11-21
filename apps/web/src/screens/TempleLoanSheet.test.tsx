// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import type { TempleRules } from '../loans';
import fr from '../locales/fr.json';

// Feuille d'emprunt au Trésor du temple (#732) : commande espionnée, rendue seule.
const api = vi.hoisted(() => ({ borrowFromTemple: vi.fn() }));
vi.mock('../api', () => ({ borrowFromTemple: api.borrowFromTemple }));
const { TempleLoanSheet } = await import('./TempleLoanSheet');

const rules: TempleRules = { policyRateBps: 1000, termDays: [7, 30, 365], tiers: [] };
const plain = (node: HTMLElement | null) => node?.textContent?.replace(/\p{Zs}/gu, ' ');
const callbacks = {
  onClose: vi.fn(),
  onBorrowed: vi.fn((_message: string) => Promise.resolve()),
  onRefused: vi.fn(() => Promise.resolve()),
};

async function show(props: { cap?: number } = {}) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 'jeton', cityName: 'K' };
  render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: { c1: 'K' }, citizenshipStatus: 'citizen' }}>
        <TempleLoanSheet rules={rules} cap={props.cap ?? 20_000} open {...callbacks} />
      </HouseProvider>
    </I18nextProvider>,
  );
  return within(screen.getByRole('dialog'));
}
const next = () => fireEvent.click(screen.getByRole('button', { name: /^Continuer$/ }));
const amount = (sheet: ReturnType<typeof within>, value: string) =>
  fireEvent.change(sheet.getByLabelText(/^Montant emprunté/), {
    target: { value },
  });

beforeEach(() => {
  api.borrowFromTemple.mockReset();
  api.borrowFromTemple.mockResolvedValue({
    ok: true,
    replayed: false,
    data: {
      loanId: 'l1',
      principal: 6000,
      rateBps: 1000,
      termDays: 30,
      interest: 50,
      outstanding: 6050,
      dueDay: 20_400,
      dueAt: '2999-01-01T04:00:00+00:00',
    },
  });
  for (const callback of Object.values(callbacks)) callback.mockClear();
});
afterEach(cleanup);

describe('feuille d’emprunt au Trésor du temple (#732)', () => {
  it('plafond, durée, intérêts de packages/sim, récapitulatif, puis le principal, la durée et le taux vus sont envoyés', async () => {
    const sheet = await show();
    expect(plain(sheet.getByText(/^De 1 à /))).toContain('De 1 à 20 000 oboles');
    amount(sheet, '6000');
    next();
    // 6 000 × 10 % × 30 ÷ 365 = 49,3 oboles, arrondi à l'obole supérieure : 50.
    fireEvent.click(sheet.getByRole('radio', { name: '30 jours' }));
    expect(plain(sheet.getByText(/^À 10 % l'an/))).toBe(
      "À 10 % l'an, les intérêts sont de 8 drachmes 2 oboles : vous rembourserez 1 008 drachmes 2 oboles.",
    );
    next();
    expect(plain(sheet.getByText('À rembourser', { selector: 'dt' }).closest('div'))).toContain(
      '1 008 drachmes 2 oboles',
    );
    fireEvent.click(
      sheet.getByRole('button', { name: /^Emprunter 1\p{Zs}000\p{Zs}drachmes à 10\p{Zs}%$/u }),
    );

    await waitFor(() => expect(callbacks.onBorrowed).toHaveBeenCalled());
    expect(api.borrowFromTemple.mock.calls[0]?.slice(0, 2)).toEqual([
      { principal: 6000, termDays: 30, expectedRateBps: 1000 },
      'jeton',
    ]);
    expect(
      plain({ textContent: callbacks.onBorrowed.mock.calls[0]?.[0] } as HTMLElement),
    ).toContain('1 008 drachmes 2 oboles');
    expect(callbacks.onClose).toHaveBeenCalled();
  });

  it('au-delà du plafond, la suite est bloquée ; les durées sont celles de la configuration', async () => {
    const sheet = await show({ cap: 600 });
    amount(sheet, '601');
    expect(sheet.getByRole('button', { name: 'Continuer' }).hasAttribute('disabled')).toBe(true);
    expect(sheet.getByRole('alert').textContent).toContain('de 1 à 600');
    amount(sheet, '600');
    next();
    expect(sheet.getAllByRole('radio')).toHaveLength(3);
  });

  it('taux changé : le message du code, rien n’est annoncé, la feuille reste ouverte et l’écran relit', async () => {
    api.borrowFromTemple.mockResolvedValue({
      ok: false,
      error: { code: 'RATE_CHANGED', message: 'x' },
    });
    const sheet = await show();
    amount(sheet, '600');
    next();
    next();
    fireEvent.click(sheet.getByRole('button', { name: /^Emprunter / }));
    await waitFor(() => expect(callbacks.onRefused).toHaveBeenCalled());
    expect(sheet.getByRole('alert').textContent).toContain('Le taux directeur a changé');
    expect(callbacks.onBorrowed).not.toHaveBeenCalled();
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });
});
