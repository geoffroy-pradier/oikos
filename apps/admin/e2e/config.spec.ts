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
    page.getByRole('heading', { name: `Contenu de la version ${number}` }),
  ).toBeFocused();
  await expect(
    page.getByText(`Aucune différence avec la version ${number}, en vigueur.`),
  ).toBeVisible();
  const config = JSON.parse(await editor.inputValue()) as {
    starting: { grantOboles: number };
    market: { npcMaxPriceFactor: number };
    goods: [{ id: string; elasticity: number }];
    recipes: [{ id: string; outputs: [{ goodId: string; quantity: number }] }];
    npcClasses: [{ id: string; basket: [{ goodId: string; quantityPerThousand: number }] }];
  };
  const grant = config.starting.grantOboles;
  // Formulaire des biens, replié : déplié, une saisie y réécrit le texte, la comparaison la montre.
  await page.getByText('Biens', { exact: true }).click();
  const [good] = config.goods;
  const fields = page.getByRole('group', { name: good.id, exact: true });
  await fields.getByLabel('élasticité').fill(String(good.elasticity + 1));
  await expect(
    page.getByText(`goods[${good.id}].elasticity : ${good.elasticity} → ${good.elasticity + 1}`),
  ).toBeVisible();
  // Un bien ajouté est vide, foyer sur son identifiant ; retiré, le texte revient à la liste d'avant.
  const added = `élément ${config.goods.length + 1}`;
  await page.getByRole('button', { name: 'Ajouter un bien' }).click();
  await expect(
    page.getByRole('group', { name: added, exact: true }).getByLabel('identifiant'),
  ).toBeFocused();
  await page.getByRole('button', { name: `Retirer ${added}`, exact: true }).click();
  await expect(page.getByText(`${added} retiré du texte`)).toBeVisible();
  expect((JSON.parse(await editor.inputValue()) as typeof config).goods).toHaveLength(
    config.goods.length,
  );
  await expectNoHorizontalScroll(page);
  // Formulaire des recettes : une saisie dans une ligne d'extrant réécrit le texte, la comparaison la montre.
  await page.getByText('Recettes', { exact: true }).click();
  const [recipe] = config.recipes;
  const [output] = recipe.outputs;
  const recipes = page
    .locator('details')
    .filter({ has: page.getByText('Recettes', { exact: true }) });
  await recipes
    .getByRole('group', { name: recipe.id, exact: true })
    .getByRole('group', { name: 'extrants', exact: true })
    .getByRole('group', { name: output.goodId, exact: true })
    .getByLabel('quantité')
    .fill(String(output.quantity + 1));
  const quantity = `recipes[${recipe.id}].outputs[${output.goodId}].quantity`;
  await expect(
    page.getByText(`${quantity} : ${output.quantity} → ${output.quantity + 1}`),
  ).toBeVisible();
  // Une ligne d'extrant ajoutée puis retirée : le texte revient à ce qu'il était.
  const before = await editor.inputValue();
  const where = `extrants de ${recipe.id}`;
  await recipes.getByRole('button', { name: `Ajouter une ligne (${where})`, exact: true }).click();
  const line = `élément ${recipe.outputs.length + 1}`;
  await recipes.getByRole('button', { name: `Retirer ${line} (${where})`, exact: true }).click();
  await expect(page.getByText(`${line} retiré (${where})`)).toBeVisible();
  expect(await editor.inputValue()).toBe(before);
  await expectNoHorizontalScroll(page);
  // Formulaire des classes : de même, une saisie dans le panier d'une classe.
  const classes = page.locator('details').filter({
    has: page.getByText('Classes de PNJ', { exact: true }),
  });
  await classes.getByText('Classes de PNJ', { exact: true }).click();
  const [npcClass] = config.npcClasses;
  const [need] = npcClass.basket;
  await classes
    .getByRole('group', { name: npcClass.id, exact: true })
    .getByRole('group', { name: 'panier', exact: true })
    .getByRole('group', { name: need.goodId, exact: true })
    .getByLabel('quantité pour 1 000 habitants')
    .fill(String(need.quantityPerThousand + 1));
  const demand = `npcClasses[${npcClass.id}].basket[${need.goodId}].quantityPerThousand`;
  await expect(
    page.getByText(`${demand} : ${need.quantityPerThousand} → ${need.quantityPerThousand + 1}`),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Un texte qui n'est pas du JSON est signalé à la sortie du champ, pas pendant la frappe.
  await editor.fill('{ "starting": ');
  const invalid = page.getByRole('alert').filter({ hasText: "n'est pas un objet JSON valide" });
  await expect(invalid).toHaveCount(0);
  await editor.blur();
  await expect(invalid).toHaveCount(1);

  // Une valeur hors bornes est refusée par le schéma de l'API, champ nommé.
  const broken = { ...config, market: { npcMaxPriceFactor: 0 } };
  await editor.fill(JSON.stringify(broken, null, 2));
  await expect(page.getByText('market.npcMaxPriceFactor : 3 → 0')).toBeVisible();
  await page.getByRole('button', { name: 'Enregistrer comme nouvelle version' }).click();
  // La zone du champ est aussi une alerte, vide ici : celle des résultats se désigne par son texte.
  const alert = page.getByRole('alert').filter({ hasText: 'Configuration refusée par le schéma' });
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

  // Texte modifié : ouvrir demande confirmation, foyer sur le geste sans effet. Double clic dessus, vers
  // le bas : la fiche suivante remonte, son bouton « Programmer » vient sous le pointeur ; rien n'est envoyé.
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') sent.push(new URL(request.url()).pathname);
  });
  await editor.fill('{}');
  const open = created.getByRole('button', { name: /^Ouvrir la version/ });
  await open.click();
  const keep = page.getByRole('button', { name: 'Garder le texte modifié' });
  await expect(keep).toBeFocused();
  await keep.dblclick({ position: { x: 20, y: 38 } });
  await expect(open).toBeFocused();
  expect(sent.filter((path) => path.startsWith('/api/commands/'))).toEqual([]);

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
