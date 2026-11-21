import { randomUUID } from 'node:crypto';
import { createConfigLoader } from '@oikos/config';
import { createDb } from '@oikos/db';
import { cityProperties, voyageArrivals } from '@oikos/engine';
import { createRng } from '@oikos/sim';
import { expect, test, type Page } from '@playwright/test';
import { sql } from 'kysely';
import { closeCityDb, E2E_ORACLE, setUpChronicles, setUpCity, setUpOracle } from './city-fixtures';
import {
  citySection,
  expectNoHorizontalScroll,
  fillOrder,
  foundHouseForm,
  KALLISTE_ID,
  placeOrder,
  signIn,
} from './helpers';

// Parcours de l'alpha (#286), critère de sortie de la phase 2, point 1 : deux joueurs dans deux cités (Kallistè et
// Elaia), à 360 px, IA coupée (configuration initiale), qui jouent à tour de rôle ce que le critère énumère. Chaque
// étape est aussi couverte en détail par les tests de bout en bout de son écran ; celui-ci les enchaîne.
const db = createDb(process.env['DATABASE_URL'] ?? '');
test.afterAll(() => Promise.all([db.destroy(), closeCityDb()]));
const WORLD_ID = '01900000-0000-7000-8000-000000000001';
const ELAIA_ID = '01900000-0000-7000-8000-000000000103';
const french = new Intl.NumberFormat('fr-FR');
/** Un montant comme l'écrit l'interface (6 oboles pour 1 drachme), calculé à la main. */
const money = (amount: number) => {
  const [drachmas, obols] = [Math.floor(amount / 6), amount % 6];
  const unit = (count: number, word: string) =>
    `${french.format(count)} ${word}${count < 2 ? '' : 's'}`;
  return [
    ...(drachmas > 0 ? [unit(drachmas, 'drachme')] : []),
    ...(obols > 0 || drachmas === 0 ? [unit(obols, 'obole')] : []),
  ].join(' ');
};
/** Message annoncé : les régions vivantes vides ne comptent pas ; `text` désigne la région attendue (mode strict). */
const said = (page: Page, kind: 'status' | 'alert', text: string | RegExp = /\S/) =>
  page.getByRole(kind).filter({ hasText: text });
const navOf = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const suffix = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 8).join('');

async function foundHouse(page: Page, prefix: string, cityId: string) {
  const name = `${prefix} ${suffix()}`;
  await signIn(page, `e2e-${randomUUID()}@example.test`);
  await foundHouseForm(page, name, page.locator(`input[value="${cityId}"]`));
  await expect(page.getByRole('heading', { name: `Maison ${name}` })).toBeVisible();
  return name;
}

/** Monnaie de plus pour la maison, par une écriture du grand livre depuis le robinet des récompenses. */
async function fund(houseName: string, oboles: number) {
  await db.transaction().execute(async (trx) => {
    const { rows } = await sql<{
      id: string;
    }>`insert into game.ledger_entries (world_id, kind, meta)
      values (${WORLD_ID}, 'e2e.fund', '{}') returning id`.execute(trx);
    await sql`insert into game.ledger_lines (entry_id, account_id, amount)
      select ${rows[0]?.id}, a.id, case when a.kind = 'system' then ${-oboles}::bigint else ${oboles}::bigint end
      from game.accounts a where a.world_id = ${WORLD_ID} and (a.system_key = 'faucet_rewards'
        or a.house_id = (select id from game.houses where name = ${houseName}) and a.kind = 'house')`.execute(
      trx,
    );
  });
}

/** Pose des unités produites dans l'entrepôt de la maison, dans la cité : de quoi payer la rénovation. */
async function give(houseName: string, goodId: string, quantity: number, cityId: string) {
  const { rows } = await sql<{ id: string }>`select id from game.houses
    where name = ${houseName}`.execute(db);
  await sql`insert into game.inventories (world_id, house_id, city_id, good_id)
    select world_id, ${rows[0]?.id}, id, ${goodId} from game.cities where id = ${cityId}
    on conflict do nothing`.execute(db);
  await sql`insert into game.stock_ledger (world_id, good_id, quantity, from_system, to_inventory_id, kind)
    select world_id, good_id, ${quantity}, 'production', id, 'test' from game.inventories
    where house_id = ${rows[0]?.id} and city_id = ${cityId} and good_id = ${goodId}`.execute(db);
}

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

