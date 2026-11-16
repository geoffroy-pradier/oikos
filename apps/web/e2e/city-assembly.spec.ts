import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, KALLISTE_ID, signIn } from './helpers';

// Onglet Cité (#264) : une maison nouvelle, métèque, voit la vie politique de sa cité, son assemblée et
// son trésor public, sans bouton de vote, et l'écran dit pourquoi.
test('vie politique, assemblée et trésor public d’une maison métèque', async ({ page }) => {
  const id = randomUUID();
  const houseName = `Citoyens ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await page.getByLabel('Nom de la maison').fill(houseName);
  await page.locator(`input[value="${KALLISTE_ID}"]`).check();
  await page.getByLabel('Nom de la maison').press('Enter');
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();

  await page.getByRole('link', { name: 'Cité' }).click();
  await expect(page.getByRole('heading', { name: 'Vie politique' })).toBeVisible();
  const politics = page.getByRole('heading', { name: 'Vie politique' }).locator('..');
  await expect(politics.getByText('Métèque à Kallistè')).toBeVisible();
  await expect(politics.getByText(/^Métèque, votre maison voit la vie de la cité/)).toBeVisible();
  await expect(politics.getByRole('button')).toHaveCount(0);

  const assembly = page.getByRole('heading', { name: 'Assemblée' }).locator('..');
  await expect(
    assembly.getByText('Métèque, votre maison ne vote pas les décrets de la cité.'),
  ).toBeVisible();
  await expect(assembly.getByRole('button', { name: /^Voter / })).toHaveCount(0);
  await expect(assembly.getByText('Proposer un décret')).toHaveCount(0);

  const treasury = page.getByRole('heading', { name: 'Trésor public' }).locator('..');
  await expect(treasury.getByText(/^Solde : /)).toBeVisible();
  await expect(treasury.getByText(/^Taxe de marché en vigueur : /)).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Au clavier : le titre de chaque carte se lit dans l'ordre, sans piège.
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});
