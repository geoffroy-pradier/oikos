import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, foundHouseForm, signIn } from './helpers';

// Écran Sites (#291) : une maison d'Ampelos ne se voit proposer que les productions de son terroir (6.1)
// et les ateliers ; le champ de blé, refusé par l'API, n'est plus offert.
test('une maison d’Ampelos ne se voit proposer que les sites de son terroir', async ({ page }) => {
  const id = randomUUID();
  const houseName = `Vignes ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, houseName, page.getByRole('radio', { name: 'Ampelos', exact: true }));
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vigne', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Sites', exact: true }).click();

  const offers = page.getByLabel('Site à acquérir').locator('option');
  await expect(offers.first()).toHaveAttribute('value', 'grow_grapes');
  const values = await offers.evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value),
  );
  expect(values).toEqual(expect.arrayContaining(['grow_grapes', 'catch_fish', 'mill_flour']));
  expect(values).not.toContain('grow_wheat');
  expect(values).not.toContain('grow_olives');
  // Au clavier : le menu se parcourt aux flèches, sans jamais tomber sur une production hors terroir.
  const menu = page.getByLabel('Site à acquérir');
  await menu.focus();
  await page.keyboard.press('ArrowDown');
  await expect(menu).toHaveValue(values[1] ?? '');
  await expectNoHorizontalScroll(page);
});
