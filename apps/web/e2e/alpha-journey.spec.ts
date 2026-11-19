import { randomUUID } from 'node:crypto';
import { createConfigLoader } from '@oikos/config';
import { createDb } from '@oikos/db';
import { cityProperties, voyageArrivals } from '@oikos/engine';
import { createRng } from '@oikos/sim';
import { expect, test, type Page } from '@playwright/test';
import { sql } from 'kysely';
import { closeCityDb, E2E_ORACLE, setUpChronicles, setUpCity, setUpOracle } from './city-fixtures';
import { expectNoHorizontalScroll, KALLISTE_ID, signIn } from './helpers';

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
const said = (page: Page, kind: 'status' | 'alert') =>
  page.getByRole(kind).filter({ hasText: /\S/ });
const navOf = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const suffix = () => [...randomUUID().replace(/[^a-f]/g, '')].slice(0, 8).join('');

async function foundHouse(page: Page, prefix: string, cityId: string) {
  const name = `${prefix} ${suffix()}`;
  await signIn(page, `e2e-${randomUUID()}@example.test`);
  await page.getByLabel('Nom de la maison').fill(name);
  await page.locator(`input[value="${cityId}"]`).check();
  await page.getByLabel('Nom de la maison').press('Enter');
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
      select ${rows[0]?.id}, a.id, case when a.kind = 'system' then ${-oboles} else ${oboles} end
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
  // La configuration initiale coupe l'IA : aucune consigne d'intendant, aucune chronique ni aucun oracle de l'IA.
  expect(config.graces).toEqual([]);
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
    await page.getByRole('link', { name: 'Personnel de la maison' }).click();
    await expect(page.getByRole('heading', { name: 'Personnel', level: 1 })).toBeVisible();
    await expect(page.getByText('4 travailleurs', { exact: true })).toBeVisible();
    await expect(
      page.getByText(/^Logés par vos biens : 0 ; hébergés chez les habitants : 4/),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step('Alpha porte du blé par mer jusqu’à Elaia', async () => {
    await nav.getByRole('link', { name: 'Carte' }).click();
    await page.getByRole('button', { name: 'Acheter — 400 drachmes' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText('Caboteur acheté pour 400 drachmes.');
    await page.getByRole('link', { name: 'Caboteur', exact: true }).click();
    await page.getByRole('radio', { name: /^Elaia — 4 h de mer/ }).check();
    await page.getByLabel(/Blé \(80 libres\)/).fill('30');
    await page.getByRole('button', { name: /^Partir vers Elaia/ }).click();
    await expect(page.getByRole('heading', { name: 'Kallistè → Elaia' })).toBeVisible();
    await arrive(alpha);
    await page.getByRole('button', { name: 'Relire la flotte' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Navire arrivé à Elaia' })).toHaveText(
      'Navire arrivé à Elaia : 30 × Blé, déchargé dans votre stock.',
    );
    await expectNoHorizontalScroll(page);
  });

  await test.step('Alpha vend ce blé à Elaia, Bêta l’y achète à l’agora', async () => {
    // L'agora de l'écran est celle de la cité de la maison : la vente à Elaia d'Alpha passe par la commande.
    const price = 19 + Math.floor(Math.random() * 30);
    const placed = await page.evaluate(
      async ({ cityId, price }) => {
        const key = Object.keys(localStorage).find((name) => name.endsWith('-auth-token')) ?? '';
        const token = (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string })
          .access_token;
        const response = await fetch('/api/commands/market.placeOrder', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({ cityId, goodId: 'wheat', side: 'sell', price, quantity: 30 }),
        });
        return (await response.json()) as { ok: boolean };
      },
      { cityId: ELAIA_ID, price },
    );
    expect(placed.ok).toBe(true);
    await otherNav.getByRole('link', { name: 'Agora' }).click();
    await expect(other.getByRole('heading', { name: 'Agora de Elaia' })).toBeVisible();
    await other.getByLabel('Sens').selectOption({ label: 'Acheter' });
    await other.getByLabel('Prix limite par unité (oboles)').fill(String(price + 1));
    await other.getByLabel('Quantité', { exact: true }).fill('30');
    await other.keyboard.press('Enter');
    await expect(said(other, 'status')).toContainText(
      `Achat conclu : 30 × Blé pour ${money(30 * price)}.`,
    );
    await expectNoHorizontalScroll(other);
  });

  await test.step('Bêta achète un logement à la cité et le loue ; Alpha le loue, puis achète et rénove le sien', async () => {
    const rent = 600 + Math.floor(Math.random() * 300);
    await other.goto('/immobilier');
    await other
      .getByRole('button', { name: /^Acheter à la cité \(.*\) — Maison de ville n° \d+, Elaia$/ })
      .first()
      .click();
    await expect(said(other, 'status')).toContainText('Bien acheté.');
    await other.getByRole('textbox', { name: /^Loyer par jour, en oboles — / }).fill(String(rent));
    await other.getByRole('button', { name: /^Mettre en location — / }).click();
    await expect(said(other, 'status')).toContainText('Bien mis en location.');

    await page.goto('/immobilier');
    await page
      .getByRole('button', {
        name: new RegExp(`^Louer \\(${money(rent)} par jour\\) — Maison de ville n° \\d+, Elaia$`),
      })
      .click();
    await expect(said(page, 'status')).toContainText('Bail signé.');
    await expect(page.getByText(`Vous louez ce bien : ${money(rent)} par jour`)).toBeVisible();

    await page
      .getByRole('button', {
        name: /^Acheter à la cité \(.*\) — Maison de ville n° \d+, Kallistè$/,
      })
      .first()
      .click();
    await expect(said(page, 'status')).toContainText('Bien acheté.');
    await wear(alpha, 5000);
    const renovation = config.properties.sizes.find((size) => size.id === 'townhouse')?.renovation;
    for (const stack of renovation?.goods ?? [])
      await give(alpha, stack.goodId, stack.quantity, KALLISTE_ID);
    await page.reload();
    await page
      .getByRole('button', { name: /^Rénover \(.*\) — Maison de ville n° \d+, Kallistè$/ })
      .click();
    await expect(said(page, 'status')).toContainText('Bien rénové.');
    await expect(page.getByText('État : 100 %').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step('Alpha confie son champ à un intendant, par le formulaire', async () => {
    await nav.getByRole('link', { name: 'Maison' }).click();
    await page
      .getByRole('button', { name: /^Embaucher un intendant pour / })
      .first()
      .click();
    await expect(said(page, 'status').first()).toContainText('entre à votre service');
    await page.getByRole('button', { name: /^Ajouter une règle/ }).click();
    await page.getByRole('button', { name: 'Enregistrer les règles' }).click();
    await expect(said(page, 'status').filter({ hasText: 'suivra 1 règle' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step('Alpha, citoyen, se porte candidat, vote le décret, lit la chronique', async () => {
    await setUpCity(alpha, 'citizen');
    await nav.getByRole('link', { name: 'Cité' }).click();
    const card = (name: string) => page.getByRole('heading', { name, level: 2 }).locator('..');
    const [politics, assembly] = [card('Vie politique'), card('Assemblée')];
    await politics.getByRole('button', { name: 'Me porter candidat' }).click();
    await expect(politics.getByRole('status')).toHaveText('Candidature déposée.');
    await assembly
      .getByRole('button', { name: /^Voter pour : Taxe de marché de la cité à / })
      .first()
      .click();
    await expect(
      assembly.getByRole('status').filter({ hasText: 'Vote enregistré.' }),
    ).toBeVisible();
    // Chronique : celle de repli ou de l'IA déjà écrite, jamais attendue du modèle.
    const article = card('Chronique de la cité').getByRole('article');
    await expect(
      article.getByText(chronicle?.text_fr.split(/\n\s*\n/)[0] ?? '', { exact: true }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step('Alpha offre, voit qu’aucune grâce n’est offerte, consulte la Pythie', async () => {
    await page.getByRole('link', { name: 'Temple : Charis, offrandes, grâces et oracle' }).click();
    await expect(page.getByRole('heading', { name: 'Temple de Kallistè' })).toBeVisible();
    await page.getByLabel(/^Oboles offertes/).fill('12');
    await page.getByRole('button', { name: /^Offrir à Déméter/ }).click();
    await expect(said(page, 'status')).toContainText('Offrande faite à Déméter');
    await expect(
      page.getByText("Aucune grâce n'est offerte dans la configuration en vigueur."),
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
    const composer = page.getByRole('textbox', { name: /^Votre message dans/ });
    const cityText = `Khaire ${randomUUID()}`;
    await composer.fill(cityText);
    await composer.press('Control+Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Message envoyé.' })).toBeVisible();
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
    await expect(said(other, 'status')).toContainText(
      "Message signalé : la modération l'examinera.",
    );
    await expectNoHorizontalScroll(page);
    await expectNoHorizontalScroll(other);
  });
  await context.close();
});

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
