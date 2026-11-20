import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  ARCHON_NAME,
  closeCityDb,
  FOREIGN_HOUSE_ID,
  setUpCity,
  setUpForeignHouse,
} from './city-fixtures';
import { expectNoHorizontalScroll, foundHouseForm, signIn } from './helpers';

// Fiche publique d'une maison (#705) : on y arrive depuis un magistrat, un candidat et l'auteur d'un message ;
// une maison inconnue ou d'un autre monde mène à l'écran introuvable, sans rien révéler.
test.afterAll(closeCityDb);

async function found(page: Page, role: Parameters<typeof setUpCity>[1] = 'metic') {
  const id = randomUUID();
  const name = `Fiche ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, name);
  await expect(page.getByRole('heading', { name: `Maison ${name}` })).toBeVisible();
  await setUpCity(name, role);
  return name;
}
const noViolation = async (page: Page) =>
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

test('du magistrat à sa fiche, au clavier, puis retour à la cité', async ({ page }) => {
  await found(page);
  await page.getByRole('link', { name: 'Cité' }).click();
  const link = page.getByRole('link', { name: `Voir la fiche de ${ARCHON_NAME}` });
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: ARCHON_NAME })).toBeFocused();
  await expect(page.getByText('Citoyenne de Kallistè')).toBeVisible();
  await expect(page.getByText('Timè', { exact: true })).toBeVisible();
  const mandates = page.getByRole('heading', { level: 2, name: 'Mandats' }).locator('..');
  await expect(mandates.getByRole('listitem').first()).toContainText('Archonte');
  await expect(mandates.getByText('En cours').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await noViolation(page);
  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page).toHaveURL(/\/cite$/);
});

test('d’un candidat à sa fiche : une maison sans mandat', async ({ page }) => {
  const name = await found(page, 'citizen');
  await page.getByRole('link', { name: 'Cité' }).click();
  await page.getByRole('button', { name: 'Me porter candidat' }).click();
  const candidate = page.getByRole('link', { name, exact: true });
  await candidate.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('Citoyenne de Kallistè')).toBeVisible();
  await expect(page.getByText("Cette maison n'a tenu aucun mandat.")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('de l’auteur d’un message à sa fiche, métèque', async ({ page }) => {
  const name = await found(page);
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('link', { name: 'Messages' })
    .click();
  await page.getByRole('button', { name: /^Canal de Kallistè/ }).click();
  const text = `Khaire ${randomUUID()}`;
  await page.getByRole('textbox', { name: /^Votre message dans/ }).fill(text);
  await page.getByRole('button', { name: 'Envoyer' }).click();
  const message = page
    .getByRole('list', { name: 'Messages du canal' })
    .getByRole('listitem')
    .filter({ hasText: text });
  await message.getByRole('link', { name: 'Votre maison' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('Métèque à Kallistè')).toBeVisible();
  await noViolation(page);
});

test('une maison inconnue ou d’un autre monde : l’écran introuvable, sans rien révéler', async ({
  page,
}) => {
  await found(page);
  await setUpForeignHouse();
  for (const id of [randomUUID(), FOREIGN_HOUSE_ID, 'pas-un-identifiant']) {
    await page.goto(`/maison/${id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: "Cette page n'existe pas." }),
    ).toBeVisible();
    await expect(page.getByText(/Lointaine|Ailleurs|Timè/)).toHaveCount(0);
  }
});
