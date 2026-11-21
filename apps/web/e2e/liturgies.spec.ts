import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { closeCityDb, setUpCity } from './city-fixtures';
import {
  citySection,
  expectNoHorizontalScroll,
  foundHouseForm,
  seriousViolations,
  signIn,
} from './helpers';
import { closeLiturgyDb, setUpLiturgies, setUpOstracism } from './liturgy-fixtures';

// Liturgies et ostracisme (#723) : alerte du tableau de bord, accomplissement par feuille, liturgies et ostracisme de
// l'onglet Cité. La scène (liturgies, vote d'ostracisme) est posée en base comme le moteur l'écrirait.
test.afterAll(async () => {
  await closeLiturgyDb();
  await closeCityDb();
});

async function foundHouse(page: Page, city?: Parameters<typeof foundHouseForm>[2]) {
  const id = randomUUID();
  const houseName = `Liturgie ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, houseName, city);
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  return houseName;
}

test('liturgie désignée : alerte, accomplissement par étapes au clavier, état dans la cité', async ({
  page,
}) => {
  const houseName = await foundHouse(page);
  await setUpLiturgies(houseName, 'assigned');
  await page.goto('/');
  const alert = page.getByRole('link', {
    name: /^Liturgie confiée à votre maison : Fête\. Dû : 100 drachmes, à accomplir avant le /,
  });
  await expect(alert).toBeVisible();
  await alert.press('Enter');

  await expect(page.getByRole('heading', { level: 1, name: 'Liturgie' })).toBeVisible();
  await expect(page.getByText('À accomplir', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Accomplir ma liturgie' }).press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Accomplir ma liturgie' });
  await expect(sheet.getByText('Le dû est fixé par la cité.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Continuer' }).press('Enter');
  // Faste borné par la configuration, avec ses raccourcis : 25 %, 50 % et tout.
  const splendor = sheet.getByLabel(/^Faste/);
  await expect(sheet.getByRole('button', { name: 'Tout' })).toBeVisible();
  await splendor.fill('60');
  await expect(sheet.getByText(/^Vous gagneriez /)).toBeVisible();
  await sheet.getByRole('button', { name: 'Continuer' }).press('Enter');
  await expect(sheet.getByText('110 drachmes').first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Payer 110 drachmes' }).press('Enter');

  const done = page
    .getByRole('status')
    .filter({ hasText: 'Liturgie accomplie : 110 drachmes payés' });
  await expect(done).toBeVisible();
  await expect(page.getByText('Accomplie', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accomplir ma liturgie' })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
  await expectNoHorizontalScroll(page);

  // Onglet Cité : la liturgie de la saison de chaque maison désignée, jamais un montant.
  await page.getByRole('link', { name: 'Retour à la cité' }).click();
  await citySection(page, 'Liturgies');
  const panel = page.getByRole('tabpanel', { name: 'Liturgies' });
  const row = (name: string) =>
    panel.getByRole('listitem').or(panel.getByRole('row')).filter({ hasText: name });
  await expect(row(houseName).first()).toContainText('Accomplie');
  await expect(row('Philaïdes').first()).toContainText("Prélevée d'office");
  await expect(row('Alcméonides').first()).toContainText('À accomplir');
  await expect(panel).not.toContainText(/drachme|obole/);
  await expect(panel.getByRole('link', { name: 'Voir ma liturgie' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('liturgie prélevée d’office : l’écran le dit, avec la Timè perdue, sans alerte ni bouton', async ({
  page,
}) => {
  const houseName = await foundHouse(page);
  await setUpLiturgies(houseName, 'levied');
  await page.goto('/cite/liturgie');
  await expect(page.getByRole('heading', { level: 1, name: 'Liturgie' })).toBeVisible();
  await expect(page.getByText("Prélevée d'office", { exact: true })).toBeVisible();
  await expect(page.getByText(/Timè perdue\s: 90\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accomplir ma liturgie' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Maison' }).first().click();
  await expect(page.getByRole('link', { name: /^Liturgie confiée/ })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('ostracisme au vote : un citoyen choisi dans la liste filtrable, le bulletin déposé sans son nom', async ({
  page,
}) => {
  const houseName = await foundHouse(page);
  await setUpCity(houseName, 'citizen');
  await setUpOstracism();
  await page.getByRole('link', { name: 'Cité' }).click();
  await citySection(page, 'Ostracisme');
  const panel = page.getByRole('tabpanel', { name: 'Ostracisme' });
  await expect(panel.getByText(/^Vote ouvert jusqu'au /)).toBeVisible();
  await panel.getByRole('button', { name: 'Inscrire un nom' }).press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Inscrire un nom' });
  await expect(sheet.getByRole('radio')).not.toHaveCount(0);
  await sheet.getByLabel('Rechercher un citoyen').fill('alcmeo');
  await expect(sheet.getByRole('radio')).toHaveCount(1);
  await sheet.getByRole('radio', { name: 'Alcméonides' }).check();
  await sheet.getByRole('button', { name: 'Continuer' }).press('Enter');
  await expect(sheet.getByText('Vous inscrivez le nom de Alcméonides.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Inscrire ce nom' }).press('Enter');

  await expect(
    page.getByRole('status').filter({ hasText: 'Votre bulletin est déposé.' }),
  ).toBeVisible();
  await expect(panel.getByText(/^Votre maison a voté le /)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Inscrire un nom' })).toHaveCount(0);
  // Secret : rien du panneau ne dit pour qui la maison a voté.
  await expect(panel).not.toContainText('Alcméonides');
  expect(await seriousViolations(page)).toEqual([]);
  await expectNoHorizontalScroll(page);
});

test('ostracisme dépouillé : l’ostracisé, les bulletins et le décompte par nom', async ({
  page,
}) => {
  const houseName = await foundHouse(
    page,
    page.locator('input[value="01900000-0000-7000-8000-000000000103"]'),
  );
  await setUpCity(houseName, 'metic');
  await setUpOstracism();
  await page.getByRole('link', { name: 'Cité' }).click();
  await citySection(page, 'Ostracisme');
  const panel = page.getByRole('tabpanel', { name: 'Ostracisme' });
  await expect(panel.getByText(/^Étéoboutades est ostracisée jusqu'au /)).toBeVisible();
  await expect(panel.getByText('Bulletins')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Inscrire un nom' })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Étéoboutades' }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});
