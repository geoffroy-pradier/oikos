import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { closeCityDb, ARCHON_NAME, setUpCity } from './city-fixtures';
import { expectNoHorizontalScroll, KALLISTE_ID, signIn } from './helpers';

// Onglet Cité (#264) : vie politique, assemblée et trésor public de Kallistè, avec une élection en dépôt
// des candidatures et un décret au vote ; ce qu'y voient et y font un métèque, une citoyenne et l'archonte.
test.afterAll(closeCityDb);

async function openCity(page: Page, role: Parameters<typeof setUpCity>[1]) {
  const id = randomUUID();
  const houseName = `Agora ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await page.getByLabel('Nom de la maison').fill(houseName);
  await page.locator(`input[value="${KALLISTE_ID}"]`).check();
  await page.getByLabel('Nom de la maison').press('Enter');
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
  await expect(
    assembly.getByText(new RegExp(`^Proposé par ${ARCHON_NAME} ; vote clos le `)),
  ).toBeVisible();
  return { houseName, politics, assembly, treasury: card('Trésor public') };
}

test('un métèque voit élection, décret au vote et trésor, sans bouton, et sait pourquoi', async ({
  page,
}) => {
  const { politics, assembly, treasury } = await openCity(page, 'metic');
  const cards = ['Vie politique', 'Assemblée', 'Trésor public'];
  const titles = await page.getByRole('heading', { level: 2 }).allTextContents();
  expect(titles.filter((title) => cards.includes(title))).toEqual(cards);

  await expect(politics.getByText(/^Métèque à Kallistè depuis le /)).toBeVisible();
  await expect(politics.getByText(/^Métèque, votre maison voit la vie de la cité/)).toBeVisible();
  await expect(politics.getByText(/^Archonte en charge : /)).toBeVisible();
  await expect(politics.getByText(/^Candidatures à partir du /)).toBeVisible();
  await expect(politics.getByText(/^Fin du vote le /)).toBeVisible();
  await expect(politics.getByRole('button')).toHaveCount(0);

  await expect(
    assembly.getByText('Métèque, votre maison ne vote pas les décrets de la cité.'),
  ).toBeVisible();
  await expect(assembly.getByText(/^Taxe de marché de la cité à /).first()).toBeVisible();
  await expect(assembly.getByRole('button')).toHaveCount(0);
  await expect(assembly.getByRole('heading', { name: 'Proposer un décret' })).toHaveCount(0);

  await expect(treasury.getByText(/^Solde : −?[\d\s]+ (drachmes?|oboles?)/)).toBeVisible();
  await expect(treasury.getByText(/^Taxe de marché en vigueur : [\d,]+\s%$/)).toBeVisible();
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

  // Du dernier contrôle de la vie politique, Tab puis Entrée : le bouton Pour nomme le décret.
  const approve = assembly
    .getByRole('button', { name: /^Voter pour : Taxe de marché de la cité à / })
    .first();
  await politics.getByRole('button', { name: 'Retirer ma candidature' }).focus();
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
  await expect(assembly.getByRole('heading', { name: 'Proposer un décret' })).toBeVisible();
  await expect(assembly.getByText(/^Vote d.+ ; quorum de .+ des citoyens ;/)).toBeVisible();
  await assembly.getByLabel('Taux de la taxe de marché').check();
  const rate = assembly.getByLabel('Taux, en pour cent');
  const hint = assembly.getByText(/^Entre [\d,]+\s% et [\d,]+\s%$/);
  await expect(rate).toHaveAccessibleDescription(/^Entre [\d,]+\s% et [\d,]+\s%/);
  const submit = assembly.getByRole('button', { name: 'Proposer au vote' });
  await expect(submit).toHaveAttribute('aria-disabled', 'true');
  // Hors des bornes, rien ne part ; à la borne basse annoncée, le bouton s'active. Rien n'est soumis : la
  // base garde ses décrets d'un passage à l'autre, et la cité en limite le nombre au vote.
  await rate.fill('99');
  await expect(assembly.getByRole('alert')).toHaveText('Hors des bornes du décret.');
  await expect(submit).toHaveAttribute('aria-disabled', 'true');
  const min = /^Entre ([\d,]+)/.exec((await hint.textContent()) ?? '')?.[1] ?? '';
  await rate.fill(min);
  await expect(assembly.getByRole('alert')).toHaveText('');
  await expect(submit).toHaveAttribute('aria-disabled', 'false');
  await expectNoHorizontalScroll(page);
});
