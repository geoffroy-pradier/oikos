import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, signIn } from './helpers';

// Écran Sites (#291) : une maison d'Ampelos ne se voit proposer que les productions de son terroir (6.1)
// et les ateliers ; le champ de blé, refusé par l'API, n'est plus offert.
test('une maison d’Ampelos ne se voit proposer que les sites de son terroir', async ({ page }) => {
  const id = randomUUID();
  const houseName = `Vignes ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await page.getByLabel('Nom de la maison').fill(houseName);
  await page.getByRole('radio', { name: 'Ampelos', exact: true }).check();
  await page.getByLabel('Nom de la maison').press('Enter');
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vigne' })).toBeVisible();

  const offers = page.getByLabel('Site à acquérir').locator('option');
  await expect(offers.first()).toHaveAttribute('value', 'grow_grapes');
  const values = await offers.evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value),
  );
  expect(values).toEqual(expect.arrayContaining(['grow_grapes', 'catch_fish', 'mill_flour']));
  expect(values).not.toContain('grow_wheat');
  expect(values).not.toContain('grow_olives');
  await expectNoHorizontalScroll(page);
});
