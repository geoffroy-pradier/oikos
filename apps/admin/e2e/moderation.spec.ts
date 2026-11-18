import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { enroll, expectNoHorizontalScroll, grantRole, signIn } from './helpers';

/**
 * Le module Modération (#277), de la connexion au geste : vraie session à second facteur, vrai rôle en base, vraie
 * lecture de la file. Un signalement est ajouté à la réponse de l'API (une file de test demanderait un monde, des
 * maisons et un canal) et la commande de masquage est interceptée : on vérifie ce que l'écran envoie.
 */
test('un modérateur ne voit que la Modération et traite un signalement au clavier, à 360 px comme à 1440 px', async ({
  page,
}) => {
  const email = `olympe-${randomUUID()}@example.test`;
  await signIn(page, email);
  await grantRole(email, 'moderator');
  await enroll(page);

  // Navigation composée d'après le rôle : la Modération, rien d'autre.
  const modules = page.getByRole('navigation', { name: 'Modules' });
  await expect(modules.getByRole('button')).toHaveText(['Modération']);
  await expect(page.getByRole('heading', { name: 'Modération', level: 1 })).toBeVisible();

  const messageId = randomUUID();
  const longName = `Maison-${'Longue'.repeat(10)}`;
  await page.route('**/api/admin/reports', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { data: { now: string; queue: unknown[] } };
    const house = (name: string) => ({ houseId: randomUUID(), houseName: name });
    body.data.queue.unshift({
      world: 'archipel',
      reportedHouse: { id: randomUUID(), name: longName, userId: randomUUID() },
      channel: { id: randomUUID(), kind: 'city', city: 'kalliste' },
      message: {
        id: messageId,
        ...house(longName),
        body: 'Message signalé',
        createdAt: '2026-01-01T10:00:00.000Z',
        hiddenAt: null,
      },
      reports: [{ id: randomUUID(), reason: 'harassment', createdAt: '2026-01-01T11:00:00.000Z' }],
      context: [
        {
          id: randomUUID(),
          ...house('Voisine'),
          body: 'Message voisin',
          createdAt: '2026-01-01T09:59:00.000Z',
          hiddenAt: null,
        },
      ],
    });
    await route.fulfill({ response, json: body });
  });
  const sent: { key: string | undefined; body: unknown }[] = [];
  await page.route('**/api/commands/admin.hideMessage', async (route) => {
    const request = route.request();
    sent.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
    await route.fulfill({
      json: { ok: true, data: { messageId, hiddenAt: new Date().toISOString() } },
    });
  });
  await page.getByRole('button', { name: 'Actualiser' }).click();

  const entry = page.getByRole('listitem', { name: /^Message de la maison Maison-Longue/ });
  await expect(entry).toBeVisible();
  await expect(entry.getByText('Message voisin')).toBeVisible();
  await expect(entry.getByText(/Message signalé/)).toBeVisible();
  // Signalé en 2026 : l'alerte de plus de 24 h s'affiche.
  await expect(page.getByRole('alert').filter({ hasText: 'plus de 24 h' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Au clavier : Entrée ouvre la confirmation, le foyer va à « Annuler », rien n'est envoyé avant « Confirmer » (l'Entrée tenue est couverte par les tests de composant).
  await entry.getByRole('button', { name: 'Masquer le message' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await expect(entry.getByText(/sera masqué pour les joueurs/)).toBeVisible();
  await expectNoHorizontalScroll(page);
  expect(sent).toEqual([]);

  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('button', { name: 'Confirm hiding' })).toBeVisible();
  await page.getByLabel('Language').selectOption('fr');

  await page.getByRole('button', { name: 'Confirmer le masquage' }).click();
  await expect(page.getByText('Message masqué.')).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toEqual({ messageId });
  expect(sent[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
});
