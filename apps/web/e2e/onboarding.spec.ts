import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, KALLISTE_ID, signIn } from './helpers';

test('une lecture en échec n’est pas prise pour « pas de maison » et se réessaie', async ({
  page,
}) => {
  await page.route('**/rest/v1/houses*', (route) =>
    route.fulfill({ status: 500, json: { message: 'boom' } }),
  );
  await signIn(page, `e2e-${randomUUID()}@example.test`);
  await expect(page.getByRole('alert')).toContainText('Impossible de lire vos données');
  await expect(page.getByRole('heading', { name: 'Fonder votre maison' })).toHaveCount(0);

  // Même sans maison ni lecture possible, le joueur peut changer de langue et fermer sa session.
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await page.getByLabel('Language').selectOption('fr');
  await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();

  await page.unroute('**/rest/v1/houses*');
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByRole('heading', { name: 'Fonder votre maison' })).toBeVisible();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('heading', { name: "Entrer dans l'Archipel" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Se déconnecter' })).toHaveCount(0);
});

test('inscription, création de maison, puis coquille de navigation', async ({ page }) => {
  const id = randomUUID();
  const email = `e2e-${id}@example.test`;
  const houseName = `Maison ${[...id.replace(/[^a-f]/g, '')].slice(0, 8).join('')}`;

  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Entrer dans l'Archipel" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await signIn(page, email);
  await expect(page.getByRole('heading', { name: 'Fonder votre maison' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Un nom invalide est refusé avec un message, sans quitter l'écran.
  await page.getByLabel('Nom de la maison').fill('X1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('ne sont pas valides');
  await expect(page.getByLabel('Nom de la maison')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Nom de la maison').fill(houseName);
  // La base de test contient les cités d'autres mondes (tests d'intégration) : seules les quatre de
  // l'Âge servi par ce client sont proposées, chacune avec son dieu protecteur et son terroir (6.1).
  const cities = page.getByRole('group', { name: "Cité d'accueil" }).getByRole('radio');
  await expect(cities).toHaveCount(4);
  const city = (name: string) => page.getByRole('radio', { name: new RegExp(`^${name}`) });
  await expect(city('Halos')).toHaveAccessibleDescription(
    "Protégée par Poséidon · Cité portuaire · Terroir : Pêcherie, Saline, Carrière d'argile, Coupe de bois et Pâturage à moutons · Premier site : Pêcherie",
  );
  await expect(city('Ampelos')).toHaveAccessibleDescription(/^Protégée par Dionysos .* Vigne$/);
  // Choix au clavier : les flèches parcourent le groupe, de la première cité à la dernière.
  await city('Ampelos').focus();
  await expect(city('Ampelos')).toBeChecked();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator(`input[value="${KALLISTE_ID}"]`)).toBeChecked();
  await expectNoHorizontalScroll(page);
  await page.getByLabel('Emblème').selectOption('trident');
  await page.getByLabel('Nom de la maison').press('Enter');

  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await expect(page.getByText('Métèque à Kallistè')).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Coquille : cinq onglets, en bas sur téléphone, sur le côté sur ordinateur ; navigation au clavier.
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav.getByRole('link')).toHaveCount(5);
  const [box, viewport] = [await nav.boundingBox(), page.viewportSize()];
  if (!box || !viewport) throw new Error('navigation introuvable');
  if (viewport.width < 1024) expect(Math.round(box.y + box.height)).toBe(viewport.height);
  else expect([box.x, Math.round(box.height)]).toEqual([0, viewport.height]);

  await nav.getByRole('link', { name: 'Maison' }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('link', { name: 'Agora' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Agora' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Agora' })).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalScroll(page);

  // Police agrandie à 200 % (réglage du navigateur) : aucun libellé d'onglet coupé ni superposé.
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  const tabs = await nav.getByRole('link').evaluateAll((links) =>
    links.map((link) => ({
      clipped: link.scrollWidth > link.clientWidth + 1,
      box: link.getBoundingClientRect().toJSON() as {
        left: number;
        right: number;
        top: number;
        bottom: number;
      },
    })),
  );
  expect(tabs.filter((tab) => tab.clipped)).toEqual([]);
  tabs.slice(1).forEach((tab, index) => {
    const previous = tabs[index];
    const sideBySide = previous && previous.box.right <= tab.box.left + 1;
    const stacked = previous && previous.box.bottom <= tab.box.top + 1;
    expect(sideBySide || stacked).toBe(true);
  });
  await expectNoHorizontalScroll(page);
  await page.evaluate(() => (document.documentElement.style.fontSize = ''));

  // Adresse inconnue : écran traduit, puis retour à la maison.
  await page.goto('/adresse-inconnue');
  await expect(page.getByRole('heading', { name: "Cette page n'existe pas." })).toBeVisible();
  await page.getByRole('link', { name: 'Revenir à la maison' }).click();
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await nav.getByRole('link', { name: 'Agora' }).click();

  // Thème sombre : appliqué et mémorisé.
  await page.getByRole('button', { name: 'Thème sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await nav.getByRole('link', { name: 'Maison' }).click();

  // La maison et le thème survivent au rechargement ; l'interface bascule en anglais et s'en souvient.
  await page.reload();
  await expect(page.getByRole('heading', { name: `Maison ${houseName}` })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.getByRole('heading', { name: `House ${houseName}` })).toBeVisible();
  await expect(page.getByText('Metic in Kallistè')).toBeVisible();
  // L'identité de la cité suit la langue.
  await page.getByRole('navigation').getByRole('link', { name: 'City' }).click();
  await expect(page.getByText('Protected by Demeter')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'House', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

// Le service worker, bloqué partout ailleurs (voir `playwright.config.ts`), est ici l'objet du test.
test.describe('avec service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('application installable : manifeste, service worker, coquille disponible hors ligne', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = (await (await page.request.get(manifestUrl ?? '')).json()) as {
      name: string;
      display: string;
      start_url: string;
      icons: { sizes: string; purpose?: string }[];
    };
    expect(manifest).toMatchObject({ name: 'OIKOS', display: 'standalone', start_url: '/' });
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

    // Le service worker prend la page en charge, puis la coquille se recharge sans réseau.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) =>
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
        );
      }
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: "Entrer dans l'Archipel" })).toBeVisible();
    await page.goto('/agora');
    await expect(page.getByRole('heading', { name: "Entrer dans l'Archipel" })).toBeVisible();
    await context.setOffline(false);
  });
});
