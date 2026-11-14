import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import en from './locales/en.json';
import fr from './locales/fr.json';

// Le module virtuel du service worker n'existe que dans la construction de Vite.
const sw = vi.hoisted(() => ({ needRefresh: true }));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [sw.needRefresh, () => undefined],
    updateServiceWorker: () => Promise.resolve(),
  }),
}));
const { UpdateBanner, UpdatePrompt } = await import('./UpdatePrompt');
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
  it('propose de mettre à jour ou plus tard (fr)', async () => {
    const html = await render('fr');
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

  it('la zone d’annonce reste dans la page, vide et sans nom tant qu’aucune version n’attend', async () => {
    const instance = i18next.createInstance();
    await instance.use(initReactI18next).init({
      resources: { fr: { translation: fr } },
      lng: 'fr',
      interpolation: { escapeValue: false },
    });
    const page = () =>
      renderToStaticMarkup(
        <I18nextProvider i18n={instance}>
          <UpdatePrompt />
        </I18nextProvider>,
      );
    sw.needRefresh = false;
    expect(page()).toBe('<div aria-live="polite"></div>');
    sw.needRefresh = true;
    expect(page()).toContain(
      `<div aria-live="polite"><section aria-label="${fr.app.update.title}"`,
    );
    expect(page()).toContain(`>${fr.app.update.now}</button>`);
  });
});
