import { randomUUID } from 'node:crypto';
import { createConfigLoader } from '@oikos/config';
import { createDb } from '@oikos/db';
import { cityProperties } from '@oikos/engine';
import { createRng } from '@oikos/sim';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, signIn, foundHouseForm } from './helpers';

// Écrans Personnel et Immobilier, onglet Cité (#259) : le parc de Kallistè naît comme au premier tick qui
// la connaît ; une maison achète un bien à la cité au clavier, au prix affiché.
const db = createDb(process.env['DATABASE_URL'] ?? '');
const WORLD_ID = '01900000-0000-7000-8000-000000000001';

async function buildPark() {
  const { config } = await createConfigLoader(db).at(new Date());
  await db.transaction().execute((trx) =>
    cityProperties.run({
      trx,
      worldId: WORLD_ID,
      index: 0,
      scheduledAt: new Date(),
      config,
      rng: createRng('e2e'),
      dailyClose: false,
      seasonSwitch: false,
      catchUp: false,
    }),
  );
}

test('personnel, parc de la cité et achat d’un bien à la cité', async ({ page }, testInfo) => {
  const id = randomUUID();
  const houseName = `Bâtisseurs ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await buildPark();
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, houseName);
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();

  // Personnel : le champ de départ et ses quatre travailleurs, sans logement.
  await page.getByRole('link', { name: 'Personnel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Personnel', level: 1 })).toBeVisible();
  // Une ligne par cité (fiche sur téléphone) : travailleurs, logés par ses biens, hébergés, hébergement.
  const workforce = page.getByRole('region', { name: 'Travailleurs par cité' });
  await expect(workforce.locator('td, dd').filter({ visible: true })).toHaveText([
    '4',
    '0',
    '4',
    /./,
  ]);
  await expectNoHorizontalScroll(page);

  // Immobilier : un bien de la cité s'achète au clavier, au prix affiché.
  await page.goto('/immobilier');
  await expect(page.getByRole('heading', { name: 'Immobilier', level: 1 })).toBeVisible();
  // Les deux formats tournent en même temps sur la même base : chacun achète un lot différent.
  const buy = page.getByRole('button', {
    name: /^Acheter à la cité \(500 drachmes\) — Maison de ville n° \d+, Kallistè$/,
  });
  await (testInfo.project.name === 'mobile-360' ? buy.first() : buy.last()).focus();
  await page.keyboard.press('Enter');
  // L'achat s'ouvre dans une feuille, au prix vu, et se confirme au clavier.
  const confirm = page
    .getByRole('dialog')
    .getByRole('button', { name: "Confirmer l'achat — 500 drachmes" });
  // Le foyer entre dans la feuille sur « Fermer » ; une tabulation mène à la confirmation.
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Enter');
  // Le résultat s'annonce dans la carte des offres et prend le foyer, la feuille fermée.
  await expect(page.getByRole('status').filter({ hasText: 'Bien acheté.' })).toBeVisible();
  const mine = page.getByRole('heading', { name: 'Mes biens' }).locator('..');
  await expect(mine.getByText('État : 100 %')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Onglet Cité : marché du travail pas encore fixé, parc par taille.
  await page.getByRole('link', { name: 'Cité' }).click();
  await expect(page.getByRole('heading', { name: 'Marché du travail' })).toBeVisible();
  await expect(page.getByText(/^Maison de ville : 20 au total/)).toBeVisible();
  await expectNoHorizontalScroll(page);
});
