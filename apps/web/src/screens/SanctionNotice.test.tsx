// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { currentSanctions, nextSanctionEnd, SANCTIONED_EVENT } from '../moderation';

// Sanctions du compte (#275) : lecture simulée.
const fake = vi.hoisted(() => ({
  rows: [] as unknown[] | null,
  reloads: 0,
}));
vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('../data', async () => {
  const { useState } = await import('react');
  return {
    useRows: () => {
      const [, rerender] = useState(0);
      return {
        rows: fake.rows,
        failed: false,
        reload: () => ((fake.reloads += 1), rerender((n) => n + 1), Promise.resolve(fake.rows)),
      };
    },
  };
});
const { SanctionNotice } = await import('./SanctionNotice');

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const row = (id: string, kind: string, from: number, to: number | null, appealed = false) => ({
  id,
  kind,
  starts_at: iso(from),
  ends_at: to === null ? null : iso(to),
  reason: `Motif ${id}`,
  appeal_body: appealed ? 'Je conteste.' : null,
  appealed_at: appealed ? iso(-HOUR / 2) : null,
});

async function show(lng = 'fr') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  const house = { id: 'h1', name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
  return render(
    <I18nextProvider i18n={instance}>
      <HouseProvider value={{ ...house, cityNames: {}, citizenshipStatus: 'metic' }}>
        <SanctionNotice />
      </HouseProvider>
    </I18nextProvider>,
  );
}
beforeEach(() => {
  sessionStorage.clear();
  fake.rows = [];
  fake.reloads = 0;
});
afterEach(cleanup);

describe('sanctions en cours', () => {
  it('ne garde que celles qui ne sont pas finies, la plus ancienne d’abord ; une ligne illisible fait échouer', () => {
    const now = Date.now();
    const rows = [
      row('ban', 'ban', -HOUR, null),
      row('old', 'warning', -3 * HOUR, -2 * HOUR),
      row('soon', 'suspension', HOUR, 2 * HOUR),
      row('now', 'silence', -2 * HOUR, HOUR),
    ];
    const sanctions = currentSanctions(rows, now);
    expect(sanctions?.map((sanction) => sanction.id)).toEqual(['now', 'ban', 'soon']);
    expect(nextSanctionEnd(sanctions ?? [])).toBe(Date.parse(rows[3]?.ends_at ?? ''));
    expect(currentSanctions([{ ...rows[0], kind: 'jail' }], now)).toBeNull();
  });

  it('rien à annoncer : l’écran se tait', async () => {
    fake.rows = [row('old', 'warning', -3 * HOUR, -2 * HOUR)];
    const { container } = await show();
    expect(container.textContent).toBe('');
  });

  it('annonce chaque sanction, son effet, son motif et sa fin, et l’appel déjà fait', async () => {
    fake.rows = [row('s1', 'silence', -HOUR, HOUR), row('b1', 'ban', -HOUR, null, true)];
    await show();
    expect(screen.getByRole('heading', { name: 'Sanctions de votre compte' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Réduit au silence' })).toBeTruthy();
    expect(screen.getByText('Motif : Motif s1')).toBeTruthy();
    expect(screen.getByText(/^Jusqu'au /)).toBeTruthy();
    expect(screen.getByText("Sans fin : l'exclusion est définitive.")).toBeTruthy();
    expect(screen.getByText('Je conteste.')).toBeTruthy();
  });

  it('se relit quand l’API refuse une commande pour une sanction', async () => {
    fake.rows = [];
    await show();
    act(() => void window.dispatchEvent(new Event(SANCTIONED_EVENT)));
    expect(fake.reloads).toBe(1);
  });
});
