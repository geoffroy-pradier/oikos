import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

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

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Connexion par lien magique d'un nouveau compte : saisie et envoi au clavier. */
async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(email);
  await page.goto(await magicLink(email));
}

test('une lecture en échec n’est pas prise pour « pas de maison » et se réessaie', async ({
  page,
}) => {
  await page.route('**/rest/v1/houses*', (route) =>
    route.fulfill({ status: 500, json: { message: 'boom' } }),
  );
  await signIn(page, `e2e-${randomUUID()}@example.test`);
  await expect(page.getByRole('alert')).toContainText('Impossible de lire vos données');
  await expect(page.getByRole('heading', { name: 'Fonder votre maison' })).toHaveCount(0);

  await page.unroute('**/rest/v1/houses*');
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByRole('heading', { name: 'Fonder votre maison' })).toBeVisible();
});

test('inscription, création de maison, puis coquille de navigation', async ({ page }) => {
  const id = randomUUID();
  const email = `e2e-${id}@example.test`;
  const houseName = `Maison ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;

  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Entrer dans l'Archipel" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await signIn(page, email);
  await expect(page.getByRole('heading', { name: 'Fonder votre maison' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Un nom invalide est refusé avec un message, sans quitter l'écran.
  await page.getByLabel('Nom de la maison').fill('X1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('ne sont pas valides');
  await expect(page.getByLabel('Nom de la maison')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Nom de la maison').fill(houseName);
  await page.getByLabel('Emblème').selectOption('trident');
  await page.getByLabel('Nom de la maison').press('Enter');

  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await expect(page.getByText('Métèque à Kallistè')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Coquille : cinq onglets, en bas sur téléphone, sur le côté sur ordinateur ; navigation au clavier.
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav.getByRole('link')).toHaveCount(5);
  const [box, viewport] = [await nav.boundingBox(), page.viewportSize()];
  if (!box || !viewport) throw new Error('navigation introuvable');
  if (viewport.width < 1024) expect(Math.round(box.y + box.height)).toBe(viewport.height);
  else expect([box.x, Math.round(box.height)]).toEqual([0, viewport.height]);

  await nav.getByRole('link', { name: 'Maison' }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('link', { name: 'Agora' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Agora' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Agora' })).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalScroll(page);

  // Police agrandie à 200 % (réglage du navigateur) : aucun libellé d'onglet coupé ni superposé.
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  const tabs = await nav.getByRole('link').evaluateAll((links) =>
    links.map((link) => ({
      clipped: link.scrollWidth > link.clientWidth + 1,
      box: link.getBoundingClientRect().toJSON() as {
        left: number;
        right: number;
        top: number;
        bottom: number;
      },
    })),
  );
  expect(tabs.filter((tab) => tab.clipped)).toEqual([]);
  tabs.slice(1).forEach((tab, index) => {
    const previous = tabs[index];
    const sideBySide = previous && previous.box.right <= tab.box.left + 1;
    const stacked = previous && previous.box.bottom <= tab.box.top + 1;
    expect(sideBySide || stacked).toBe(true);
  });
  await expectNoHorizontalScroll(page);
  await page.evaluate(() => (document.documentElement.style.fontSize = ''));

  // Adresse inconnue : écran traduit, puis retour à la maison.
  await page.goto('/adresse-inconnue');
  await expect(page.getByRole('heading', { name: "Cette page n'existe pas." })).toBeVisible();
  await page.getByRole('link', { name: 'Revenir à la maison' }).click();
  await nav.getByRole('link', { name: 'Agora' }).click();

  // Thème sombre : appliqué et mémorisé.
  await page.getByRole('button', { name: 'Thème sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await nav.getByRole('link', { name: 'Maison' }).click();

  // La maison et le thème survivent au rechargement ; l'interface bascule en anglais et s'en souvient.
  await page.reload();
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('heading', { name: `House ${houseName}` })).toBeVisible();
  await expect(page.getByText('Metic in Kallistè')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'House' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
