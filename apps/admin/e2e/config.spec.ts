import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { enroll, expectNoHorizontalScroll, grantSuperAdmin, signIn } from './helpers';

test('paramètres : comparer, enregistrer une nouvelle version, programmer à la prochaine clôture', async ({
  page,
}) => {
  const email = `olympe-${randomUUID()}@example.test`;
  await signIn(page, email);
  await grantSuperAdmin(email);
  await enroll(page);
  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('button', { name: 'Paramètres' })
    .click();
  await expect(page.getByRole('heading', { name: 'Paramètres', level: 1 })).toBeVisible();

  // La version en vigueur est signalée ; on l'ouvre : aucune différence avec elle-même.
  const inForce = page.getByRole('listitem').filter({ hasText: 'En vigueur' });
  await expect(inForce).toHaveCount(1);
  const number = /Version (\d+)/.exec(await inForce.getByRole('heading').innerText())?.[1] ?? '';
  await inForce.getByRole('button', { name: `Ouvrir la version ${number}` }).click();
  const editor = page.getByLabel('Configuration (JSON)');
  await expect(
    page.getByText(`Aucune différence avec la version ${number}, en vigueur.`),
  ).toBeVisible();
  const config = JSON.parse(await editor.inputValue()) as {
    starting: { grantOboles: number };
    market: { npcMaxPriceFactor: number };
  };
  const grant = config.starting.grantOboles;

  // Un texte qui n'est pas du JSON est signalé, et rien n'est envoyé.
  await editor.fill('{ "starting": ');
  await expect(page.getByRole('alert')).toContainText("n'est pas un objet JSON valide");

  // Une valeur hors bornes est refusée par le schéma de l'API, champ nommé.
  const broken = { ...config, market: { npcMaxPriceFactor: 0 } };
  await editor.fill(JSON.stringify(broken, null, 2));
  await expect(page.getByText('market.npcMaxPriceFactor : 3 → 0')).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer comme nouvelle version' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Configuration refusée par le schéma');
  await expect(alert).toContainText('market.npcMaxPriceFactor');

  // Une modification valide : la différence est affichée, puis enregistrée comme nouvelle version.
  const next = { ...config, starting: { ...config.starting, grantOboles: grant + 1 } };
  await editor.fill(JSON.stringify(next, null, 2));
  await expect(page.getByText(`starting.grantOboles : ${grant} → ${grant + 1}`)).toBeVisible();
  const note = `essai ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('Note de version').fill(note);
  await page.getByRole('button', { name: 'Enregistrer comme nouvelle version' }).click();
  await expect(page.getByRole('status')).toContainText(/Version \d+ enregistrée/);
  const created = page.getByRole('listitem').filter({ hasText: note });
  await expect(created).toHaveCount(1);
  // Enregistrer n'active pas : la version en vigueur n'a pas changé, la nouvelle n'est pas programmée.
  await expect(inForce.getByRole('heading')).toContainText(`Version ${number}`);
  await expect(created).not.toContainText('Programmée');
  await expectNoHorizontalScroll(page);

  // Programmation à la prochaine clôture. On programme la version déjà en vigueur : sans effet sur le jeu.
  await inForce
    .getByRole('button', { name: `Programmer la version ${number} à la prochaine clôture` })
    .click();
  await expect(page.getByRole('status')).toContainText(`Version ${number} programmée pour le`);
  await expect(inForce).toContainText('Programmée pour le');

  // Le journal d'audit garde la trace des deux commandes réussies et du refus.
  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('button', { name: "Journal d'audit" })
    .click();
  await expect(
    page.getByRole('row', { name: /admin\.scheduleConfig Réussie/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: /admin\.publishConfig Réussie/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: /admin\.publishConfig Refusée \(CONFIG_INVALID\)/ }).first(),
  ).toBeVisible();
});
