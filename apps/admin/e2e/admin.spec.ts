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
  await expect(page.getByText('Commandes des joueurs refusées (24 h)')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dernières exécutions de tick' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Fuseau en vigueur, lu par l'API : connu de la base. Puis inconnu (réponse de l'API modifiée, le
  // nom allongé) : la Vigie le nomme et alerte, sans déborder à 360 px, en français et en anglais.
  await expect(page.getByText('Fuseau en vigueur (tous les mondes)')).toBeVisible();
  await expect(page.getByText(/^Fuseau en vigueur inconnu/)).toHaveCount(0);
  const vigie = '**/api/admin/vigie';
  const lostZone = `America/${'Ancienne_Zone_'.repeat(4)}Retiree`;
  await page.route(vigie, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: { clock: Record<string, unknown> } };
    body.data.clock = { ...body.data.clock, timezone: lostZone, knownToDatabase: false };
    await route.fulfill({ response, json: body });
  });
  await page.getByRole('button', { name: 'Actualiser' }).click();
  await expect(page.getByText(`${lostZone} (inconnu de la base)`)).toBeVisible();
  await expect(page.getByText(/^Fuseau en vigueur inconnu de la base/)).toContainText(lostZone);
  await expectNoHorizontalScroll(page);
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByText(/^Time zone in force unknown to the database/)).toContainText(
    lostZone,
  );
  await expectNoHorizontalScroll(page);
  await page.getByLabel('Language').selectOption('fr');
  await page.unroute(vigie);

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

  // Économie, au clavier : lisible à 360 px, même avec une clé de compte système inconnue et longue
  // (ajoutée à la réponse de l'API, au premier monde).
  const economy = '**/api/admin/economy';
  const unknownKey = `sink_${'inconnu'.repeat(12)}`;
  await page.route(economy, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: { worlds: { systemAccounts: unknown[] }[] } };
    const gameDay = Math.floor(Date.now() / 86_400_000);
    const long = { key: unknownKey, kind: 'sink', total: 1, days: [{ gameDay, amount: 1 }] };
    body.data.worlds[0]?.systemAccounts.push(long);
    await route.fulfill({ response, json: body });
  });
  await modules.getByRole('button', { name: 'Économie' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Économie', level: 1 })).toBeVisible();
  await expect(modules.getByRole('button', { name: 'Économie' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('table', { name: /^Masse monétaire/ }).first()).toBeVisible();
  await expect(page.getByRole('rowheader', { name: `${unknownKey} (puits)` })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.unroute(economy);

  // Animation, au clavier : le calendrier des événements (#267) reste lisible à 360 px avec une tempête
  // ajoutée à la réponse de l'API, en cours à l'heure qu'elle rend.
  const events = '**/api/admin/events';
  await page.route(events, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: { now: string; events: unknown[] } };
    const endsAt = new Date(Date.parse(body.data.now) + 86_400_000).toISOString();
    body.data.events.push({
      id: randomUUID(),
      world: 'archipel',
      model: 'storm',
      city: 'kalliste',
      otherCity: 'halos',
      goodId: null,
      startsAt: body.data.now,
      endsAt,
      magnitudeBps: 2_500,
      plannedDay: 1,
    });
    await route.fulfill({ response, json: body });
  });
  await modules.getByRole('button', { name: 'Animation' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Calendrier des événements', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: /^En cours Tempête route kalliste – halos/ }),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.unroute(events);

  // Accès : le compte s'y lit avec son rôle ; l'API refuse un identifiant inconnu ; rien ne déborde à 360 px.
  await modules.getByRole('button', { name: 'Accès' }).click();
  await expect(page.getByRole('heading', { name: 'Accès', level: 1 })).toBeVisible();
  await expect(
    page.getByRole('row', { name: /\(vous\) Super-administrateur Inscrit en base/ }),
  ).toBeVisible();
  // Accorder un rôle se fait dans une feuille, refermée par Échap.
  await page.getByRole('button', { name: 'Accorder un rôle' }).click();
  const grant = page.getByRole('dialog', { name: 'Accorder un rôle' });
  await grant.getByLabel('Identifiant du compte').fill(randomUUID());
  await page.keyboard.press('Enter');
  await expect(grant.getByText('Aucun compte ne porte cet identifiant.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.keyboard.press('Escape');
  await expect(grant).toHaveCount(0);
  // Entrée tenue sur « Retirer le rôle » : la confirmation s'ouvre, foyer sur « Annuler », rien n'est validé.
  const mine = page.getByRole('row', { name: /\(vous\) Super-administrateur Inscrit en base/ });
  await mine.getByRole('button', { name: /^Retirer le rôle de / }).focus();
  for (let held = 0; held < 3; held += 1) await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(mine.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(mine.getByRole('button', { name: /^Retirer le rôle de / })).toBeFocused();
  await expectNoHorizontalScroll(page);

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
