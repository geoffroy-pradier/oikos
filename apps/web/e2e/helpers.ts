import { expect, type Locator, type Page } from '@playwright/test';

/** Cité du monde de test (`seed.sql`). D'autres suites créent des cités : on la choisit par son identifiant. */
export const KALLISTE_ID = '01900000-0000-7000-8000-000000000101';

const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://127.0.0.1:54324';

/** Récupère le lien magique envoyé à `email` dans la boîte de réception locale. */
async function magicLink(email: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    const first = messages[0];
    if (first) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${first.ID}`);
      const { Text } = (await message.json()) as { Text: string };
      const link = /https?:\/\/\S*\/auth\/v1\/verify\S+/.exec(Text)?.[0];
      if (link) return link.replace(/[)\]>.]+$/, '');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Aucun lien magique reçu pour ${email}`);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Connexion par lien magique d'un nouveau compte : saisie et envoi au clavier. */
export async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(email);
  await page.goto(await magicLink(email));
}

/**
 * Change la langue par la feuille des Réglages de la coquille, puis la referme à Échap. Le bouton se nomme
 * dans la langue en cours ; seul celui de la mise en page affichée est visible.
 */
export async function chooseLanguage(page: Page, language: 'fr' | 'en') {
  await page.getByRole('button', { name: /^(Réglages|Settings)$/ }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/^(Langue|Language)$/)
    .selectOption(language);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Fonde la maison depuis l'écran de création. `city` : la carte de cité à choisir, Kallistè par défaut. */
export async function foundHouseForm(
  page: Page,
  houseName: string,
  city: Locator = page.locator(`input[value="${KALLISTE_ID}"]`),
) {
  const name = page.getByLabel('Nom de la maison');
  await name.fill(houseName);
  await city.check();
  await name.press('Enter');
}
