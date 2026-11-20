import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { closeCityDb, ARCHON_NAME, setUpCity } from './city-fixtures';
import { citySection, expectNoHorizontalScroll, signIn, foundHouseForm } from './helpers';

// Onglet Cité (#264) : vie politique, assemblée et trésor public de Kallistè, avec une élection en dépôt
// des candidatures et un décret au vote ; ce qu'y voient et y font un métèque, une citoyenne et l'archonte.
// Chaque sous-section est une pastille (#697) : la vie politique s'ouvre d'abord.
test.afterAll(closeCityDb);

async function openCity(page: Page, role: Parameters<typeof setUpCity>[1]) {
  const id = randomUUID();
  const houseName = `Agora ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, houseName);
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await setUpCity(houseName, role);
  await page.getByRole('link', { name: 'Cité' }).click();
  const card = (name: string) => page.getByRole('heading', { name, level: 2 }).locator('..');
  const politics = card('Vie politique');
  const assembly = card('Assemblée');
  // Données chargées : l'élection en cours et le décret de la maison Acropole sont affichés.
  await expect(
    politics.getByText("Élection de l'archonte : dépôt des candidatures ouvert."),
  ).toBeVisible();
  await citySection(page, 'Assemblée');
  await expect(
    assembly.getByText(new RegExp(`^Proposé par ${ARCHON_NAME}\\s; vote clos le `)),
  ).toBeVisible();
  await citySection(page, 'Vie politique');
  return { houseName, politics, assembly, treasury: card('Trésor public') };
}

test('un métèque voit élection, décret au vote et trésor, sans bouton, et sait pourquoi', async ({
  page,
}) => {
  const { politics, assembly, treasury } = await openCity(page, 'metic');
  const cards = ['Vie politique', 'Assemblée', 'Trésor public'];
  // Les panneaux des pastilles non choisies restent montés, cachés : leurs titres comptent.
  const titles = await page
    .getByRole('heading', { level: 2, includeHidden: true })
    .allTextContents();
  expect(titles.filter((title) => cards.includes(title))).toEqual(cards);

  await expect(politics.getByText(/^Métèque à Kallistè depuis le /)).toBeVisible();
  await expect(politics.getByText(/^Métèque, votre maison voit la vie de la cité/)).toBeVisible();
  await expect(politics.getByText(/^Archonte en charge\s: /)).toBeVisible();
  await expect(politics.getByText(/^Candidatures à partir du /)).toBeVisible();
  await expect(politics.getByText(/^Fin du vote le /)).toBeVisible();
  await expect(politics.getByRole('button')).toHaveCount(0);

  await citySection(page, 'Assemblée');
  await expect(
    assembly.getByText('Métèque, votre maison ne vote pas les décrets de la cité.'),
  ).toBeVisible();
  await expect(assembly.getByText(/^Taxe de marché de la cité à /).first()).toBeVisible();
  await expect(assembly.getByRole('button')).toHaveCount(0);
  await expect(assembly.getByRole('heading', { name: 'Proposer un décret' })).toHaveCount(0);

  await citySection(page, 'Trésor');
  await expect(treasury.getByText(/^Solde\s: −?[\d\s]+ (drachmes?|oboles?)/)).toBeVisible();
  await expect(treasury.getByText(/^Taxe de marché en vigueur\s: [\d,]+\s%$/)).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('une citoyenne se porte candidate et vote le décret, au clavier', async ({ page }) => {
  const { houseName, politics, assembly } = await openCity(page, 'citizen');
  await expect(politics.getByText(/^Citoyenne à Kallistè depuis le /)).toBeVisible();

  await politics.getByRole('button', { name: 'Me porter candidat' }).focus();
  await page.keyboard.press('Enter');
  await expect(politics.getByRole('status')).toHaveText('Candidature déposée.');
  await expect(politics.getByRole('listitem').filter({ hasText: houseName })).toBeVisible();
  await expect(politics.getByRole('button', { name: 'Retirer ma candidature' })).toBeVisible();

  // Depuis le panneau de l'assemblée, Tab puis Entrée : le bouton Pour nomme le décret.
  const approve = assembly
    .getByRole('button', { name: /^Voter pour\s: Taxe de marché de la cité à / })
    .first();
  await citySection(page, 'Assemblée');
  await page.getByRole('tabpanel', { name: 'Assemblée' }).focus();
  await page.keyboard.press('Tab');
  await expect(approve).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(assembly.getByRole('status').filter({ hasText: 'Vote enregistré.' })).toBeVisible();
  await expect(
    assembly.getByText('Votre maison a voté ce décret. Le vote est secret.').first(),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('l’archonte en charge propose un décret dans les bornes annoncées', async ({ page }) => {
  const { assembly } = await openCity(page, 'archon');
  await citySection(page, 'Assemblée');
  await expect(assembly.getByRole('heading', { name: 'Proposer un décret' })).toBeVisible();
  await expect(assembly.getByText(/^Vote d.+\s; quorum de .+ des citoyens\s;/)).toBeVisible();
  // La proposition se fait dans une feuille par étapes (#697) : le modèle, puis ses paramètres.
  await assembly.getByRole('button', { name: 'Nouveau décret' }).click();
  const sheet = page.getByRole('dialog', { name: 'Proposer un décret' });
  await sheet.getByLabel('Taux de la taxe de marché').check();
  await sheet.getByRole('button', { name: 'Continuer' }).click();
  const rate = sheet.getByLabel('Taux, en pour cent');
  const hint = sheet.getByText(/^Entre [\d,]+\s% et [\d,]+\s%$/);
  await expect(rate).toHaveAccessibleDescription(/^Entre [\d,]+\s% et [\d,]+\s%/);
  // Le récapitulatif, puis « Proposer au vote », ne s'atteignent que dans les bornes.
  const submit = sheet.getByRole('button', { name: 'Continuer' });
  await expect(submit).toBeDisabled();
  // Hors des bornes, rien ne part ; à la borne basse annoncée, le bouton s'active. Rien n'est soumis : la
  // base garde ses décrets d'un passage à l'autre, et la cité en limite le nombre au vote.
  await rate.fill('99');
  await expect(sheet.getByRole('alert')).toHaveText('Hors des bornes du décret.');
  await expect(submit).toBeDisabled();
  const min = /^Entre ([\d,]+)/.exec((await hint.textContent()) ?? '')?.[1] ?? '';
  await rate.fill(min);
  await expect(sheet.getByRole('alert')).toHaveText('');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(sheet.getByRole('button', { name: 'Proposer au vote' })).toBeEnabled();
  await expectNoHorizontalScroll(page);
});
