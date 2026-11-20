// @vitest-environment jsdom
import { INITIAL_CONFIG } from '@oikos/config';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';
import { parseSiteRules } from '../site-rules';
import { SiteAcquire } from './SiteAcquire';

const rules = parseSiteRules(INITIAL_CONFIG);
if (!rules) throw new Error('rules');
const offers = rules.offers.filter(({ recipe }) =>
  ['grow_wheat', 'grow_olives'].includes(recipe.id),
);

async function show(busy = false) {
  const onConfirm = vi.fn();
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({ resources: { fr: { translation: fr } }, lng: 'fr' });
  render(
    <I18nextProvider i18n={instance}>
      <SiteAcquire
        offers={offers}
        upkeepOf={() => 30}
        balance={3000}
        count={1}
        limit={4}
        busy={busy}
        warning="Réponse perdue : vérifiez la liste."
        onConfirm={onConfirm}
      />
    </I18nextProvider>,
  );
  return onConfirm;
}
afterEach(cleanup);

describe('acquisition en feuille, par étapes', () => {
  it('la production choisie, puis le récapitulatif chiffré ; confirmer referme et envoie l’offre vue', async () => {
    const onConfirm = await show();
    fireEvent.click(screen.getByRole('button', { name: fr.home.acquire }));
    const sheet = screen.getByRole('dialog', { name: fr.home.acquire });
    expect(
      within(sheet).getByText('Votre maison exploite 1 site sur 4. Le prix est celui affiché.'),
    ).toBeTruthy();
    const group = within(sheet).getByRole('group', { name: fr.home.acquireRecipe });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Oliveraie/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: fr.steps.next }));
    const olives = offers.find(({ recipe }) => recipe.id === 'grow_olives');
    if (!olives) throw new Error('olives');
    const row = (label: string) => within(sheet).getByText(label).parentElement?.textContent;
    expect(row(fr.sites.acquire.upkeep)).toBe(`${fr.sites.acquire.upkeep}5 drachmes`);
    expect(row(fr.sites.acquire.after)).toMatch(/^Trésorerie après l'achat\d/);
    expect(within(sheet).getByText('Réponse perdue : vérifiez la liste.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: /^Acquérir pour / }));
    expect(onConfirm).toHaveBeenCalledWith(olives);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('pendant une commande, la feuille ne s’ouvre pas', async () => {
    await show(true);
    const trigger = screen.getByRole('button', { name: fr.home.acquire });
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
