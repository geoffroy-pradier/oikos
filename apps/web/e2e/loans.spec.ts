import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, foundHouseForm, seriousViolations, signIn } from './helpers';
import { closeLoanDb, defaultLoan, openTempleTreasury } from './loan-fixtures';

// Écran Finances (#732) : emprunt au Trésor du temple par étapes, alerte du tableau de bord, remboursement, défaut.
// Le temple est ouvert en base (plafond de 2 000 drachmes, durées de 3 et 7 jours) : la configuration initiale ne prête rien.
test.afterAll(closeLoanDb);

async function foundHouse(page: Page) {
  const id = randomUUID();
  const houseName = `Prêt ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;
  await signIn(page, `e2e-${id}@example.test`);
  await foundHouseForm(page, houseName);
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  return houseName;
}

/** Emprunte 100 drachmes pour 3 jours, au clavier, jusqu'à l'annonce du prêt accordé. */
async function borrow(page: Page) {
  await page.getByRole('button', { name: 'Emprunter', exact: true }).press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Emprunter au Trésor du temple' });
  await expect(sheet.getByText(/^De 1 à 12\s000 oboles/)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Tout' })).toBeVisible();
  await sheet.getByLabel(/^Montant emprunté/).fill('600');
  await sheet.getByRole('button', { name: 'Continuer' }).press('Enter');
  await sheet.getByRole('radio', { name: '3 jours' }).check();
  // 600 × 10 % × 3 ÷ 365 : moins d'une obole, comptée au-dessus.
  await expect(sheet.getByText(/^À 10\s%\sl'an, les intérêts sont de 1\sobole/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Continuer' }).press('Enter');
  await expect(sheet.getByText('À rembourser', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Emprunter 100 drachmes à 10 %' }).press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'Prêt accordé : 100 drachmes' }),
  ).toBeVisible();
}

test('emprunt par étapes, alerte du tableau de bord, remboursement soldant le prêt', async ({
  page,
}) => {
  await foundHouse(page);
  await openTempleTreasury();
  await page.goto('/finances');
  await expect(page.getByRole('heading', { level: 1, name: 'Finances' })).toBeVisible();
  await expect(page.getByText('Aucune dette en cours.')).toBeVisible();
  const temple = page.getByRole('heading', { level: 2, name: 'Trésor du temple' });
  await expect(temple).toBeVisible();
  await expect(page.getByText("10 % l'an").first()).toBeVisible();
  await expect(page.getByText('2 000 drachmes').first()).toBeVisible();

  await borrow(page);
  const debt = page.locator('[data-loan]');
  await expect(debt.getByRole('heading', { name: 'Trésor du temple' })).toBeVisible();
  await expect(debt.getByText('En cours')).toBeVisible();
  await expect(debt.getByText('100 drachmes 1 obole').first()).toBeVisible();
  // Un seul prêt du temple à la fois : plus de bouton, la raison à la place.
  await expect(page.getByRole('button', { name: 'Emprunter', exact: true })).toHaveCount(0);
  await expect(page.getByText(/remboursez-le pour emprunter de nouveau/)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await expectNoHorizontalScroll(page);

  // Échéance dans les trois jours de jeu : le tableau de bord alerte.
  await page.getByRole('link', { name: 'Maison' }).first().click();
  const alert = page.getByRole('link', {
    name: /^Prêt\s\(Trésor\sdu\stemple\)\sà\srembourser\savant\sle\s.*100\sdrachmes\s1\sobole\srestent\sdus/,
  });
  await expect(alert).toBeVisible();
  await alert.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Finances' })).toBeVisible();

  // Remboursement : tout, d'un clic, puis le récapitulatif dit que le prêt est soldé.
  await page.getByRole('button', { name: /^Rembourser\s:\sTrésor du temple$/ }).press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Rembourser un prêt' });
  await expect(sheet.getByText(/^De 1 à 601 oboles/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Tout' }).click();
  await sheet.getByRole('button', { name: 'Continuer' }).press('Enter');
  await expect(sheet.getByText(/solde le prêt/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Rembourser 100 drachmes 1 obole' }).press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'le prêt est soldé' })).toBeVisible();
  await expect(page.getByText('Aucune dette en cours.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Emprunter', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Maison' }).first().click();
  await expect(page.getByRole('link', { name: /^Prêt \(/ })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('prêt en défaut : marque de déshonneur, alerte, plus d’emprunt', async ({ page }) => {
  const houseName = await foundHouse(page);
  await openTempleTreasury();
  await page.goto('/finances');
  await borrow(page);
  await defaultLoan(houseName);
  await page.goto('/finances');
  await expect(page.locator('[data-loan]').getByText('En défaut')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Marque de déshonneur' })).toBeVisible();
  await expect(page.getByText(/tant qu'il n'est pas soldé/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Emprunter', exact: true })).toHaveCount(0);
  await expect(page.getByText(/L'emprunt est suspendu/)).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await expectNoHorizontalScroll(page);
  await page.getByRole('link', { name: 'Maison' }).first().click();
  await expect(
    page.getByRole('link', { name: /^Prêt \(Trésor du temple\) en défaut/ }),
  ).toBeVisible();
});
