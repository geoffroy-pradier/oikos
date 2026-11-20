import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, signIn, foundHouseForm } from './helpers';

// Onglet Messages (#274), à deux joueurs de Kallistè, chacun dans son navigateur : un message du canal de la
// cité et une conversation privée arrivent chez l'autre sans recharger la page, par Realtime ; la saisie en
// cours de l'autre n'est ni perdue ni privée du foyer. Chaque passage fonde deux maisons neuves et écrit des
// textes uniques : rien ne dépend de ce qu'un passage précédent a laissé dans le canal de la cité.
const POLLING = /ne viennent plus en direct/;

async function foundHouse(page: Page, prefix: string) {
  const id = randomUUID();
  const name = `${prefix} ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, name);
  await expect(page.getByRole('heading', { name: `Maison ${name}` })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('link', { name: 'Messages' })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: 'Canal de Kallistè' })).toBeVisible();
  return name;
}
/**
 * Retient chaque annonce de la région polie de l'écran : l'autre format du test (360 ou 1 440 px) tourne en même
 * temps et écrit aussi dans le canal de Kallistè, si bien que l'annonce attendue peut être remplacée avant d'être
 * lue. On vérifie donc qu'elle a été faite, pas qu'elle est la dernière.
 */
async function recordAnnouncements(page: Page) {
  await page.evaluate(() => {
    // La région de l'écran Messages, dans le contenu principal : le bandeau de mise à jour (`UpdatePrompt`),
    // rendu avant l'application, porte lui aussi une région polie, toujours présente et vide.
    const regions = document.querySelectorAll('#main [aria-live="polite"]');
    const [region] = regions;
    if (regions.length !== 1 || !region)
      throw new Error(`une région d'annonce attendue dans #main, ${regions.length} trouvée(s)`);
    const said: string[] = [];
    Object.assign(window, { __announced: said });
    new MutationObserver(() => said.push(region.textContent ?? '')).observe(region, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}
const announced = (page: Page) =>
  page.evaluate(() => (window as unknown as { __announced: string[] }).__announced);
const composer = (page: Page) => page.getByRole('textbox', { name: /^Votre message dans/ });
const shown = (page: Page) => page.getByRole('list', { name: 'Messages du canal' });

test('deux joueurs : le canal de la cité et une conversation privée, en direct', async ({
  page,
  browser,
  baseURL,
  viewport,
}) => {
  const alpha = await foundHouse(page, 'Hermes');
  const context = await browser.newContext({ baseURL: baseURL ?? '', viewport });
  const other = await context.newPage();
  const beta = await foundHouse(other, 'Iris');

  await recordAnnouncements(other);
  // Bêta commence une saisie et y garde le foyer.
  await composer(other).fill('Brouillon de Bêta');
  await composer(other).focus();

  // Alpha écrit dans le canal de la cité, au clavier.
  const cityText = `Khaire Kallistè ${randomUUID()}`;
  await composer(page).fill(cityText);
  await composer(page).press('Control+Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Message envoyé.' })).toBeVisible();
  await expect(composer(page)).toHaveValue('');
  await expect(shown(page).getByText(cityText)).toBeVisible();

  // Chez Bêta, le message arrive sans recharger, avant toute relecture de repli (15 secondes).
  await expect(shown(other).getByText(cityText)).toBeVisible({ timeout: 10_000 });
  await expect(shown(other).getByRole('listitem').filter({ hasText: cityText })).toContainText(
    alpha,
  );
  await expect(composer(other)).toHaveValue('Brouillon de Bêta');
  await expect(composer(other)).toBeFocused();

  // Alpha ouvre une conversation avec Bêta par son nom, et lui écrit.
  await page
    .getByRole('textbox', { name: 'Écrire à une maison, par son nom' })
    .fill(beta.toLowerCase());
  await page.getByRole('button', { name: 'Ouvrir la conversation' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `Conversation ouverte avec ${beta}.` }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: `Conversation avec ${beta}` }),
  ).toBeVisible();
  const privateText = `En privé ${randomUUID()}`;
  await composer(page).fill(privateText);
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await expect(shown(page).getByText(privateText)).toBeVisible();

  // Chez Bêta, la conversation nouvelle paraît avec son non lu, annoncée sans voler le foyer.
  const direct = other.getByRole('button', { name: new RegExp(`^Conversation avec ${alpha}`) });
  await expect(direct).toContainText('1 message non lu', { timeout: 10_000 });
  const phrase = `Nouveau message : Conversation avec ${alpha}.`;
  await expect
    .poll(async () => (await announced(other)).some((text) => text.includes(phrase)))
    .toBe(true);
  await expect(composer(other)).toBeFocused();
  await expect(other.getByRole('status').filter({ hasText: POLLING })).toHaveCount(0);

  // Bêta l'ouvre au clavier : le message s'affiche, le non lu disparaît, son brouillon de la cité l'attend.
  await direct.focus();
  await other.keyboard.press('Enter');
  await expect(direct).toHaveAttribute('aria-current', 'true');
  await expect(shown(other).getByText(privateText)).toBeVisible();
  await expect(direct).not.toContainText('non lu');
  await other.getByRole('button', { name: /^Canal de Kallistè/ }).click();
  await expect(composer(other)).toHaveValue('Brouillon de Bêta');
  await expectNoHorizontalScroll(page);
  await expectNoHorizontalScroll(other);
  await context.close();
});
