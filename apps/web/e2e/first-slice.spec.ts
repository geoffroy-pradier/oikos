import { randomUUID } from 'node:crypto';
import { createConfigLoader } from '@oikos/config';
import { createDb } from '@oikos/db';
import { npcDemand, observedPricesStep, priceCandlesStep, type TickStep } from '@oikos/engine';
import { createRng, marketTax } from '@oikos/sim';
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

test('site à l’arrêt : annoncé avec son entretien, « à récolter » borné à l’arrêt, relancé au clavier', async ({
  page,
}) => {
  const houseName = await foundHouse(page);
  await expect(page.getByText('Entretien : 30 oboles par jour', { exact: false })).toBeVisible();
  await expect(page.getByText("À l'arrêt", { exact: false })).toHaveCount(0);

  // Douze heures de champ (trois cycles), dont les six dernières à l'arrêt faute d'entretien payé.
  await elapse(houseName, 720);
  await db.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set halted_at = now() - interval '6 hours'
      where house_id = (select id from game.houses where name = ${houseName})`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
  await page.reload();
  await expect(
    page.getByText(/^À l'arrêt depuis le .+ : entretien impayé\. Ce site ne produit plus\.$/),
  ).toBeVisible();
  // Le tableau de bord le signale aussi parmi les sites à surveiller.
  await expect(
    page
      .getByRole('region', { name: 'À surveiller' })
      .getByText('Champ de blé — arrêté, entretien non payé'),
  ).toBeVisible();
  // Six heures avant l'arrêt : un cycle entier, 40 unités de blé — pas les 120 de trois cycles.
  await expect(page.getByText('À récolter : 40 × Blé.')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Règles des sites illisibles : l'arrêt reste annoncé, mais aucun bouton n'affiche un prix inventé.
  await page.route('**/rest/v1/site_rules*', (route) =>
    route.fulfill({ status: 500, json: { message: 'boom' } }),
  );
  await page.reload();
  await expect(page.getByText('entretien impayé', { exact: false })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Impossible de lire vos données');
  await expect(page.getByRole('button', { name: /Relancer/ })).toHaveCount(0);
  await page.unroute('**/rest/v1/site_rules*');
  await page.reload();

  // Relance au clavier : un jour d'entretien quitte la trésorerie, le site repart.
  const restart = page.getByRole('button', { name: 'Relancer : Champ de blé, pour 30 oboles' });
  await expect(restart).toHaveText('Relancer (30 oboles)');
  await restart.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(
    "Site relancé : Champ de blé, pour 30 oboles d'entretien.",
  );
  await expect(page.getByText(/^2\s970 oboles$/)).toBeVisible();
  await expect(restart).toHaveCount(0);
  // Le bouton a disparu avec l'arrêt : le foyer est sur le message, pas perdu sur la page.
  await expect(page.getByRole('status')).toBeFocused();
  await expect(page.getByText("À l'arrêt", { exact: false })).toHaveCount(0);
  // Le cycle gelé a repris là où il en était : toujours un cycle à récolter, pas trois.
  await expect(page.getByText('À récolter : 40 × Blé.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByText('Upkeep: 30 obols a day', { exact: false })).toBeVisible();
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

/** Le moteur joue une étape du tick (par défaut la demande des PNJ) sur le monde de test. */
async function npcsBuy(step: TickStep = npcDemand) {
  const { config } = await createConfigLoader(db).at(new Date());
  await db.transaction().execute((trx) =>
    step.run({
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

    // Les PNJ achètent au tick, des ventes les moins chères aux plus chères : la vente finit servie, et
    // la maison touche le net de chaque échange (la taxe de marché s'arrondit échange par échange).
    await expect(async () => {
      await npcsBuy();
      await page.reload();
      await expect(page.getByText('Blé : 0')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    const { config } = await createConfigLoader(db).at(new Date());
    const sales = await sql<{ gross: string }>`
      select t.price * t.quantity as gross from game.trades t join game.orders o on o.id = t.sell_order_id
      where o.house_id = (select id from game.houses where name = ${houseName})`.execute(db);
    const net = sales.rows.reduce(
      (sum, sale) => sum + marketTax(Number(sale.gross), config.marketTax).net,
      0,
    );
    expect(sales.rows.reduce((sum, sale) => sum + Number(sale.gross), 0)).toBe(160);
    await expect(
      page.getByText(`${french.format(3000 + net)} oboles`, { exact: true }),
    ).toBeVisible();

    // Le tick résume les échanges en chandeliers : l'agora montre le dernier prix du blé, le graphique
    // décrit, et les mêmes valeurs dans un tableau ouvert au clavier.
    await npcsBuy(priceCandlesStep);
    await npcsBuy(observedPricesStep);
    const candle = (
      await sql<{ open: string; high: string; low: string; close: string; volume: string }>`
        select open, high, low, close, volume from game.price_candles
        where city_id = ${KALLISTE_ID} and good_id = 'wheat'
          and period_seconds = ${config.priceHistory.candleMinutes * 60}
        order by period_start desc limit 1`.execute(db)
    ).rows[0];
    if (!candle) throw new Error('aucun chandelier du blé après le tick');
    await nav.getByRole('link', { name: 'Agora' }).click();
    await expect(
      page.getByText(`Dernier prix, en oboles : ${french.format(Number(candle.close))} (`),
    ).toBeVisible();
    await expect(page.getByText(/Variation sur 24 h : /)).toBeVisible();
    // Prix moyen observé, calculé à l'instant par le tick : annoncé « sur 24 h », avec son volume.
    const average = await sql<{
      price: string;
      volume: string;
    }>`select price, volume from game.observed_prices
      where city_id = ${KALLISTE_ID} and good_id = 'wheat'`.execute(db);
    const [price, volume] = [average.rows[0]?.price, average.rows[0]?.volume].map((value) =>
      french.format(Number(value)),
    );
    await expect(
      page.getByText(`Prix moyen sur 24 h, en oboles : ${price} (volume échangé : ${volume}).`),
    ).toBeVisible();
    // Le même prix, calculé il y a plus d'une fenêtre : annoncé comme un prix passé, avec sa date.
    await sql`update game.observed_prices set observed_at = observed_at - interval '25 hours'
      where city_id = ${KALLISTE_ID} and good_id = 'wheat'`.execute(db);
    await page.reload();
    await expect(
      page.getByText(
        /^Dernier prix moyen calculé, au .+, en oboles : .+ \(volume échangé en 24 h : .+\)\.$/,
      ),
    ).toBeVisible();
    await expect(page.getByText(/Prix moyen sur 24 h/)).toHaveCount(0);
    // Description exacte de l'image, accord du nombre compris ; seules les dates, mises en forme par le
    // navigateur, sont laissées libres.
    const shown = await sql<{ count: string; low: string; high: string }>`
      select count(*), min(low) as low, max(high) as high from (select low, high from game.price_candles
        where city_id = ${KALLISTE_ID} and good_id = 'wheat' and period_seconds = ${config.priceHistory.candleMinutes * 60}
        order by period_start desc limit 48) recent`.execute(db);
    const [count, low, high] = [shown.rows[0]?.count, shown.rows[0]?.low, shown.rows[0]?.high].map(
      Number,
    );
    const periods = count === 1 ? '1 période' : `${count} périodes`;
    await expect(page.getByRole('img', { name: /^Chandeliers/ })).toHaveAccessibleName(
      new RegExp(
        `^Chandeliers : Blé, ${periods}, du .+ au .+, prix en oboles de ${french.format(low ?? 0)} à ${french.format(high ?? 0)}\\. Le tableau des prix donne les mêmes valeurs\\.$`,
      ),
    );
    const table = page.getByText('Tableau des prix par période');
    await expect(page.getByRole('columnheader', { name: 'Clôture' })).toBeHidden();
    await table.focus();
    await page.keyboard.press('Enter');
    const values = [candle.open, candle.high, candle.low, candle.close, candle.volume];
    await expect(
      page
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader') })
        .first(),
    ).toContainText(values.map((value) => french.format(Number(value))).join(''));
    await expectNoHorizontalScroll(page);
    await nav.getByRole('link', { name: 'Maison' }).click();
  });
  await expect(page.getByText('Blé : 0')).toBeVisible();
  await nav.getByRole('link', { name: 'Agora' }).click();
  await expect(page.getByRole('heading', { name: 'Mes ordres en attente' })).toBeVisible();
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
  // Au-dessus du prix de réserve des PNJ (18 oboles) : seul un joueur achètera cette vente. Assez bas
  // pour que l'acheteur puisse ensuite retenir le prix d'un second achat de trente unités.
  const price = 19 + Math.floor(Math.random() * 30);
  let paid = 0;
  const { config } = await createConfigLoader(db).at(new Date());
  const netOf = (gross: number) => marketTax(gross, config.marketTax).net;

  await alone(async () => {
    // La vente est déposée, mais la réponse se perd : le joueur réessaie la même saisie.
    await page.getByLabel('Prix limite par unité (oboles)').fill(String(price));
    await page.getByLabel('Quantité', { exact: true }).fill('30');
    // Avant de déposer la vente, le formulaire annonce ce qu'elle rapportera, taxe de marché déduite.
    const [gross, net] = [30 * price, netOf(30 * price)];
    expect(net).toBeLessThan(gross);
    // La description accessible ramène les espaces insécables des nombres à des espaces simples.
    const plain = (value: number) => french.format(value).replace(/\s/g, ' ');
    const expected = new RegExp(
      `^Net attendu : ${plain(net)} oboles \\(${plain(gross)} moins ${gross - net} de taxe de marché\\)`,
    );
    // Lue en arrivant sur chacun des deux champs et sur le bouton, sans être annoncée à chaque frappe.
    for (const control of [
      page.getByLabel('Prix limite par unité (oboles)'),
      page.getByLabel('Quantité', { exact: true }),
      page.getByRole('button', { name: "Déposer l'ordre" }),
    ])
      await expect(control).toHaveAccessibleDescription(expected);
    await expect(page.locator('#expected-net')).not.toHaveAttribute('aria-live');
    await expectNoHorizontalScroll(page);
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
    // Plus rien à ce prix : un second achat attend dans le carnet, son prix retenu hors de la trésorerie.
    await other.keyboard.press('Enter');
    const bid = price + 1;
    await expect(other.getByRole('status')).toContainText(
      `Achat en attente : 30 × Blé à ${bid} oboles. Le séquestre retient ${french.format(30 * bid)} oboles`,
    );
    await expect(
      other.getByText(
        `Blé : 30 sur 30 à ${bid} oboles (séquestre : ${french.format(30 * bid)} oboles)`,
      ),
    ).toBeVisible();
    // Le carnet public montre l'achat de l'autre côté ; le vendeur le voit, sans savoir de qui il vient.
    await page.reload();
    const bids = page.getByRole('table', { name: /^Achats en attente/ });
    await expect(bids.getByRole('row', { name: `${bid} 30` })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // Le vendeur y répond par une vente moins chère : elle s'exécute aussitôt, au prix de l'achat.
    await page.getByLabel('Prix limite par unité (oboles)').fill(String(price));
    await page.getByLabel('Quantité', { exact: true }).fill('4');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText(
      `Vente conclue : 4 × Blé pour ${french.format(netOf(4 * bid))} oboles.`,
    );
    await expect(bids.getByRole('row', { name: `${bid} 26` })).toBeVisible();
    // L'acheteur a reçu le blé sans repayer ; ce qui attend encore reste retenu, puis lui est rendu.
    await otherNav.getByRole('link', { name: 'Maison' }).click();
    await expect(other.getByText('Blé : 34')).toBeVisible();
    await expect(other.getByText(/Ordres ouverts à l'agora : 1 achat, /)).toBeVisible();
    await expect(
      other.getByText(`${french.format(3000 - 30 * price - 30 * bid)} oboles`, { exact: true }),
    ).toBeVisible();
    await expect(
      other.getByText(
        `plus ${french.format(26 * bid)} oboles au séquestre pour vos achats en attente`,
      ),
    ).toBeVisible();
    await otherNav.getByRole('link', { name: 'Agora' }).click();
    await other.getByRole('button', { name: /^Annuler l'achat de 26 × Blé/ }).click();
    await expect(other.getByRole('status')).toContainText(
      `Achat annulé : 26 × Blé ; votre trésorerie récupère ${french.format(26 * bid)} oboles.`,
    );
    await expect(other.getByText('Aucun ordre en attente.')).toBeVisible();

    // Le vendeur propose ses six derniers blés à un prix dont l'acheteur ne peut payer que trois unités :
    // l'achat s'exécute pour cette part et le dit ; le reste, impossible à retenir, est annulé.
    const left = 3000 - 30 * price - 4 * bid;
    const dear = Math.floor(left / 3);
    await page.getByLabel('Prix limite par unité (oboles)').fill(String(dear));
    await page.getByLabel('Quantité', { exact: true }).fill('6');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText(
      `Vente déposée : 6 × Blé à ${french.format(dear)} oboles.`,
    );
    await other.getByLabel('Sens').selectOption({ label: 'Acheter' });
    await other.getByLabel('Prix limite par unité (oboles)').fill(String(dear));
    await other.getByLabel('Quantité', { exact: true }).fill('6');
    // Un achat ne paie pas la taxe : rien n'est annoncé.
    await expect(other.getByLabel('Quantité', { exact: true })).toHaveAccessibleDescription('');
    await other.keyboard.press('Enter');
    await expect(other.getByRole('status')).toContainText(
      `Achat partiel : 3 × Blé sur 6 pour ${french.format(3 * dear)} oboles. Votre trésorerie ne permettait ni d'en payer davantage ni de retenir le prix du reste.`,
    );
    await otherNav.getByRole('link', { name: 'Maison' }).click();
    await expect(
      other.getByText(`${french.format(left - 3 * dear)} oboles`, { exact: true }),
    ).toBeVisible();
    await expect(other.getByText('Blé : 37')).toBeVisible();
    await context.close();
    // Trois échanges, taxés un par un : le vendeur touche le net de chacun.
    paid = netOf(30 * price) + netOf(4 * bid) + netOf(3 * dear);
    // Le vendeur retire ce qui reste : rien ne traîne dans le carnet pour les autres tests.
    await page.reload();
    await page.getByRole('button', { name: /^Annuler la vente de 3 × Blé/ }).click();
    await expect(page.getByRole('status')).toContainText(
      'Vente annulée : 3 × Blé en stock libre de nouveau.',
    );
  });

  // Le vendeur est payé, son blé est parti, sa vente a quitté la liste.
  await nav.getByRole('link', { name: 'Maison' }).click();
  await page.reload();
  await expect(
    page.getByText(`${french.format(3000 + paid)} oboles`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Blé : 3', { exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Agora' }).click();
  await expect(page.getByRole('heading', { name: 'Mes ordres en attente' })).toBeVisible();
  await expect(page.getByText(/sur 30 à/)).toHaveCount(0);
});

