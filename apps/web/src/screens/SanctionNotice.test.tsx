// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HouseProvider } from '../house';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import {
  appealDecisions,
  currentSanctions,
  nextSanctionEnd,
  noticedSanctions,
  SANCTIONED_EVENT,
} from '../moderation';

// Sanctions du compte (#275) et décisions sur leurs appels (#529) : lectures et appel simulés.
const fake = vi.hoisted(() => ({
  rows: [] as unknown[] | null,
  decisions: [] as unknown[] | null,
  reloads: 0,
  decisionReloads: 0,
  appeals: [] as { id: string; body: string; key: string; answer: (r: unknown) => void }[],
}));
vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('../data', async () => {
  const { useState } = await import('react');
  return {
    useRows: (view: string) => {
      const [, rerender] = useState(0);
      const decisions = view === 'my_appeal_decisions';
      const rows = decisions ? fake.decisions : fake.rows;
      return {
        rows,
        failed: false,
        reload: () => (
          decisions ? (fake.decisionReloads += 1) : (fake.reloads += 1),
          rerender((n) => n + 1),
          Promise.resolve(rows)
        ),
      };
    },
  };
});
vi.mock('../api', () => ({
  appealSanction: (id: string, body: string, _token: string, key: string) =>
    new Promise((answer) => fake.appeals.push({ id, body, key, answer })),
}));
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
const decided = (id: string, decision: string, at = -HOUR / 4) => ({
  sanction_id: id,
  decision,
  decided_at: iso(at),
});

async function show(lng = 'fr', houseId = 'h1') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    interpolation: { escapeValue: false },
  });
  const house = { id: houseId, name: 'Test', cityId: 'c1', accessToken: 't', cityName: 'Kallistè' };
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
  localStorage.clear();
  fake.rows = [];
  fake.decisions = [];
  fake.reloads = 0;
  fake.decisionReloads = 0;
  fake.appeals.length = 0;
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
    expect(nextSanctionEnd(sanctions ?? [], now)).toBe(Date.parse(rows[3]?.ends_at ?? ''));
    expect(currentSanctions([{ ...rows[0], kind: 'jail' }], now)).toBeNull();
  });

  it('rien à annoncer : l’écran se tait', async () => {
    fake.rows = [row('old', 'warning', -3 * HOUR, -2 * HOUR)];
    const { container } = await show();
    expect(container.textContent).toBe('');
    // Rien à annoncer : aucune région d'annonce, l'écran garde la sienne seule.
    expect(screen.queryAllByRole('status')).toHaveLength(0);
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
    expect(screen.getAllByRole('button', { name: 'Faire appel' })).toHaveLength(1);
  });

  it('un appel s’écrit au clavier, part sous une clé gardée tant qu’il est sans réponse, puis le foyer passe au résultat', async () => {
    fake.rows = [row('s1', 'suspension', -HOUR, HOUR)];
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Faire appel' }));
    const box = screen.getByRole('textbox', { name: 'Votre appel' });
    expect(document.activeElement).toBe(box);
    fireEvent.click(screen.getByRole('button', { name: "Envoyer l'appel" }));
    expect(screen.getByRole('alert').textContent).toBe("Écrivez votre appel avant de l'envoyer.");
    expect(fake.appeals).toHaveLength(0);
    fireEvent.change(box, { target: { value: '  Je conteste.  ' } });
    fireEvent.submit(box);
    const first = fake.appeals[0];
    expect([first?.id, first?.body]).toEqual(['s1', 'Je conteste.']);
    // Réponse perdue : le même appel repart sous la même clé.
    await act(async () => first?.answer({ ok: false, error: { code: 'INTERNAL', message: 'x' } }));
    fireEvent.submit(box);
    expect(fake.appeals[1]?.key).toBe(first?.key);
    // La relecture montre l'appel fait : le formulaire disparaît, le résultat et le foyer restent.
    fake.rows = [row('s1', 'suspension', -HOUR, HOUR, true)];
    await act(async () =>
      fake.appeals[1]?.answer({ ok: true, data: { sanctionId: 's1' }, replayed: false }),
    );
    expect(screen.queryByRole('button', { name: 'Faire appel' })).toBeNull();
    expect(screen.getByText('Je conteste.')).toBeTruthy();
    const status = screen.getByText("Votre appel est envoyé : la modération l'examinera.");
    expect(status.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(status);
    expect(fake.reloads).toBe(1);
  });

  it('un refus est expliqué ; annuler rend le foyer au bouton', async () => {
    fake.rows = [row('s1', 'silence', -HOUR, HOUR)];
    await show('en');
    fireEvent.click(screen.getByRole('button', { name: 'Appeal' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your appeal' }), {
      target: { value: 'Please.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send the appeal' }));
    await act(async () =>
      fake.appeals[0]?.answer({ ok: false, error: { code: 'SANCTION_ENDED', message: 'x' } }),
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'This sanction has ended: it can no longer be appealed.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => new Promise((resolve) => setTimeout(resolve)));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Appeal' }));
  });

  it('se relit quand l’API refuse une commande pour une sanction', async () => {
    fake.rows = [];
    await show();
    act(() => void window.dispatchEvent(new Event(SANCTIONED_EVENT)));
    expect([fake.reloads, fake.decisionReloads]).toEqual([1, 1]);
  });
});

