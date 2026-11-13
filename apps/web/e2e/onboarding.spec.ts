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

test('inscription par lien magique puis création de maison, au clavier, à 360 px', async ({
  page,
}) => {
  const id = randomUUID();
  const email = `e2e-${id}@example.test`;
  const houseName = `Maison ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;

  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Entrer dans l'Archipel" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Connexion : saisie et envoi au clavier.
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(email);

  await page.goto(await magicLink(email));
  await expect(page.getByRole('heading', { name: 'Fonder votre maison' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Un nom invalide est refusé avec un message, sans quitter l'écran.
  await page.getByLabel('Nom de la maison').fill('X1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('ne sont pas valides');

  await page.getByLabel('Nom de la maison').fill(houseName);
  await page.getByLabel('Emblème').selectOption('trident');
  await page.getByLabel('Nom de la maison').press('Enter');

  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await expect(page.getByText('Métèque à Kallistè')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // La maison survit au rechargement, et l'interface bascule en anglais.
  await page.reload();
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('heading', { name: `House ${houseName}` })).toBeVisible();
  await expect(page.getByText('Metic in Kallistè')).toBeVisible();
});
