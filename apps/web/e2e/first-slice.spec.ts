import { randomUUID } from 'node:crypto';
import { createConfigLoader } from '@oikos/config';
import { createDb } from '@oikos/db';
import { npcDemand } from '@oikos/engine';
import { createRng } from '@oikos/sim';
import { expect, test, type Page } from '@playwright/test';
import { sql } from 'kysely';
import { expectNoHorizontalScroll, KALLISTE_ID, signIn } from './helpers';

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
  await page.getByLabel('Cité').selectOption(KALLISTE_ID);
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

test('réponse perdue ou lecture en échec : l’écran ne ment pas sur le stock', async ({ page }) => {
  const houseName = await foundHouse(page);
  await elapse(houseName, 240);

  // La récolte aboutit côté serveur, mais sa réponse n'arrive jamais : l'erreur est annoncée,
  // et le stock relu montre quand même le blé engrangé.
  await page.route('**/api/commands/site.collect', async (route) => {
    await route.fetch();
    await route.abort();
  });
  await page.getByRole('button', { name: 'Récolter : Champ de blé' }).click();
  await expect(page.getByRole('alert')).toContainText('Une erreur est survenue');
  await expect(page.getByText('Blé : 40')).toBeVisible();
  await page.unroute('**/api/commands/site.collect');

  // Une lecture en échec est annoncée ; elle n'est jamais prise pour un entrepôt vide.
  await page.route('**/rest/v1/my_inventories*', (route) =>
    route.fulfill({ status: 500, json: { message: 'boom' } }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Impossible de lire vos données');
  await expect(page.getByText('Aucun bien en stock')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Champ de blé' })).toBeVisible();
});

/**
 * Section exclusive sur le marché de Kallistè : les deux tailles d'écran jouent ces tests en même temps
 * dans le même carnet, et l'achat de l'une ne doit pas servir la vente de l'autre. Verrou consultatif
 * de session, tenu sur une connexion réservée.
 */
function alone<T>(section: () => Promise<T>): Promise<T> {
  return db.connection().execute(async (connection) => {
    await sql`select pg_advisory_lock(hashtext('e2e:market'))`.execute(connection);
    try {
      return await section();
    } finally {
      await sql`select pg_advisory_unlock(hashtext('e2e:market'))`.execute(connection);
    }
  });
}
const french = new Intl.NumberFormat('fr-FR');

/** Le moteur joue l'étape de demande des PNJ sur le monde de test, comme à un tick. */
async function npcsBuy() {
  const { config } = await createConfigLoader(db).at(new Date());
  await db.transaction().execute((trx) =>
    npcDemand.run({
      trx,
      worldId: '01900000-0000-7000-8000-000000000001',
      index: 0,
      scheduledAt: new Date(),
      config,
      rng: createRng('e2e'),
      dailyClose: false,
      seasonSwitch: false,
    }),
  );
}

test('du champ à l’agora : produire, vendre, voir son solde augmenter', async ({ page }) => {
  const houseName = await foundHouse(page);
  await elapse(houseName, 480);
  await page.getByRole('button', { name: 'Récolter : Champ de blé' }).click();
  await expect(page.getByText('Blé : 80')).toBeVisible();

  // Dépôt d'une vente à l'agora, au clavier : une saisie invalide est refusée sans rien envoyer.
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.getByRole('link', { name: 'Agora' }).click();
  await expect(page.getByRole('heading', { name: 'Agora de Kallistè' })).toBeVisible();
  await alone(async () => {
    await page.getByLabel('Prix limite par unité (oboles)').fill('2');
    await page.getByLabel('Quantité', { exact: true }).fill('beaucoup');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('ne sont pas valides');
    await page.getByLabel('Quantité', { exact: true }).fill('8e1');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('ne sont pas valides');
    await page.getByLabel('Quantité', { exact: true }).fill('81');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Stock libre insuffisant');
    await page.getByLabel('Quantité', { exact: true }).fill('80');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('Vente déposée : 80 × Blé à 2 oboles.');
    await expect(page.getByText('80 sur 80 à 2 oboles')).toBeVisible();
    // Le carnet public montre ce niveau de prix : colonne du prix, puis quantité offerte.
    await expect(page.getByRole('row', { name: /^2 \d+$/ })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Le blé en vente est réservé ; la trésorerie n'a pas encore bougé.
    await nav.getByRole('link', { name: 'Maison' }).click();
    await expect(page.getByText('Blé : 80 (dont 80 en vente)')).toBeVisible();
    await expect(page.getByText(/^3\s000 oboles$/)).toBeVisible();

    // Les PNJ achètent au tick, des ventes les moins chères aux plus chères : la vente finit servie.
    await expect(async () => {
      await npcsBuy();
      await page.reload();
      await expect(page.getByText(/^3\s160 oboles$/)).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
  });
  await expect(page.getByText('Blé : 0')).toBeVisible();
  await nav.getByRole('link', { name: 'Agora' }).click();
  await expect(page.getByRole('heading', { name: 'Mes ventes en attente' })).toBeVisible();
  await expect(page.getByText(/sur 80 à 2 oboles/)).toHaveCount(0);
});

test('achat à l’agora, et nouvel essai après une réponse perdue : un seul ordre', async ({
  page,
  browser,
  baseURL,
  viewport,
}) => {
  const seller = await foundHouse(page);
  await elapse(seller, 240);
  await page.getByRole('button', { name: 'Récolter : Champ de blé' }).click();
  await expect(page.getByText('Blé : 40')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.getByRole('link', { name: 'Agora' }).click();
  // Au-dessus du prix de réserve des PNJ (18 oboles) : seul un joueur achètera cette vente.
  const price = 19 + Math.floor(Math.random() * 80);

  await alone(async () => {
    // La vente est déposée, mais la réponse se perd : le joueur réessaie la même saisie.
    await page.getByLabel('Prix limite par unité (oboles)').fill(String(price));
    await page.getByLabel('Quantité', { exact: true }).fill('30');
    await page.route('**/api/commands/market.placeOrder', async (route) => {
      await route.fetch();
      await route.abort();
    });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Une erreur est survenue');
    await page.unroute('**/api/commands/market.placeOrder');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText(
      `Vente déposée : 30 × Blé à ${price} oboles.`,
    );
    // Un seul ordre : la même clé d'idempotence a rejoué le premier dépôt.
    await expect(page.getByText(`30 sur 30 à ${price} oboles`)).toHaveCount(1);
    await expect(page.getByRole('row', { name: `${price} 30` })).toBeVisible();

    // Une autre maison achète toute la vente, au prix du vendeur même avec une limite plus haute.
    const context = await browser.newContext({ baseURL: baseURL ?? '', viewport });
    const other = await context.newPage();
    await foundHouse(other);
    const otherNav = other.getByRole('navigation', { name: 'Navigation principale' });
    await otherNav.getByRole('link', { name: 'Agora' }).click();
    await other.getByLabel('Sens').selectOption({ label: 'Acheter' });
    await other.getByLabel('Prix limite par unité (oboles)').fill(String(price + 1));
    await other.getByLabel('Quantité', { exact: true }).fill('30');
    await other.keyboard.press('Enter');
    const cost = french.format(30 * price);
    await expect(other.getByRole('status')).toContainText(
      `Achat conclu : 30 × Blé pour ${cost} oboles.`,
    );
    await expect(other.getByRole('row', { name: `${price} 30` })).toHaveCount(0);
    // Plus rien à ce prix : un second achat ne conclut rien et ne coûte rien.
    await other.keyboard.press('Enter');
    await expect(other.getByRole('status')).toContainText("rien n'a été acheté");
    await otherNav.getByRole('link', { name: 'Maison' }).click();
    await expect(other.getByText(`${french.format(3000 - 30 * price)} oboles`)).toBeVisible();
    await expect(other.getByText('Blé : 30')).toBeVisible();
    await context.close();
  });

  // Le vendeur est payé, son blé est parti, sa vente a quitté la liste.
  await nav.getByRole('link', { name: 'Maison' }).click();
  await page.reload();
  await expect(page.getByText(`${french.format(3000 + 30 * price)} oboles`)).toBeVisible();
  await expect(page.getByText('Blé : 10')).toBeVisible();
  await nav.getByRole('link', { name: 'Agora' }).click();
  await expect(page.getByRole('heading', { name: 'Mes ventes en attente' })).toBeVisible();
  await expect(page.getByText(/sur 30 à/)).toHaveCount(0);
});
