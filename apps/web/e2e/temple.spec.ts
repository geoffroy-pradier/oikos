import { randomUUID } from 'node:crypto';
import { createConfigLoader } from '@oikos/config';
import { createDb } from '@oikos/db';
import { expect, test } from '@playwright/test';
import { sql } from 'kysely';
import { closeCityDb, E2E_ORACLE, setUpOracle } from './city-fixtures';
import { expectNoHorizontalScroll, signIn, foundHouseForm } from './helpers';

// Écran du temple (#272), IA coupée (configuration initiale) : Charis, offrande de monnaie et de blé au clavier,
// grâces, consultation de la Pythie et oracle en texte brut, puis l'offrande dans les flux de l'écran Comptes. À
// 360 px comme à 1 440 px, sans défilement horizontal.
const db = createDb(process.env['DATABASE_URL'] ?? '');
test.afterAll(() => Promise.all([db.destroy(), closeCityDb()]));

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

test('Charis, offrande, grâces et Pythie au clavier, puis l’offrande dans les comptes', async ({
  page,
}) => {
  const { config } = await createConfigLoader(db).at(new Date());
  await setUpOracle();
  const id = randomUUID();
  const houseName = `Prêtres ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, houseName);
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await elapse(houseName, 480);
  await page.getByRole('button', { name: 'Récolter : Champ de blé' }).click();
  await expect(page.getByText('Blé : 80')).toBeVisible();

  // Depuis l'onglet Cité, au clavier.
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.getByRole('link', { name: 'Cité' }).click();
  await page.getByRole('link', { name: 'Temple : Charis, offrandes, grâces et oracle' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Temple de Kallistè' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Déméter : 0 Charis' })).toBeVisible();
  await expect(
    page.getByText(/^Charis de Kallistè envers Déméter, son dieu protecteur : /),
  ).toBeVisible();
  await expect(page.getByText(/votre maison, métèque, n'y compte pas\.$/)).toBeVisible();

  // Offrande : 12 oboles et 10 blés, la Charis annoncée avant l'envoi au taux de la configuration.
  const demeter = config.gods.find((god) => god.id === 'demeter');
  const wheat = demeter?.charisPerUnit['wheat'] ?? NaN;
  const charis = 12 * (demeter?.charisPerObole ?? NaN) + 10 * wheat;
  // La feuille s'ouvre depuis la carte de Déméter ; Entrée dans un champ mène au récapitulatif.
  await page.getByRole('button', { name: 'Faire une offrande à Déméter' }).focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Faire une offrande' });
  await sheet.getByLabel(/^Oboles offertes/).fill('12');
  await sheet.getByLabel(/^Blé \(80 libres/).fill('10');
  await expect(
    sheet.getByText(`Cette offrande vous rapportera ${charis} Charis envers Déméter.`),
  ).toBeVisible();
  await page.keyboard.press('Enter');
  await sheet.getByRole('button', { name: `Offrir à Déméter (+${charis} Charis)` }).focus();
  await page.keyboard.press('Enter');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Offrande faite à Déméter' })).toHaveText(
    `Offrande faite à Déméter : +${charis} Charis. Votre Charis envers Déméter : ${charis}.`,
  );
  await expect(page.getByRole('heading', { name: `Déméter : ${charis} Charis` })).toBeVisible();
  await page.getByRole('button', { name: 'Faire une offrande à Déméter' }).click();
  await expect(sheet.getByLabel(/^Blé \(70 libres/)).toBeVisible();
  await page.keyboard.press('Escape');

  // Grâces : celles de la configuration en vigueur (aucune dans la configuration initiale).
  if (config.graces.length === 0)
    await expect(
      page.getByText("Aucune grâce n'est offerte dans la configuration en vigueur."),
    ).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'Grâces' })).toBeVisible();

  // Pythie : prix et Charis de la configuration (taux par obole de son dieu) ; l'oracle de repli s'affiche tel
  // quel, balisage compris.
  const price = config.oracle?.consultationOboles ?? NaN;
  const pythia = config.gods.find((god) => god.id === config.oracle?.godId);
  const gained = price * (pythia?.charisPerObole ?? NaN);
  await expect(
    page.getByText(new RegExp(`^Une consultation coûte .* ${gained} Charis envers Apollon\\.$`)),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Consulter la Pythie pour / }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'Consultation faite pour' }),
  ).toContainText(`+${gained} Charis. La Pythie a rendu`);
  await expect(page.getByText(E2E_ORACLE.fr, { exact: true })).toBeVisible();
  await expect(page.locator('main blockquote em')).toHaveCount(0);
  await expect(page.getByText(/Date de l'événement : imprécise/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: `Apollon : ${gained} Charis` })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Comptes : l'offrande et la consultation sous leur nature, libellée.
  await nav.getByRole('link', { name: 'Maison' }).click();
  await page.getByRole('link', { name: 'Comptes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Flux de trésorerie' })).toBeVisible();
  // Tableau sur ordinateur, fiches sur téléphone : la mise en page affichée.
  await expect(
    page.getByText(/^Offrandes et consultations de la Pythie : −/).filter({ visible: true }),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
});
