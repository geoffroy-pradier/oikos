// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import fr from '../locales/fr.json';
import { ScreenHeader } from '../ScreenHeader';
import { LoadProblem } from './LoadProblem';

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr } },
  lng: 'fr',
  interpolation: { escapeValue: false },
});
const show = (node: React.ReactNode) =>
  render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
afterEach(cleanup);

describe('LoadProblem : nouvelle présentation', () => {
  it('dit l’échec avec une icône décorative, et relit sans double envoi', async () => {
    let calls = 0;
    let finish: () => void = () => undefined;
    show(
      <LoadProblem
        onRetry={() => {
          calls++;
          return new Promise<void>((resolve) => (finish = resolve));
        }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(fr.app.loadFailed);
    expect(screen.getByRole('alert').previousElementSibling?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    const retry = screen.getByRole('button', { name: 'Réessayer' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect([calls, retry.getAttribute('aria-disabled')]).toEqual([1, 'true']);
    finish();
    await screen.findByRole('button', { name: 'Réessayer' });
  });

  it('prend une illustration à la place de l’icône, sans la faire lire', () => {
    show(
      <LoadProblem onRetry={() => Promise.resolve()} illustration={<svg data-testid="art" />} />,
    );
    expect(screen.getByTestId('art').parentElement?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ScreenHeader', () => {
  it('donne l’heure de jeu en sous-titre du titre de la page', () => {
    show(<ScreenHeader title="Maison Alcméonides" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Maison Alcméonides' })).toBeTruthy();
    expect(screen.getByText(/^Il est \d{2}:\d{2}$/)).toBeTruthy();
  });
});
