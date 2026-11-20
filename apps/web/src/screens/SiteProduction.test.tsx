// @vitest-environment jsdom
import { INITIAL_CONFIG } from '@oikos/config';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';
import { parseSiteRules } from '../site-rules';
import { SiteProduction } from './SiteProduction';

const rules = parseSiteRules(INITIAL_CONFIG);
if (!rules) throw new Error('rules');
const olives = rules.recipe('grow_olives') ?? null;

function Screen({ onConfirm }: { onConfirm: (id: string) => void }) {
  const [choice, setChoice] = useState('grow_olives');
  return (
    <SiteProduction
      siteName="Oliveraie"
      current="grow_olives"
      recipe={olives}
      alternatives={rules?.alternatives('grow_olives') ?? []}
      choice={choice}
      onChoice={setChoice}
      upkeepOf={() => 30}
      busy={false}
      onConfirm={onConfirm}
    />
  );
}
afterEach(cleanup);

describe('changement de production en feuille', () => {
  it('rien à continuer sur la production actuelle ; une autre, puis ce qui change ; confirmer l’envoie', async () => {
    const onConfirm = vi.fn();
    const instance = i18next.createInstance();
    await instance
      .use(initReactI18next)
      .init({ resources: { fr: { translation: fr } }, lng: 'fr' });
    render(
      <I18nextProvider i18n={instance}>
        <Screen onConfirm={onConfirm} />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Changer la production : Oliveraie' }));
    const sheet = screen.getByRole('dialog', { name: 'Production : Oliveraie' });
    const group = within(sheet).getByRole('group', { name: 'Production : Oliveraie' });
    expect(within(group).getByRole('radio', { name: 'Oliveraie' })).toHaveProperty('checked', true);
    const next = within(sheet).getByRole('button', { name: fr.steps.next });
    expect(next).toHaveProperty('disabled', true);
    fireEvent.click(within(group).getByRole('radio', { name: 'Vigne' }));
    expect(next).toHaveProperty('disabled', false);
    fireEvent.click(next);
    expect(within(sheet).getByText('Oliveraie → Vigne')).toBeTruthy();
    expect(within(sheet).getByText(/^\d+ × Olives → \d+ × Raisin$/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: fr.sites.production.confirm }));
    expect(onConfirm).toHaveBeenCalledWith('grow_grapes');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
