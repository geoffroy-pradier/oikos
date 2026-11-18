import { createDb } from '@oikos/db';
import { expect, type Page } from '@playwright/test';
import { sql } from 'kysely';
import { totp } from './totp';

const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://127.0.0.1:54324';

/** Récupère le lien magique envoyé à `email` dans la boîte de réception locale. */
async function magicLink(email: string, skip = 0): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    // Les messages arrivent du plus récent au plus ancien : on attend qu'il y en ait un de plus.
    const latest = messages.length > skip ? messages[0] : undefined;
    if (latest) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`);
      const { Text } = (await message.json()) as { Text: string };
      const link = /https?:\/\/\S*\/auth\/v1\/verify\S+/.exec(Text)?.[0];
      if (link) return link.replace(/[)\]>.]+$/, '');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Aucun lien magique reçu pour ${email}`);
}

export async function signIn(page: Page, email: string, previousLinks = 0) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Connexion à Olympe' })).toBeVisible();
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(email);
  await page.goto(await magicLink(email, previousLinks));
}

/**
 * Inscrit un rôle en base pour un compte. Le super-administrateur n'est nommé par personne, comme le tout premier,
 * créé par un humain ; tout autre rôle doit l'être par un autre compte (`roles_granted_unless_root`) : un
 * super-administrateur s'il en existe un, sinon n'importe quel autre compte de la base.
 */
export async function grantRole(email: string, role: string) {
  const db = createDb(process.env['DATABASE_URL'] ?? '');
  try {
    const inserted = await sql`insert into admin.roles (user_id, role, granted_by)
      select target.id, ${role}, case when ${role} = 'super_admin' then null else coalesce(
        (select r.user_id from admin.roles r where r.role = 'super_admin' and r.user_id <> target.id limit 1),
        (select u.id from auth.users u where u.id <> target.id limit 1)) end
      from auth.users target where target.email = ${email}`.execute(db);
    if (inserted.numAffectedRows !== 1n)
      throw new Error(`Aucun compte ${email} à qui donner le rôle ${role}`);
  } finally {
    await db.destroy();
  }
}

/** Inscrit le super-administrateur en base, comme un humain le fait pour le tout premier. */
export const grantSuperAdmin = (email: string) => grantRole(email, 'super_admin');

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Enrôle une application d'authentification et rend sa clé. */
export async function enroll(page: Page): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Double authentification' })).toBeVisible();
  await expect(page.getByRole('img', { name: "Code QR d'enrôlement" })).toBeVisible();
  const secret = (await page.locator('code').first().innerText()).trim();
  await page.getByLabel('Code à six chiffres').fill(totp(secret));
  await page.keyboard.press('Enter');
  return secret;
}
