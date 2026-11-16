import { randomUUID } from 'node:crypto';
import { gameDayDate } from '@oikos/sim';
import { expect, test } from '@playwright/test';
import { db, setUpChronicles } from './city-fixtures';
import { expectNoHorizontalScroll, KALLISTE_ID, signIn } from './helpers';

// Onglet Cité, chronique (#271) : celle de la veille, réécrite par l'IA, en entier ; celle de l'avant-veille,
// repliée, s'ouvre et se referme au clavier. À 360 px comme à 1 440 px, sans défilement horizontal.
test.afterAll(() => db.destroy());

const date = (day: number) =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(gameDayDate(day));

test('la chronique du jour en entier, la précédente repliée et ouverte au clavier', async ({
  page,
}) => {
  const days = await setUpChronicles();
  const id = randomUUID();
  const houseName = `Gazette ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await page.getByLabel('Nom de la maison').fill(houseName);
  await page.locator(`input[value="${KALLISTE_ID}"]`).check();
  await page.getByLabel('Nom de la maison').press('Enter');
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await page.getByRole('link', { name: 'Cité' }).click();

  const title = page.getByRole('heading', { name: 'Chronique de la cité', level: 2 });
  const card = title.locator('..');
  const latest = card.getByRole('article');
  await expect(
    latest.getByRole('heading', { name: `Chronique du ${date(days.latest)}` }),
  ).toBeVisible();
  await expect(latest.getByText('Veille E2E : la gazette.')).toBeVisible();
  await expect(latest.getByText('Un navire au port.')).toBeVisible();
  await expect(
    latest.getByText(/^Récit réécrit par l'IA à partir des faits du jour\./),
  ).toBeVisible();

  // La précédente est repliée : le premier élément que Tab atteint après le titre est son résumé.
  const summary = card.locator('summary', { hasText: `Chronique du ${date(days.earlier)}` });
  const details = summary.locator('..');
  const text = details.getByText('Avant-veille E2E : journée calme.');
  await expect(text).toBeHidden();
  await title.focus();
  await page.keyboard.press('Tab');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(text).toBeVisible();
  // Chronique de repli : pas de mention de l'IA.
  await expect(details.getByText(/réécrit par l'IA/)).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(text).toBeHidden();
  await expectNoHorizontalScroll(page);
});