describe('décision sur l’appel (#529)', () => {
  it('une sanction finie ne reste annoncée que si son appel est tranché et sa décision pas masquée', () => {
    const now = Date.now();
    const rows = [
      row('lifted', 'suspension', -2 * HOUR, -HOUR / 4, true),
      row('ended', 'warning', -3 * HOUR, -2 * HOUR, true),
      row('masked', 'silence', -3 * HOUR, -HOUR, true),
      row('kept', 'silence', -HOUR, HOUR, true),
    ];
    const decisions = appealDecisions([
      decided('lifted', 'granted'),
      decided('masked', 'rejected', -2 * HOUR),
      decided('kept', 'rejected'),
    ]);
    const sanctions = noticedSanctions(rows, decisions ?? new Map(), new Set(['masked']), now);
    expect(sanctions?.map((sanction) => [sanction.id, sanction.decision?.decision])).toEqual([
      ['lifted', 'granted'],
      ['kept', 'rejected'],
    ]);
    // Une fin passée ne fait pas tourner la minuterie.
    expect(nextSanctionEnd(sanctions ?? [], now)).toBe(Date.parse(rows[3]?.ends_at ?? ''));
    expect(appealDecisions([{ ...decided('kept', 'rejected'), decision: 'pending' }])).toBeNull();
  });

  it('un appel rejeté est annoncé sous la sanction qui court, sans nouvel appel', async () => {
    fake.rows = [row('s1', 'silence', -HOUR, HOUR, true)];
    fake.decisions = [decided('s1', 'rejected')];
    await show();
    expect(screen.getByText(/^Appel rejeté le .+ : la sanction est maintenue\.$/)).toBeTruthy();
    expect(screen.getByText(/^Jusqu'au /)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Faire appel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Masquer cet avis' })).toBeNull();
  });

  it('un appel accueilli lève la sanction : annoncée finie, sans effet, jusqu’à ce que le joueur masque l’avis', async () => {
    fake.rows = [
      row('s1', 'suspension', -HOUR, -HOUR / 4, true),
      row('s2', 'silence', -HOUR, HOUR),
    ];
    fake.decisions = [decided('s1', 'granted')];
    const view = await show();
    expect(screen.getByText(/^Appel accueilli le .+ : la sanction est levée\.$/)).toBeTruthy();
    expect(screen.getByText(/^Terminée le /)).toBeTruthy();
    expect(screen.queryByText(/Vous ne pouvez plus agir/)).toBeNull();
    const hide = screen.getByRole('button', { name: 'Masquer cet avis' });
    expect(hide.getAttribute('aria-describedby')).toBe(
      screen.getByRole('heading', { name: 'Compte suspendu' }).id,
    );
    fireEvent.click(hide);
    expect(screen.queryByRole('heading', { name: 'Compte suspendu' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Réduit au silence' })).toBeTruthy();
    const status = screen.getByText('Avis masqué.');
    expect(status.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(status);
    // Masqué sur cet appareil : un nouvel affichage ne le montre plus.
    view.unmount();
    const again = await show();
    expect(screen.queryByText(/^Appel accueilli/)).toBeNull();
    // Masqué pour ce compte seulement : un autre compte sur le même navigateur a sa propre clé.
    expect(JSON.parse(localStorage.getItem('oikos.appealDecisionsDismissed.h1') ?? '[]')).toEqual([
      's1',
    ]);
    expect(localStorage.getItem('oikos.appealDecisionsDismissed')).toBeNull();
    again.unmount();
    await show('fr', 'h2');
    expect(screen.getByText(/^Appel accueilli/)).toBeTruthy();
  });

  it('le dernier avis masqué, l’annonce reste ; en anglais, la décision se lit aussi', async () => {
    fake.rows = [row('b1', 'ban', -HOUR, -HOUR / 4, true)];
    fake.decisions = [decided('b1', 'granted')];
    await show('en');
    expect(screen.getByText(/^Appeal granted on .+: the sanction is lifted\.$/)).toBeTruthy();
    expect(screen.getByText(/^Ended on /)).toBeTruthy();
    // La région existe, vide et masquée à la vue, avant l'annonce : c'est le même élément qui l'annonce.
    const region = screen.getByRole('status');
    expect([region.textContent, region.className.includes('empty:sr-only')]).toEqual(['', true]);
    fireEvent.click(screen.getByRole('button', { name: 'Hide this notice' }));
    expect(screen.queryByRole('heading', { name: 'Sanctions on your account' })).toBeNull();
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('Notice hidden.');
    expect(document.activeElement).toBe(region);
  });

  it('des décisions illisibles ne cachent pas les sanctions en cours', async () => {
    fake.rows = [row('s1', 'silence', -HOUR, HOUR, true)];
    fake.decisions = [{ sanction_id: 's1', decision: 'maybe', decided_at: 'x' }];
    await show();
    expect(screen.getByRole('heading', { name: 'Réduit au silence' })).toBeTruthy();
    expect(screen.queryByText(/^Appel (accueilli|rejeté)/)).toBeNull();
  });
});
