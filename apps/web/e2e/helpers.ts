import AxeBuilder from '@axe-core/playwright';
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

/**
 * Attend la fin des animations et transitions en cours : axe mesure les couleurs telles qu'affichées, et une
 * apparition en fondu lui montrerait des teintes intermédiaires, au contraste insuffisant (#937).
 */
export async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        // Une animation sans fin (indicateur de chargement) ne s'achève jamais : on ne l'attend pas.
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** Violations graves (sérieuses ou critiques) des règles WCAG A et AA relevées par axe sur la page. */
export async function seriousViolations(page: Page) {
  await settleAnimations(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      rule: violation.id,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * Ouvre la feuille d'ordre de l'agora (« Vendre » ou « Acheter ») et y saisit la quantité et le prix limite.
 * Entrée mène ensuite au récapitulatif, que `placeOrder` confirme au clavier.
 */
export async function fillOrder(
  page: Page,
  side: 'Vendre' | 'Acheter',
  quantity: number | string,
  price: number | string,
) {
  await page.getByRole('button', { name: side, exact: true }).click();
  await page.getByLabel('Quantité', { exact: true }).fill(String(quantity));
  await page.getByLabel('Prix limite par unité (oboles)').fill(String(price));
}

/** Confirme l'ordre au récapitulatif de la feuille, au clavier. */
export const placeOrder = (page: Page) =>
  page.getByRole('button', { name: "Déposer l'ordre" }).press('Enter');

/**
 * Acquiert un site par sa feuille, au clavier : la production (`recipe`, sinon la première proposée), « Continuer »,
 * puis la confirmation au prix vu.
 */
export async function acquireSite(page: Page, recipe?: RegExp) {
  await page.getByRole('button', { name: 'Acquérir un site' }).press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Acquérir un site' });
  if (recipe) await sheet.getByRole('radio', { name: recipe }).check();
  await sheet.getByRole('button', { name: 'Continuer' }).press('Enter');
  await sheet.getByRole('button', { name: /^Acquérir pour / }).press('Enter');
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

/**
 * Fonde la maison par les quatre étapes (nom, blason, cité, récapitulatif), au clavier pour le nom.
 * `city` : la carte de cité à choisir, Kallistè par défaut.
 */
export async function foundHouseForm(
  page: Page,
  houseName: string,
  city: Locator = page.locator(`input[value="${KALLISTE_ID}"]`),
) {
  const name = page.getByLabel('Nom de la maison');
  await name.fill(houseName);
  await name.press('Enter');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await city.check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Fonder la maison' }).click();
}

/**
 * Onglet Cité (#697) : ouvre une de ses sous-sections en pastilles (Vie politique, Assemblée, Trésor,
 * Événements, Chronique) et attend qu'elle soit affichée.
 */
export async function citySection(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}