test('agora : choisir un bien, déposer une vente puis l’annuler au clavier', async ({ page }) => {
  // Interception posée dès le début et commandée par un drapeau : la poser juste avant l'envoi a
  // laissé passer, de loin en loin, la vraie réponse (la vente était déposée au lieu d'être « perdue »).
  let loseReply = false;
  let lost = 0;
  await page.route('**/api/commands/market.placeOrder', async (route) => {
    if (!loseReply) return route.continue();
    lost += 1;
    await route.fetch();
    await route.abort();
  });
  const houseName = await foundHouse(page);
  await elapse(houseName, 480);
  await page.getByRole('button', { name: 'Récolter : Champ de blé' }).click();
  await expect(page.getByText('Blé : 80')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.getByRole('link', { name: 'Agora' }).click();

  // Les quinze biens sont proposés ; le carnet et le formulaire suivent le bien choisi.
  const good = page.getByLabel('Bien');
  await expect(good.getByRole('option')).toHaveCount(15);
  await good.selectOption({ label: 'Olives' });
  await expect(page.getByRole('heading', { name: "Carnet d'ordres : Olives" })).toBeVisible();
  await page.getByLabel('Prix limite par unité (oboles)').fill('900');
  await page.getByLabel('Quantité', { exact: true }).fill('30');
  await page.keyboard.press('Enter');
  // La maison n'a pas d'olives : la vente est refusée, rien n'est déposé.
  await expect(page.getByRole('alert')).toContainText('Stock libre insuffisant');

  // Une vente de blé, à un prix que les PNJ n'atteignent pas : elle attend dans le carnet.
  await good.selectOption({ label: 'Blé' });
  await expect(page.getByRole('heading', { name: 'Déposer un ordre : Blé' })).toBeVisible();
  await page.getByLabel('Prix limite par unité (oboles)').fill('900');
  await page.getByLabel('Quantité', { exact: true }).fill('30');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Vente déposée : 30 × Blé à 900 oboles.');
  await expect(page.getByText('Blé : 30 sur 30 à 900 oboles')).toBeVisible();
  // Une réponse tardive du carnet du blé ne s'affiche pas sous le titre d'un autre bien.
  await page.route('**/rest/v1/order_book*', async (route) => {
    if (route.request().url().includes('good_id=eq.wheat'))
      await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await good.selectOption({ label: 'Olives' });
  await good.selectOption({ label: 'Blé' });
  await good.selectOption({ label: 'Olives' });
  await page.waitForTimeout(1200);
  await expect(page.getByRole('heading', { name: "Carnet d'ordres : Olives" })).toBeVisible();
  await expect(page.getByRole('row', { name: /^900 \d+$/ })).toHaveCount(0);
  await page.unroute('**/rest/v1/order_book*');
  // La liste de mes ventes, elle, ne dépend pas du bien affiché.
  await expect(page.getByText('Blé : 30 sur 30 à 900 oboles')).toBeVisible();
  await good.selectOption({ label: 'Blé' });
  await expect(page.getByRole('row', { name: /^900 \d+$/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  // Police très agrandie : le tableau du carnet défile dans sa carte, pas la page. (260 % :
  // marge prise sur les 200 % visés, la largeur des lettres variant d'une machine à l'autre.)
  await page.evaluate(() => (document.documentElement.style.fontSize = '260%'));
  await expectNoHorizontalScroll(page);
  await page.evaluate(() => (document.documentElement.style.fontSize = ''));

  // Un second dépôt dont la réponse se perd, puis une annulation, puis le même dépôt renvoyé :
  // l'annulation ne fait pas oublier la clé du dépôt, un seul ordre existe.
  await page.getByLabel('Prix limite par unité (oboles)').fill('901');
  await page.getByLabel('Quantité', { exact: true }).fill('10');
  loseReply = true;
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Une erreur est survenue');
  expect(lost).toBe(1);
  loseReply = false;

  // Annulation au clavier : le stock réservé redevient disponible.
  await page.getByRole('button', { name: 'Annuler la vente de 30 × Blé à 900 oboles' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(
    'Vente annulée : 30 × Blé en stock libre de nouveau.',
  );
  await expect(page.getByText('Blé : 30 sur 30 à 900 oboles')).toHaveCount(0);

  await page.getByRole('button', { name: "Déposer l'ordre" }).click();
  await expect(page.getByRole('status')).toContainText('Vente déposée : 10 × Blé à 901 oboles.');
  await expect(page.getByText('Blé : 10 sur 10 à 901 oboles')).toHaveCount(1);
  await page.getByRole('button', { name: 'Annuler la vente de 10 × Blé à 901 oboles' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Vente annulée : 10 × Blé en stock libre de nouveau.',
  );
  await expect(page.getByRole('button', { name: /^Annuler la vente/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Mes ordres en attente' })).toBeVisible();
  await nav.getByRole('link', { name: 'Maison' }).click();
  await expect(page.getByText('Blé : 80', { exact: true })).toBeVisible();
});

test('sites : acquisition au clavier, changement de production, limite du siège', async ({
  page,
}) => {
  await foundHouse(page);
  await expect(page.getByText('1 sur 4')).toBeVisible();

  // Une oliveraie, choisie et payée au clavier : la trésorerie baisse du prix annoncé.
  const offer = page.getByLabel('Site à acquérir');
  await offer.selectOption({ label: 'Oliveraie (Verger) : 900 oboles' });
  await offer.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Site acquis : Oliveraie, pour 900 oboles.');
  await expect(page.getByText(/^2\s100 oboles$/)).toBeVisible();
  await expect(page.getByText('2 sur 4')).toBeVisible();
  await expect(page.getByText('Type : Verger')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Un champ n'a qu'une production : seul le verger propose d'en changer.
  await expect(page.getByLabel('Production : Champ de blé', { exact: true })).toHaveCount(0);
  const change = page.getByRole('button', { name: 'Changer la production : Oliveraie' });
  await expect(change).toBeDisabled();
  await page.getByLabel('Production : Oliveraie', { exact: true }).selectOption({ label: 'Vigne' });
  await change.click();
  await expect(page.getByRole('status')).toContainText('Production changée : Vigne.');
  await expect(page.getByRole('heading', { name: 'Vigne' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Oliveraie' })).toHaveCount(0);

  // Deux champs de plus : la limite du siège est atteinte, l'acquisition n'est plus proposée.
  await offer.selectOption({ label: 'Champ de blé (Champ) : 600 oboles' });
  for (const balance of [/^1\s500 oboles$/, /^900 oboles$/]) {
    await page.getByRole('button', { name: 'Acquérir' }).click();
    await expect(page.getByText(balance)).toBeVisible();
  }
  await expect(page.getByText('4 sur 4')).toBeVisible();
  await expect(page.getByText('Votre maison exploite déjà autant de sites')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Acquérir' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // Après rechargement, tout vient de la base ; les textes suivent la langue.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Champ de blé' })).toHaveCount(3);
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByText('4 of 4')).toBeVisible();
  await expect(page.getByText('Type: Orchard')).toBeVisible();
});

test('acquisition sans réponse puis nouvel essai : un seul site, un seul paiement', async ({
  page,
}) => {
  await foundHouse(page);
  // L'acquisition aboutit côté serveur, mais sa réponse n'arrive jamais.
  await page.route('**/api/commands/site.acquire', async (route) => {
    await route.fetch();
    await route.abort();
  });
  const acquire = page.getByRole('button', { name: 'Acquérir' });
  await acquire.click();
  await expect(page.getByRole('alert')).toContainText('Une erreur est survenue');
  await expect(page.getByText('2 sur 4')).toBeVisible();
  await expect(page.getByText(/^2\s400 oboles$/)).toBeVisible();

  // Nouvel essai, même intention : l'API rejoue l'achat, l'écran le dit, rien n'est payé de plus.
  await page.unroute('**/api/commands/site.acquire');
  await acquire.click();
  await expect(page.getByRole('status')).toContainText('Ce site était déjà acquis : Champ de blé');
  await expect(page.getByText('2 sur 4')).toBeVisible();
  await expect(page.getByText(/^2\s400 oboles$/)).toBeVisible();

  // L'intention suivante est une nouvelle acquisition. Un double clic n'envoie qu'une commande, et
  // le prix payé s'affiche dans la fenêtre bien que le nouveau site ait poussé le formulaire.
  let sent = 0;
  await page.route('**/api/commands/site.acquire', async (route) => {
    sent += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await acquire.dblclick();
  await expect(page.getByRole('status')).toContainText('Site acquis : Champ de blé, pour 600');
  await expect(page.getByRole('status')).toBeInViewport();
  await expect(page.getByText('3 sur 4')).toBeVisible();
  await expect(page.getByText(/^1\s800 oboles$/)).toBeVisible();
  expect(sent).toBe(1);
});

test('plusieurs sites : noms distincts, résultat affiché près de l’action, choix gardé après un refus', async ({
  page,
}) => {
  const houseName = await foundHouse(page);
  const offer = page.getByLabel('Site à acquérir');
  await offer.selectOption({ label: 'Oliveraie (Verger) : 900 oboles' });
  for (const count of ['2 sur 4', '3 sur 4']) {
    await page.getByRole('button', { name: 'Acquérir' }).click();
    await expect(page.getByText(count)).toBeVisible();
  }
  const headings = page.getByRole('listitem').getByRole('heading');
  await expect(headings).toHaveText(['Champ de blé', 'Oliveraie 1', 'Oliveraie 2']);

  // Un cycle d'olives s'est écoulé : changer de production exige de récolter d'abord. Au clavier.
  await elapse(houseName, 360);
  const production = page.getByLabel('Production : Oliveraie 1', { exact: true });
  await production.selectOption({ label: 'Vigne' });
  await production.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  const refusal = page.getByRole('alert');
  await expect(refusal).toContainText('Récoltez ce site avant de changer sa production.');
  await expect(refusal).toBeInViewport();
  // Le choix est gardé, et le bouton activé garde le focus.
  await expect(production).toHaveValue('grow_grapes');
  const change = page.getByRole('button', { name: 'Changer la production : Oliveraie 1' });
  await expect(change).toBeFocused();

  // Récolte du premier site, page en haut : le résultat paraît sous ce site, dans la fenêtre.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Récolter : Champ de blé' }).click();
  await expect(page.getByRole('status')).toContainText('Récolte engrangée : 40 × Blé.');
  await expect(page.getByRole('status')).toBeInViewport();
  // Une récolte ne réordonne pas les sites.
  await expect(headings).toHaveText(['Champ de blé', 'Oliveraie 1', 'Oliveraie 2']);

  await page.getByRole('button', { name: 'Récolter : Oliveraie 1' }).click();
  await expect(page.getByRole('status')).toContainText('Récolte engrangée');
  await change.click();
  await expect(page.getByRole('status')).toContainText('Production changée : Vigne.');
  await expect(headings).toHaveText(['Champ de blé', 'Vigne', 'Oliveraie']);
  await expectNoHorizontalScroll(page);
});

test('atelier : intrants requis, stock libre, production récoltable, puis pénurie', async ({
  page,
}) => {
  const houseName = await foundHouse(page);
  await elapse(houseName, 480);
  await page.getByRole('button', { name: 'Récolter : Champ de blé' }).click();
  await expect(page.getByText('Blé : 80')).toBeVisible();

  // Un moulin : sa fiche dit ce qu'il consomme et ce que la maison a de libre.
  await page.getByLabel('Site à acquérir').selectOption('mill_flour');
  await page.getByRole('button', { name: 'Acquérir' }).click();
  await expect(page.getByRole('status')).toContainText('Site acquis : Moulin');
  const mill = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Moulin' }) });
  await expect(mill.getByText('Intrants par cycle :')).toBeVisible();
  await expect(mill.getByText('10 × Blé (stock libre : 80)')).toBeVisible();
  await expect(mill.getByText("Rien à récolter pour l'instant.")).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Deux heures plus tard : deux moutures récoltables, annoncées avant la récolte puis engrangées.
  await elapse(houseName, 120);
  await page.reload();
  await expect(mill.getByText('À récolter : 16 × Farine.')).toBeVisible();
  await page.getByRole('button', { name: 'Récolter : Moulin' }).click();
  await expect(page.getByRole('status')).toContainText('Récolte engrangée : 16 × Farine.');
  await expect(page.getByText('Blé : 60', { exact: true })).toBeVisible();
  await expect(page.getByText('Farine : 16', { exact: true })).toBeVisible();
  await expect(mill.getByText('10 × Blé (stock libre : 60)')).toBeVisible();

  // Une vente en attente réserve 55 blés : il n'en reste que 5 de libres, pas de quoi moudre.
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.getByRole('link', { name: 'Agora' }).click();
  await page.getByLabel('Prix limite par unité (oboles)').fill('900');
  await page.getByLabel('Quantité', { exact: true }).fill('55');
  await page.getByRole('button', { name: "Déposer l'ordre" }).click();
  await expect(page.getByRole('status')).toContainText('Vente déposée : 55 × Blé');
  await elapse(houseName, 60);
  await nav.getByRole('link', { name: 'Maison' }).click();
  await expect(mill.getByText('10 × Blé (stock libre : 5)')).toBeVisible();
  await expect(
    mill.getByText("Rien à récolter pour l'instant. 1 cycle attend des intrants."),
  ).toBeVisible();
  // La vente annulée, le blé redevient libre : le cycle en attente est récoltable.
  await nav.getByRole('link', { name: 'Agora' }).click();
  await page.getByRole('button', { name: 'Annuler la vente de 55 × Blé à 900 oboles' }).click();
  await expect(page.getByRole('status')).toContainText('Vente annulée');
  await nav.getByRole('link', { name: 'Maison' }).click();
  await expect(mill.getByText('À récolter : 8 × Farine.')).toBeVisible();

  // Neuf heures de plus (dix cycles dus), du blé pour six moutures : quatre attendent, l'écran le dit.
  await elapse(houseName, 540);
  await page.reload();
  await expect(
    mill.getByText('À récolter : 48 × Farine. 4 cycles attendent des intrants.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Récolter : Moulin' }).click();
  await expect(page.getByRole('status')).toContainText('Récolte engrangée : 48 × Farine.');
  await expect(
    mill.getByText("Rien à récolter pour l'instant. 4 cycles attendent des intrants."),
  ).toBeVisible();
  await expect(mill.getByText('10 × Blé (stock libre : 0)')).toBeVisible();
  // Récolter quand même : le refus de l'API est traduit, sous le site.
  await page.getByRole('button', { name: 'Récolter : Moulin' }).click();
  await expect(page.getByRole('alert')).toContainText('Il manque des intrants');
  await expect(page.getByRole('alert')).toBeInViewport();
  await expectNoHorizontalScroll(page);

  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByText('Inputs per cycle:')).toBeVisible();
  await expect(page.getByText('4 cycles are waiting for inputs.')).toBeVisible();
});
