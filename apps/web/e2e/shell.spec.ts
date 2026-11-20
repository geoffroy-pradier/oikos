import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, foundHouseForm, seriousViolations, signIn } from './helpers';

test('coquille : sans violation grave (axe) dans les deux thèmes, Réglages au clavier', async ({
  page,
}) => {
  // Animations coupées : axe lit les couleurs finales, et la coquille doit tenir sans mouvement.
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  const id = randomUUID();
  const houseName = `Coquille ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, houseName);
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();

  // Sur ordinateur, la maison est dans la barre latérale ; sur téléphone, dans l'en-tête compact.
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  const where = wide ? nav : page.getByRole('banner');
  await expect(where.getByText(`Maison ${houseName}`)).toBeVisible();
  await expect(page.getByRole('banner')).toHaveCount(wide ? 0 : 1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await seriousViolations(page)).toEqual([]);
  await expectNoHorizontalScroll(page);

  // Réglages au clavier : la feuille prend le foyer, Échap la referme et le rend au bouton.
  const settings = page.getByRole('button', { name: 'Réglages' });
  await settings.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Réglages' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Fermer' })).toBeFocused();
  await expect(sheet.getByRole('radio', { name: 'Appareil' })).toBeChecked();
  expect(await seriousViolations(page)).toEqual([]);
  await expectNoHorizontalScroll(page);

  // Thème sombre au clavier : flèche vers la gauche depuis « Appareil ».
  await sheet.getByRole('radio', { name: 'Appareil' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(sheet.getByRole('radio', { name: 'Sombre' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(settings).toBeFocused();
  expect(await seriousViolations(page)).toEqual([]);

  // Thème de l'appareil : suivi en direct, et rien de mémorisé au rechargement.
  await settings.click();
  await sheet.getByRole('radio', { name: 'Appareil' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('oikos.theme'))).toBeNull();
});

test('rangées de pastilles qui défilent : chaque onglet atteint au clavier est visible en entier', async ({
  page,
}) => {
  const id = randomUUID();
  const houseName = `Rangée ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, houseName);
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();

  // Rubriques de la maison : la pastille de l'écran est entière à l'arrivée, puis chaque lien au clavier.
  await page.goto('/comptes');
  const sections = page.getByRole('navigation', { name: 'Rubriques de la maison' });
  await expect(sections.locator('[aria-current="page"]')).toBeInViewport({ ratio: 1 });
  const links = sections.getByRole('link');
  await links.first().focus();
  for (let index = 0; index < (await links.count()); index += 1) {
    if (index > 0) await page.keyboard.press('Tab');
    await expect(links.nth(index)).toBeFocused();
    await expect(links.nth(index)).toBeInViewport({ ratio: 1 });
  }
  await expectNoHorizontalScroll(page);
});
