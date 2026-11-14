import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { enroll, expectNoHorizontalScroll, grantSuperAdmin, signIn } from './helpers';
import { totp } from './totp';

test('un compte sans rôle est refusé, même avec la double authentification', async ({ page }) => {
  await signIn(page, `olympe-${randomUUID()}@example.test`);
  // Aucun module n'est proposé avant le second facteur.
  await expect(page.getByRole('navigation', { name: 'Modules' })).toHaveCount(0);
  await enroll(page);
  await expect(page.getByRole('alert')).toContainText("n'a pas accès au back-office");
  // Le compte lit son identifiant, à transmettre à un super-administrateur.
  await expect(page.locator('code')).toHaveText(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  await expect(page.getByRole('navigation', { name: 'Modules' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Vigie' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('heading', { name: 'Connexion à Olympe' })).toBeVisible();
});

test('un super-administrateur passe le second facteur, lit la Vigie et le journal d’audit', async ({
  page,
}) => {
  const email = `olympe-${randomUUID()}@example.test`;
  await signIn(page, email);
  await grantSuperAdmin(email);
  await expectNoHorizontalScroll(page);

  // Un code faux est refusé, sans ouvrir le back-office.
  await expect(page.getByRole('img', { name: "Code QR d'enrôlement" })).toBeVisible();
  await page.getByLabel('Code à six chiffres').fill('000000');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Code refusé');
  await expect(page.getByRole('heading', { name: 'Vigie' })).toHaveCount(0);
  const secret = await enroll(page);

  // Vigie : rôle affiché, compteurs lus par l'API.
  await expect(page.getByRole('heading', { name: 'Vigie', level: 1 })).toBeVisible();
  await expect(page.getByText('Rôle : Super-administrateur')).toBeVisible();
  await expect(page.getByText('Maisons fondées')).toBeVisible();
  await expect(page.getByText('Commandes refusées (24 h)')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dernières exécutions de tick' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Journal d'audit, au clavier : une commande d'administration refusée y figure avec son code.
  const key = randomUUID();
  const token = await page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([name]) => name.endsWith('-auth-token'));
    return (JSON.parse(entry?.[1] ?? '{}') as { access_token?: string }).access_token ?? '';
  });
  const refused = await page.request.post('/api/commands/admin.scheduleConfig', {
    headers: { authorization: `Bearer ${token}`, 'Idempotency-Key': key },
    data: { versionId: randomUUID() },
  });
  expect(refused.status()).toBe(404);
  const modules = page.getByRole('navigation', { name: 'Modules' });
  await modules.getByRole('button', { name: "Journal d'audit" }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: "Journal d'audit", level: 1 })).toBeVisible();
  await expect(modules.getByRole('button', { name: "Journal d'audit" })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    page
      .getByRole('row', { name: /admin\.scheduleConfig Refusée \(CONFIG_VERSION_NOT_FOUND\)/ })
      .first(),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Les textes suivent la langue.
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
  await page.getByLabel('Language').selectOption('fr');

  // Nouvelle session : plus d'enrôlement, le code de l'application est demandé avant tout accès.
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('heading', { name: 'Connexion à Olympe' })).toBeVisible();
  // Supabase Auth n'envoie pas deux liens au même compte dans la même seconde (réglage local).
  await page.waitForTimeout(1500);
  await signIn(page, email, 1);
  await expect(page.getByRole('heading', { name: 'Double authentification' })).toBeVisible();
  await expect(page.getByRole('img', { name: "Code QR d'enrôlement" })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Vigie' })).toHaveCount(0);
  await page.getByLabel('Code à six chiffres').fill(totp(secret));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Vigie', level: 1 })).toBeVisible();
});
