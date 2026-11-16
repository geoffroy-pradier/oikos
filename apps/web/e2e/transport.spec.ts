import { randomUUID } from 'node:crypto';
import { createConfigLoader } from '@oikos/config';
import { createDb } from '@oikos/db';
import { voyageArrivals } from '@oikos/engine';
import { createRng } from '@oikos/sim';
import { expect, test } from '@playwright/test';
import { sql } from 'kysely';
import { expectNoHorizontalScroll, KALLISTE_ID, signIn } from './helpers';

// Onglet Carte (#254) : acheter un navire, le faire partir chargé, le voir arriver, par l'interface.
const db = createDb(process.env['DATABASE_URL'] ?? '');
test.afterAll(() => db.destroy());
const WORLD_ID = '01900000-0000-7000-8000-000000000001';

/** Avance le temps de jeu des sites de la maison (garde de la base levée le temps de l'écriture). */
async function elapse(houseName: string, minutes: number) {
  await db.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set created_at = created_at - ${`${minutes} minutes`}::interval,
      cycle_started_at = cycle_started_at - ${`${minutes} minutes`}::interval
      where house_id = (select id from game.houses where name = ${houseName})`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
}

/** Le voyage de la maison est échu (gardes levées le temps de l'écriture), puis le moteur le décharge. */
async function arrive(houseName: string) {
  await db.transaction().execute(async (trx) => {
    await sql`alter table game.voyages disable trigger voyages_guard, disable trigger voyages_settled`.execute(
      trx,
    );
    await sql`update game.voyages set departed_at = now() - interval '5 hours',
      arrives_at = now() - interval '1 hour'
      where house_id = (select id from game.houses where name = ${houseName})`.execute(trx);
    await sql`alter table game.voyages enable trigger voyages_guard, enable trigger voyages_settled`.execute(
      trx,
    );
  });
  const { config } = await createConfigLoader(db).at(new Date());
  await db.transaction().execute((trx) =>
    voyageArrivals.run({
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

test('acheter un navire, le faire partir chargé vers Elaia, le voir arriver', async ({ page }) => {
  const id = randomUUID();
  const houseName = `Armateurs ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await page.getByLabel('Nom de la maison').fill(houseName);
  await page.locator(`input[value="${KALLISTE_ID}"]`).check();
  await page.getByLabel('Nom de la maison').press('Enter');
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await elapse(houseName, 480);
  await page.getByRole('button', { name: 'Récolter : Champ de blé' }).click();
  await expect(page.getByText('Blé : 80')).toBeVisible();

  // La carte et la liste qui la double ; achat d'un caboteur au prix affiché, au clavier.
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.getByRole('link', { name: 'Carte' }).click();
  await expect(page.getByRole('heading', { name: "Carte de l'archipel" })).toBeVisible();
  await expect(page.getByRole('img', { name: /4 cités, 6 routes/ })).toBeVisible();
  await expect(page.getByText('Kallistè – Elaia : 4 h')).toBeVisible();
  await page.getByRole('button', { name: 'Acheter — 400 drachmes' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Caboteur acheté pour 400 drachmes.');
  await expect(page.getByRole('listitem').filter({ hasText: 'à quai à Kallistè' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Fiche du navire : la destination, la cargaison prise dans le stock libre, puis « Partir ».
  await page.getByRole('link', { name: 'Caboteur', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Caboteur' })).toBeVisible();
  await page.getByRole('radio', { name: /^Elaia — 4 h de mer/ }).check();
  await page.getByLabel(/Blé \(80 libres\)/).fill('30');
  await page.getByRole('button', { name: /^Partir vers Elaia/ }).click();
  // La fiche porte aussi la région, vide, qui annonce la lecture des tempêtes : on vise l'issue du départ.
  await expect(
    page.getByRole('status').filter({ hasText: 'Caboteur est parti vers Elaia' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Kallistè → Elaia' })).toBeVisible();
  await expect(page.getByText('30 × Blé')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Entrepôt : le stock à quai et la cargaison en mer, sous sa cité d'arrivée.
  await nav.getByRole('link', { name: 'Maison' }).click();
  await expect(page.getByText('Blé : 50')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'En mer, vers Elaia' })).toBeVisible();

  // Arrivée jouée par le moteur, annoncée à la relecture de la fiche.
  await nav.getByRole('link', { name: 'Carte' }).click();
  await page.getByRole('link', { name: 'Caboteur', exact: true }).click();
  await expect(page.getByText('Arrivée prévue')).toBeVisible();
  await arrive(houseName);
  await page.getByRole('button', { name: 'Relire la flotte' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Navire arrivé à Elaia' })).toHaveText(
    'Navire arrivé à Elaia : 30 × Blé, déchargé dans votre stock.',
  );
  await expect(page.getByText('à quai à Elaia')).toBeVisible();
});