/**
 * Les sites de la maison sont à l'arrêt depuis une heure, faute d'entretien payé, ou depuis le début de leur cycle s'il
 * est plus récent : un cycle ne commence jamais après l'arrêt (`sites_cycle_not_after_halt`). Garde levée le temps de
 * l'écriture.
 */
async function halt(houseName: string) {
  await db.transaction().execute(async (trx) => {
    await sql`alter table game.sites disable trigger sites_guard`.execute(trx);
    await sql`update game.sites set halted_at = greatest(cycle_started_at, now() - interval '1 hour')
      where house_id = (select id from game.houses where name = ${houseName})`.execute(trx);
    await sql`alter table game.sites enable trigger sites_guard`.execute(trx);
  });
}

/** Le bien le plus récent de la maison perd de son état (garde levée le temps de l'écriture). */
async function wear(houseName: string, condition: number) {
  await db.transaction().execute(async (trx) => {
    await sql`alter table game.properties disable trigger properties_guard`.execute(trx);
    await sql`update game.properties set condition = ${condition}
      where owner_house_id = (select id from game.houses where name = ${houseName})`.execute(trx);
    await sql`alter table game.properties enable trigger properties_guard`.execute(trx);
  });
}

test('parcours de l’alpha : deux joueurs, deux cités, IA coupée', async ({
  page,
  browser,
  baseURL,
  viewport,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-360', 'parcours joué à 360 px');
  test.setTimeout(240_000);
  const { config } = await createConfigLoader(db).at(new Date());
  // IA coupée : chaque usage est désactivé par la configuration initiale (08), et le journal des appels reste vide.
  expect(Object.values(config.ai.usages).map((usage) => usage.enabled)).toEqual([
    false,
    false,
    false,
    false,
  ]);
  const startedAt = new Date();
  await setUpOracle();
  const [chronicle] = await setUpChronicles();
  await cityPark();

  const alpha = await foundHouse(page, 'Armateurs', KALLISTE_ID);
  const context = await browser.newContext({ baseURL: baseURL ?? '', viewport });
  const other = await context.newPage();
  const beta = await foundHouse(other, 'Marchands', ELAIA_ID);
  await fund(alpha, 6000);
  await fund(beta, 6000);
  const [nav, otherNav] = [navOf(page), navOf(other)];

  await test.step('Alpha récolte et lit son personnel', async () => {
    await elapse(alpha, 480);
    await page.reload();
    await page.getByRole('button', { name: 'Récolter : Champ de blé' }).click();
    await expect(page.getByText('Blé : 80')).toBeVisible();
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
  });

  await test.step('Alpha porte du blé par mer jusqu’à Elaia', async () => {
    await nav.getByRole('link', { name: 'Carte' }).click();
    await page.getByRole('button', { name: 'Acheter — 400 drachmes' }).focus();
    await page.keyboard.press('Enter');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: "Confirmer l'achat — 400 drachmes" })
      .click();
    await expect(page.getByRole('status')).toHaveText('Caboteur acheté pour 400 drachmes.');
    await page.getByRole('link', { name: 'Caboteur', exact: true }).click();
    await page.getByRole('button', { name: 'Préparer un départ' }).click();
    await page.getByRole('radio', { name: /^Elaia — 4 h de mer/ }).check();
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByLabel(/Blé \(80 libres\)/).fill('30');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: /^Partir vers Elaia/ }).click();
    await expect(page.getByText('Kallistè → Elaia').filter({ visible: true })).toBeVisible();
    await arrive(alpha);
    await page.getByRole('button', { name: 'Relire la flotte' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Navire arrivé à Elaia' })).toHaveText(
      'Navire arrivé à Elaia : 30 × Blé, déchargé dans votre stock.',
    );
    await expectNoHorizontalScroll(page);
  });

  await test.step('Alpha vend ce blé à Elaia, Bêta l’y achète à l’agora', async () => {
    // Alpha choisit Elaia, où son blé est arrivé : l'écran propose les cités où la maison a un stock ou un site.
    const price = 19 + Math.floor(Math.random() * 30);
    await nav.getByRole('link', { name: 'Agora' }).click();
    await expect(page.getByRole('heading', { name: 'Agora de Kallistè' })).toBeVisible();
    await page.getByLabel('Cité du marché').selectOption({ label: 'Elaia' });
    await expect(page.getByRole('heading', { name: 'Agora de Elaia' })).toBeVisible();
    await fillOrder(page, 'Vendre', 30, price);
    await page.keyboard.press('Enter');
    await placeOrder(page);
    await expect(said(page, 'status', /^Vente déposée\s: 30 × Blé/)).toBeVisible();
    await expectNoHorizontalScroll(page);
    // L'ordre d'Alpha à Elaia, retrouvé en base : sa maison n'y en a pas d'autre au même prix.
    const { rows: orders } = await sql<{ id: string }>`
      select id from game.orders where side = 'sell' and good_id = 'wheat' and price = ${price}
        and city_id = ${ELAIA_ID} and house_id = (select id from game.houses where name = ${alpha})`.execute(
      db,
    );
    expect(orders).toHaveLength(1);
    const placed = { data: { orderId: orders[0]?.id } };
    await otherNav.getByRole('link', { name: 'Agora' }).click();
    await expect(other.getByRole('heading', { name: 'Agora de Elaia' })).toBeVisible();
    await fillOrder(other, 'Acheter', 30, price + 1);
    await other.keyboard.press('Enter');
    await placeOrder(other);
    await expect(said(other, 'status', /^Achat conclu\s: 30 × Blé pour /)).toBeVisible();
    // La vente d'Alpha, par son identifiant : d'autres ordres de blé peuvent attendre à Elaia, pas dans ce compte.
    const { rows } = await sql<{ gross: string; units: string }>`
      select sum(price * quantity)::text as gross, sum(quantity)::text as units
      from game.trades where sell_order_id = ${placed.data.orderId}`.execute(db);
    expect(rows[0]).toEqual({ gross: String(30 * price), units: '30' });
    await expectNoHorizontalScroll(other);
  });

  await test.step('Bêta achète un logement à la cité et le loue ; Alpha le loue, puis achète et rénove le sien', async () => {
    const rent = 600 + Math.floor(Math.random() * 300);
    await other.goto('/immobilier');
    await other
      .getByRole('button', { name: /^Acheter à la cité \(.*\) — Maison de ville n° \d+, Elaia$/ })
      .first()
      .click();
    await other
      .getByRole('dialog')
      .getByRole('button', { name: /^Confirmer l'achat/ })
      .click();
    await expect(said(other, 'status', 'Bien acheté.')).toBeVisible();
    // Les commandes du propriétaire sont dans la fiche du bien.
    await other
      .getByRole('button', { name: /^Gérer — / })
      .filter({ visible: true })
      .click();
    // Mise en location par étapes : le loyer, le récapitulatif, la confirmation.
    const fiche = other.getByRole('dialog');
    await fiche.getByRole('button', { name: /^Mettre en location — / }).click();
    await fiche
      .getByRole('spinbutton', { name: /^Loyer par jour, en oboles — / })
      .fill(String(rent));
    await fiche.getByRole('button', { name: 'Continuer' }).click();
    await fiche.getByRole('button', { name: /^Confirmer l'offre/ }).click();
    await expect(said(other, 'status', 'Bien mis en location.')).toBeVisible();

    await page.goto('/immobilier');
    await page
      .getByRole('button', {
        name: new RegExp(`^Louer \\(${money(rent)} par jour\\) — Maison de ville n° \\d+, Elaia$`),
      })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Signer le bail/ })
      .click();
    await expect(said(page, 'status', 'Bail signé.')).toBeVisible();
    // Le bail en cours, dans le tableau (ou la fiche) des baux : locataire, à ce loyer.
    const leases = page.getByRole('region', { name: 'Mes baux' });
    await expect(leases.getByText('Locataire').filter({ visible: true })).toBeVisible();
    await expect(
      leases.getByText(`${money(rent)} par jour`, { exact: true }).filter({ visible: true }),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: /^Acheter à la cité \(.*\) — Maison de ville n° \d+, Kallistè$/,
      })
      .first()
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Confirmer l'achat/ })
      .click();
    await expect(said(page, 'status', 'Bien acheté.')).toBeVisible();
    await wear(alpha, 5000);
    const renovation = config.properties.sizes.find((size) => size.id === 'townhouse')?.renovation;
    for (const stack of renovation?.goods ?? [])
      await give(alpha, stack.goodId, stack.quantity, KALLISTE_ID);
    await page.reload();
    await page
      .getByRole('button', { name: /^Gérer — .*, Kallistè$/ })
      .filter({ visible: true })
      .click();
    await page
      .getByRole('button', { name: /^Rénover \(.*\) — Maison de ville n° \d+, Kallistè$/ })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmer la rénovation' }).click();
    await expect(said(page, 'status', 'Bien rénové.')).toBeVisible();
    // L'état, en tableau sur ordinateur, en fiche sur téléphone : la mise en page affichée.
    const owned = page.getByRole('region', { name: 'Mes biens' });
    await expect(
      owned
        .getByText(/^100\s%$/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step('Alpha relance son champ arrêté et paie les salaires de ses travailleurs', async () => {
    // Le dû d'un jour : l'entretien du champ et le salaire de ses quatre travailleurs, logés par son bien (aucun
    // hébergement à payer). La configuration en vigueur le fixe ; l'écran l'annonce avant le clic.
    const { coefficientBps, dailyOboles } = config.sites.upkeep;
    const upkeep = Math.ceil((dailyOboles.field * coefficientBps) / 10_000);
    const wages = 4 * (config.staff.dailyWageOboles['kalliste'] ?? 0);
    expect(wages).toBeGreaterThan(0);
    await halt(alpha);
    await nav.getByRole('link', { name: 'Maison' }).click();
    await page.getByRole('link', { name: 'Sites', exact: true }).click();
    await page.reload();
    await page
      .getByRole('button', { name: `Relancer : Champ de blé, pour ${money(upkeep + wages)}` })
      .click();
    await page.getByRole('button', { name: `Relancer pour ${money(upkeep + wages)}` }).click();
    await expect(said(page, 'status', 'Site relancé')).toContainText(
      `Site relancé : Champ de blé, pour ${money(upkeep + wages)} d'entretien et de salaires.`,
    );
    // Les comptes portent les salaires payés, sous leur nature.
    await page.getByRole('link', { name: 'Comptes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Flux de trésorerie' })).toBeVisible();
    // Tableau sur ordinateur, fiches sur téléphone : la mise en page affichée.
    await expect(
      page.getByText(`Salaires : −${money(wages)}`).filter({ visible: true }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step('Alpha confie son champ à un intendant, par le formulaire', async () => {
    await nav.getByRole('link', { name: 'Maison' }).click();
    await page.getByRole('link', { name: 'Sites', exact: true }).click();
    await page
      .getByRole('button', { name: /^Embaucher un intendant pour / })
      .first()
      .click();
    await page.getByRole('button', { name: /^Embaucher pour / }).click();
    await expect(said(page, 'status', 'entre à votre service').first()).toBeVisible();
    // Les règles se donnent dans leur feuille.
    await page.getByRole('button', { name: /^Règles de .+…$/ }).click();
    await page.getByRole('button', { name: /^Ajouter une règle/ }).click();
    await page.getByRole('button', { name: 'Enregistrer les règles' }).click();
    await expect(said(page, 'status', 'suivra 1 règle')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step('Alpha, citoyen, vote le décret et lit la chronique', async () => {
    await setUpCity(alpha, 'citizen');
    await nav.getByRole('link', { name: 'Cité' }).click();
    const card = (name: string) => page.getByRole('heading', { name, level: 2 }).locator('..');
    const assembly = card('Assemblée');
    await citySection(page, 'Assemblée');
    await assembly
      .getByRole('button', { name: /^Voter pour\s: Taxe de marché de la cité à / })
      .first()
      .click();
    await expect(
      assembly.getByRole('status').filter({ hasText: 'Vote enregistré.' }),
    ).toBeVisible();
    // Chronique : celle de repli ou de l'IA déjà écrite, jamais attendue du modèle.
    await citySection(page, 'Chronique');
    const article = card('Chronique de la cité').getByRole('article');
    await expect(
      article.getByText(chronicle?.text_fr.split(/\n\s*\n/)[0] ?? '', { exact: true }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step('Bêta, citoyen d’Elaia, se porte candidat à l’élection de l’archonte et y vote', async () => {
    await elaiaElection('filing');
    await db.transaction().execute(async (trx) => {
      await sql`update game.citizenships set status = 'citizen', since = now()
        where status = 'metic' and house_id = (select id from game.houses where name = ${beta})`.execute(
        trx,
      );
    });
    await otherNav.getByRole('link', { name: 'Cité' }).click();
    const politics = other.getByRole('heading', { name: 'Vie politique', level: 2 }).locator('..');
    await expect(
      politics.getByText("Élection de l'archonte : dépôt des candidatures ouvert."),
    ).toBeVisible();
    await politics.getByRole('button', { name: 'Me porter candidat' }).click();
    await expect(politics.getByRole('status')).toHaveText('Candidature déposée.');
    // Le vote s'ouvre : la maison vote pour sa propre candidature, une seule fois.
    await elaiaElection('voting');
    await other.reload();
    await expect(politics.getByText("Élection de l'archonte : vote ouvert.")).toBeVisible();
    await politics.getByRole('button', { name: `Voter pour ${beta}` }).click();
    await expect(
      politics.getByRole('status').filter({ hasText: 'Vote enregistré.' }),
    ).toBeVisible();
    await expect(politics.getByText('Votre maison a voté. Le vote est secret.')).toBeVisible();
    await expectNoHorizontalScroll(other);
  });

  await test.step('Alpha offre à Déméter, invoque sa récolte bénie, consulte la Pythie', async () => {
    // La grâce de Déméter de la configuration en vigueur : Alpha offre de quoi atteindre la Charis qu'elle requiert.
    const grace = config.graces.find((each) => each.godId === 'demeter');
    const demeter = config.gods.find((god) => god.id === 'demeter');
    if (!grace || !demeter) throw new Error('No grace of Demeter in the configuration');
    const oboles = Math.ceil(grace.charisRequired / demeter.charisPerObole);
    await page.getByRole('link', { name: 'Temple : Charis, offrandes, grâces et oracle' }).click();
    await expect(page.getByRole('heading', { name: 'Temple de Kallistè' })).toBeVisible();
    await page.getByRole('button', { name: 'Faire une offrande à Déméter' }).click();
    await page.getByLabel(/^Oboles offertes/).fill(String(oboles));
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('button', { name: /^Offrir à Déméter/ }).click();
    await expect(said(page, 'status', 'Offrande faite à Déméter')).toBeVisible();
    const name = `Récolte bénie (Déméter)`;
    await page
      .getByRole('button', { name: `Invoquer ${name} (−${grace.charisSpent} Charis)` })
      .click();
    await page
      .getByRole('button', { name: `Confirmer l'invocation (−${grace.charisSpent} Charis)` })
      .click();
    await expect(said(page, 'status', 'Grâce invoquée')).toContainText(`Grâce invoquée : ${name}.`);
    await expect(
      page.getByText(/En attente\s: elle s'appliquera à votre prochaine action/),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Consulter la Pythie pour / }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Consultation faite pour' }),
    ).toBeVisible();
    await expect(page.getByText(E2E_ORACLE.fr, { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step('Alpha écrit à la cité et à Bêta ; Bêta signale le message', async () => {
    await nav.getByRole('link', { name: 'Messages' }).click();
    // Sur téléphone, la liste des canaux d'abord, puis le fil.
    await page.getByRole('button', { name: /^Canal de Kallistè/ }).click();
    const composer = page.getByRole('textbox', { name: /^Votre message dans/ });
    const cityText = `Khaire ${randomUUID()}`;
    await composer.fill(cityText);
    await composer.press('Control+Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Message envoyé.' })).toBeVisible();
    await page.getByRole('button', { name: 'Nouvelle conversation' }).click();
    await page.getByRole('textbox', { name: 'Écrire à une maison, par son nom' }).fill(beta);
    await page.getByRole('button', { name: 'Ouvrir la conversation' }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: `Conversation avec ${beta}` }),
    ).toBeVisible();
    const privateText = `En privé ${randomUUID()}`;
    await composer.fill(privateText);
    await page.getByRole('button', { name: 'Envoyer' }).click();
    await expect(
      page.getByRole('list', { name: 'Messages du canal' }).getByText(privateText),
    ).toBeVisible();

    await otherNav.getByRole('link', { name: 'Messages' }).click();
    const direct = other.getByRole('button', { name: new RegExp(`^Conversation avec ${alpha}`) });
    await expect(direct).toBeVisible({ timeout: 15_000 });
    await direct.click();
    await expect(other.getByText(privateText)).toBeVisible();
    await other.getByRole('button', { name: `Signaler le message de ${alpha}` }).click();
    await other.getByRole('button', { name: 'Envoyer le signalement' }).click();
    await expect(
      said(other, 'status', "Message signalé : la modération l'examinera."),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoHorizontalScroll(other);
  });
  await test.step('IA coupée : aucun appel au fournisseur pendant le parcours', async () => {
    const calls = await sql<{ n: string }>`select count(*)::text as n from telemetry.ai_calls
      where called_at >= ${startedAt}`.execute(db);
    expect(calls.rows[0]?.n).toBe('0');
  });
  await context.close();
});

/**
 * Élection de l'archonte d'Elaia, ouverte au dépôt des candidatures ou au vote. Elle est propre à ce parcours (les
 * autres tests jouent celle de Kallistè) : une base gardée la réutilise, ses fenêtres sont seulement replacées.
 */
async function elaiaElection(phase: 'filing' | 'voting') {
  const [open, vote] =
    phase === 'filing'
      ? ["interval '1 hour'", "interval '1 year'"]
      : ["interval '2 hours'", "interval '-1 minute'"];
  await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext('e2e:elaia-election'))`.execute(trx);
    await sql`alter table game.elections disable trigger elections_guard`.execute(trx);
    await sql`insert into game.elections (world_id, city_id, office, candidacy_opens_at, voting_opens_at, voting_closes_at, term_ends_at)
      select ${WORLD_ID}, ${ELAIA_ID}, 'archon', now(), now() + interval '1 year', now() + interval '1 year 1 day', now() + interval '1 year 30 days'
      where not exists (select 1 from game.elections where city_id = ${ELAIA_ID} and office = 'archon' and tallied_at is null)`.execute(
      trx,
    );
    await sql`update game.elections set candidacy_opens_at = now() - ${sql.raw(open)},
        voting_opens_at = now() + ${sql.raw(vote)}, voting_closes_at = now() + interval '1 year 1 day'
      where city_id = ${ELAIA_ID} and office = 'archon' and tallied_at is null`.execute(trx);
    await sql`alter table game.elections enable trigger elections_guard`.execute(trx);
  });
}

/** Le parc de logements de chaque cité du monde de test naît comme au premier tick qui la connaît. */
async function cityPark() {
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
