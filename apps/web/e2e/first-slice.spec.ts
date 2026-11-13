import { randomUUID } from 'node:crypto';
import { createDb } from '@oikos/db';
import { expect, test, type Page } from '@playwright/test';
import { sql } from 'kysely';
import { expectNoHorizontalScroll, signIn } from './helpers';

// Première tranche verticale (ticket 9) : du champ à la trésorerie, par l'interface seule.
const db = createDb(process.env['DATABASE_URL'] ?? '');
test.afterAll(() => db.destroy());

/** Fait passer `minutes` de temps de jeu sur les sites de la maison (garde de la base levée le temps du test). */
async function elapse(houseName: string, minutes: number) {
  await db.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = created_at - ${`${minutes} minutes`}::interval,
      cycle_started_at = cycle_started_at - ${`${minutes} minutes`}::interval
      where house_id = (select id from game.houses where name = ${houseName})`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
}

async function foundHouse(page: Page) {
  const id = randomUUID();
  const houseName = `Champs ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await page.getByLabel('Nom de la maison').fill(houseName);
  await page.getByLabel('Cité').selectOption({ label: 'Kallistè' });
  await page.getByLabel('Nom de la maison').press('Enter');
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  return houseName;
}

test('fiche de site et trésorerie : la maison reçoit sa dotation, puis récolte son champ', async ({
  page,
}) => {
  const houseName = await foundHouse(page);

  // Dotation de départ et premier site, lus par les vues du joueur.
  await expect(page.getByText(/^3\s000 oboles$/)).toBeVisible();
  await expect(page.getByText('Aucun bien en stock')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Champ de blé' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Trop tôt : le refus de l'API est affiché, rien n'entre en stock.
  const collect = page.getByRole('button', { name: 'Récolter : Champ de blé' });
  await collect.click();
  await expect(page.getByRole('alert')).toContainText('Rien à récolter');
  await expect(page.getByText('Aucun bien en stock')).toBeVisible();

  // Deux cycles de quatre heures plus tard : 80 unités de blé, récoltées au clavier.
  await elapse(houseName, 480);
  await collect.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Récolte engrangée : 80 × Blé.');
  await expect(page.getByText('Blé : 80')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Après rechargement, l'état vient toujours de la base ; les textes suivent la langue.
  await page.reload();
  await expect(page.getByText('Blé : 80')).toBeVisible();
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByText('Wheat: 80')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wheat field' })).toBeVisible();
  await expect(page.getByText(/^3,000 obols$/)).toBeVisible();
});
