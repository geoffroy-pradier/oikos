import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import en from './locales/en.json';
import fr from './locales/fr.json';

// Le module virtuel du service worker n'existe que dans la construction de Vite.
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: () => ({}) }));
const { UpdateBanner } = await import('./UpdatePrompt');
/** Le rendu serveur échappe l'apostrophe. */
const escaped = (text: string) => text.replaceAll("'", '&#x27;');

async function render(language: 'fr' | 'en') {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng: language,
    interpolation: { escapeValue: false },
  });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <UpdateBanner onUpdate={() => undefined} onLater={() => undefined} />
    </I18nextProvider>,
  );
}

describe('bandeau de mise à jour', () => {
  it('nomme la région, annonce poliment, propose de mettre à jour ou plus tard (fr)', async () => {
    const html = await render('fr');
    expect(html).toContain(`aria-label="${fr.app.update.title}"`);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(escaped(fr.app.update.ready));
    expect(html).toContain(`>${fr.app.update.now}</button>`);
    expect(html).toContain(`>${fr.app.update.later}</button>`);
    // Pas de rôle d'annonce : les résultats d'action gardent seuls `status` et `alert`.
    expect(html).not.toMatch(/role="(status|alert)"/);
  });

  it('existe aussi en anglais', async () => {
    const html = await render('en');
    expect(html).toContain(escaped(en.app.update.ready));
    expect(html).toContain(`>${en.app.update.now}</button>`);
  });
});
