// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import type { MyLoan } from '../loans';
import fr from '../locales/fr.json';

// Feuille de remboursement (#732) : commande espionnée, rendue seule.
const api = vi.hoisted(() => ({ repayLoan: vi.fn() }));
vi.mock('../api', () => ({ repayLoan: api.repayLoan }));
const { LoanRepaySheet } = await import('./LoanRepaySheet');

const loan: MyLoan = {
  id: 'l1',
  lender: 'temple',
  principal: 6000,
  rateBps: 1000,
  termDays: 30,
  interest: 50,
  dueAt: Date.parse('2999-01-01T04:00:00+00:00'),
  interestDue: 30,
  outstanding: 6030,
  status: 'active',
};
const plain = (node: HTMLElement | null) => node?.textContent?.replace(/\p{Zs}/gu, ' ');
const callbacks = {
  onClose: vi.fn(),
  onRepaid: vi.fn((_message: string) => Promise.resolve()),
  onRefused: vi.fn(() => Promise.resolve()),
};

async function show(props: { treasury?: number | null; loan?: MyLoan } = {}) {
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
        <LoanRepaySheet
          loan={props.loan ?? loan}
          treasury={props.treasury === undefined ? 1000 : props.treasury}
          open
          {...callbacks}
        />
      </HouseProvider>
    </I18nextProvider>,
  );
  return within(screen.getByRole('dialog', { name: 'Rembourser un prêt' }));
}
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));

beforeEach(() => {
  api.repayLoan.mockReset();
  api.repayLoan.mockResolvedValue({
    ok: true,
    replayed: false,
    data: { loanId: 'l1', interest: 30, principal: 270, outstanding: 5730, status: 'active' },
  });
  for (const callback of Object.values(callbacks)) callback.mockClear();
});
afterEach(cleanup);

describe('feuille de remboursement (#732)', () => {
  it('montant borné par la trésorerie, intérêts d’abord au récapitulatif, puis le montant vu est envoyé', async () => {
    const sheet = await show();
    expect(plain(sheet.getByText(/^De 1 à /))).toContain('De 1 à 1 000 oboles');
    expect(sheet.getByRole('button', { name: 'Tout' })).toBeTruthy();
    fireEvent.change(sheet.getByLabelText(/^Montant remboursé/), { target: { value: '300' } });
    next();

    expect(plain(sheet.getByText('Intérêts payés', { selector: 'dt' }).closest('div'))).toContain(
      '5 drachmes',
    );
    expect(
      plain(sheet.getByText('Principal remboursé', { selector: 'dt' }).closest('div')),
    ).toContain('45 drachmes');
    expect(plain(sheet.getByText('Reste dû après', { selector: 'dt' }).closest('div'))).toContain(
      '955 drachmes',
    );
    fireEvent.click(sheet.getByRole('button', { name: 'Rembourser 50 drachmes' }));

    await waitFor(() => expect(callbacks.onRepaid).toHaveBeenCalled());
    expect(api.repayLoan).toHaveBeenCalledTimes(1);
    expect(api.repayLoan.mock.calls[0]?.[0]).toEqual({ loanId: 'l1', amount: 300 });
    expect(api.repayLoan.mock.calls[0]?.[1]).toBe('jeton');
    expect(plain({ textContent: callbacks.onRepaid.mock.calls[0]?.[0] } as HTMLElement)).toContain(
      '955 drachmes',
    );
    expect(callbacks.onClose).toHaveBeenCalled();
  });

  it('le raccourci « Tout » prend le plus petit du reste dû et de la trésorerie, et solde le prêt', async () => {
    const sheet = await show({ treasury: 50_000 });
    expect(plain(sheet.getByText(/^De 1 à /))).toContain('De 1 à 6 030 oboles');
    fireEvent.click(sheet.getByRole('button', { name: 'Tout' }));
    expect((sheet.getByLabelText(/^Montant remboursé/) as HTMLInputElement).value).toMatch(
      /6\D?030/,
    );
  });

  it('un montant hors bornes bloque la suite ; une trésorerie vide le dit', async () => {
    const sheet = await show();
    fireEvent.change(sheet.getByLabelText(/^Montant remboursé/), { target: { value: '1001' } });
    expect(sheet.getByRole('button', { name: 'Continuer' }).hasAttribute('disabled')).toBe(true);
    expect(sheet.getByRole('alert').textContent).toContain('de 1 à');
    cleanup();
    const empty = await show({ treasury: 0 });
    expect(empty.getByText(/trésorerie est vide/)).toBeTruthy();
    expect(empty.queryByLabelText(/^Montant remboursé/)).toBeNull();
  });

  it('refus de l’API : le message du code, aucune annonce de réussite, la feuille reste ouverte et l’écran relit', async () => {
    api.repayLoan.mockResolvedValue({
      ok: false,
      error: { code: 'ABOVE_OUTSTANDING', message: 'x' },
    });
    const sheet = await show();
    fireEvent.change(sheet.getByLabelText(/^Montant remboursé/), { target: { value: '300' } });
    next();
    fireEvent.click(sheet.getByRole('button', { name: 'Rembourser 50 drachmes' }));
    await waitFor(() => expect(callbacks.onRefused).toHaveBeenCalled());
    expect(sheet.getByRole('alert').textContent).toContain('Le reste dû a changé');
    expect(callbacks.onRepaid).not.toHaveBeenCalled();
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });

  it('une intention restée sans réponse repart sous la même clé ; un montant autre, sous une clé neuve', async () => {
    api.repayLoan.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', message: 'x' },
    });
    const sheet = await show();
    fireEvent.change(sheet.getByLabelText(/^Montant remboursé/), { target: { value: '300' } });
    next();
    const confirm = () =>
      fireEvent.click(sheet.getByRole('button', { name: 'Rembourser 50 drachmes' }));
    confirm();
    await waitFor(() => expect(api.repayLoan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(callbacks.onRefused).toHaveBeenCalledTimes(1));
    confirm();
    await waitFor(() => expect(api.repayLoan).toHaveBeenCalledTimes(2));
    expect(api.repayLoan.mock.calls[1]?.[2]).toBe(api.repayLoan.mock.calls[0]?.[2]);
  });
});
