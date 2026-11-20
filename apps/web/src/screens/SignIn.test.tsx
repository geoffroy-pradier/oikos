// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fr from '../locales/fr.json';

const auth = vi.hoisted(() => ({ failing: false, sent: [] as string[] }));
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: ({ email }: { email: string }) => {
        auth.sent.push(email);
        return Promise.resolve({ error: auth.failing ? new Error('boom') : null });
      },
    },
  },
}));
const { SignIn } = await import('./SignIn');

async function mount() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr } },
    lng: 'fr',
    interpolation: { escapeValue: false },
  });
  render(
    <I18nextProvider i18n={instance}>
      <SignIn />
    </I18nextProvider>,
  );
  fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
    target: { value: 'a@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Recevoir le lien' }));
}
afterEach(() => {
  cleanup();
  auth.failing = false;
  auth.sent = [];
});

describe('connexion', () => {
  it('lien envoyé : l’adresse est confirmée, sans erreur sur le champ', async () => {
    await mount();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('a@example.test'));
    expect(auth.sent).toEqual(['a@example.test']);
    expect(screen.getByLabelText('Adresse e-mail').getAttribute('aria-invalid')).toBeNull();
  });

  it('échec d’envoi : le message est sous le champ, qu’il décrit et marque invalide', async () => {
    auth.failing = true;
    await mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("L'envoi a échoué. Réessayez dans un instant.");
    const field = screen.getByLabelText('Adresse e-mail');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(alert.id);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('l’illustration d’accueil est décorative : aucun nom accessible en plus du titre', async () => {
    await mount();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Entrer dans l'Archipel");
  });
});
