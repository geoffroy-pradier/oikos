import { randomUUID } from 'node:crypto';
import { createConfigLoader } from '@oikos/config';
import { createDb } from '@oikos/db';
import { voyageArrivals } from '@oikos/engine';
import { createRng } from '@oikos/sim';
import { expect, test } from '@playwright/test';
import { sql } from 'kysely';
import { expectNoHorizontalScroll, signIn, foundHouseForm } from './helpers';

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
  await foundHouseForm(page, houseName);
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await elapse(houseName, 480);
  await page.getByRole('button', { name: 'Récolter : Champ de blé' }).click();
  await expect(page.getByText('Blé : 80')).toBeVisible();

  // La carte et la liste qui la double ; achat d'un caboteur au prix affiché, au clavier.
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.getByRole('link', { name: 'Carte' }).click();
  await expect(page.getByRole('heading', { name: "Carte de l'archipel" })).toBeVisible();
  await expect(page.getByRole('img', { name: /12 cités, 23 routes/ })).toBeVisible();
  await expect(page.getByText('Kallistè – Elaia : 4 h')).toBeVisible();
  // Un vrai clic sur une cité du dessin la choisit pour le panneau ; un glisser qui revient sur une autre, non.
  const drawing = page.getByRole('img', { name: /12 cités, 23 routes/ });
  // Les douze noms de cités, tels que le navigateur les dessine : aucun n'en chevauche un autre (#707).
  const boxes = await drawing
    .locator('text.font-bold')
    .evaluateAll((texts) => texts.map((text) => text.getBoundingClientRect().toJSON() as DOMRect));
  expect(boxes).toHaveLength(12);
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1))
      expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(
        true,
      );
  await drawing.locator('text', { hasText: /^Ampelos$/ }).click();
  const chosen = page.getByRole('heading', { level: 2, name: 'Ampelos' });
  await expect(chosen).toBeVisible();
  const halos = await drawing.locator('text', { hasText: /^Halos$/ }).boundingBox();
  if (!halos) throw new Error('Halos absente du dessin');
  const [x, y] = [halos.x + halos.width / 2, halos.y + halos.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y - 30, { steps: 5 });
  await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
  await expect(chosen).toBeVisible();
  await page.getByRole('button', { name: 'Acheter — 400 drachmes' }).focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: "Confirmer l'achat — 400 drachmes" })
    .click();
  await expect(page.getByRole('status')).toHaveText('Caboteur acheté pour 400 drachmes.');
  await expect(page.getByRole('listitem').filter({ hasText: 'à quai à Kallistè' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Fiche du navire, puis sa feuille de départ par étapes : la destination, la cargaison prise dans le
  // stock libre, puis « Partir » au coût vu.
  await page.getByRole('link', { name: 'Caboteur', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Caboteur' })).toBeVisible();
  await page.getByRole('button', { name: 'Préparer un départ' }).click();
  // Police très agrandie (260 %) : la fiche et sa feuille de départ ne débordent pas de la page.
  await page.evaluate(() => (document.documentElement.style.fontSize = '260%'));
  await expectNoHorizontalScroll(page);
  await page.evaluate(() => (document.documentElement.style.fontSize = ''));
  // La feuille ne propose que les routes de Kallistè, ses six voisines, des plus courtes aux plus longues (#707).
  const destinations = page.getByRole('group', { name: 'Destination' }).locator('label');
  await expect(destinations).toHaveCount(6);
  const names = await destinations.allTextContents();
  expect(names.map((name) => name.split(' — ')[0])).toEqual([
    'Dikaia',
    'Emporion',
    'Ampelos',
    'Elaia',
    'Myrrhinè',
    'Halos',
  ]);
  await page.getByRole('radio', { name: /^Elaia — 4 h de mer/ }).check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel(/Blé \(80 libres\)/).fill('30');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: /^Partir vers Elaia/ }).click();
  // La fiche porte aussi la région, vide, qui annonce la lecture des tempêtes : on vise l'issue du départ.
  await expect(
    page.getByRole('status').filter({ hasText: 'Caboteur est parti vers Elaia' }),
  ).toBeVisible();
  // Voyages en fiches sur téléphone, en tableau sur ordinateur : la mise en page affichée.
  await expect(page.getByText('Kallistè → Elaia').filter({ visible: true })).toBeVisible();
  await expect(page.getByText('30 × Blé').filter({ visible: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Entrepôt : le stock à quai et la cargaison en mer, sous sa cité d'arrivée.
  await nav.getByRole('link', { name: 'Maison' }).click();
  await expect(page.getByText('Blé : 50')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'En mer, vers Elaia' })).toBeVisible();

  // Arrivée jouée par le moteur, annoncée à la relecture de la fiche.
  await nav.getByRole('link', { name: 'Carte' }).click();
  await page.getByRole('link', { name: 'Caboteur', exact: true }).click();
  await expect(page.getByText('Arrivée prévue').filter({ visible: true })).toBeVisible();
  await arrive(houseName);
  await page.getByRole('button', { name: 'Relire la flotte' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Navire arrivé à Elaia' })).toHaveText(
    'Navire arrivé à Elaia : 30 × Blé, déchargé dans votre stock.',
  );
  await expect(page.getByText('à quai à Elaia')).toBeVisible();
});

test('fonder dans une cité nouvelle, choisie par son dieu, puis partir vers une voisine (#707)', async ({
  page,
}) => {
  const id = randomUUID();
  const houseName = `Messagers ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  const name = page.getByLabel('Nom de la maison');
  await name.fill(houseName);
  await name.press('Enter');
  await page.getByRole('button', { name: 'Continuer' }).click();
  // La liste des douze cités se filtre par dieu protecteur : Hermès protège Emporion seule.
  const cities = page.getByRole('group', { name: "Cité d'accueil" }).getByRole('radio');
  await expect(cities).toHaveCount(12);
  await page.getByLabel('Dieu protecteur').selectOption({ label: 'Hermès' });
  await expect(cities).toHaveCount(1);
  await expect(page.getByText('1 cité sur 12')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('radio', { name: 'Emporion', exact: true }).check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Fonder la maison' }).click();
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();

  // Un caboteur à quai à Emporion : la feuille de départ ne propose que ses quatre voisines.
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('link', { name: 'Carte' })
    .click();
  await page.getByRole('button', { name: 'Acheter — 400 drachmes' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: "Confirmer l'achat — 400 drachmes" })
    .click();
  await expect(page.getByRole('listitem').filter({ hasText: 'à quai à Emporion' })).toBeVisible();
  await page.getByRole('link', { name: 'Caboteur', exact: true }).click();
  await page.getByRole('button', { name: 'Préparer un départ' }).click();
  const destinations = page.getByRole('group', { name: 'Destination' }).locator('label');
  await expect(destinations).toHaveCount(4);
  expect((await destinations.allTextContents()).map((text) => text.split(' — ')[0])).toEqual([
    'Halos',
    'Kallistè',
    'Elaia',
    'Gamelia',
  ]);
  await page.getByRole('radio', { name: /^Gamelia — 4 h de mer/ }).check();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: /^Partir vers Gamelia/ }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Caboteur est parti vers Gamelia' }),
  ).toBeVisible();
});
