import { randomUUID } from 'node:crypto';
import { gameDayDate } from '@oikos/sim';
import { expect, test } from '@playwright/test';
import { closeCityDb, setUpChronicles } from './city-fixtures';
import { expectNoHorizontalScroll, KALLISTE_ID, signIn } from './helpers';

// Onglet Cité, chronique (#271) : la plus récente en entier ; la précédente, repliée, s'ouvre et se referme au
// clavier ; la mention de l'IA suit la source de chacune. À 360 px comme à 1 440 px, sans défilement horizontal.
test.afterAll(closeCityDb);

const date = (day: number) =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(gameDayDate(day));

// Paragraphes d'une chronique, comme l'écran les découpe.
const paragraphs = (text: string) => text.split(/\n\s*\n/).map((part) => part.trim());
const AI_NOTE = /^Récit réécrit par l'IA à partir des faits du jour\./;

test('la chronique du jour en entier, la précédente repliée et ouverte au clavier', async ({
  page,
}) => {
  // Les deux plus récentes, telles qu'en base : sur une base neuve, celle de la veille (IA) et l'avant-veille.
  const [latestRow, earlierRow] = await setUpChronicles();
  if (!latestRow || !earlierRow) throw new Error('deux chroniques de Kallistè attendues');
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
    latest.getByRole('heading', { name: `Chronique du ${date(latestRow.game_day)}` }),
  ).toBeVisible();
  for (const paragraph of paragraphs(latestRow.text_fr))
    await expect(latest.getByText(paragraph, { exact: true })).toBeVisible();
  await expect(latest.getByText(AI_NOTE)).toHaveCount(latestRow.source === 'ai' ? 1 : 0);

  // La précédente est repliée : le premier élément que Tab atteint après le titre est son résumé.
  const summary = card.locator('summary', { hasText: `Chronique du ${date(earlierRow.game_day)}` });
  const details = summary.locator('..');
  const [first = ''] = paragraphs(earlierRow.text_fr);
  const text = details.getByText(first, { exact: true });
  await expect(text).toBeHidden();
  await title.focus();
  await page.keyboard.press('Tab');
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(text).toBeVisible();
  await expect(details.getByText(AI_NOTE)).toHaveCount(earlierRow.source === 'ai' ? 1 : 0);
  await page.keyboard.press('Space');
  await expect(text).toBeHidden();
  await expectNoHorizontalScroll(page);
});
